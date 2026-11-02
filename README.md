# GymTime

Backend de control de asistencia y alarma por huella (ESP32 + NestJS + PostgreSQL). Monorepo npm con los workspaces `shared/` (protocolo), `simulator/` (ESP32 simulado), `cli/` (comando `gym`) y `server/`.

**Estado:** hitos H1 (conexión), H2 (enrolamiento), H3 (asistencia y horarios) y H4 (alarma y vencimientos) cerrados. Falta el panel web y los hitos posteriores; el detalle está en [`docs/estado_firmware.md`](docs/estado_firmware.md).

## Estructura

| Carpeta | Contenido |
|---|---|
| `server/` | Backend NestJS (REST, WebSocket `/device`, Prisma). |
| `shared/` | Protocolo y esquemas compartidos. |
| `simulator/` | ESP32 simulado. |
| `cli/` | Comando `gym`. |
| `docs/` | Documentación para firmware y protocolo. |

## Puesta en marcha

Requisitos: Node 24 (`.nvmrc`), npm y Docker con Compose.

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
- Si el puerto 5432 está ocupado, cambia `POSTGRES_PORT` y el puerto en `DATABASE_URL`.
- `GET /health` (estado, uptime y base de datos; 503 si la base no responde).
- Swagger UI en `/docs`; OpenAPI JSON en `/docs-json`.

## Simulador y firmware

- `SIM_DEVICE_TOKEN=<DEVICE_TOKEN> npm run simulator` conecta un ESP32 simulado al backend (opciones `SIM_URL`, `SIM_DEVICE_ID`, `SIM_FW` o `--url`, `--device-id`, `--token`, `--fw`).
- Enrolamiento simulado: el simulador responde `enroll.start` sin hardware. Opciones `SIM_ENROLL_MODE` (`ok`|`fail`|`silent`), `SIM_ENROLL_STEP_MS`, `SIM_ENROLL_FAIL_REASON`, `SIM_TEMPLATE_BYTES` o `--enroll-mode`, `--enroll-step-ms`, `--enroll-fail-reason`, `--template-bytes` (detalle en la guía).
- Lector simulado: guarda las plantillas de `templates.sync` (borra todo al llegar un `syncId` nuevo), confirma cada bloque, muestra `schedule.set` en hora de Bogotá e informa su conteo en `status.fingerprintCount`. Solo imprime slots y conteos, nunca plantillas.
- Alarma simulada: muestra cada `alarm.set` como `ALARM ON (motivo) continua` o `ALARM ON (motivo) N s` / `ALARM OFF (motivo)`; con una duración numérica se apaga sola y reporta `alarm.state` con origen `local`.
- Comandos interactivos del simulador (`sim>`): `scan <slot>` envía una huella leída, `button` pulsa el botón físico, `disconnect`/`reconnect` cortan y retoman la conexión, y `help` muestra la ayuda.
- [`docs/integracion_firmware.md`](docs/integracion_firmware.md): guía para conectar el ESP32 real (backend, IP, token, secuencia, problemas comunes). Referencia del protocolo: [`docs/protocolo_v0.md`](docs/protocolo_v0.md).

## CLI `gym`

Administración desde la terminal contra la API REST. Se ejecuta con `npm run gym -- <grupo> <acción> [opciones]` (compila `cli/` antes) o, tras `npm run build -w cli`, con `node cli/dist/main.js`. `gym --help` lista todos los comandos; `gym <grupo> --help` los de un grupo.

Configuración, con esta precedencia: opción `--url`/`--api-key` > variables `GYM_URL`/`GYM_API_KEY` > archivo `~/.config/gymtime/cli.json` (`{"url": "...", "apiKey": "..."}`, ruta cambiable con `GYM_CONFIG`) > defecto (solo la URL: `http://localhost:3000`). La clave es el `ADMIN_API_KEY` del `.env`, viaja en la cabecera `x-api-key` y nunca se imprime. Evita `--api-key`: queda en el historial del shell.

| Comando | Efecto |
|---|---|
| `gym student add --document <doc> --name <nombre> [--program <p>] [--consented]` | Registra un estudiante. |
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

La sincronización es automática al conectarse el dispositivo, al terminar un enrolamiento y 15 minutos antes de cada horario y al terminar. Un horario creado con `--ends-in` o que empieza dentro de esos 15 minutos ya pasó su disparador: `gym schedule create` lo avisa y hay que ejecutar `gym sync` a mano. Quitar un estudiante de un horario solo existe en REST (`DELETE /schedules/:id/students/:studentId`). Capacidad: 161 plantillas por sincronización, porque el slot 162 es el de trabajo del enrolamiento.

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
```

## Documentación

- [`docs/estado_firmware.md`](docs/estado_firmware.md): qué está disponible y qué falta.
- [`docs/integracion_firmware.md`](docs/integracion_firmware.md): conectar el ESP32 o el simulador.
- [`docs/protocolo_v0.md`](docs/protocolo_v0.md): protocolo.
- [`backlog_iteracion_1_backend.md`](backlog_iteracion_1_backend.md): backlog e hitos.

## Scripts (raíz)

`npm run simulator`, `npm run gym`, `lint`, `format`, `format:check`, `test`, `test:e2e`, `build`, `migrate`, `migrate:deploy` (entornos no interactivos), `db:generate`.

## Notas

- Prisma 7: configuración en `server/prisma.config.ts`, cliente generado en `server/src/generated/` (no versionado) y adaptador `@prisma/adapter-pg`.
- El índice único parcial de huella activa y el CHECK de `schedules` se escriben a mano en la migración `init`; consérvalos si se regenera.
