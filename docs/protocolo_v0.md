# Protocolo GymTime v0 (ESP32 <-> servidor)

Este documento es la referencia completa para implementar el cliente del lector (ESP32 con sensor AS608). Basta con leerlo para escribir el firmware. Los esquemas oficiales viven en el paquete `@gymtime/shared`; los ejemplos de este documento se validan automáticamente contra ellos en las pruebas, por lo que no pueden divergir.

- Versión del protocolo: 0, identificada en cada mensaje con `"v": 1`.
- Transporte: WebSocket nativo (`ws://`, sin TLS, red local). Mensajes de texto JSON, uno por trama.

## 1. Conexión y arranque

1. Abrir `ws://<ip-del-backend>:3000/device`.
2. El **primer** mensaje debe ser `hello` (con `deviceId`, `token`, `fw`). Si no llega un `hello` válido en 5 s, el servidor cierra la conexión; con un token incorrecto lo rechaza con `ack` de error `UNAUTHORIZED`.
   En producción la URL es `wss://api.<dominio>/device` y el token es el propio del dispositivo (`docs/guia_wss_firmware.md`); el esquema de `hello` no cambia. Si el administrador rota o revoca el token con la conexión abierta, el servidor la cierra con el código WebSocket `4410` (`token_revoked`); un token inválido en `hello` se cierra con `4401`.
3. El servidor responde `hello.ok` (con `serverTime` y `heartbeatSec`). A partir de ahí el dispositivo envía `status` cada `heartbeatSec` segundos.
4. El servidor puede enviar `templates.sync` y `schedule.set` para dejar el lector listo, y reenvía las órdenes que no hubieran sido confirmadas antes de la desconexión.
5. Si la conexión se pierde, reconectar y volver a empezar por `hello`. Sin conexión el lector conserva el horario en curso y reconcilia al reconectar.

Cualquier mensaje distinto de `hello` antes de autenticarse recibe `ack` de error `NOT_AUTHENTICATED`.

Aclaraciones de implementación (servidor):

- **`hello` repetido:** una vez autenticada la conexión, un nuevo `hello` válido recibe de nuevo `hello.ok` sin duplicar el estado. Un `hello` no se registra como mensaje procesado (su respuesta es `hello.ok`, no `ack`, y es idempotente por naturaleza).
- **Mensaje inválido sin `id`:** si el mensaje no pasa la validación y su `id` no es un UUID recuperable, el servidor no puede construir un `ack` válido (`ref` es obligatorio): lo registra en el log y lo ignora, sin responder. Si el `id` sí es recuperable, responde `ack` con el error correspondiente (`INVALID_MESSAGE`, `UNSUPPORTED_VERSION` o `UNKNOWN_TYPE`).
- **Segunda conexión del mismo `deviceId`:** el servidor cierra la anterior y conserva la nueva.

## 2. Sobre de todo mensaje

```json
{ "v": 1, "id": "uuid", "type": "fingerprint.scan", "ts": 1760000000, "ref": null, "payload": {} }
```

| Campo | Tipo | Descripción |
|---|---|---|
| `v` | entero | Siempre `1`. Otro valor se rechaza con `UNSUPPORTED_VERSION`. |
| `id` | UUID | Identificador único del mensaje (UUID v4). Se conserva en los reenvíos. |
| `type` | texto | Tipo de mensaje (secciones 5 y 6). Uno desconocido se rechaza con `UNKNOWN_TYPE`. |
| `ts` | entero | Hora Unix en **segundos** (UTC) en que ocurrió el evento. |
| `ref` | UUID o `null` | Solo en las respuestas (`ack`, `hello.ok`, `scan.result`): `id` del mensaje original. En el resto es `null`. |
| `payload` | objeto | Contenido según el tipo. |

El esquema es **estricto**: un campo desconocido, un campo faltante o con tipo erróneo hace que el mensaje se rechace con `INVALID_MESSAGE`. La hora que manda es la del servidor (`serverTime` en `hello.ok`).

