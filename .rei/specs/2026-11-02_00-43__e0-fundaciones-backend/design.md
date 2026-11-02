# Diseño — E0 Fundaciones del backend

## Estrategia

Partir del proyecto NestJS 12 ya creado en `server/` (ESM, vitest, oxlint, prettier) y añadir, en orden, tooling de monorepo, Postgres, configuración, Prisma, logging y health/Swagger. No se crea ningún módulo de dominio: solo infraestructura transversal que `devices` y el resto consumirán. Los directorios `cli/`, `simulator/`, `shared/` NO se crean ahora (YAGNI); los workspaces se declaran con `server` y se amplían cuando existan.

## Archivos involucrados

Raíz: `package.json` (workspaces, scripts delegados, `engines`), `.nvmrc`, `.editorconfig`, `.gitignore`, `docker-compose.yml`, `.env.example`.

`server/`: `package.json` (scripts `migrate`, `migrate:deploy`, `db:generate`), `prisma/schema.prisma`, `prisma/migrations/`, `prisma.config.ts` (si la versión de Prisma lo exige), `src/main.ts`, `src/app.module.ts`, `src/config/` (esquema + módulo), `src/database/` (módulo + servicio), `src/health/` (módulo + controlador), `src/common/logging/` (configuración de pino y redacción), tests `*.spec.ts` junto a cada pieza y e2e en `test/`.

Se eliminan `app.controller`/`app.service` de ejemplo (y su spec) al no aportar valor.

## Decisiones

### D1. Monorepo con npm workspaces y `.env` único en la raíz
npm ya es el gestor del proyecto (hay `package-lock.json`). Workspaces dan un `npm install`/`npm run lint` únicos. El `.env` vive en la raíz porque `docker-compose.yml` y el servidor comparten credenciales de Postgres; el servidor lo carga desde la raíz (ruta resuelta explícitamente, no depende del cwd). Descartado: pnpm/turbo (peso innecesario para 4 paquetes).

### D2. Node fijo
`.nvmrc` y `engines.node` con la versión LTS 24 (la del entorno, v24.x). `engine-strict=true` en `.npmrc` para que una versión errónea falle de forma explícita.

### D3. Lint y formato
Se conservan oxlint (type-aware) y prettier ya presentes. Scripts raíz `lint`, `format`, `format:check` delegan a `server` con `--workspaces --if-present`. Se añade `.editorconfig` coherente con `.prettierrc`. Descartado: migrar a ESLint (reabre una decisión ya tomada por el scaffold).

### D4. Validación de configuración con zod
Un esquema zod único (`src/config/env.schema.ts`) parsea `process.env` y es la fuente de los tipos de la configuración. Se usa `@nestjs/config` con la función `validate`, que formatea los errores como lista "VARIABLE: motivo". El fallo lanza antes de que Nest abra el puerto (R7). `ENCRYPTION_KEY` se declara en base64 y se valida a 32 bytes (R8); solo se valida la variable, el servicio de cifrado es de otro Work Item. Sin valores por defecto para secretos (`DATABASE_URL`, `DEVICE_TOKEN`, `ADMIN_API_KEY`, `ENCRYPTION_KEY`); sí para `HOST=0.0.0.0`, `PORT=3000`, `LOG_LEVEL=info`, `NODE_ENV=development`. Se exige longitud mínima a los tokens para evitar valores de ejemplo triviales. Un `ConfigService` tipado se inyecta; no se lee `process.env` fuera de este módulo.

Esta es validación de entorno, no el protocolo zod del dispositivo (fuera de alcance, irá en `shared`).

### D5. PostgreSQL en Docker
`docker-compose.yml` con imagen `postgres` (major fijo), variables tomadas del `.env` con `${VAR:-default}`, volumen nombrado, puerto expuesto en 5432 (configurable) y `healthcheck` con `pg_isready`. Solo la base de datos; el servidor corre en el host durante el desarrollo.

### D6. Prisma y modelo de datos
Un `schema.prisma` traduce literalmente el backlog §7 a trece modelos. Convenciones: modelos en PascalCase mapeados con `@@map` a tablas snake_case del backlog y campos con `@map`; claves `uuid` generadas por la base de datos para `id` (los dispositivos reales los referencian por `device_id` textual, ver abajo). Puntos que requieren decisión explícita:

