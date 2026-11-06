# Reporte de la iteración 1 — GymTime UniCórdoba

**Fecha del reporte:** 5 de noviembre de 2026
**Periodo:** 2 de noviembre de 2026 (implementación completa en un día)
**Estado:** iteración 1 completa
**Alcance:** backend local, CLI, simulador de ESP32 y documentación de firmware

---

## 1. Resumen ejecutivo

La iteración 1 entrega un backend local funcional para el control de acceso y de
tiempo de permanencia del gimnasio, con un ESP32 simulado y una CLI de
administración. El sistema ya permite el flujo completo: enrolar la huella de un
estudiante, cargar las plantillas en el lector, decidir entrada o salida con cada
escaneo, registrar la asistencia y hacer sonar la alarma al terminar el horario
mientras quede gente dentro.

Se cerraron los cinco hitos del backlog (H1 a H5): 13 Work Items, todos en
`done`, con revisión independiente, 6 migraciones de base de datos y una suite de
pruebas que incluye los 12 escenarios de aceptación A1–A12 ejecutables con un
solo comando.

**Lo que queda fuera de esta iteración:** el panel web y el mensaje de pantalla
`display.message` (el backlog no le asigna hito). El firmware real del ESP32 lo
desarrolla el equipo de hardware contra el contrato entregado.

---

## 2. Objetivo y principios respetados

**Objetivo:** dejar un backend local al que se conecte el ESP32 para probar el
registro de huellas, el reconocimiento y la alarma de fin de horario, manejado
desde la terminal.

Principios aplicados:

- **Solo huella:** el mismo lector sirve para entrada y salida.
- **Hora de salida fija por horario:** entrar tarde no da más tiempo; solo entran
  los estudiantes asignados.
- **El servidor decide, el dispositivo ejecuta:** el ESP32 captura y muestra; la
  decisión y la hora son del servidor.
- **Protocolo robusto:** WebSocket versionado con `ack`, idempotencia por `id`,
  reintentos y órdenes persistidas.
- **Protección de datos biométricos:** solo se guarda la plantilla, cifrada con
  AES-256-GCM y con la clave fuera de la base de datos.
- **Bajo costo:** PostgreSQL en Docker, un solo dispositivo, `ws://` en red local.

---

## 3. Estado por hito

| Hito | Contenido | Estado | Commits |
|---|---|---|---|
| **H1. Conexión** | E0 (fundaciones), E1 (contrato), E2-1 a E2-3 (gateway, estado, ack/idempotencia), E10-1 (simulador), E12-1 (guía) | Completo | `1aebf96`, `170dc43`, `2201523`, `7400f2c` |
| **H2. Enrolamiento** | E3 (estudiantes), E4 (huellas cifradas), E9-1 a E9-3 (CLI), E10-2 (enrolamiento simulado) | Completo | `713721b`, `999fe6d` |
| **H3. Reconocimiento** | E5 (horarios), E6 (sincronización), E7 (asistencia), E9-4 a E9-6, E10-3 y E10-4 (lector y comandos simulados) | Completo | `bb3ab77`, `bc4b542` |
| **H4. Alarma** | E8 (alarma y vencimientos), E9-7 (`alarm`), E10-5 (alarma simulada) | Completo | `4b89881` |
| **H5. Cierre** | E2-4 a E2-6 (órdenes, heartbeat, SSE), E9-8 (`device`, `watch`), E11 (pruebas), E12-2 (problemas comunes) | Completo | `3bd5724`, `406c422`, `cf546e2` |

Work Items cerrados: 13 (11 features y 2 tasks), todos con planificación
aprobada, implementación y revisión independiente.

| # | Work Item | Tipo |
|---|---|---|
| 1 | `2026-11-02_00-43__e0-fundaciones-backend` | feature |
| 2 | `2026-11-02_01-06__e1-contrato-protocolo` | feature |
| 3 | `2026-11-02_01-17__e2-gateway-dispositivos` | feature |
| 4 | `2026-11-02_01-36__simulador-y-guia-firmware` | feature |
| 5 | `2026-11-02_01-52__estudiantes-y-huellas` | feature |
| 6 | `2026-11-02_02-10__cli-y-enrolamiento-simulado` | feature |
| 7 | `2026-11-02_02-29__docs-readme-y-guia-local` | task |
| 8 | `2026-11-02_02-37__horarios-y-sincronizacion` | feature |
| 9 | `2026-11-02_03-15__asistencia-y-escaneo` | feature |
| 10 | `2026-11-02_14-50__alarma-y-vencimientos` | feature |
| 11 | `2026-11-02_15-26__robustez-conexion-y-eventos` | feature |
| 12 | `2026-11-02_15-49__pruebas-integrales-a1-a12` | feature |
| 13 | `2026-11-02_16-25__guia-problemas-comunes` | task |