## 3. Reglas de entrega

- Todo mensaje que no sea `ack` se confirma con un `ack` (su `ref` es el `id` del mensaje) en **menos de 5 s**.
- Sin `ack`, el emisor reenvía hasta **3 veces** con el **mismo `id`**.
- El receptor ignora un `id` que ya procesó, pero **vuelve a enviar el ack**.
- El `ack` lleva `payload` con `ok` y, si `ok` es `false`, un código de error (sección 7).
- El servidor guarda las órdenes sin confirmar y las reenvía cuando el dispositivo se reconecta.

```text
Dispositivo                         Servidor
    | -- fingerprint.scan (id=A) ---> |
    | <---------- ack (ref=A) ------- |   caso normal
    | -- fingerprint.scan (id=A) ---> |   sin ack en 5 s: reenvío (hasta 3), mismo id
    | <---------- ack (ref=A) ------- |   duplicado: no se reprocesa, se reenvía el ack
```

## 4. Convenciones

- Los campos `slot` van de 1 a 162.
- Las plantillas se codifican en base64 estándar con relleno `=`.
- Las horas son Unix en segundos (UTC); la zona horaria America/Bogota solo se usa para mostrar.

## 5. Mensajes dispositivo -> servidor

### `hello`

Primer mensaje obligatorio tras abrir la conexión. Identifica y autentica al dispositivo.

Campos del payload: `deviceId`, `token`, `fw` (cadenas no vacías).

<!-- example: hello -->
```json
{
  "v": 1,
  "id": "00000001-1111-4222-8333-000000000001",
  "type": "hello",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "deviceId": "esp32-gym-01",
    "token": "token-secreto-del-dispositivo",
    "fw": "1.0.0"
  }
}
```

### `fingerprint.scan`

El lector reconoció una huella almacenada en uno de sus slots.

Campos del payload: `slot` entero 1..162; `confidence` entero >= 0 (puntaje del AS608, no porcentaje).

<!-- example: fingerprint.scan -->
```json
{
  "v": 1,
  "id": "00000002-1111-4222-8333-000000000002",
  "type": "fingerprint.scan",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "slot": 3,
    "confidence": 187
  }
}
```

### `fingerprint.unknown`

El lector detectó un dedo pero no lo reconoció.

Campos del payload: Payload vacío `{}`.

<!-- example: fingerprint.unknown -->
```json
{
  "v": 1,
  "id": "00000003-1111-4222-8333-000000000003",
  "type": "fingerprint.unknown",
  "ts": 1760000000,
  "ref": null,
  "payload": {}
}
```

### `enroll.progress`

Avance del enrolamiento en curso.

Campos del payload: `enrollmentId` UUID; `step` uno de `place_finger`, `remove_finger`, `place_again`, `processing`.

<!-- example: enroll.progress -->
```json
{
  "v": 1,
  "id": "00000004-1111-4222-8333-000000000004",
  "type": "enroll.progress",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "enrollmentId": "00000064-1111-4222-8333-000000000064",
    "step": "place_finger"
  }
}
```

### `enroll.done`

Enrolamiento terminado; entrega la plantilla.

Campos del payload: `enrollmentId` UUID; `template` base64 válido no vacío (modelo AS608 de ~512 bytes; el ejemplo está acortado).

<!-- example: enroll.done -->
```json
{
  "v": 1,
  "id": "00000005-1111-4222-8333-000000000005",
  "type": "enroll.done",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "enrollmentId": "00000064-1111-4222-8333-000000000064",
    "template": "AAECAwQFBgcICQoLDA0ODw=="
  }
}
```

### `enroll.failed`

El enrolamiento falló en el dispositivo.

Campos del payload: `enrollmentId` UUID; `reason` texto libre no vacío.

<!-- example: enroll.failed -->
```json
{
  "v": 1,
  "id": "00000006-1111-4222-8333-000000000006",
  "type": "enroll.failed",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "enrollmentId": "00000064-1111-4222-8333-000000000064",
    "reason": "fingers_do_not_match"
  }
}
```

