# GymTime

Backend de control de asistencia y alarma por huella (ESP32 + NestJS + PostgreSQL). Monorepo npm con los workspaces `shared/` (protocolo), `simulator/` (ESP32 simulado), `cli/` (comando `gym`) y `server/`, más el panel `web/` (Next.js, fuera de los workspaces).

**Estado:** iteración 1 completa: hitos H1 (conexión), H2 (enrolamiento), H3 (asistencia y horarios), H4 (alarma y vencimientos) y H5 (órdenes con confirmación, heartbeat, eventos en vivo y pruebas integrales A1–A12) cerrados. El panel web arranca en la siguiente iteración con H8 (base y panel del asistente); el detalle está en [`docs/estado_firmware.md`](docs/estado_firmware.md).

## Estructura

| Carpeta | Contenido |
|---|---|
| `server/` | Backend NestJS (REST, WebSocket `/device`, Prisma). |
| `shared/` | Protocolo y esquemas compartidos. |
| `simulator/` | ESP32 simulado. |
| `cli/` | Comando `gym`. |
| `web/` | Panel web (Next.js 16, React 19): vistas del asistente. Proyecto aparte, con su propio `package.json`. |
| `docs/` | Documentación para firmware y protocolo. |

## Puesta en marcha

Requisitos: Node 24.7 o superior (`.nvmrc`; el hash de contraseñas usa `crypto.argon2` de Node), npm y Docker con Compose.

```bash
nvm use                      # Node 24
npm install                  # instala dependencias y genera el cliente Prisma
cp .env.example .env         # reemplaza DEVICE_TOKEN, ADMIN_API_KEY y ENCRYPTION_KEY
docker compose up -d         # PostgreSQL con volumen y healthcheck
npm run migrate              # aplica las migraciones (prisma migrate dev)
npm run build                # compila los workspaces
npm run start:dev -w server  # API en http://0.0.0.0:3000
```

Tras el `build` también puedes usar `npm run start:prod -w server` (`node dist/main`). Si hace falta regenerar el cliente Prisma: `npm run db:generate`.

- `ENCRYPTION_KEY` debe ser base64 de exactamente 32 bytes: `openssl rand -base64 32`.
- Si el arranque falla, el mensaje lista cada variable de `.env` ausente o inválida.
- Horarios y sincronización: `ENTRY_OPEN_MINUTES` (10) y `ENTRY_CLOSE_MINUTES` (5) fijan la ventana de ingreso por defecto (cada horario puede definir la suya) y `SYNC_LEAD_MINUTES` (15) cuánto antes del inicio se cargan las plantillas en el lector. Las horas de los horarios son de America/Bogota (UTC-5 fijo).
- Alarma: `ALARM_BEEP_SECONDS` (5) es el pitido corto cuando termina un horario vacío y `ALARM_TIMEOUT_MINUTES` (30) el plazo tras el fin para cerrar como `no_registrada` las sesiones que sigan abiertas.
- Pantalla del lector: `DISPLAY_COLS` (16) y `DISPLAY_ROWS` (2) fijan el tamaño del LCD y `DISPLAY_RESULT_SECONDS` (3) el tiempo por defecto de un mensaje. Los textos van sin tildes y de 16 caracteres como máximo; ver [`docs/mensajes_pantalla.md`](docs/mensajes_pantalla.md).
- Si el puerto 5432 está ocupado, cambia `POSTGRES_PORT` y el puerto en `DATABASE_URL`.
- `GET /health` (estado, uptime y base de datos; 503 si la base no responde).
- `GET /events` (SSE con `x-api-key` o con la cookie de sesión): eventos en vivo de conexiones, escaneos, órdenes y alarma; el operador los ve con `gym watch`.
- Las órdenes de enrolamiento y de alarma se guardan en `device_commands` antes de enviarse: si el lector está desconectado se entregan al reconectar, con el mismo `id` y en orden.
- Swagger UI en `/docs`; OpenAPI JSON en `/docs-json` (en producción solo con `ENABLE_DOCS=true`).
- Cuentas del panel (roles `asistente` y `admin`, sesión por cookie, bloqueo, CORS y CSRF): variables `COOKIE_*`, `CORS_ORIGINS`, `SESSION_*`, `LOGIN_*`, `TRUST_PROXY` y `FIRST_ADMIN_*` del `.env.example`, descritas en [`docs/autenticacion.md`](docs/autenticacion.md). La CLI y los scripts con `x-api-key` siguen funcionando igual. Para crear el primer administrador define `FIRST_ADMIN_USERNAME` y `FIRST_ADMIN_PASSWORD` antes de arrancar con la tabla de cuentas vacía.