---

## 4. Qué se dejó listo

### 4.1 Arquitectura

Monorepo npm con cuatro workspaces:

| Workspace | Contenido |
|---|---|
| `server/` | NestJS 12: REST, WebSocket `/device`, schedulers y Prisma. |
| `shared/` | Esquemas zod y tipos del protocolo. |
| `simulator/` | ESP32 simulado en Node. |
| `cli/` | Comando `gym`. |

Módulos del servidor: `devices`, `students`, `fingerprints`, `schedules`,
`sync`, `attendance`, `alarm`, `admin`, `health`, `common` y `config`. Cada
módulo separa dominio, infraestructura (Prisma y en memoria) y servicio, con
patrón repository e inyección de dependencias.

### 4.2 API REST

Todas las rutas de administración exigen `x-api-key` (`ADMIN_API_KEY`) y están
documentadas en Swagger (`/docs`, JSON en `/docs-json`).

| Método y ruta | Función |
|---|---|
| `GET /health` | Estado, uptime y base de datos; no exige clave. |
| `GET /devices/status` | Dispositivos, última conexión, firmware y órdenes pendientes. |
| `POST/GET/PATCH/DELETE /students` | Alta, listado, edición y baja de estudiantes. |
| `POST /students/:id/enrollments`, `POST /enrollments/:id/cancel`, `GET /enrollments/:id` | Enrolamiento con progreso y cancelación. |
| `POST/GET /schedules`, `GET /schedules/resolve`, `GET /schedules/:id`, `PUT/DELETE /schedules/:id/students/:studentId` | Horarios, resolución y estudiantes asignados. |
| `POST /sync` | Sincronización manual de plantillas y horario. |
| `GET /attendance/open`, `GET /attendance/sessions` | Quién está dentro e historial. |
| `POST /attendance/entry`, `POST /attendance/exit` | Registro manual con motivo obligatorio. |
| `GET /alarm/status`, `POST /alarm/on`, `POST /alarm/test`, `POST /alarm/off` | Estado y control de la sirena. |
| `GET /events` | Stream SSE de eventos del sistema. |

### 4.3 Protocolo WebSocket

Contrato versionado en `docs/protocolo_v0.md`, con `ack` en menos de 5 s,
reintentos con el mismo `id` e idempotencia en `processed_messages`.

| Mensaje | Dirección | Estado |
|---|---|---|
| `hello` / `hello.ok` | dispositivo / servidor | Disponible, token obligatorio y `heartbeatSec` |
| `ack` | ambos | Disponible |
| `status` (latido) | dispositivo | Disponible; sin tráfico en dos intervalos se cierra con `4402` |
| `enroll.start`, `enroll.cancel` | servidor | Disponibles, persistidos y reenviados al reconectar |
| `enroll.progress`, `enroll.done`, `enroll.failed` | dispositivo | Disponible |
| `fingerprint.scan`, `fingerprint.unknown` | dispositivo | Disponible; el servidor responde `scan.result` |
| `button.pressed` | dispositivo | Disponible; apaga la alarma y marca sesiones `no_registrada` |
| `alarm.state` | dispositivo | Disponible (solo log; el servidor es la fuente de verdad) |
| `scan.result` | servidor | Disponible, con nombre, resultado y pantalla |
| `templates.sync` | servidor | Disponible, bloques de 10 con ack por bloque |
| `schedule.set` | servidor | Disponible (horario en curso o el más próximo) |
| `alarm.set` | servidor | Disponible (`END_BEEP`, `PENDING_EXIT`, `CLEARED`, `MANUAL`, `TEST`) |
| `display.message` | servidor | **Pendiente** (hitos posteriores) |

### 4.4 CLI `gym`

