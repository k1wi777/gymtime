# Estado del backend para firmware

Qué puede probar hoy el equipo de firmware y qué falta. Hitos cerrados: **H1 (conexión)**, **H2 (enrolamiento)**, **H3 (escaneo, asistencia y horarios)**, **H4 (alarma y vencimientos)** y **H5 (órdenes con confirmación, heartbeat y eventos en vivo)**. Este documento no repite el protocolo: el formato de cada mensaje está en [`protocolo_v0.md`](./protocolo_v0.md) y la puesta en marcha detallada en [`integracion_firmware.md`](./integracion_firmware.md). Si algo falla, la sección 8 de esa guía recoge los problemas comunes con su síntoma, causa, verificación y solución.

## Cómo trabajar en local

Con `.env` ya configurado (guía, sección 2) y desde la raíz del repositorio:

```bash
docker compose up -d
npm run migrate
npm run start:dev -w server                     # backend en ws://<ip>:3000/device
SIM_DEVICE_TOKEN=<DEVICE_TOKEN> npm run simulator   # otra terminal: ESP32 simulado
curl -H "x-api-key: <ADMIN_API_KEY>" http://localhost:3000/devices/status
```

`<DEVICE_TOKEN>` y `<ADMIN_API_KEY>` son los valores de tu `.env`. IP, token y secuencia de conexión: secciones 3 a 6 de la guía.

## Mensajes del protocolo

| Mensaje | Dirección | Estado | Notas |
|---|---|---|---|
| `hello` / `hello.ok` | dispositivo / servidor | Disponible | Autenticación con el token del dispositivo. |
| `ack` | ambos | Disponible | Idempotencia por `id`: un duplicado recibe de nuevo el ack guardado. |
| `status` (latido) | dispositivo | Disponible | Obligatorio: alimenta `GET /devices/status` y mantiene viva la conexión. Sin tráfico durante dos intervalos de `heartbeatSec` el servidor cierra con 4402 y marca el dispositivo fuera de línea. |
| `enroll.start` | servidor | Disponible | Lo envía el servidor al iniciar un enrolamiento. Queda guardado como pendiente hasta el `ack` y se reenvía con el mismo `id` si el lector se reconecta. |
| `enroll.cancel` | servidor | Disponible | Se envía al cancelar un enrolamiento; también se reintenta y se reenvía al reconectar. |
| `enroll.progress`, `enroll.done`, `enroll.failed` | dispositivo | Disponible | Únicos mensajes del dispositivo con lógica de enrolamiento en el servidor. |
| `fingerprint.scan`, `fingerprint.unknown` | dispositivo | Disponible | El servidor decide entrada, salida o rechazo y responde con `scan.result`. |
| `button.pressed` | dispositivo | Disponible | Si la sirena está encendida la silencia, marca las sesiones abiertas como `no_registrada` y registra que la apagó el botón; si está apagada solo se registra y se confirma. |
| `alarm.state` | dispositivo | Disponible (solo log) | Se confirma y se registra en el log; el servidor es la fuente de verdad del estado de la alarma y no lo altera. |
| `scan.result` | servidor | Disponible | Respuesta a `fingerprint.scan`/`fingerprint.unknown`, con la pantalla a mostrar. Desde H6 el `display` trae textos cortos de 16 caracteres ASCII (nombre corto + `Entrada OK`, `Salida OK` o el motivo); la estructura no cambia. |
| `templates.sync` | servidor | Disponible | Bloques de hasta 10 plantillas con `ack` por bloque; un bloque único 1 de 1 con `templates: []` vacía el lector. Slots 1..161 (el 162 es el de trabajo del enrolamiento). Se envía al conectarse, al terminar un enrolamiento, 15 min antes de cada horario, al terminar cada horario y con `gym sync`. |
| `schedule.set` | servidor | Disponible | Tras la sincronización, con el horario en curso o el más próximo (segundos Unix). Si no hay ninguno, no se envía. |
| `alarm.set` | servidor | Disponible | Al terminar un horario: pitido corto `END_BEEP` si quedó vacío o continua `PENDING_EXIT` si queda alguien; al salir el último, `CLEARED`. También lo disparan `gym alarm on/test/off`. `durationSec` numérico se apaga solo; `null` suena hasta otra orden. La última orden de alarma gana: las anteriores sin confirmar se descartan, y la vigente se reenvía al reconectar. |
| `display.message` | servidor | Disponible | Texto temporal de hasta 2 líneas de 16 caracteres ASCII y `durationSec` (1 a 60 s las del operador). Persistido, con reintento y reenvío al reconectar. También lo envía la alarma continua: `Tiempo cumplido` / `Registre salida` con `alarm.set`, y dos líneas vacías (limpiar pantalla, 1 s) al apagarla. Ver [`mensajes_pantalla.md`](./mensajes_pantalla.md). |