## Panel web (`web/`)

El panel es un proyecto Next.js independiente: no forma parte de los workspaces, así que se instala por separado. Llama a la API directamente desde el navegador (cookie de sesión + CORS), por lo que la API y el panel usan puertos distintos.

```bash
npm run install:web          # npm --prefix web install
cp web/.env.example web/.env.local
# .env de la API: PORT=3001 y CORS_ORIGINS=http://localhost:3000
npm run dev:server           # API en http://localhost:3001 (PORT=3001)
npm run dev:web              # panel en http://localhost:3000
```

- `NEXT_PUBLIC_API_URL` (en `web/.env.local`) es la URL de la API; se incrusta en el build y nunca debe contener secretos.
- Primer acceso: crea el administrador con `FIRST_ADMIN_USERNAME`/`FIRST_ADMIN_PASSWORD` (ver arriba) e inicia sesión en `http://localhost:3000`.
- Manual de uso para el asistente: [`docs/manual_asistente.md`](docs/manual_asistente.md).
- Los tipos de la API se generan de `server/openapi.json` (`npm --prefix web run gen:api`); si cambias los DTO del servidor, regenera con `npm --prefix server run openapi:export` y luego `gen:api`.
- Pruebas del panel: `npm --prefix web test` (componentes, sin navegador) y `npm --prefix web run test:e2e` (Playwright con el Chrome del sistema contra un servidor en memoria; lento).

## Simulador y firmware

- `SIM_DEVICE_TOKEN=<DEVICE_TOKEN> npm run simulator` conecta un ESP32 simulado al backend (opciones `SIM_URL`, `SIM_DEVICE_ID`, `SIM_FW` o `--url`, `--device-id`, `--token`, `--fw`).
- Enrolamiento simulado: el simulador responde `enroll.start` sin hardware. Opciones `SIM_ENROLL_MODE` (`ok`|`fail`|`silent`), `SIM_ENROLL_STEP_MS`, `SIM_ENROLL_FAIL_REASON`, `SIM_TEMPLATE_BYTES` o `--enroll-mode`, `--enroll-step-ms`, `--enroll-fail-reason`, `--template-bytes` (detalle en la guía).
- Lector simulado: guarda las plantillas de `templates.sync` (borra todo al llegar un `syncId` nuevo), confirma cada bloque, muestra `schedule.set` en hora de Bogotá e informa su conteo en `status.fingerprintCount`. Solo imprime slots y conteos, nunca plantillas.
- Alarma simulada: muestra cada `alarm.set` como `ALARM ON (motivo) continua` o `ALARM ON (motivo) N s` / `ALARM OFF (motivo)`; con una duración numérica se apaga sola y reporta `alarm.state` con origen `local`.
- Comandos interactivos del simulador (`sim>`): `scan <slot>` envía una huella leída, `button` pulsa el botón físico, `disconnect`/`reconnect` cortan y retoman la conexión, y `help` muestra la ayuda.
- [`docs/integracion_firmware.md`](docs/integracion_firmware.md): guía para conectar el ESP32 real (backend, IP, token y secuencia) y guía de problemas comunes con síntoma, causa, verificación y solución (sección 8). Referencia del protocolo: [`docs/protocolo_v0.md`](docs/protocolo_v0.md).