| Grupo | Comandos |
|---|---|
| `student` | `add`, `list`, `remove` |
| `enroll` | `start` (progreso en vivo), `cancel` |
| `schedule` | `create` (incluido `--ends-in 3m`), `assign`, `list`, `show` |
| `sync` | Dispara la sincronización con el lector |
| `sessions` | `open`, `list` |
| `attendance` | `entry`, `exit` con `--reason` obligatorio |
| `alarm` | `status`, `on`, `off`, `test` |
| `device` | `status` |
| `watch` | Eventos en vivo por SSE con reconexión y salida limpia |

Configuración por `--url`/`--api-key`, variables `GYM_URL`/`GYM_API_KEY` o
`~/.config/gymtime/cli.json`. La clave nunca se imprime.

### 4.5 Simulador de ESP32

- Implementa `hello`, `ack`, reintentos y heartbeat.
- Enrolamiento simulado con modos `ok`, `fail` y `silent`.
- Lector simulado: guarda `templates.sync`, borra todo con un `syncId` nuevo,
  confirma por bloques, muestra `schedule.set` en hora de Bogotá e informa
  `fingerprintCount`. Nunca imprime plantillas.
- Alarma simulada por consola, con apagado automático y `alarm.state` origen
  `local`.
- Comandos interactivos `sim>`: `scan <slot>`, `button`, `disconnect`,
  `reconnect`, `help`.

### 4.6 Datos y migraciones

PostgreSQL con Prisma. Tablas: `students`, `fingerprints`, `enrollments`,
`devices`, `device_slots`, `schedules`, `schedule_students`,
`schedule_instances`, `attendance_sessions`, `device_commands`,
`processed_messages`, `alarm_events` y `event_log`.

Seis migraciones: `init`, `device_online`, `enrollment_fields`,
`schedule_entry_window`, `alarm_closed_sessions` y
`device_command_created_at`. Las plantillas se guardan cifradas (AES-256-GCM) y
se descifran solo en memoria para enviarlas.

---

## 5. Verificación y pruebas

| Verificación | Comando | Resultado |
|---|---|---|
| Lint servidor | `npm --prefix server run lint` | Pasa |
| Unitarias servidor | `npm --prefix server test` | 45 archivos, 298 pruebas |
| Typecheck servidor | `tsc --noEmit -p server/tsconfig.json` | Pasa |
| E2E | `npm --prefix server run test:e2e` | 7 archivos, 34 pruebas |
| Lint CLI y simulador | `npm run lint -w cli -w simulator` | Pasa |
| Unitarias CLI y simulador | `npm run test -w cli -w simulator` | 93 + 77 pruebas |
| Typecheck CLI y simulador | `npm run typecheck -w cli -w simulator` | Pasa |
| Escenarios A1–A12 | `npm run test:scenarios` | 11/11, ~10 s |
| Harness | `rei check --quiet` | Exit 0 |

La suite de escenarios corre sin Docker, PostgreSQL ni hardware: arranca el
servidor con repositorios en memoria, reloj controlado y tick de alarma corto.
Solo A11 usa tiempo real por el aviso corto de 5 s.

**Escenarios cubiertos:** A1 enrolamiento; A2/A3 entrada y salida; A4 huella
desconocida; A5 no asignado; A6 sin horario; A7/A8 alarma continua y apagado del
último; A9 apagado manual; A10 caída, reconexión y duplicado; A11 aviso corto de
5 s; A12 dos horarios consecutivos.

---

## 6. Decisiones de diseño clave

- **Hora del servidor:** decide horarios, ventanas y antigüedad de la sesión; el
  `ts` del dispositivo solo se guarda como referencia.
- **Zona horaria:** se almacena en UTC y se muestra en America/Bogota (UTC-5
  fijo).
- **Ventana de ingreso:** 10 min antes del inicio a 5 min antes del fin, por
  defecto, configurable por variable y por horario.
- **Slots:** 1..161 asignados en cada sincronización; 162 (`ENROLL_SLOT`) es el
  slot de trabajo del enrolamiento.
- **Salida:** siempre permitida con sesión abierta, incluso tras el fin; volver a
  entrar en el mismo horario se rechaza con `ALREADY_EXITED`.
- **Órdenes:** se guardan en `device_commands` antes de enviarse y se reenvían
  con el mismo `id` al reconectar, en orden; la última orden de alarma gana.
