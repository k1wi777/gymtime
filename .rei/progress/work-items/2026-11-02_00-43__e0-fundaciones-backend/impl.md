# Implementación — E0 Fundaciones del backend

## Resumen
T1–T12 completadas. Monorepo npm con workspace `server`, PostgreSQL en Docker, configuración validada con zod, esquema Prisma con migración `init`, logging pino, `GET /health` y Swagger en `/docs`.

## Archivos
- Raíz: `package.json`, `.nvmrc` (24), `.npmrc` (engine-strict), `.editorconfig`, `.gitignore`, `docker-compose.yml`, `.env.example`, `README.md`.
- `server/`: `package.json` (scripts `migrate`, `migrate:deploy`, `db:generate`, `format:check`, `postinstall`), `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/*_init`, `src/config/`, `src/database/`, `src/common/logging/`, `src/health/`, `src/swagger.ts`, `src/main.ts`, `src/app.module.ts`, `test/*.e2e-spec.ts`, `README.md`.
- Eliminados: `app.controller/service` de ejemplo, su spec y el e2e original.
- `.rei/config.json`: V3 apunta a `node_modules/.bin/tsc` (raíz) porque con workspaces el binario se eleva y ya no existe en `server/node_modules`.

## Decisiones y desviaciones
- **Prisma**: confirmado en la documentación oficial (v7.10.1 estable; 8.0 sigue en rc). Prisma 7 exige `prisma.config.ts`, generador `prisma-client` con `output` propio (`server/src/generated/prisma`, ignorado en git, `importFileExtension = "js"` por ESM/NodeNext), `datasource.url` en el config (no en el schema) y adaptador `@prisma/adapter-pg`. El config carga el `.env` de la raíz con `process.loadEnvFile`; `DATABASE_URL` no es obligatoria para `generate` (postinstall).
- Campos Prisma en inglés (camelCase), columnas con los nombres del backlog (`documento`, `plantilla`, ...). Enum de origen de asistencia (`device|manual`) y `schedule_instances.estado` (texto, default `scheduled`) no estaban definidos en el backlog: son supuestos mínimos.
- `ConfigModule.forRoot` es asíncrono en @nestjs/config 12: la validación falla en el bootstrap antes de abrir el puerto; el e2e de arranque lo prueba sobre `forRoot`, y se comprobó a mano con `DEVICE_TOKEN= node dist/main.js`.
- Dependencias nuevas (justificación): `@nestjs/config` (carga/validación), `zod` (esquema de env), `@nestjs/swagger` (R18), `nestjs-pino`/`pino`/`pino-http` (+`pino-pretty` dev) (R13–R15), `prisma`/`@prisma/client`/`@prisma/adapter-pg`/`pg` (+`@types/pg`) (R10–R12).
- `ENCRYPTION_KEY` vacía en `.env.example` (obligatoria; hay que generarla).

## Verificación
- `rei check --quiet` (V1 oxlint, V2 vitest, V3 tsc): OK. `npm run lint`, `format:check`, `test` (11), `test:e2e` (4), `build`: OK.
- Docker disponible: `docker compose up -d` -> contenedor healthy (R5); `npm run migrate` sobre base vacía creó las 13 tablas + `_prisma_migrations` (R10). Probado en SQL: documento duplicado, segunda huella activa y horario con día y fecha a la vez son rechazados (R11).
- Con la app real (`node dist/main.js`): `/health` 200 y, con Postgres detenido, 503; `/docs` 200 y `/docs-json` con `/health`; log pretty en development y JSON en production; la cabecera `x-admin-key` no aparece en logs (R9, R13–R18).
- Nota local: el puerto 5432 estaba ocupado por otro proyecto; el `.env` local (no versionado) usa `POSTGRES_PORT=5433`.

## Observaciones
- Con el adaptador pg, Prisma conecta de forma perezosa: si la base está caída el servidor arranca igual y `/health` responde 503 (comportamiento deseado).
- Quedan registrados con `git add` los archivos nuevos (no `.rei/progress/`); sin commit.

## Rework (review.md)
- `.rei/docs/project/verification.md`: fila V3 ahora `node_modules/.bin/tsc --noEmit -p server/tsconfig.json`, igual que `.rei/config.json`. Sin otros cambios.