### `alarm.state`

El estado de la alarma cambió en el dispositivo.

Campos del payload: `on` booleano; `source` uno de `server`, `button`, `local`.

<!-- example: alarm.state -->
```json
{
  "v": 1,
  "id": "00000007-1111-4222-8333-000000000007",
  "type": "alarm.state",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "on": false,
    "source": "button"
  }
}
```

### `button.pressed`

Se pulsó el botón físico de la alarma.

Campos del payload: Payload vacío `{}`.

<!-- example: button.pressed -->
```json
{
  "v": 1,
  "id": "00000008-1111-4222-8333-000000000008",
  "type": "button.pressed",
  "ts": 1760000000,
  "ref": null,
  "payload": {}
}
```

### `status`

Latido periódico, cada `heartbeatSec` segundos.

Campos del payload: `uptime` (s), `heap` (bytes), `fingerprintCount`: enteros >= 0; `rssi`: entero en dBm (negativo).

<!-- example: status -->
```json
{
  "v": 1,
  "id": "00000009-1111-4222-8333-000000000009",
  "type": "status",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "uptime": 3600,
    "heap": 184320,
    "rssi": -58,
    "fingerprintCount": 12
  }
}
```


## 6. Mensajes servidor -> dispositivo

### `hello.ok`

Respuesta a un `hello` válido. Su `ref` es el `id` del `hello`. Hace de confirmación del `hello`.

Campos del payload: `serverTime` Unix s; `heartbeatSec` entero > 0. Respuesta: `ref` obligatorio.

<!-- example: hello.ok -->
```json
{
  "v": 1,
  "id": "00000015-1111-4222-8333-000000000015",
  "type": "hello.ok",
  "ts": 1760000001,
  "ref": "00000001-1111-4222-8333-000000000001",
  "payload": {
    "serverTime": 1760000001,
    "heartbeatSec": 30
  }
}
```

### `scan.result`

Decisión del servidor ante un `fingerprint.scan` o `fingerprint.unknown` (`ref` = `id` del escaneo). Aquí, una entrada.

Campos del payload: `result`: `entry`, `exit`, `denied`, `unknown`. Con `entry`/`exit`: `studentName` texto y `reason` `null`. Con `denied`: `reason` es un código de rechazo y `studentName` texto o `null`. Con `unknown`: ambos `null`. `display`: el mensaje de pantalla (`title`, `subtitle`, `tone`; ver abajo) más los campos obsoletos `line1`, `line2` y `color`.

`studentName` es el nombre completo; en `display.title` el servidor envía el nombre corto de pantalla (`display_name`, máximo 24 caracteres, con tildes). La pantalla es una TFT a color de 3,5" (240 × 320 px, horizontal) que dibuja tildes y la ñ.

**Contenido de pantalla (`display`)**, igual en `scan.result` y en `display.message`:

| Campo | Tipo | Significado |
|---|---|---|
| `title` | texto | Título de una línea (hasta 32 caracteres). No vacío, salvo el mensaje de limpiar la pantalla. |
| `subtitle` | texto | Subtítulo (hasta 80 caracteres y 2 líneas separadas por `\n`); `""` si no hay. |
| `tone` | `success`, `error`, `warning`, `info` | Intención de color: verde, rojo, naranja, neutro. El firmware elige el RGB final y el tamaño de la letra. |
| `line1`, `line2`, `color` | texto | **Obsoletos** (transición, ver abajo). |

Los límites son configurables en el servidor (`DISPLAY_TITLE_MAX`, `DISPLAY_SUBTITLE_MAX`, `DISPLAY_SUBTITLE_LINES`, `DISPLAY_NAME_MAX`). La tabla de colores sugeridos por tono, el catálogo completo de textos y los mensajes locales del firmware están en [`mensajes_pantalla.md`](./mensajes_pantalla.md).