- **Heartbeat:** obligatorio; sin tráfico durante dos intervalos el servidor
  cierra con `4402` y marca el dispositivo fuera de línea.
- **Aislamiento:** un solo dispositivo y `ws://` sin TLS en red local, con
  `DEVICE_TOKEN` y `ADMIN_API_KEY` en `.env`.
- **Seams de extensión:** `AlarmPort` (asistencia → alarma) y
  `OpenSessionsProvider` (sincronización ← asistencia).

---

## 7. Documentación entregada

| Documento | Contenido |
|---|---|
| `README.md` | Puesta en marcha, comandos, simulador, pruebas y estado. |
| `docs/protocolo_v0.md` | Contrato completo del protocolo con ejemplos y motivos de rechazo. |
| `docs/integracion_firmware.md` | Conexión del ESP32 real y guía de 28 problemas comunes (síntoma, causa, verificación y solución). |
| `docs/estado_firmware.md` | Qué está disponible y qué falta, mensaje por mensaje. |
| `backlog_iteracion_1_backend.md` | Backlog e hitos de la iteración. |

---

## 8. Cómo probarlo

```bash
nvm use
npm install
cp .env.example .env        # DEVICE_TOKEN, ADMIN_API_KEY, ENCRYPTION_KEY
docker compose up -d
npm run migrate
npm run build
npm run start:dev -w server
```

En otra terminal:

```bash
SIM_DEVICE_TOKEN=<DEVICE_TOKEN> npm run simulator
export GYM_API_KEY=<ADMIN_API_KEY>
npm run gym -- student add --document 123 --name "Ana" --consented
npm run gym -- enroll start --student 123
npm run gym -- schedule create --name Prueba --ends-in 3m --student 123
npm run gym -- sync
# en el simulador: scan <slot> dos veces (entrada y salida)
npm run gym -- sessions open
npm run gym -- alarm status
```

---

## 9. Trazabilidad de commits

| Commit | Entrega |
|---|---|
| `1aebf96` | Contexto del proyecto, backlog y arnés REI. |
| `170dc43` | Contrato del protocolo v0 (E1). |
| `2201523` | Gateway WebSocket de dispositivos (E2). |
| `7400f2c` | Simulador de ESP32 y guía de firmware. |
| `713721b` | Estudiantes y enrolamiento de huellas (E3, E4). |
| `999fe6d` | CLI `gym` y enrolamiento simulado (E9, E10-2). |
| `7e70bfa` | README y guía de estado del firmware. |
| `bb3ab77` | Horarios y sincronización de plantillas (E5, E6, E9, E10-3). |
| `bc4b542` | Asistencia, registro manual y comandos de escaneo (E7, E9-6, E10-4). |
| `4b89881` | Alarma, vencimientos y comandos de alarma (E8, E9-7, E10-5). |
| `3bd5724` | Órdenes persistidas, heartbeat y eventos en vivo (E2-4, E2-5, E2-6, E9-8). |
| `406c422` | Suite A1–A12 y corrección del cableado e2e (E11). |
| `cf546e2` | Guía de problemas comunes del firmware (E12-2). |
| `51efa1d` | Cierre formal de la iteración 1. |

---

## 10. Pendiente y próximos pasos

| Pendiente | Nota |
|---|---|
| **Panel web** | Fuera de la iteración 1; siguiente iteración. |
| `display.message` | El backlog no le asigna hito. |
| Prueba con ESP32 real | El firmware lo desarrolla el equipo de hardware contra el contrato. |
| Más de un dispositivo | El modelo de datos lo soporta; el objetivo de la iteración era uno. |
| Métricas y usuarios del panel | Parte del panel web. |

---

## 11. Observaciones conocidas

- `gym schedule create --ends-in` fija el margen de cierre de ingreso en 0 para
  que el horario de prueba acepte ingresos hasta su fin; está documentado en el
  README.
- El estado `no_registrada` solo lo producen los flujos de alarma (apagado manual
  o cierre por timeout); no es un estado que se cree desde el registro normal.
- Los artefactos del adaptador de agentes (`.opencode/`) no se versionan.
- Los checks lentos V4 (e2e) y V5 (build) se ejecutan bajo petición según
  `verification.md`; al cierre de la iteración V4 quedó en verde.