## REST y CLI

Todas las rutas de estudiantes, enrolamientos, horarios, asistencia, alarma y `/devices/status` exigen la cabecera `x-api-key` con el `ADMIN_API_KEY`. `GET /health` y Swagger no la exigen. Swagger UI en `/docs`, OpenAPI JSON en `/docs-json`.

| Método y ruta | Función |
|---|---|
| `GET /health` | Estado, uptime y base de datos. |
| `GET /devices/status` | Dispositivos conectados, última conexión, firmware y órdenes pendientes. |
| `GET /events` | Stream SSE con `x-api-key` de conexiones, escaneos, órdenes y alarma para `gym watch`. |
| `POST /devices/messages` | Muestra un mensaje en el LCD (`line1`, `line2?`, `durationSec?`, `deviceId?`); responde `commandId`, `deviceId` y `status` (`acked`, `queued` o `failed`). 400 si no cabe en la pantalla; 404 si no hay dispositivo. |
| `POST /students`, `GET /students` | Alta y listado de estudiantes: `document` (cédula), `name`, `program` (carrera), `email` y `phone` opcionales, `displayName` (nombre corto del LCD). |
| `PATCH /students/:id`, `DELETE /students/:id` | Modificar (incluidos `email`, `phone` y `displayName`) o dar de baja un estudiante. |
| `POST /students/:id/enrollments` | Inicia un enrolamiento. |
| `GET /enrollments/:id` | Consulta su estado. |
| `POST /enrollments/:id/cancel` | Lo cancela. |
| `POST /schedules`, `GET /schedules`, `GET /schedules/:id` | Crea, lista y consulta horarios. |
| `PUT /schedules/:id/students/:studentId`, `DELETE ...` | Asigna o quita un estudiante (siguen devolviendo 204 e idempotentes). Quitar cierra la vigencia (`valid_to`) en lugar de borrar la fila; asignar otra vez abre una nueva. |
| `GET /schedules/resolve?studentId&at` | Horario que corresponde a un estudiante en un instante. |
| `GET /attendance/open`, `GET /attendance/sessions` | Quién está dentro y historial de sesiones con filtros. |
| `POST /attendance/entry`, `POST /attendance/exit` | Registro manual de entrada o salida con motivo obligatorio. |
| `POST /sync` | Sincroniza el lector en línea (409 si no hay). |
| `GET /alarm/status` | Estado de la sirena, motivo, ocurrencia, duración y sesiones abiertas. |
| `POST /alarm/on`, `POST /alarm/test` | Enciende la sirena de forma continua (`MANUAL`) o con el pitido de prueba (`TEST`); 409 si no hay dispositivo en línea. |
| `POST /alarm/off` | Silencia la sirena, marca las sesiones abiertas como `no_registrada` y devuelve cuántas cerró; 409 si no estaba encendida. |

