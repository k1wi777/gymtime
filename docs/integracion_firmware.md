# Guía de integración del ESP32 con el backend

Esta guía permite conectar el ESP32 (o el simulador) al backend de GymTime sin preguntar nada a nadie. Cubre la puesta en marcha, la red, el token, la secuencia de conexión, cómo comprobarla y qué hacer si falla. El detalle de cada mensaje no se repite aquí: está en [`protocolo_v0.md`](./protocolo_v0.md), que es la referencia. Para saber qué mensajes y endpoints están disponibles hoy y cuáles faltan, consulta [`estado_firmware.md`](./estado_firmware.md).

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

- **Token:** en desarrollo es el valor de `DEVICE_TOKEN` del `.env` del backend; en producción cada lector tiene su propio token (`gym device register <id>`, ver [`guia_wss_firmware.md`](guia_wss_firmware.md)). El firmware lo lleva compilado y lo envía en cada `hello`. Si lo cambias en `.env`, reinicia el backend y actualiza el firmware.
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

   `display.message` ya está disponible: texto de hasta 2 líneas de 16 caracteres ASCII, que el firmware muestra durante `durationSec` (dos líneas vacías = limpiar la pantalla); ver [`mensajes_pantalla.md`](./mensajes_pantalla.md). Los mensajes que el servidor puede enviar ya en esta etapa, `templates.sync` y `schedule.set`, se describen en las secciones 6 y 8 del [protocolo](./protocolo_v0.md); aquí no se duplican. Tres puntos que el firmware debe cumplir:

   - Al recibir el **primer bloque de una sincronización nueva** (`syncId` distinto del anterior), borra todas las plantillas locales y carga las recibidas en los slots indicados; los bloques siguientes del mismo `syncId` solo añaden. Cada bloque se confirma con su `ack`.
   - Un bloque único 1 de 1 con `templates` vacío significa «borra todo y no cargues nada». Se confirma con `ack` como cualquier otro:

<!-- example: templates.sync -->
```json
{
  "v": 1,
  "id": "a1b2c3d4-0007-4000-8000-000000000007",
  "type": "templates.sync",
  "ts": 1760000004,
  "ref": null,
  "payload": {
    "syncId": "a1b2c3d4-0008-4000-8000-000000000008",
    "chunk": { "index": 1, "total": 1 },
    "templates": []
  }
}
```

   - `schedule.set` llega después del último bloque; guárdalo como horario vigente y confírmalo. Los slots son temporales: el servidor los reasigna en cada sincronización y usa 1..161 (el 162 es el slot de trabajo del enrolamiento).

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
| `SIM_ENROLL_MODE` | `--enroll-mode` | `ok` (`ok`, `fail` o `silent`) |
| `SIM_ENROLL_STEP_MS` | `--enroll-step-ms` | `800` (pausa entre pasos, en ms) |
| `SIM_ENROLL_FAIL_REASON` | `--enroll-fail-reason` | `simulated_failure` |
| `SIM_TEMPLATE_BYTES` | `--template-bytes` | `512` (tamaño decodificado de la plantilla falsa) |

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

### Enrolamiento simulado

El simulador atiende `enroll.start` y `enroll.cancel` sin lector real. En modo `ok` responde con un `enroll.progress` por paso (`place_finger`, `remove_finger`, `place_again`, `processing`) y termina con `enroll.done` con una plantilla aleatoria nueva de `SIM_TEMPLATE_BYTES` bytes. En modo `fail` envía `place_finger` y luego `enroll.failed` con el motivo configurado. En modo `silent` no responde nada, para comprobar la expiración. `enroll.cancel` detiene los pasos pendientes. Las plantillas nunca se imprimen en la salida (se muestran como `***`). Para registrar una huella de punta a punta, con el simulador en marcha:

```bash
gym student add --document 123 --name "Ana"
gym enroll start --student 123      # ver README: CLI `gym`
```

### Sincronización simulada

El simulador hace de lector: al recibir `templates.sync` guarda cada plantilla en su slot (borra todo si el `syncId` es nuevo), confirma cada bloque con `ack` y registra solo slots y conteos (`sync 1/3: reader wiped, 10 template(s) stored (slots 1..10), 10 in reader`), nunca las plantillas. Al recibir `schedule.set` lo guarda y lo muestra en hora de Bogotá, y el `status` informa `fingerprintCount`. Para verlo con el backend en marcha:

```bash
gym schedule create --name Prueba --ends-in 3m --student 123
gym sync
```

### Mensajes de pantalla simulados

El simulador atiende `display.message` sin pantalla real: imprime `display.message: "línea 1" / "línea 2" (3s)` (o `(screen cleared)` si las dos líneas llegan vacías) y lo confirma con `ack`. Para verlo con el backend en marcha:

```bash
gym device message "Hola" "GymTime" --seconds 5
```

Con el simulador desconectado, la orden queda en cola (`queued`) y llega al reconectar. Los textos que el servidor envía, la regla de 16 caracteres ASCII y los mensajes locales del firmware están en [`mensajes_pantalla.md`](./mensajes_pantalla.md).

Ctrl+C cierra la conexión y termina el proceso. Detén el simulador antes de conectar el ESP32 real con el mismo `deviceId`, porque una segunda conexión expulsa a la primera.

### Modo sin conexión simulado

Con `--offline` el simulador guarda el snapshot que envía el servidor y, si se corta la red, decide solo:

```bash
SIM_DEVICE_TOKEN=... npm --prefix simulator start -- --offline --state-file /tmp/sim-estado.jsonl
sim> net off        # pierde la red
sim> scan 3         # decide con el snapshot (entrada o salida local)
sim> net on         # reconecta y envía la cola con su hora original
```

Las reglas y el formato están en [`modo_sin_conexion_firmware.md`](./modo_sin_conexion_firmware.md). Lo que no encaja queda en «Por revisar» del panel.

## 8. Problemas comunes

Esta sección diagnostica los fallos más probables, primero en la conexión y después en la operación normal. Cada bloque sigue el mismo orden: **qué se ve**, **por qué**, **cómo confirmarlo** y **qué cambiar**. El contrato de cada mensaje sigue en el [protocolo](./protocolo_v0.md); aquí solo se interpreta.

Triaje, en este orden: ¿abre el WebSocket? (8.1) ¿autentica con `hello`? (8.2) ¿late con `status`? (8.3) ¿recibe y aplica órdenes? (8.6 a 8.8). Si el dispositivo no aparece en `gym device status`, el fallo está antes del `hello`; si aparece con `online: no`, se cayó después de autenticar.

