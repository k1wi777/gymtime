# GymTime

Backend de control de asistencia y alarma por huella (ESP32 + NestJS + PostgreSQL). Monorepo npm con los workspaces `shared/` (protocolo), `simulator/` (ESP32 simulado) y `server/`.

## Puesta en marcha

Requisitos: Node 24 (`.nvmrc`), npm y Docker.

```bash
nvm use                      # Node 24
npm install                  # instala dependencias y genera el cliente Prisma
cp .env.example .env         # reemplaza DEVICE_TOKEN, ADMIN_API_KEY y ENCRYPTION_KEY
docker compose up -d         # PostgreSQL con volumen y healthcheck
npm run migrate              # aplica las migraciones (prisma migrate dev)
npm run start:dev -w server  # API en http://0.0.0.0:3000
```

- `ENCRYPTION_KEY` debe ser base64 de exactamente 32 bytes: `openssl rand -base64 32`.
- Si el arranque falla, el mensaje lista cada variable de `.env` ausente o inválida.
- Si el puerto 5432 está ocupado, cambia `POSTGRES_PORT` y el puerto en `DATABASE_URL`.
- `GET /health` (estado, uptime y base de datos; 503 si la base no responde).
- Swagger UI en `/docs`; OpenAPI JSON en `/docs-json`.

## Simulador y firmware

- `SIM_DEVICE_TOKEN=<DEVICE_TOKEN> npm run simulator` conecta un ESP32 simulado al backend (opciones `SIM_URL`, `SIM_DEVICE_ID`, `SIM_FW` o `--url`, `--device-id`, `--token`, `--fw`).
- [`docs/integracion_firmware.md`](docs/integracion_firmware.md): guía para conectar el ESP32 real (backend, IP, token, secuencia, problemas comunes). Referencia del protocolo: [`docs/protocolo_v0.md`](docs/protocolo_v0.md).

## Scripts (raíz)

`npm run simulator`, `lint`, `format`, `format:check`, `test`, `test:e2e`, `build`, `migrate`, `migrate:deploy` (entornos no interactivos), `db:generate`.

## Notas

- Prisma 7: configuración en `server/prisma.config.ts`, cliente generado en `server/src/generated/` (no versionado) y adaptador `@prisma/adapter-pg`.
- El índice único parcial de huella activa y el CHECK de `schedules` se escriben a mano en la migración `init`; consérvalos si se regenera.