- **Enumeraciones** nativas de Postgres para: estado de `enrollments`, estado de `attendance_sessions` (`abierta|cerrada|no_registrada`, valores del backlog), estado de `device_commands`, `closed_by` de `alarm_events`, origen de entrada/salida. Los valores se mantienen tal como figuran en el backlog; los nombres de campo van en inglés salvo donde el backlog fija otro.
- **`students.documento`** `@unique`. **Una huella activa por estudiante:** `fingerprints` lleva `activa Boolean` y un índice único parcial `(student_id) WHERE activa` creado en SQL dentro de la migración (Prisma no expresa índices parciales; se añade a mano al `migration.sql` generado). Se documenta en un comentario del schema.
- **`devices.id`** es texto (identificador que el dispositivo envía en `hello`), no uuid; `device_slots` tiene clave compuesta `(device_id, slot)`.
- **`schedules`**: `dia_semana` entero nullable y `fecha` date nullable, con CHECK (exactamente uno no nulo) añadido en SQL de la migración. `inicio`/`fin` como `time` (`@db.Time`); `margen_ingreso` en minutos.
- **`schedule_instances`** único `(schedule_id, fecha)` para que el generador diario sea idempotente más adelante.
- **`processed_messages`** clave primaria `(device_id, message_id)` para la idempotencia (A10).
- **`device_commands`**: `payload` `Json`; índice `(device_id, estado)` para la consulta de pendientes.
- Fechas/horas de eventos como `timestamptz`.
- `fingerprints.plantilla` como `Bytes` (contenido ya cifrado) junto con `iv` `Bytes`; el tag GCM se concatena al cifrado, decisión que ejecuta el servicio de cifrado futuro.
- Sin `seed` en este Work Item.

Se versiona una única migración inicial (`init`). `npm run migrate` ejecuta `prisma migrate dev`; `migrate:deploy` para entornos no interactivos. El cliente generado se produce vía `postinstall`/`db:generate` y no se versiona.

La versión de Prisma se toma de la estable vigente; si ésta exige `prisma.config.ts` y adaptador de driver (`@prisma/adapter-pg`), se usa. El Implementer confirma contra la documentación oficial vigente antes de escribir el cliente.

Descartado: TypeORM/Drizzle (decisión fija: Prisma); `@@unique` parcial por lógica de aplicación (no garantiza R11).

### D7. `DatabaseModule` global
Un `PrismaService` (extiende/envuelve el cliente) con `onModuleInit`/`onModuleDestroy` y habilitación de shutdown hooks. Módulo `@Global` para que los repositorios Prisma futuros lo reciban por inyección. Los repositorios en sí NO se crean aquí.

### D8. Logging con pino (`nestjs-pino`)
`nestjs-pino` registra peticiones HTTP, reemplaza el logger de Nest (`app.useLogger`) y deja un `Logger` inyectable con contexto. Salida JSON; en `NODE_ENV=development` se usa transporte `pino-pretty` (dependencia de desarrollo; no se carga en producción). Redacción (`redact`) de cabeceras `authorization`, `x-admin-key`, `x-device-token` y de campos `token`, `plantilla`, `template`. Los mensajes WebSocket y las decisiones del dominio se registrarán desde el gateway y los services futuros con este mismo logger; aquí solo se deja la infraestructura y una convención de campos (`deviceId`, `messageId`, `event`) documentada en el módulo. Descartado: winston (menos ergonomía JSON), logger por defecto de Nest (sin estructura).

### D9. Health y Swagger
`GET /health` implementado sin `@nestjs/terminus` (un solo indicador): ejecuta `SELECT 1` con timeout corto y lanza `ServiceUnavailableException` (503) si falla. Swagger con `@nestjs/swagger` configurado en `main.ts` mediante una función `setupSwagger(app)` en su propio archivo (testeable). Se declara `addApiKey` para la cabecera de administrador; la autenticación por guard NO se implementa aquí (la usarán los endpoints de `admin`). `/health` queda público y se etiqueta en Swagger.

### D10. Arranque
`main.ts` crea la app con `bufferLogs`, aplica logger, Swagger y shutdown hooks y escucha en `HOST:PORT` leídos de `ConfigService`. Se registra un log de arranque con URL y versión de Node.

## Pruebas

- Unitarias: esquema de env (válido, falta variable, clave de cifrado de longitud errónea, múltiples errores listados), redacción del logger.
- Controlador de salud con `PrismaService` simulado (ok y fallo → 503).
- e2e: `/health` y `/docs` responden usando un `PrismaService` sustituido (sin Postgres).
- Verificación manual/documentada: `docker compose up -d` + `npm run migrate` sobre base vacía y comprobación de tablas e índices (R10, R11); estas pruebas no se automatizan en CI por requerir Docker.

## Riesgos

- Cambios incompatibles de Prisma en su versión más reciente (config y adaptador): mitigado con confirmación de la documentación.
- Índice parcial y CHECK editados a mano en la migración: se regeneran con cuidado si se rehace la migración; se anota en el schema.
- Docker puede no estar disponible en la máquina del Implementer: R5/R10 se verifican entonces en el entorno del equipo.