CLI `gym` (opciones y configuración en el [README](../README.md#cli-gym)):

| Comando | Efecto |
|---|---|
| `gym student add`, `gym student edit`, `gym student list`, `gym student remove` | Gestiona estudiantes (`--email`, `--phone`, `--display-name` opcionales). |
| `gym enroll start`, `gym enroll cancel` | Inicia o cancela un enrolamiento. |
| `gym schedule create/assign/list/show` | Gestiona horarios. |
| `gym sync` | Dispara la sincronización. |
| `gym sessions open`, `gym sessions list` | Quién está dentro e historial de sesiones. |
| `gym attendance entry/exit` | Registro manual con motivo obligatorio. |
| `gym alarm on/off/test/status` | Controla la sirena y consulta su estado. |
| `gym device status` | Estado del lector: en línea, última conexión, firmware y órdenes pendientes. |
| `gym device message "línea 1" ["línea 2"] [--seconds N] [--device ID]` | Muestra un mensaje en el LCD del lector (sin tildes, máximo 2 líneas de 16 caracteres). Sale con error si el lector no lo confirma. |
| `gym watch` | Eventos del servidor en vivo, con reconexión automática y salida limpia con Ctrl+C. |

## El simulador como referencia

El simulador (`simulator/`) habla el mismo protocolo que el ESP32 y sirve para probar sin hardware (guía, sección 7).

- `simulator/src/device-client.ts`: conexión, `hello`, latido, `ack` de los mensajes del servidor (sin repetir el procesamiento de un `id` ya visto) y reconexión.
- `simulator/src/sender.ts`: reenvío del mismo `id` hasta 3 veces si no llega `ack` (a los 5 s).
- `simulator/src/enrollment-simulator.ts`: respuesta a `enroll.start` y `enroll.cancel`.
- `simulator/src/reader-simulator.ts`: memoria del lector; guarda el mapa slot -> plantilla de `templates.sync`, borra todo al llegar un `syncId` nuevo y guarda `schedule.set`. Un `ack` por bloque; `status.fingerprintCount` informa cuántas plantillas hay.
- `display.message`: el simulador imprime `display.message: "<línea 1>" / "<línea 2>" (<n>s)` (o `(screen cleared)` con dos líneas vacías) y lo confirma con `ack`.
- `simulator/src/alarm-simulator.ts`: sirena del dispositivo simulado; imprime `ALARM ON (motivo) continua` o `ALARM ON (motivo) N s`, y `ALARM OFF (motivo)`. Con `durationSec` numérico el `DeviceClient` la apaga al cumplirse el tiempo y envía `alarm.state {on:false, source:"local"}`.

Modos de enrolamiento (`SIM_ENROLL_MODE` o `--enroll-mode`):

| Modo | Qué ejercita |
|---|---|
| `ok` | Éxito: los pasos de `enroll.progress` y `enroll.done` con plantilla. |
| `fail` | Fallo: `enroll.failed` con el motivo configurado. |
| `silent` | No responde: comprueba la expiración del enrolamiento. |

## Disponible ahora y pendiente

| Capacidad | Estado |
|---|---|
| Conexión y autenticación del dispositivo | Disponible |
| Latido y estado de dispositivos | Disponible |
| `ack` e idempotencia | Disponible |
| Alta y baja de estudiantes (REST y CLI) | Disponible |
| Enrolamiento de huella completo | Disponible |
| Escaneo de huella y control de entrada/salida | Disponible |
| Registro manual de entrada/salida (REST y CLI) | Disponible |
| Sincronización de plantillas (`templates.sync`, `schedule.set`) | Disponible |
| Horarios | Disponible |
| Alarma, apagado manual y vencimientos | Disponible |
| Órdenes persistidas, reintentos y reenvío al reconectar | Disponible |
| Heartbeat obligatorio y detección de conexiones muertas | Disponible |
| Eventos en vivo por SSE y `gym watch` | Disponible |
| Mensajes de pantalla (`display.message`) y textos de 16 × 2 | Disponible |

El firmware ya puede implementar el flujo completo de la iteración 1: `scan.result`, `schedule.set`, `alarm.set` y el efecto de `button.pressed`. Debe enviar `status` con la periodicidad anunciada en `hello.ok` y confirmar con `ack` los mensajes del servidor; las órdenes que no se confirmaron se reenvían, con el mismo `id`, al reconectar el lector. Los formatos de los mensajes pendientes son los de [`protocolo_v0.md`](./protocolo_v0.md); pueden ajustarse al implementarlos, así que conviene revisar ese documento al cerrarse cada hito.
