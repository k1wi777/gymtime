# Guía de integración del ESP32 con el backend

Esta guía permite conectar el ESP32 (o el simulador) al backend de GymTime sin preguntar nada a nadie. Cubre la puesta en marcha, la red, el token, la secuencia de conexión, cómo comprobarla y qué hacer si falla. El detalle de cada mensaje no se repite aquí: está en [`protocolo_v0.md`](./protocolo_v0.md), que es la referencia.

## 1. Qué se necesita

- Un PC con **Node 24**, **npm** y **Docker** (el backend y la base de datos corren aquí).
- El ESP32 y el PC en la **misma red local** (misma subred).
- El repositorio clonado y `npm install` ejecutado en la raíz.

## 2. Levantar el backend

Desde la raíz del repositorio:

```bash
cp .env.example .env         # solo la primera vez
```

Edita `.env` y reemplaza los valores marcados como secretos:

| Variable | Qué poner |
|---|---|
| `DEVICE_TOKEN` | Token que presentará el ESP32 (mínimo 16 caracteres). Ver sección 4. |
| `ADMIN_API_KEY` | Clave para la API de administración (mínimo 16 caracteres). |
| `ENCRYPTION_KEY` | Base64 de 32 bytes: `openssl rand -base64 32`. |

Después:

```bash
docker compose up -d         # PostgreSQL (espera a que esté "healthy")
npm run migrate              # aplica las migraciones
npm run start:dev -w server  # arranca el backend
```

Si el arranque falla, el mensaje lista cada variable de `.env` ausente o inválida. Si el puerto 5432 está ocupado, cambia `POSTGRES_PORT` y el puerto de `DATABASE_URL` en `.env`.

Al arrancar el log indica `Server listening on http://0.0.0.0:3000`.

## 3. IP y puerto

El servidor escucha en **`0.0.0.0`**, es decir en todas las interfaces, no solo en `localhost` (`HOST` y `PORT` en `.env`; por defecto `3000`). Por eso el ESP32 puede alcanzarlo por la IP del PC en la red local.

Averigua la IP del PC:

- Linux: `hostname -I` o `ip -4 addr`.
- macOS: `ipconfig getifaddr en0`.
- Windows: `ipconfig` (campo "Dirección IPv4").

La URL que debe usar el firmware es:

```text
ws://<ip-del-pc>:3000/device
```

Por ejemplo `ws://192.168.1.50:3000/device`. Es `ws://` (sin TLS) y la ruta `/device` es obligatoria. `localhost` y `127.0.0.1` dentro del firmware apuntan al propio ESP32, no al PC. Se recomienda reservar una IP fija para el PC en el router, o actualizar el firmware si cambia.

## 4. Token y deviceId

- **Token:** es el valor de `DEVICE_TOKEN` del `.env` del backend. El firmware lo lleva compilado y lo envía en cada `hello`. Si lo cambias en `.env`, reinicia el backend y actualiza el firmware.
- **deviceId:** texto libre pero fijo y único por dispositivo (por ejemplo `esp32-gym-01`). Con un solo dispositivo en la iteración 1, usa siempre el mismo.
- **fw:** versión del firmware (por ejemplo `1.0.0`); aparece en el estado del dispositivo.

## 5. Secuencia de conexión paso a paso

Todos los mensajes son JSON de texto, uno por trama, con el sobre `{v, id, type, ts, ref, payload}` (ver sección 2 del protocolo). `ts` va en **segundos** Unix.

1. **Abrir** el WebSocket en `ws://<ip>:3000/device`.
2. **Enviar `hello` como primer mensaje**, en menos de 5 s desde que abre la conexión:

<!-- example: hello -->
```json
{
  "v": 1,
  "id": "a1b2c3d4-0001-4000-8000-000000000001",
  "type": "hello",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "deviceId": "esp32-gym-01",
    "token": "el-valor-de-DEVICE_TOKEN",
    "fw": "1.0.0"
  }
}
```

3. **Recibir `hello.ok`.** Su `ref` es el `id` del `hello` (hace de confirmación; no hay que enviar `ack` por él). Trae `heartbeatSec` (30 por defecto) y `serverTime` para ajustar el reloj:

<!-- example: hello.ok -->
```json
{
  "v": 1,
  "id": "a1b2c3d4-0002-4000-8000-000000000002",
  "type": "hello.ok",
  "ts": 1760000001,
  "ref": "a1b2c3d4-0001-4000-8000-000000000001",
  "payload": {
    "serverTime": 1760000001,
    "heartbeatSec": 30
  }
}
```

   Si el token es incorrecto, en su lugar llega un `ack` con `"ok": false` y `"error": "UNAUTHORIZED"` y el servidor cierra la conexión (ver sección 8).

4. **Enviar `status` cada `heartbeatSec` segundos** (se recomienda uno inmediato tras `hello.ok`). El dispositivo queda "en línea" mientras la conexión siga abierta:

<!-- example: status -->
```json
{
  "v": 1,
  "id": "a1b2c3d4-0003-4000-8000-000000000003",
  "type": "status",
  "ts": 1760000002,
  "ref": null,
  "payload": {
    "uptime": 120,
    "heap": 184320,
    "rssi": -58,
    "fingerprintCount": 0
  }
}
```

5. **Recibir el `ack` del servidor** a ese `status` (su `ref` es el `id` del `status`):

<!-- example: ack -->
```json
{
  "v": 1,
  "id": "a1b2c3d4-0004-4000-8000-000000000004",
  "type": "ack",
  "ts": 1760000002,
  "ref": "a1b2c3d4-0003-4000-8000-000000000003",
  "payload": {
    "ok": true
  }
}
```

6. **Confirmar con `ack` todo mensaje del servidor** que no sea otro `ack` (por ejemplo `display.message`, `schedule.set`, `templates.sync`, `alarm.set`, `enroll.start`), en menos de 5 s. El `ref` es el `id` del mensaje recibido. Si no se pudo procesar, `ok` es `false` con un código de error:

<!-- example: ack -->
```json
{
  "v": 1,
  "id": "a1b2c3d4-0005-4000-8000-000000000005",
  "type": "ack",
  "ts": 1760000003,
  "ref": "a1b2c3d4-0006-4000-8000-000000000006",
  "payload": {
    "ok": false,
    "error": "INVALID_MESSAGE"
  }
}
```

   Los mensajes que el servidor puede enviar ya en esta etapa, `templates.sync` y `schedule.set`, se describen en las secciones 6 y 8 del [protocolo](./protocolo_v0.md); aquí no se duplican.

7. **Reintentos:** si el servidor no confirma un mensaje tuyo en 5 s, reenvíalo **idéntico, con el mismo `id`**, hasta 3 veces. Si tras el último reenvío sigue sin `ack`, cierra la conexión y reconecta. En sentido contrario, si recibes un `id` que ya procesaste, no lo reprocesas pero **vuelves a enviar su `ack`**.
8. **Reconexión:** si la conexión cae, reconecta con espera creciente (1 s, 2 s, 4 s, ... hasta 30 s) y empieza de nuevo por `hello`. El servidor reenvía las órdenes que no llegaron a confirmarse. Si abres una segunda conexión con el mismo `deviceId`, el servidor cierra la anterior.

Resumen de tiempos:

| Qué | Valor |
|---|---|
| Plazo para el primer `hello` | 5 s tras abrir la conexión |
| Plazo para el `ack` | 5 s |
| Reenvíos con el mismo `id` | hasta 3 |
| `status` | cada `heartbeatSec` (30 s) |
| Espera de reconexión | 1, 2, 4 ... 30 s |

## 6. Comprobar que el dispositivo está conectado

Con el backend en marcha, pregunta por el estado (usa el valor de `ADMIN_API_KEY` del `.env`):

```bash
curl -H "x-api-key: <ADMIN_API_KEY>" http://<ip-del-pc>:3000/devices/status
```

Un dispositivo conectado aparece con `"online": true`, su `deviceId` y su `firmwareVersion`. Si no aparece o sale `"online": false`, no ha completado el `hello`. Sin la clave o con una incorrecta la respuesta es `401`.

En el log del backend verás eventos como `connection_opened`, `message_sent` y `closed`. Los fallos de autenticación o de formato quedan registrados con su causa.

## 7. Ensayar primero con el simulador

Antes de usar el ESP32 real, comprueba que el backend y la red están bien con el simulador, que habla el mismo protocolo:

```bash
SIM_DEVICE_TOKEN=<DEVICE_TOKEN> npm run simulator
```

(`DEVICE_TOKEN` es el valor de tu `.env`; el simulador no lee ese archivo.) Opciones, con los argumentos por encima de las variables de entorno:

| Variable | Argumento | Defecto |
|---|---|---|
| `SIM_URL` | `--url` | `ws://localhost:3000/device` |
| `SIM_DEVICE_ID` | `--device-id` | `esp32-sim-01` |
| `SIM_DEVICE_TOKEN` | `--token` | obligatorio |
| `SIM_FW` | `--fw` | `sim-1.0.0` |

Por ejemplo, desde otro equipo de la red: `npm run simulator -- --url ws://192.168.1.50:3000/device --token <DEVICE_TOKEN>`.

Salida esperada (el token nunca se imprime):

```text
::: connecting: ws://localhost:3000/device
::: authenticating
--> hello            {"v":1,...,"payload":{"deviceId":"esp32-sim-01","token":"***","fw":"sim-1.0.0"}}
<-- hello.ok         {...,"payload":{"serverTime":...,"heartbeatSec":30}}
::: online: heartbeat every 30 s
--> status           {...}
<-- ack              {...,"payload":{"ok":true}}
```

Ctrl+C cierra la conexión y termina el proceso. Detén el simulador antes de conectar el ESP32 real con el mismo `deviceId`, porque una segunda conexión expulsa a la primera.

## 8. Problemas comunes de la primera conexión

| Síntoma | Causa probable | Solución |
|---|---|---|
| El ESP32 no logra abrir el WebSocket (timeout o conexión rechazada), pero `curl` funciona desde el propio PC | Firewall del PC bloquea el puerto 3000 | Permite el puerto: `sudo ufw allow 3000/tcp` (Linux/ufw), `sudo firewall-cmd --add-port=3000/tcp` (firewalld) o una regla de entrada TCP 3000 en el Firewall de Windows. |
| Conexión rechazada o sin respuesta desde cualquier equipo de la red | IP errónea o cambiada, o el firmware usa `localhost`/`127.0.0.1` | Vuelve a obtener la IP del PC (sección 3) y usa `ws://<ip>:3000/device`. Reserva una IP fija en el router. |
| El PC responde a `curl` desde otro equipo pero el ESP32 no llega | Red aislada: el punto de acceso aísla clientes (modo "AP isolation"/"guest") o están en subredes distintas | Conecta ambos a la misma red sin aislamiento de clientes. Prueba con `ping` desde otro equipo de la misma Wi-Fi. |
| Llega `ack` con `ok: false` y `error: UNAUTHORIZED`, y el servidor cierra la conexión | El token de `hello` no coincide con `DEVICE_TOKEN` | Copia exactamente el valor del `.env` (sin espacios ni comillas). Si lo cambiaste, reinicia el backend y reflashea el firmware. El simulador lo registra como "hello rejected: UNAUTHORIZED". |
| Se abre la conexión y el servidor la cierra a los 5 s sin respuesta | El `hello` llegó tarde o no se envió (plazo de 5 s tras abrir) | Envía `hello` inmediatamente al abrir el WebSocket, antes de cualquier otra cosa. |
| Llega `ack` con `error: NOT_AUTHENTICATED` | Se envió otro mensaje antes de un `hello` válido | `hello` debe ser siempre el primer mensaje de cada conexión, también tras reconectar. |
| `ack` con `error: INVALID_MESSAGE` | JSON mal formado, campo faltante o desconocido, `id` que no es UUID, `ts` en milisegundos, o tipos incorrectos (el esquema es estricto) | Compara con los ejemplos del [protocolo](./protocolo_v0.md). `ts` va en **segundos** y `ref` debe ser `null` salvo en respuestas. |
| `ack` con `error: UNSUPPORTED_VERSION` o `UNKNOWN_TYPE` | `v` distinto de `1` o `type` inexistente | Usa `"v": 1` y los tipos del protocolo. |
| El ESP32 no tiene hora correcta | Sin NTP el reloj arranca en 1970 | No impide conectar. Ajusta el reloj con `serverTime` de `hello.ok` y envía siempre `ts` en segundos. La hora que manda es la del servidor. |
| El dispositivo se desconecta cada vez que se conecta otro cliente | Dos conexiones con el mismo `deviceId` (por ejemplo el simulador y el ESP32): el servidor conserva solo la más reciente | Usa un solo cliente por `deviceId`, o `SIM_DEVICE_ID` distinto para el simulador. |
| Falla el handshake con `wss://` | El backend usa `ws://` sin TLS en esta etapa | Usa `ws://`, no `wss://`. |
| Cualquier otro fallo | | Revisa el log del backend: cada rechazo queda registrado con su causa. |