## CLI `gym`

Administración desde la terminal contra la API REST. Se ejecuta con `npm run gym -- <grupo> <acción> [opciones]` (compila `cli/` antes) o, tras `npm run build -w cli`, con `node cli/dist/main.js`. `gym --help` lista todos los comandos; `gym <grupo> --help` los de un grupo.

Configuración, con esta precedencia: opción `--url`/`--api-key` > variables `GYM_URL`/`GYM_API_KEY` > archivo `~/.config/gymtime/cli.json` (`{"url": "...", "apiKey": "..."}`, ruta cambiable con `GYM_CONFIG`) > defecto (solo la URL: `http://localhost:3000`). La clave es el `ADMIN_API_KEY` del `.env`, viaja en la cabecera `x-api-key` y nunca se imprime. Evita `--api-key`: queda en el historial del shell.

| Comando | Efecto |
|---|---|
| `gym student add --document <doc> --name <nombre> [--program <carrera>] [--email <correo>] [--phone <teléfono>] [--display-name <texto>] [--consented]` | Registra un estudiante. `--document` es la cédula y `--program` la carrera; correo y teléfono son opcionales (Ley 1581: solo se guardan si se indican, no van a los logs ni al lector). `--display-name` (máx. 16 caracteres ASCII) es el nombre que muestra el LCD; si se omite se genera. |
| `gym student edit <documento> [--name] [--program] [--email] [--phone] [--display-name]` | Modifica los datos indicados. |
| `gym student list [--active true\|false]` | Tabla de estudiantes. |
| `gym student remove <documento>` | Desactiva al estudiante (borra su huella). |
| `gym enroll start --student <documento> [--device <id>]` | Inicia el enrolamiento y muestra cada paso del dispositivo hasta `done`, `failed`, `expired` o `cancelled` (código 0 solo en `done`). Ctrl+C lo cancela. |
| `gym enroll cancel <enrollmentId>` | Cancela el enrolamiento con el id que imprime `start`. |
| `gym schedule create --name <n> (--weekday 1-7 \| --date YYYY-MM-DD) --start HH:mm --end HH:mm [--student <doc>]... [--entry-open <min>] [--entry-close <min>]` | Crea un horario recurrente (1 = lunes ... 7 = domingo) o de una fecha, en hora de Bogotá; `--student` es repetible. |
| `gym schedule create --name <n> --ends-in 3m [--student <doc>]...` | Horario de prueba: hoy, empieza ahora y termina en N minutos (el margen de cierre de ingreso queda en 0). |
| `gym schedule assign --schedule <id> --student <doc>` | Asigna un estudiante a un horario. |
| `gym schedule list`, `gym schedule show --schedule <id>` | Lista los horarios; detalle con estudiantes y próximas fechas en hora de Bogotá. |
| `gym sync` | Carga en el lector en línea las plantillas y el horario vigentes; muestra bloques y plantillas enviados (nunca su contenido). Código 1 si falla; 409 si no hay dispositivo. |
| `gym sessions open` | Lista quién está dentro ahora mismo. |
| `gym sessions list [--student <doc>] [--status abierta\|cerrada\|no_registrada] [--limit <n>]` | Historial de sesiones; la hora se muestra en Bogotá. |
| `gym attendance entry --student <doc> --reason <texto>` | Registra una entrada manual (el motivo es obligatorio). |
| `gym attendance exit --student <doc> --reason <texto>` | Registra una salida manual (el motivo es obligatorio); si era la última, apaga la alarma. |
| `gym alarm status` | Muestra si la sirena está encendida, su motivo, la ocurrencia, la duración y las sesiones abiertas. |
| `gym alarm on` / `gym alarm test` | Enciende la sirena de forma continua (`MANUAL`) o con el pitido corto de prueba (`TEST`); 409 si no hay dispositivo en línea. |
| `gym alarm off` | Silencia la sirena, marca como `no_registrada` las sesiones abiertas de la ocurrencia alarmada e informa cuántas cerró; 409 si no estaba encendida. |
| `gym device message "línea 1" ["línea 2"] [--seconds N] [--device ID]` | Muestra un mensaje en el LCD del lector (sin tildes; máx. 2 líneas de 16 caracteres; 1 a 60 s). Con el lector desconectado queda en cola y se entrega al reconectar; sale con error si no lo confirma. |
| `gym device status` | Tabla de dispositivos: en línea, última conexión en Bogotá, versión de firmware y órdenes pendientes de confirmar. |
| `gym watch` | Muestra en vivo los eventos del servidor (conexiones, escaneos, órdenes y alarma) con hora de Bogotá; se reconecta solo y se corta con Ctrl+C. |