**Transición de `line1`, `line2` y `color` (protocolo sigue en `v: 1`).** Mientras dure la transición el servidor sigue enviando `line1 = title`, `line2 = subtitle` (ya sin recorte a 16 caracteres ni sin tildes) y `color` derivado del tono (`success→green`, `error→red`, `warning→orange`, `info→white`), para que ningún consumidor actual deje de validar. Los tres están obsoletos: el firmware debe leer `title`, `subtitle` y `tone`. Se retirarán cuando el firmware confirme el cambio.

<!-- example: scan.result -->
```json
{
  "v": 1,
  "id": "00000016-1111-4222-8333-000000000016",
  "type": "scan.result",
  "ts": 1760000002,
  "ref": "00000002-1111-4222-8333-000000000002",
  "payload": {
    "result": "entry",
    "studentName": "Ana Perez",
    "reason": null,
    "display": {
      "title": "Ana Perez",
      "subtitle": "Entrada registrada",
      "tone": "success",
      "line1": "Ana Perez",
      "line2": "Entrada registrada",
      "color": "green"
    }
  }
}
```

### `enroll.start`

Ordena iniciar un enrolamiento usando un slot temporal.

Campos del payload: `enrollmentId` UUID; `scratchSlot` 1..162; `timeoutSec` entero > 0.

<!-- example: enroll.start -->
```json
{
  "v": 1,
  "id": "00000017-1111-4222-8333-000000000017",
  "type": "enroll.start",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "enrollmentId": "00000064-1111-4222-8333-000000000064",
    "scratchSlot": 162,
    "timeoutSec": 60
  }
}
```

### `enroll.cancel`

Cancela el enrolamiento en curso.

Campos del payload: `enrollmentId` UUID.

<!-- example: enroll.cancel -->
```json
{
  "v": 1,
  "id": "00000018-1111-4222-8333-000000000018",
  "type": "enroll.cancel",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "enrollmentId": "00000064-1111-4222-8333-000000000064"
  }
}
```

### `templates.sync`

Bloque de plantillas a cargar en el lector (ver notas de firmware).

Campos del payload: `syncId` UUID; `chunk.index` desde 1 hasta `chunk.total`; `templates` de 1 a 10 entradas `{slot, template}` con slots 1..162 sin repetir en el bloque. **Excepción:** `templates` puede ser un arreglo vacío solo cuando `chunk` es 1 de 1; es la orden de dejar el lector sin plantillas (nadie debe estar cargado). Con `chunk.total` mayor que 1 ningún bloque puede venir vacío.

<!-- example: templates.sync -->
```json
{
  "v": 1,
  "id": "00000019-1111-4222-8333-000000000019",
  "type": "templates.sync",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "syncId": "000000c8-1111-4222-8333-0000000000c8",
    "chunk": {
      "index": 1,
      "total": 2
    },
    "templates": [
      {
        "slot": 1,
        "template": "AAECAwQFBgcICQoLDA0ODw=="
      },
      {
        "slot": 2,
        "template": "AAECAwQFBgcICQoLDA0ODw=="
      }
    ]
  }
}
```

Ejemplo de sincronización vacía (el lector borra todo y no carga nada):

<!-- example: templates.sync -->
```json
{
  "v": 1,
  "id": "0000001b-1111-4222-8333-00000000001b",
  "type": "templates.sync",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "syncId": "000000c9-1111-4222-8333-0000000000c9",
    "chunk": {
      "index": 1,
      "total": 1
    },
    "templates": []
  }
}
```

### `schedule.set`

Horario en curso, con su ventana de ingreso.

Campos del payload: `scheduleId` texto no vacío; los demás campos son Unix s.

<!-- example: schedule.set -->
```json
{
  "v": 1,
  "id": "0000001a-1111-4222-8333-00000000001a",
  "type": "schedule.set",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "scheduleId": "sched-2026-11-02-1800",
    "start": 1760004000,
    "end": 1760007600,
    "entryOpensAt": 1760003100,
    "entryClosesAt": 1760004600
  }
}
```

### `alarm.set`

Ordena encender o apagar la alarma.

