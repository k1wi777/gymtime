# Estado del backend para firmware

Qué puede probar hoy el equipo de firmware y qué falta. Hitos cerrados: **H1 (conexión)** y **H2 (enrolamiento)**. Este documento no repite el protocolo: el formato de cada mensaje está en [`protocolo_v0.md`](./protocolo_v0.md) y la puesta en marcha detallada en [`integracion_firmware.md`](./integracion_firmware.md).

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
| `status` (latido) | dispositivo | Disponible | Alimenta `GET /devices/status`. |
| `enroll.start` | servidor | Disponible | Lo envía el servidor al iniciar un enrolamiento. |
| `enroll.cancel` | servidor | Disponible | Se envía al cancelar un enrolamiento. |
| `enroll.progress`, `enroll.done`, `enroll.failed` | dispositivo | Disponible | Únicos mensajes del dispositivo con lógica en el servidor. |
| `fingerprint.scan`, `fingerprint.unknown`, `alarm.state`, `button.pressed` | dispositivo | Sin lógica | Un mensaje válido recibe `ack` con `ok:true` y solo se registra en el log; no produce efecto. |
| `scan.result` | servidor | Pendiente (H3) | Aún no se envía. |
| `templates.sync`, `schedule.set` | servidor | Pendiente (H3) | Aún no se envían. |
| `alarm.set` | servidor | Pendiente (H4) | Aún no se envía. |
| `display.message` | servidor | Pendiente (hitos posteriores) | El backlog no fija el hito; aún no se envía. |

## REST y CLI

Todas las rutas de estudiantes, enrolamientos y `/devices/status` exigen la cabecera `x-api-key` con el `ADMIN_API_KEY`. `GET /health` y Swagger no la exigen. Swagger UI en `/docs`, OpenAPI JSON en `/docs-json`.

| Método y ruta | Función |
|---|---|
| `GET /health` | Estado, uptime y base de datos. |
| `GET /devices/status` | Dispositivos conectados. |
| `POST /students`, `GET /students` | Alta y listado de estudiantes. |
| `PATCH /students/:id`, `DELETE /students/:id` | Modificar o dar de baja un estudiante. |
| `POST /students/:id/enrollments` | Inicia un enrolamiento. |
| `GET /enrollments/:id` | Consulta su estado. |
| `POST /enrollments/:id/cancel` | Lo cancela. |

CLI `gym` (opciones y configuración en el [README](../README.md#cli-gym)):

| Comando | Efecto |
|---|---|
| `gym student add`, `gym student list`, `gym student remove` | Gestiona estudiantes. |
| `gym enroll start`, `gym enroll cancel` | Inicia o cancela un enrolamiento. |

## El simulador como referencia

El simulador (`simulator/`) habla el mismo protocolo que el ESP32 y sirve para probar sin hardware (guía, sección 7).

- `simulator/src/device-client.ts`: conexión, `hello`, latido, `ack` de los mensajes del servidor (sin repetir el procesamiento de un `id` ya visto) y reconexión.
- `simulator/src/sender.ts`: reenvío del mismo `id` hasta 3 veces si no llega `ack` (a los 5 s).
- `simulator/src/enrollment-simulator.ts`: respuesta a `enroll.start` y `enroll.cancel`.

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
| Escaneo de huella y control de entrada/salida | Pendiente (H3) |
| Sincronización de plantillas | Pendiente (H3) |
| Horarios | Pendiente (H3) |
| Alarma | Pendiente (H4) |
| Mensajes de pantalla (`display.message`) | Pendiente (hitos posteriores) |

Mientras tanto el firmware puede enviar `fingerprint.scan`, `alarm.state` o `button.pressed` y recibirá `ack`, pero sin respuesta ni efecto. Los formatos de los mensajes pendientes son los de [`protocolo_v0.md`](./protocolo_v0.md); pueden ajustarse al implementarlos, así que conviene revisar ese documento al cerrarse cada hito.