La sincronización es automática al conectarse el dispositivo, al terminar un enrolamiento y 15 minutos antes de cada horario y al terminar. Un horario creado con `--ends-in` o que empieza dentro de esos 15 minutos ya pasó su disparador: `gym schedule create` lo avisa y hay que ejecutar `gym sync` a mano. Quitar un estudiante de un horario solo existe en REST (`DELETE /schedules/:id/students/:studentId`): cierra su vigencia (`valid_to`) sin borrar la fila, de modo que el historial se conserva y asignarlo de nuevo abre otra vigencia. Los cambios de estudiantes, horarios, alarma manual y mensajes quedan en `event_log` con su origen (`actor_type`: `system` para la clave de administración, `device` para el lector). Capacidad: 161 plantillas por sincronización, porque el slot 162 es el de trabajo del enrolamiento.

Ejemplo sin hardware (backend y simulador en marcha, ver «Simulador y firmware»):

```bash
export GYM_API_KEY=<ADMIN_API_KEY>
npm run gym -- student add --document 123 --name "Ana" --consented
npm run gym -- enroll start --student 123
npm run gym -- schedule create --name Prueba --ends-in 3m --student 123
npm run gym -- sync        # el simulador recibe templates.sync y schedule.set
```

Al reenrolar a un estudiante la huella anterior se borra (no se conserva inactiva).

## Checks y pruebas

```bash
npm run lint
npm run format:check
npm test            # pruebas unitarias de todos los workspaces
npm run test:e2e    # pruebas e2e (lentas)
npm --prefix web test   # panel: componentes (vitest + jsdom) y tipos de la API al día
npm --prefix web run test:e2e  # panel en Chrome real (lento; ver «Panel web»)
npm run test:scenarios  # escenarios integrales A1–A12 con el simulador
npm run test:migration  # migra una base de la iteración 1 y verifica datos e índices (requiere PostgreSQL, p. ej. docker compose up -d)
```

### Escenarios integrales A1–A12

`npm run test:scenarios` ejecuta con un solo comando los doce escenarios del
backlog, con el simulador real contra el gateway y sin pasos manuales:

| Escenario | Qué demuestra |
|---|---|
| A1 | El enrolamiento deja la plantilla cifrada y lista para el lector. |
| A2/A3 | La misma huella registra la entrada y después la salida. |
| A4 | Una huella desconocida muestra «No reconocida» / «Intente de nuevo» y no abre sesión. |
| A5 | Un estudiante del lector que ya no está en el horario es rechazado con `NOT_IN_SCHEDULE`. |
| A6 | Un escaneo sin horario activo se rechaza con `NO_ACTIVE_SCHEDULE`. |
| A7/A8 | Al terminar un horario con gente dentro la alarma sigue encendida (`PENDING_EXIT`) y se apaga (`CLEARED`) cuando sale el último. |
| A9 | El apagado manual por botón o por CLI silencia la sirena y deja las sesiones `no_registrada`. |
| A10 | La orden encolada se entrega al reconectar con su `id` y un mensaje duplicado no se procesa dos veces. |
| A11 | Un horario vacío pita 5 s y la alarma se apaga sola. |
| A12 | Dos horarios consecutivos resuelven cada estudiante a su propio horario. |