Campos del payload: `on` booleano; `durationSec` entero > 0 o `null`; `reason` uno de `END_BEEP`, `PENDING_EXIT`, `MANUAL`, `TEST`, `CLEARED`.

<!-- example: alarm.set -->
```json
{
  "v": 1,
  "id": "0000001b-1111-4222-8333-00000000001b",
  "type": "alarm.set",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "on": true,
    "durationSec": 30,
    "reason": "END_BEEP"
  }
}
```

### `display.message`

Muestra un mensaje temporal en la pantalla.

Campos del payload: `title`, `subtitle`, `tone` (el contenido de pantalla descrito en `scan.result`), los obsoletos `line1`, `line2` y `color`, y `durationSec` entero > 0.

Reglas:

- El texto conserva tildes y ñ; el servidor solo rechaza lo no imprimible y lo que no cabe en los límites (título 32 caracteres; subtítulo 80 y 2 líneas) antes de enviarlo. El firmware debe confirmar con `ack` aunque la pantalla no pueda dibujar el texto (un glifo que falte se sustituye por uno de reemplazo).
- `durationSec` es el tiempo en pantalla; al cumplirse, el lector vuelve a su estado de reposo. Una orden nueva reemplaza a la que se estaba mostrando.
- **Título y subtítulo vacíos** (`""`, con `tone` `info`) significan «limpiar la pantalla»: retiran el mensaje en curso, por ejemplo el de la alarma.
- Es una orden persistida como `alarm.set`: se reintenta con el mismo `id` y, si el lector estaba desconectado, se entrega al reconectar, en orden de creación. Lo envían `POST /devices/messages` y `gym device message`, y la alarma continua (`Tiempo cumplido` / `Registre su salida`, tono `warning`; ver [`mensajes_pantalla.md`](./mensajes_pantalla.md)).

<!-- example: display.message -->
```json
{
  "v": 1,
  "id": "0000001c-1111-4222-8333-00000000001c",
  "type": "display.message",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "title": "Tiempo cumplido",
    "subtitle": "Registre su salida",
    "tone": "warning",
    "line1": "Tiempo cumplido",
    "line2": "Registre su salida",
    "color": "orange",
    "durationSec": 10
  }
}
```


## 7. `ack` y códigos

`ack` viaja en ambas direcciones. Su `ref` es obligatorio y su payload es `{ok, error?}`; `error` solo se usa cuando `ok` es `false`.

<!-- example: ack -->
```json
{
  "v": 1,
  "id": "00000028-1111-4222-8333-000000000028",
  "type": "ack",
  "ts": 1760000002,
  "ref": "00000002-1111-4222-8333-000000000002",
  "payload": {
    "ok": true
  }
}
```

Ejemplo de `ack` negativo:

<!-- example: ack -->
```json
{
  "v": 1,
  "id": "00000029-1111-4222-8333-000000000029",
  "type": "ack",
  "ts": 1760000002,
  "ref": "00000002-1111-4222-8333-000000000002",
  "payload": {
    "ok": false,
    "error": "INVALID_MESSAGE"
  }
}
```

### Motivos de rechazo de un escaneo (`scan.result.payload.reason`)

| Código | Significado |
|---|---|
| `UNKNOWN_SLOT` | El slot de la huella no está asignado a ningún estudiante. |
| `NO_ACTIVE_SCHEDULE` | No hay un horario en curso ni con ingreso abierto en este momento. |
| `NOT_IN_SCHEDULE` | El estudiante no pertenece al horario activo. |
| `OUTSIDE_ENTRY_WINDOW` | El ingreso está fuera de la ventana permitida. |
| `ALREADY_EXITED` | El estudiante ya registró su salida de esta sesión. |
| `STUDENT_INACTIVE` | El estudiante está dado de baja. |

### Códigos de error de `ack` (`ack.payload.error`)

