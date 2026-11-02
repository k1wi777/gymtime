# Tareas — E0 Fundaciones del backend

- [x] T1 — Monorepo: `package.json` raíz con workspaces y scripts delegados, `.nvmrc`, `engines`, `.npmrc` (`engine-strict`), `.editorconfig`, `.gitignore` (`.env`, `dist`, `node_modules`); verificar `npm install`, `lint`, `format:check` en limpio (R1–R4)
- [x] T2 — `docker-compose.yml` con PostgreSQL (versión fija, volumen, healthcheck) y primera versión de `.env.example` (R5, R6)
- [x] T3 — Módulo de configuración: esquema zod, `validate` con mensajes por variable, validación de clave de 32 bytes, `ConfigService` tipado, completar `.env.example`, tests unitarios (R6, R7, R8)
- [x] T4 — Schema de Prisma con los 13 modelos y enumeraciones de backlog §7, `@@map`/`@map` snake_case, claves compuestas e índices (R10, R11)
- [x] T5 — Migración inicial `init`; añadir a mano índice único parcial de huella activa y CHECK de `schedules`; scripts `migrate`, `migrate:deploy`, `db:generate`; verificar sobre base vacía en Docker (R10, R11)
- [x] T6 — `DatabaseModule` global con `PrismaService` (conexión/cierre, shutdown hooks) (R12)
- [x] T7 — Logging: `nestjs-pino`, JSON, pretty en desarrollo, nivel configurable, log de peticiones y redacción de secretos; tests de redacción (R13, R14, R15)
- [x] T8 — `HealthModule` con `GET /health` (200/503 por ping a la base) y tests unitarios (R16, R17)
- [x] T9 — `setupSwagger` con título, versión, esquema de clave de administrador y tags; publicar `/docs` y JSON (R18)
- [x] T10 — Reescribir `main.ts` (bufferLogs, logger, Swagger, shutdown hooks, listen `HOST:PORT`), retirar `app.controller`/`app.service` de ejemplo y actualizar `AppModule` (R9, R18)
- [x] T11 — Tests e2e de `/health` y `/docs` con `PrismaService` sustituido; comprobar que el arranque falla indicando la variable ausente (R7, R16, R18)
- [x] T12 — Actualizar `README` raíz/`server` con puesta en marcha (`nvm use`, `.env`, `docker compose up -d`, `npm run migrate`, `npm run start:dev`) y ejecutar `lint`, `test`, `test:e2e`, `build`
