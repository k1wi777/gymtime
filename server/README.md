# GymTime server

API NestJS (REST + WebSocket futuro). Puesta en marcha y scripts: ver el [README de la raíz](../README.md).

- Configuración validada con zod en `src/config/` (única lectura de variables de entorno).
- Acceso a datos: `src/database/` (`PrismaService` global); esquema en `prisma/schema.prisma`.
- Logging con pino en `src/common/logging/` (campos de dominio: `deviceId`, `messageId`, `event`).
- `src/health/` expone `GET /health`; Swagger se configura en `src/swagger.ts`.