- **Requisitos:** Node 24 y `npm install`. No hace falta Docker, PostgreSQL ni
  hardware: los escenarios arrancan el servidor con repositorios en memoria, un
  reloj controlado y una alarma con tick corto.
- **Duración esperada:** por debajo de 60 s (unos 12 s incluyendo la compilación
  de `shared` y `simulator`). Solo A11 espera tiempo real, los 5 s del aviso
  corto; el resto mueve el reloj.
- **Código:** arranque y utilidades en `server/test/support/scenario-app.ts`,
  cliente mínimo de protocolo en `server/test/support/raw-device.ts` y los
  escenarios en `server/test/scenarios/a1-a12.e2e-spec.ts`.
- La cola de órdenes (ack, idempotencia y reenvío) se prueba en
  `server/test/commands.e2e-spec.ts` y corre con `npm run test:e2e`.

## Producción (H11)

Imágenes (`server/Dockerfile`, `web/Dockerfile`), `deploy/docker-compose.prod.yml` con Caddy, respaldo y restauración (`deploy/backup.sh`, `deploy/restore.sh`), rotación de la clave de cifrado (`npm run keys:rotate -w server`), tokens por lector (`gym device register|rotate|revoke`), alertas de lector sin conexión y supresión de datos (`gym student erase`). Cabeceras de seguridad y CSP en la API y el panel. Guías: [`docs/despliegue.md`](docs/despliegue.md), [`docs/runbook.md`](docs/runbook.md) y [`docs/guia_wss_firmware.md`](docs/guia_wss_firmware.md). Comprobaciones: `deploy/verify-images.sh` (imágenes), `npm run test:ops-db -w server` (respaldo, rotación y candado contra PostgreSQL), `deploy/security-review.sh` y `deploy/scan-secrets.sh`.

## Documentación

- [`docs/despliegue.md`](docs/despliegue.md), [`docs/runbook.md`](docs/runbook.md), [`docs/guia_wss_firmware.md`](docs/guia_wss_firmware.md): despliegue, operación y `wss://` para el firmware.
- [`docs/autenticacion.md`](docs/autenticacion.md): credenciales, roles, matriz de permisos, cookie, CORS, CSRF y primer administrador.
- [`docs/manual_asistente.md`](docs/manual_asistente.md): manual del panel para el asistente del gimnasio.
- [`docs/estado_firmware.md`](docs/estado_firmware.md): qué está disponible y qué falta.
- [`docs/integracion_firmware.md`](docs/integracion_firmware.md): conectar el ESP32 o el simulador y diagnosticar los problemas comunes (sección 8).
- [`docs/protocolo_v0.md`](docs/protocolo_v0.md): protocolo.
- [`backlog_iteracion_1_backend.md`](backlog_iteracion_1_backend.md): backlog e hitos.

## Scripts (raíz)

`npm run simulator`, `npm run gym`, `lint`, `format`, `format:check`, `test`, `test:e2e`, `build`, `migrate`, `migrate:deploy` (entornos no interactivos), `db:generate`, `install:web`, `dev:server` (API en el puerto 3001) y `dev:web`.

## Notas

- El puerto por defecto es 3000; para el desarrollo con el panel en `localhost:3000` y la API en `localhost:3001` define `PORT=3001` (y `GYM_URL` para la CLI).
- Prisma 7: configuración en `server/prisma.config.ts`, cliente generado en `server/src/generated/` (no versionado) y adaptador `@prisma/adapter-pg`.
- El índice único parcial de huella activa y el CHECK de `schedules` se escriben a mano en la migración `init`; consérvalos si se regenera.