| Código | Significado |
|---|---|
| `INVALID_MESSAGE` | El mensaje no es JSON válido o no cumple el esquema. |
| `UNSUPPORTED_VERSION` | La versión del protocolo (`v`) no es soportada. |
| `UNKNOWN_TYPE` | El tipo de mensaje (`type`) no existe. |
| `UNAUTHORIZED` | El token del dispositivo en `hello` es inválido: no es el de ese dispositivo, fue rotado o revocado, o (sin token propio) no coincide con el compartido. |
| `NOT_AUTHENTICATED` | Se recibió un mensaje antes de un `hello` válido. |
| `INTERNAL_ERROR` | Error interno del receptor al procesar el mensaje. |

## 8. Notas para firmware

- **`templates.sync`**: al recibirlo, el lector debe **borrar todas sus plantillas** y cargar las recibidas en los slots indicados. Cada bloque (`chunk`) se confirma por separado con su `ack`. El servidor envía bloques de **10 plantillas** como máximo para no desbordar la memoria del ESP32; el primer bloque (`chunk.index` = 1) inicia la carga y el último (`index` = `total`) la completa. Los bloques de una misma sincronización comparten `syncId`. Un único bloque 1 de 1 con `templates: []` significa «borrar todo y no cargar nada»: el lector debe vaciarse y confirmar con `ack` igualmente.
- **`schedule.set`**: el servidor lo envía después del último bloque de una sincronización, cuando hay un horario en curso o próximo. El lector lo guarda como horario vigente (inicio, fin y límites de ingreso, en segundos Unix) y lo confirma con `ack`. Si no hay horario relevante, no se envía ninguno y el lector conserva el anterior.
- **Plantilla**: es el modelo de ~512 bytes que genera el AS608, en base64.
- **`status`**: enviarlo cada `heartbeatSec` segundos (valor recibido en `hello.ok`).
- **`alarm.set`**: con `durationSec` numérico, el dispositivo apaga la alarma por sí mismo al cumplirse ese tiempo y envía `alarm.state`. Con `durationSec` en `null`, la mantiene hasta recibir `alarm.set` con `on: false`. El botón físico la apaga en ambos casos y envía `button.pressed`.
- **Enrolamiento**: `enroll.start` indica un `scratchSlot` temporal; el dispositivo informa `enroll.progress` en cada paso y termina con `enroll.done` o `enroll.failed`. `enroll.cancel` lo interrumpe.
- **Hora**: la hora del servidor manda; usar `serverTime` para ajustar el reloj.

## 9. Lista de verificación para el cliente

- [ ] Abre `ws://<ip>:3000/device` y envía `hello` primero.
- [ ] Todo mensaje lleva `v`=1, `id` UUID nuevo, `ts` en segundos y `ref` correcto.
- [ ] Confirma con `ack` todo mensaje recibido (salvo otro `ack`) en menos de 5 s.
- [ ] Reenvía hasta 3 veces con el mismo `id` si no recibe `ack`.
- [ ] Ante un `id` repetido, no reprocesa y vuelve a enviar el `ack`.
- [ ] Envía `status` cada `heartbeatSec` segundos.
- [ ] Al recibir `templates.sync`, borra las plantillas locales y carga las recibidas.
- [ ] Reconecta y repite `hello` si cae la conexión.

## 10. Extensión sin conexión (opcional, H12)

> **Estado:** borrador de contrato. Los puntos marcados como «requiere confirmación» en `docs/modo_sin_conexion_firmware.md` no están aceptados hasta que el equipo de firmware los confirme por escrito. Toda la extensión es **aditiva**: un firmware que no declara `capabilities` se comporta exactamente como en las secciones 1 a 9.

Un dispositivo que declara la capacidad `offline` puede decidir entrada y salida por su cuenta cuando no hay conexión, guardar los eventos en una cola con su hora original y enviarlos al reconectar. El servidor los reconcilia con esa hora; lo que no encaja queda «por revisar» en el panel.

### `hello` ampliado

Tres campos **opcionales** en el payload: `capabilities` (hoy solo `"offline"`), `deviceTime` (hora Unix del dispositivo, para medir el desfase del reloj) y `queued` (eventos que aún guarda en su cola). `hello.ok` **no cambia**.