| Síntoma | Bloque |
|---|---|
| El ESP32 no abre el WebSocket pero `curl` funciona en el PC | [8.1.1](#firewall) |
| Conexión rechazada o sin respuesta desde cualquier equipo | [8.1.2](#ip-puerto) |
| Responde a un equipo pero no al ESP32 | [8.1.3](#ap-isolation) |
| Falla el handshake TLS | [8.1.4](#wss) |
| `ack` con `UNAUTHORIZED` y cierre | [8.2.1](#token) |
| La conexión se cierra a los 5 s sin respuesta | [8.2.2](#hello-tardio) |
| `ack` con `NOT_AUTHENTICATED` | [8.2.3](#orden-antes-de-hello) |
| `ack` con `INVALID_MESSAGE` | [8.2.4](#mensaje-invalido) |
| `ack` con `UNSUPPORTED_VERSION` o `UNKNOWN_TYPE` | [8.2.5](#version-tipo) |
| El firmware o el contrato no son los esperados | [8.2.6](#firmware-contrato) |
| El dispositivo se cae solo a los ~60 s (4402) | [8.3.1](#heartbeat) |
| Los `status` se confirman con error | [8.3.2](#status-invalido) |
| Reloj en 1970 o `ts` que no cuadran | [8.4](#hora) |
| Cortes intermitentes o RSSI bajo | [8.5](#rssi) |
| No vuelve tras un corte o vuelve sin autenticar | [8.6.1](#reconexion) |
| Órdenes que no llegan al lector | [8.6.2](#ordenes-pendientes) |
| Mensajes duplicados | [8.6.3](#duplicados) |
| Se desconecta al conectar otro cliente (4409) | [8.6.4](#reemplazado) |
| Quedan huellas viejas tras sincronizar | [8.7.1](#sync-nuevo) |
| Llega un bloque `templates.sync` vacío | [8.7.2](#sync-vacio) |
| Faltan estudiantes en el lector | [8.7.3](#capacidad) |
| Una plantilla no carga | [8.7.4](#plantilla) |
| El horario no se aplica | [8.7.5](#schedule-set) |
| La sirena no suena | [8.8.1](#alarma-no-suena) |
| La sirena suena y no se apaga | [8.8.2](#alarma-no-se-apaga) |
| `alarm.state` no cambia nada en el servidor | [8.8.3](#alarm-state) |
| Se aplica una orden de alarma vieja | [8.8.4](#alarma-ultima-gana) |
| Cualquier otro fallo | [8.9](#otro-fallo) |

### 8.1 Red y alcance

#### 8.1.1 El ESP32 no abre el WebSocket, pero el backend responde <a id="firewall"></a>

- **Síntoma** — timeout o «connection refused» al conectar desde el ESP32, mientras el backend responde en el PC.
- **Causa probable** — el firewall del PC bloquea el puerto 3000 entrante; el `curl` local no pasa por él.
- **Verificación** — desde otro equipo de la red: `curl -H "x-api-key: <ADMIN_API_KEY>" http://<ip-del-pc>:3000/devices/status`, o `ping <ip-del-pc>`. En el PC, `sudo ufw status` (ufw), `sudo firewall-cmd --list-ports` (firewalld) o las reglas de entrada del Firewall de Windows.
- **Solución** — permite TCP 3000 solo en la red local: `sudo ufw allow 3000/tcp`, `sudo firewall-cmd --add-port=3000/tcp` o una regla de entrada en el Firewall de Windows.

#### 8.1.2 IP o puerto erróneos <a id="ip-puerto"></a>

- **Síntoma** — conexión rechazada o sin respuesta desde cualquier equipo; a veces funcionó y dejó de hacerlo tras reiniciar el router.
- **Causa probable** — la URL apunta a una IP equivocada o cambiada por DHCP, o el firmware usa `localhost`/`127.0.0.1`, que apuntan al propio ESP32. El servidor escucha en `0.0.0.0` (sección 3), así que el bind no es la causa.
- **Verificación** — en el PC, `hostname -I` y compara con la URL del firmware (`ws://<ip>:3000/device`, con la ruta `/device` obligatoria: sin ella el upgrade responde 404). Comprueba que `PORT` en `.env` es 3000 y que `ping <ip-del-pc>` responde desde otro equipo.
- **Solución** — corrige la URL, reserva la IP del PC en el router y reflashea el firmware con la IP correcta.

#### 8.1.3 El PC responde a `curl` desde otro equipo, pero el ESP32 no llega <a id="ap-isolation"></a>

- **Síntoma** — desde un portátil de la misma Wi-Fi el backend responde; el ESP32 se queda en timeout.
- **Causa probable** — el punto de acceso aísla clientes («AP isolation» o red de invitados) o el ESP32 y el PC están en subredes o VLAN distintas.
- **Verificación** — `ping <ip-del-pc>` desde otro equipo conectado a la misma red que el ESP32; si funciona desde una red y no desde la otra, es aislamiento o subred.
- **Solución** — conecta ambos a la misma red sin aislamiento de clientes, sin red de invitados, y permite el tráfico entre VLAN si las hay.

#### 8.1.4 Falla el handshake al usar `wss://` <a id="wss"></a>

- **Síntoma** — el socket no completa la conexión y no hay tráfico en el backend.
- **Causa probable** — el backend de esta etapa sirve `ws://` sin TLS.
- **Verificación** — la URL del firmware empieza por `wss://` y en el log del backend no aparece `connection_opened`.
- **Solución** — usa `ws://<ip-del-pc>:3000/device`; el TLS llega en producción (`wss://`/HTTPS).

### 8.2 Autenticación y contrato

#### 8.2.1 `ack` con `UNAUTHORIZED` y cierre de la conexión <a id="token"></a>

- **Síntoma** — llega un `ack` con `ok: false` y `error: UNAUTHORIZED`; el servidor cierra con 4401 y en `gym watch` no aparece `device.connected`.
- **Causa probable** — el token de `hello` no coincide con el del lector (o con `DEVICE_TOKEN` si aún usa el compartido), o fue rotado/revocado con `gym device rotate|revoke` (espacios, comillas, `.env` de otro entorno).
- **Verificación** — el log del backend muestra `auth_failed` con el `deviceId` y el `id` del `hello`; compara el token del firmware con el valor de `DEVICE_TOKEN` sin copiarlo a logs ni informes.
- **Solución** — copia el valor exacto; si lo cambiaste en `.env`, reinicia el backend y reflashea el firmware.

#### 8.2.2 La conexión se cierra a los 5 s sin respuesta <a id="hello-tardio"></a>

- **Síntoma** — el socket abre y el servidor lo cierra con 4408 «hello timeout» antes de cualquier `hello.ok`.
- **Causa probable** — el `hello` llegó tarde o no se envió: hay 5 s desde que abre la conexión.
- **Verificación** — en el log del backend, `connection_opened` seguido de `hello_timeout` y `closed`, sin `auth_ok`; en `gym watch` no hay `device.connected`.
- **Solución** — envía `hello` en el momento en que abre el socket, antes de temporizadores, escaneos o tareas de red.

#### 8.2.3 `ack` con `NOT_AUTHENTICATED` <a id="orden-antes-de-hello"></a>

- **Síntoma** — un mensaje distinto de `hello` recibe `ack` con `error: NOT_AUTHENTICATED`.
- **Causa probable** — se envió `status` u otro mensaje antes de un `hello` válido, o tras reconectar sin volver a autenticar.
- **Verificación** — el `ref` del `ack` identifica el mensaje adelantado; en el log, ese `type` aparece en `message_received` antes de cualquier `auth_ok`.
- **Solución** — `hello` es siempre el primer mensaje de cada conexión, también después de una reconexión.

#### 8.2.4 `ack` con `INVALID_MESSAGE` <a id="mensaje-invalido"></a>

- **Síntoma** — el mensaje se rechaza con `ack` `ok: false` y `error: INVALID_MESSAGE`; si su `id` no es un UUID recuperable, no hay `ack` y el fallo solo queda en el log.
- **Causa probable** — JSON mal formado, campo faltante o extra (el esquema es estricto), `id` que no es UUID, `ts` en milisegundos o tipos incorrectos.
- **Verificación** — compara el mensaje con los ejemplos del [protocolo](./protocolo_v0.md); el log muestra `message_invalid` con `code` y `reason`.
- **Solución** — `ts` en segundos, `ref: null` salvo en respuestas y un `id` UUID v4 nuevo por mensaje (el mismo solo al reenviar).

#### 8.2.5 `ack` con `UNSUPPORTED_VERSION` o `UNKNOWN_TYPE` <a id="version-tipo"></a>

- **Síntoma** — el mensaje se rechaza con uno de esos dos códigos.
- **Causa probable** — `v` distinto de `1` o un `type` inexistente (errata en el nombre).
- **Verificación** — contrasta `v` y `type` con las secciones 5 y 6 del [protocolo](./protocolo_v0.md); el log indica el código.
- **Solución** — envía `"v": 1` y los tipos exactos del protocolo.

#### 8.2.6 El firmware o el contrato no son los esperados <a id="firmware-contrato"></a>

- **Síntoma** — el dispositivo conecta, pero se comporta distinto de lo documentado o aparece con una versión de firmware que no es la desplegada.
- **Causa probable** — el binario flasheado es antiguo o habla una versión anterior del contrato (campos o mensajes que cambiaron).
- **Verificación** — `gym device status` (columna `firmware`) o `curl -H "x-api-key: <ADMIN_API_KEY>" http://<ip-del-pc>:3000/devices/status` (`firmwareVersion`); `gym watch` lo muestra al conectar: `device <id> connected (fw <versión>)`. Contrasta con la versión de `shared/` y del [protocolo](./protocolo_v0.md).
- **Solución** — reflashea el firmware esperado y, si el contrato cambió, actualiza el cliente antes de desplegarlo.

### 8.3 Conexión viva (heartbeat)

#### 8.3.1 El dispositivo se cae solo a los ~60 s (cierre 4402) <a id="heartbeat"></a>

- **Síntoma** — el dispositivo queda fuera de línea al minuto de conectar; código de cierre 4402 «heartbeat timeout» y `online: no`.
- **Causa probable** — no se envía `status` cada `heartbeatSec` (30 s por defecto): dos intervalos sin ningún mensaje del dispositivo (60 s) marcan el enlace como muerto aunque el TCP siga abierto.
- **Verificación** — `gym watch`: `device <id> disconnected (heartbeat_timeout)`; log del backend con `heartbeat_timeout`; `gym device status` con `online: no` y la última conexión.
- **Solución** — envía un `status` inmediato tras `hello.ok` y reprograma el temporizador con cada `heartbeatSec` recibido.

#### 8.3.2 Los `status` se confirman con error <a id="status-invalido"></a>

- **Síntoma** — el dispositivo sigue en línea, pero cada `status` recibe `ack` con `INVALID_MESSAGE` y el estado no se actualiza.
- **Causa probable** — el payload no cumple el esquema: `uptime`, `heap` o `fingerprintCount` negativos o no enteros, o `rssi` no entero.
- **Verificación** — lee el `ack` cuyo `ref` es el `id` del `status` y compara con el ejemplo del [protocolo](./protocolo_v0.md); el log muestra `message_invalid`.
- **Solución** — envía enteros: `uptime` en segundos, `heap` en bytes, `rssi` en dBm (negativo) y `fingerprintCount` con las plantillas realmente cargadas. Un `rssi` positivo o en 0 delata una lectura mal hecha.

### 8.4 Hora del dispositivo <a id="hora"></a>

- **Síntoma** — el reloj arranca en 1970 y los `ts` no cuadran con los del servidor; la conexión funciona igual.
- **Causa probable** — no hay NTP ni RTC con batería; no es un fallo de conexión, pero un `ts` mal calculado sí invalida los mensajes.
- **Verificación** — compara el `ts` enviado con `serverTime` de `hello.ok`; si el `ts` va en milisegundos (13 dígitos), el mensaje se rechaza con `INVALID_MESSAGE`.
- **Solución** — ajusta el reloj con `serverTime` al recibir `hello.ok`, envía `ts` en segundos y usa la hora del servidor para mostrar; la tuya es solo referencia.

### 8.5 Wifi y RSSI <a id="rssi"></a>

- **Síntoma** — desconexiones intermitentes, `hello` que nunca llega o latidos perdidos; en `gym watch` se alternan conexiones y cortes.
- **Causa probable** — RSSI débil, canal saturado o roaming entre AP con el mismo SSID; con mala señal el TCP se cae y no se cumplen los plazos de 5 s.
- **Verificación** — `status.rssi` en dBm: alrededor de -50 es bueno, -70 usable y por debajo de -80 el enlace no es fiable. `gym watch` y el log muestran los cortes; revisa en el router canal y potencia.
- **Solución** — acerca el ESP32 al AP, fija canal o BSSID, evita la banda saturada, reserva la IP y añade antena externa si hace falta.

### 8.6 Reconexión y órdenes pendientes

#### 8.6.1 No vuelve tras un corte, o vuelve sin autenticar <a id="reconexion"></a>

- **Síntoma** — tras una caída no hay conexión nueva, o hay `ack` con `NOT_AUTHENTICATED` al reconectar.
- **Causa probable** — no hay bucle de reconexión, o se reabre el socket sin repetir `hello`.
- **Verificación** — `gym watch`: no aparece un `device.connected` nuevo tras el corte; en el log, `connection_opened` sin `auth_ok` posterior (o con mensajes rechazados por `NOT_AUTHENTICATED`).
- **Solución** — reconecta con espera creciente (1, 2, 4… hasta 30 s) y empieza cada conexión por `hello`, con un `id` nuevo.

#### 8.6.2 Órdenes que no llegan al lector <a id="ordenes-pendientes"></a>

- **Síntoma** — el operador lanza `gym enroll start` o `gym alarm on` y el lector no reacciona hasta que se reconecta.
- **Causa probable** — el dispositivo estaba fuera de línea: la orden quedó guardada en `device_commands` para entregarse al reconectar.
- **Verificación** — `gym device status`, columna `pending`; `gym watch` muestra la orden con su `id` y estado `pending` y después `sent` o `acked`.
- **Solución** — en el firmware no hay nada que hacer: el servidor reenvía las órdenes en orden al reconectar. Si no llegan, comprueba que la conexión completó `hello`.

#### 8.6.3 Mensajes duplicados <a id="duplicados"></a>

- **Síntoma** — llega dos veces el mismo mensaje, con el mismo `id`.
- **Causa probable** — el emisor no recibió el `ack` a tiempo (5 s) y reenvió; el servidor hace lo mismo hasta 3 veces.
- **Verificación** — compara los `id`; en `gym watch` se ven dos `sent` con el mismo `commandId` y `attempts` creciente.
- **Solución** — si el `id` ya se procesó, no repitas el efecto (no cargues dos veces ni suenes dos veces) y **vuelve a enviar el `ack`**; el emisor lo toma como confirmación.

#### 8.6.4 Se desconecta al conectar otro cliente (cierre 4409) <a id="reemplazado"></a>

- **Síntoma** — el dispositivo se cae justo cuando conecta otro cliente, con código 4409 «replaced by a new connection».
- **Causa probable** — dos conexiones con el mismo `deviceId` (simulador y ESP32 a la vez); el servidor conserva la más reciente y cierra la anterior.
- **Verificación** — `gym watch`: dos `device.connected` seguidos para el mismo `deviceId` y `device <id> disconnected (replaced)`.
- **Solución** — un solo cliente por `deviceId`; detén el simulador antes de conectar el ESP32 o usa `SIM_DEVICE_ID` distinto.

### 8.7 Sincronización y slots

#### 8.7.1 Quedan huellas viejas tras sincronizar <a id="sync-nuevo"></a>

- **Síntoma** — un estudiante que ya no está en el horario sigue abriendo, o los slots quedan mezclados.
- **Causa probable** — no se borró el lector al recibir el primer bloque de un `syncId` nuevo; el servidor reasigna los slots en cada sincronización.
- **Verificación** — `gym sync` muestra los bloques y slots enviados (nunca el contenido); `status.fingerprintCount` no baja al número esperado y el log del simulador solo imprime `reader wiped` si el borrado está implementado.
- **Solución** — en el primer bloque de un `syncId` distinto al anterior, borra todas las plantillas locales y carga las del bloque; los bloques siguientes del mismo `syncId` solo añaden.

#### 8.7.2 Llega un bloque `templates.sync` vacío <a id="sync-vacio"></a>

- **Síntoma** — llega un bloque 1 de 1 con `templates: []` y el firmware lo trata como error o no hace nada.
- **Causa probable** — no hay nadie asignado: el servidor ordena dejar el lector sin plantillas.
- **Verificación** — `chunk.index` 1 y `chunk.total` 1 con arreglo vacío; `gym sync` informa 0 plantillas.
- **Solución** — borra todas las plantillas, deja `fingerprintCount` en 0 y confirma con `ack` como cualquier bloque. No es un error.

#### 8.7.3 Faltan estudiantes en el lector <a id="capacidad"></a>

- **Síntoma** — algunos estudiantes del horario no están cargados y no pueden entrar.
- **Causa probable** — la sincronización supera las 161 plantillas; el slot 162 está reservado al enrolamiento.
- **Verificación** — `gym sync` informa cuántas plantillas envió y avisa de los estudiantes que quedaron fuera por falta de slots (`left out for lack of reader slots`); el log del backend muestra `sync_over_capacity` con `capacity` y `omitted`.
- **Solución** — reduce los estudiantes por horario o reparte en varios horarios; el firmware no debe truncar en silencio: si recibe más de 161 slots, registra el aviso.

#### 8.7.4 Una plantilla no carga <a id="plantilla"></a>

- **Síntoma** — el bloque se confirma con `ok: false` o el lector falla al decodificar, y ese estudiante no queda cargado.
- **Causa probable** — base64 corrupto o plantilla mayor de lo que admite el AS608 (unos 512 B decodificados por plantilla).
- **Verificación** — el `ref` del `ack` negativo es el `id` del bloque; `status.fingerprintCount` queda por debajo del esperado; compara el tamaño decodificado con 512 B.
- **Solución** — confirma el bloque con `ack` `ok: false` para no bloquear el resto y vuelve a lanzar la sincronización con `gym sync`: el servidor da el bloque por confirmado y no lo repite solo.

#### 8.7.5 El horario no se aplica <a id="schedule-set"></a>

- **Síntoma** — el lector tiene las huellas, pero rechaza los escaneos con `NO_ACTIVE_SCHEDULE` o usa un horario anterior.
- **Causa probable** — no se guardó el `schedule.set` que llega tras el último bloque, o no se confirmó y el lector conserva el horario previo.
- **Verificación** — `gym sync` muestra el horario enviado; en el dispositivo, imprime inicio, fin y ventana de ingreso en hora de Bogotá.
- **Solución** — guarda `schedule.set` como horario vigente y confírmalo con `ack`. Si no llega ninguno, conserva el anterior: no lo borres.

### 8.8 Alarma y botón

#### 8.8.1 La sirena no suena <a id="alarma-no-suena"></a>

- **Síntoma** — termina el horario y la sirena no suena, aunque `gym alarm status` diga `ON`.
- **Causa probable** — no se confirmó el `alarm.set` (se reenviará), un `durationSec` numérico ya la apagó sola o el GPIO del buzzer no está activo.
- **Verificación** — `gym watch` muestra `alarm on (END_BEEP)` o `alarm on (PENDING_EXIT)`; `gym device status` con `pending` mayor que 0 indica órdenes sin confirmar; `gym alarm status` da motivo, duración e instancia.
- **Solución** — confirma `alarm.set` en menos de 5 s; si `durationSec` es numérico, programa el apagado y envía `alarm.state`; revisa el GPIO y la alimentación del buzzer.

#### 8.8.2 La sirena suena y no se apaga <a id="alarma-no-se-apaga"></a>

- **Síntoma** — la sirena sigue sonando después de salir el último o de pulsar el botón.
- **Causa probable** — con `durationSec: null` la sirena suena hasta otra orden; el botón no envía `button.pressed` o el firmware no aplica el `alarm.set` de apagado.
- **Verificación** — `gym alarm status` sigue en `ON`; en `gym watch`, busca `alarm off (CLEARED) by button`; el log del backend registra la orden y su confirmación.
- **Solución** — el botón debe silenciar localmente y enviar `button.pressed`; el servidor lo confirma, marca las sesiones abiertas como `no_registrada` y manda el `alarm.set` con `on: false`. Aplica siempre el último `alarm.set`.

#### 8.8.3 `alarm.state` no cambia nada en el servidor <a id="alarm-state"></a>

- **Síntoma** — el dispositivo envía `alarm.state` y el estado del servidor no cambia.
- **Causa probable** — es informativo (origen `server`, `button` o `local`); el servidor es la fuente de verdad y no lo altera.
- **Verificación** — `gym alarm status` no cambia tras el `alarm.state`; el log lo registra y el servidor lo confirma.
- **Solución** — úsalo para reflejar en la pantalla el estado real del dispositivo; no esperes que encienda ni apague nada en el servidor.

#### 8.8.4 Se aplica una orden de alarma vieja <a id="alarma-ultima-gana"></a>

- **Síntoma** — tras varias órdenes de alarma seguidas, el dispositivo obedece una anterior.
- **Causa probable** — se procesan en desorden o se guardan todas; el servidor descarta las anteriores sin confirmar y reenvía solo la vigente.
- **Verificación** — `gym watch` muestra los `alarm.set` con su `id` y estado; `gym alarm status` indica la instancia y el motivo vigentes.
- **Solución** — aplica el `alarm.set` más reciente y confírmalo; al reconectar recibirás solo la última orden.

### 8.9 Cualquier otro fallo <a id="otro-fallo"></a>

- **Síntoma** — un fallo que no aparece en esta sección.
- **Causa probable** — desconocida; el log del backend casi siempre la acota.
- **Verificación** — revisa el log del backend (`connection_opened`, `message_received`, `message_invalid`, `auth_failed`, `heartbeat_timeout`, `resend`, `closed`) y `gym watch`, que muestra en vivo conexiones, escaneos, órdenes y alarma.
- **Solución** — adjunta al reporte el `deviceId`, el `fw`, el `id` del mensaje que falla y las líneas del log de ese instante.