<!-- example: hello -->
```json
{
  "v": 1,
  "id": "00000103-1111-4222-8333-000000000103",
  "type": "hello",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "deviceId": "esp32-gym-01",
    "token": "token-secreto-del-dispositivo",
    "fw": "1.1.0",
    "capabilities": [
      "offline"
    ],
    "deviceTime": 1760000012,
    "queued": 37
  }
}
```

### `offline.snapshot` (servidor -> dispositivo)

Lo recibe solo un dispositivo que declaró `offline`: al conectar, al terminar cada sincronización y cuando cambia el horario vigente (si `queued` > 0, tras el último lote o a los 60 s). Se confirma con `ack`. Lleva el horario con su ventana (`null` si no hay horario próximo: el dispositivo rechaza escaneos sin conexión), el roster `slot` -> nombre corto (ASCII, máximo 16 caracteres), los slots que están dentro (`open`), los que ya salieron en esta ocurrencia (`exited`) y los límites de cola y lote. Un roster nuevo reemplaza al anterior, pero los eventos pendientes se siguen resolviendo con el `snapshotId` con el que se decidieron.

<!-- example: offline.snapshot -->
```json
{
  "v": 1,
  "id": "00000104-1111-4222-8333-000000000104",
  "type": "offline.snapshot",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "snapshotId": "000000a0-1111-4222-8333-0000000000a0",
    "generatedAt": 1760000000,
    "schedule": {
      "scheduleId": "11111111-1111-4111-8111-111111111111",
      "start": 1760000400,
      "end": 1760004000,
      "entryOpensAt": 1760000100,
      "entryClosesAt": 1760001200
    },
    "roster": [
      {
        "slot": 1,
        "name": "Ana Gomez"
      },
      {
        "slot": 2,
        "name": "Luis Mora"
      },
      {
        "slot": 3,
        "name": "Eva Ruiz"
      }
    ],
    "open": [
      2
    ],
    "exited": [
      3
    ],
    "limits": {
      "queueMax": 500,
      "batchMax": 50
    }
  }
}
```

### `offline.events` (dispositivo -> servidor)

Lote de 1 a 50 eventos (`batch` es el número del lote y `last` indica el último de la reconexión). Cada evento lleva `id` (UUID v4 creado en el dispositivo y reutilizado en cada reintento), `seq` (entero creciente persistido), `ts` (hora original), `snapshotId` (el snapshot con el que se decidió) y su tipo: `entry` y `exit` con `slot`; `unknown` (informativo); `alarm` con `endTs` (`null` si seguía sonando) y `endedBy` (`button`, `all_exited` o `timeout`), un único evento al terminar la alarma local, cuyo `ts` es el inicio. El `ack` es el existente: el dispositivo borra de su cola todo el lote solo cuando llega con `ok: true`. Un evento inválido no hace fallar el lote; los eventos repetidos (mismo `id`) no se reprocesan. Tamaño máximo de la trama: 64 KB.

<!-- example: offline.events -->
```json
{
  "v": 1,
  "id": "00000107-1111-4222-8333-000000000107",
  "type": "offline.events",
  "ts": 1760000000,
  "ref": null,
  "payload": {
    "batch": 1,
    "last": true,
    "events": [
      {
        "id": "00000203-1111-4222-8333-000000000203",
        "seq": 3,
        "ts": 1760000600,
        "snapshotId": "000000a0-1111-4222-8333-0000000000a0",
        "type": "unknown"
      },
      {
        "id": "00000204-1111-4222-8333-000000000204",
        "seq": 4,
        "ts": 1760004000,
        "snapshotId": "000000a0-1111-4222-8333-0000000000a0",
        "type": "alarm",
        "endTs": 1760004090,
        "endedBy": "button"
      }
    ]
  }
}
```

Los vectores de prueba (válidos e inválidos) están en `docs/fixtures/offline/*.jsonl` y el servidor los verifica con los esquemas en cada ejecución de las pruebas.
