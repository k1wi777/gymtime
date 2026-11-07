# Guía de firmware: modo sin conexión

Para el equipo de firmware del ESP32. Describe qué guarda el dispositivo cuando no hay conexión, cómo decide entradas y salidas por su cuenta, el formato de la cola y de los mensajes, los límites y el orden al reconectar. Está escrita para implementarse **sin leer el código del servidor**. El contrato base sigue en [`protocolo_v0.md`](./protocolo_v0.md) (sección 10); los textos de pantalla, en [`mensajes_pantalla.md`](./mensajes_pantalla.md).

> **Estado:** borrador de contrato (H12). Los puntos C1 a C11 de la sección 9 están **pendientes de confirmación por escrito del equipo de firmware**. El servidor ya cumple este contrato; si el equipo propone otro valor, se ajusta aquí y en la configuración, no en el código. Toda la extensión es **aditiva**: un firmware que no declara `capabilities` funciona exactamente como en v0 y no recibe ni envía nada de lo descrito aquí.

## 1. Qué es y qué no es

Sin conexión el ESP32 sigue dejando entrar y salir a los estudiantes **solo con la información que ya tenía guardada**. Cada decisión se anota en una cola con su hora original y se envía al reconectar. El servidor reconcilia con esa hora: lo que encaja queda como asistencia «sin conexión»; lo que no encaja queda **por revisar** en el panel. El dispositivo **no corrige nada ni reintenta una decisión**: ejecuta las reglas de la sección 3 y reporta.

No es un segundo servidor: no calcula métricas, no crea horarios y no decide excepciones. Si no tiene snapshot válido (sección 2) rechaza los escaneos y lo muestra.

## 2. Qué guarda el dispositivo

Todo en LittleFS (sobrevive a un reinicio), además de las huellas del AS608:

| Dato | Origen | Para qué |
|---|---|---|
| Último `offline.snapshot` | Servidor | Horario con su ventana, roster `slot` → nombre corto, quién está dentro y quién ya salió |
| Cola de eventos | Dispositivo | Decisiones tomadas sin conexión, una por línea, con `id`, `seq`, `ts` y `snapshotId` |
| Contador `seq` | Dispositivo | Entero creciente que **se guarda en cada evento** y nunca se reinicia |
| Estado local `open` / `exited` | Snapshot + decisiones | Para decidir entrada o salida y evitar reingresos |

El roster guarda el **nombre corto** (ASCII, máximo 16 caracteres, el mismo `display_name` de la pantalla). Es un dato personal mínimo y **nunca va con biometría**: las plantillas de huella siguen solo en el AS608 (punto C7).

### Cuándo llega el snapshot

El servidor envía `offline.snapshot` solo a un dispositivo que declaró `offline`: al conectar, al terminar cada sincronización y cuando cambia el horario vigente. Si el `hello` dijo `queued > 0`, espera al último lote o a 60 s. Se confirma con `ack`. **Aplíquelo cuando la cola esté vacía**: si aún hay eventos por enviar, guarde el roster nuevo pero conserve `open`/`exited` locales (son más recientes). Los eventos pendientes se siguen resolviendo en el servidor con el `snapshotId` con el que se decidieron.

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

- `schedule` es `null` cuando no hay horario próximo: sin horario, **rechace todos los escaneos** («Sin horario»).
- `roster` no trae biometría: solo `slot` y nombre.
- `limits` repite los límites de cola y lote (500 y 50) por si cambian.

## 3. Cómo decide el dispositivo sin conexión

Datos: `now` (hora del reloj del dispositivo, ver sección 7), el `schedule` del snapshot y `open`/`exited`. Para el `slot` que leyó el AS608:

1. Sin snapshot válido o `schedule == null` → rechazar («Sin horario»). No se anota.
2. `slot` no está en el roster → evento `unknown` (informativo) y mensaje «No reconocida». El servidor solo lo cuenta.
3. `slot` está en `open` → **salida**. Se permite siempre, aunque el horario haya terminado. Pasa de `open` a `exited`.
4. `slot` está en `exited` → rechazar («Ya marco salida»). No se anota. No hay reingreso.
5. Si `entryOpensAt <= now <= entryClosesAt` → **entrada**; pasa a `open`. Si no → rechazar («Ingreso cerrado»). No se anota.
6. Si la cola está llena (500) → rechazar con **«Cola llena»** y no anote nada. Nunca sobrescriba eventos antiguos: sería perder asistencia en silencio (punto C3).

Cada entrada, salida o desconocido se anota **antes** de mostrar el mensaje.

### Alarma local

Al llegar `now >= end` con alguien en `open`, suene la sirena. Se apaga cuando `open` queda vacío (`all_exited`), con el botón (`button`) o al cumplirse el tiempo máximo (`timeout`, 15 minutos). Se anota **un único evento `alarm` cuando termina**: `ts` es el inicio, `endTs` el fin y `endedBy` quién la apagó. Si reconecta con la sirena aún sonando, anote `endTs: null` (el servidor se encarga de la alarma real). Un reinicio durante la alarma pierde el evento (punto C9). Estas alarmas **no** encienden la sirena del servidor: el panel las muestra aparte como «Local».

## 4. Formato de la cola

Un archivo en LittleFS; cada línea es **un evento** en JSON, sin saltos dentro. Los campos son los mismos que viajan en `offline.events` (la cola es el lote sin envoltorio):

| Campo | Regla |
|---|---|
| `id` | UUID v4 generado **al decidir**. Se reutiliza en cada reintento; es la clave de idempotencia |
| `seq` | Entero creciente persistido. Desempata eventos con el mismo `ts` |
| `ts` | Hora del evento, Unix segundos, del reloj del dispositivo |
| `snapshotId` | Snapshot con el que se decidió |
| `type` | `entry`, `exit`, `unknown` o `alarm` |
| `slot` | Solo `entry` y `exit` |
| `endTs`, `endedBy` | Solo `alarm`; `endedBy` ∈ `button`, `all_exited`, `timeout` |

Ejemplos de líneas (el servidor los valida con sus esquemas):

<!-- queue-event -->
```json
{"id": "00000201-1111-4222-8333-000000000201", "seq": 1, "ts": 1760000500, "snapshotId": "000000a0-1111-4222-8333-0000000000a0", "type": "entry", "slot": 1}
```

<!-- queue-event -->
```json
{"id": "00000202-1111-4222-8333-000000000202", "seq": 2, "ts": 1760003000, "snapshotId": "000000a0-1111-4222-8333-0000000000a0", "type": "exit", "slot": 1}
```

<!-- queue-event -->
```json
{"id": "00000203-1111-4222-8333-000000000203", "seq": 3, "ts": 1760000600, "snapshotId": "000000a0-1111-4222-8333-0000000000a0", "type": "unknown"}
```

<!-- queue-event -->
```json
{"id": "00000204-1111-4222-8333-000000000204", "seq": 4, "ts": 1760004000, "snapshotId": "000000a0-1111-4222-8333-0000000000a0", "type": "alarm", "endTs": 1760004090, "endedBy": "button"}
```

No agregue campos propios: el servidor rechaza el evento con campos extra (los demás eventos del lote se procesan). Escriba la línea completa antes de borrar nada y escriba de forma atómica (archivo temporal y renombrar) para sobrevivir a un corte de energía. Máximo **500** eventos.

## 5. Orden al reconectar

1. Abra el WebSocket y envíe `hello` con `capabilities: ["offline"]`, `deviceTime` (su hora actual) y `queued` (eventos en cola).
2. Reciba `hello.ok` (no cambia). Envíe `status` como siempre.
3. Si `queued > 0`, **envíe los lotes antes de nada más**; el servidor espera el último lote para mandar el snapshot nuevo.
4. Reciba y aplique el snapshot (cuando la cola esté vacía) y confirme con `ack`.
5. Vuelva al modo en línea: a partir de aquí el servidor decide cada escaneo.

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

### Lotes

Envíe `offline.events` con **1 a 50** eventos, del más antiguo al más nuevo, `batch` desde 1 y `last: true` en el último. Espere el `ack` del lote **5 s**; sin respuesta, reenvíe el **mismo** lote con los **mismos** `id` de evento (el servidor no duplica nada). Borre de la cola los eventos de un lote **solo cuando llegue `ack` con `ok: true`**; con `ok: false` conserve la cola y reintente en la siguiente conexión. El tamaño máximo de la trama es **64 KB**.

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

<!-- example: ack -->
```json
{
  "v": 1,
  "id": "00000109-1111-4222-8333-000000000109",
  "type": "ack",
  "ts": 1760000000,
  "ref": "00000106-1111-4222-8333-000000000106",
  "payload": {
    "ok": true
  }
}
```

Un evento inválido no hace fallar el lote ni su `ack`: el servidor lo deja anotado en la auditoría y procesa los demás. Un evento repetido (mismo `id`, aunque sea en otro lote) no se vuelve a procesar.

## 6. Qué hace el servidor con la cola (para entender los avisos)

Aplica los eventos de cada estudiante ordenados por `ts` y `seq`, con **la hora original** y las mismas reglas que en línea. Resuelve el `slot` con el roster del `snapshotId` del evento. Lo que contradice el estado queda **por revisar** con un motivo cerrado: `EXIT_WITHOUT_ENTRY`, `DUPLICATE_ENTRY`, `OUTSIDE_WINDOW`, `NOT_IN_SCHEDULE`, `ALREADY_EXITED`, `STUDENT_INACTIVE`, `SESSION_ALREADY_CLOSED`, `OUT_OF_ORDER`, `TS_FUTURE`, `TS_TOO_OLD`, `UNKNOWN_SNAPSHOT` o `UNKNOWN_SLOT`. Un `ts` más de 120 s en el futuro, de hace más de 72 horas o anterior a 2020 también va a revisión. Si al reconciliar quedan personas dentro de un horario ya terminado, el servidor aplica la alarma habitual.

El dispositivo **no recibe el resultado por evento** (el `ack` no cambia): lo ve el asistente en el panel («Por revisar»).

## 7. Reloj

El servidor mide `deviceTime − hora del servidor` en cada `hello` y avisa en el panel si supera **30 s**. **No corrige** los `ts` con ese desfase: la hora del evento es la del dispositivo. Por eso:

- Sincronice la hora por NTP al conectar y no registre sin ella.
- **Sin hora válida (por ejemplo, tras un reinicio sin red y sin RTC) no registre entradas**: rechace los escaneos con «Sin hora» (punto C2). Un RTC DS3231 resuelve el caso; es una decisión de hardware.
- Nunca use `millis()` como hora de un evento.

## 8. Mensajes de pantalla sin conexión

Se agregan a [`mensajes_pantalla.md`](./mensajes_pantalla.md) (punto C11): `Cola llena` / `Avise asistente`, `Sin hora` / `No registra`, `Sin horario` / `en este momento`, y los de resultado local (`<NOMBRE>` / `Entrada local`, `Salida local`). Solo ASCII, 16 caracteres.

## 9. Puntos pendientes de confirmación (C1 a C11)

Hasta que el equipo de firmware los confirme por escrito, **ninguno está aceptado**.

| # | Punto | Propuesta | Estado |
|---|---|---|---|
| C1 | `capabilities`, `deviceTime`, `queued` en `hello` | Opcionales; sin ellos, v0 | Pendiente |
| C2 | Reloj tras un reinicio sin red | Sin hora válida no se registra; con RTC sí | Pendiente |
| C3 | Cola en LittleFS, JSON por línea, máx. 500 | Cola llena: rechazar, nunca sobrescribir | Pendiente |
| C4 | `id` UUID v4 y `seq` persistido | Se reutilizan en cada reintento | Pendiente |
| C5 | Lote de hasta 50, `ack` en 5 s, mismo `id` | Borrar solo con `ack` ok | Pendiente |
| C6 | Snapshot hasta 162 slots (~6 KB) en flash | Aplicarlo con la cola vacía | Pendiente |
| C7 | Nombre corto en flash | Alternativa: solo slots, mensajes sin nombre | Pendiente |
| C8 | Reglas locales de la sección 3 | Las de esta guía | Pendiente |
| C9 | Un único evento `alarm` al terminar | Se pierde si hay reinicio durante la alarma | Pendiente |
| C10 | Ignorar campos desconocidos del servidor | Ampliaciones aditivas | Pendiente |
| C11 | Mensajes de LCD sin conexión | Sección 8 | Pendiente |

## 10. Esbozo de C++ (orientativo)

No es código de producción: fija la forma de los datos y el orden de las operaciones. Use `ArduinoJson` con un `JsonDocument` por línea o lote (no cargue la cola entera en memoria).

```cpp
struct LocalState {
  std::set<uint8_t> open, exited;   // slots 1..162
  String snapshotId;
  uint32_t entryOpensAt, entryClosesAt, endTs;  // 0 = sin horario
};

enum class Decision { Entry, Exit, Unknown, Reject };

Decision decideOffline(LocalState& s, uint8_t slot, uint32_t now, bool inRoster) {
  if (s.endTs == 0 || !clockValid()) return Decision::Reject;      // sin horario / sin hora
  if (!inRoster) { enqueue("unknown", 0, now, s); return Decision::Unknown; }
  if (s.open.count(slot)) {                                        // salida siempre permitida
    s.open.erase(slot); s.exited.insert(slot);
    return enqueue("exit", slot, now, s) ? Decision::Exit : Decision::Reject;
  }
  if (s.exited.count(slot)) return Decision::Reject;               // sin reingreso
  if (now < s.entryOpensAt || now > s.entryClosesAt) return Decision::Reject;
  s.open.insert(slot);
  return enqueue("entry", slot, now, s) ? Decision::Entry : Decision::Reject;
}

// Una línea de la cola: el evento completo, con uuid v4 y seq persistido.
bool enqueue(const char* type, uint8_t slot, uint32_t ts, const LocalState& s) {
  if (queueCount() >= 500) { showMessage("Cola llena", "Avise asistente"); return false; }
  JsonDocument doc;
  doc["id"] = uuidV4(); doc["seq"] = nextSeqPersisted(); doc["ts"] = ts;
  doc["snapshotId"] = s.snapshotId; doc["type"] = type;
  if (slot) doc["slot"] = slot;
  return appendLineAtomically(doc);   // archivo temporal + renombrar
}

// Al reconectar: lotes de hasta 50; borrar solo con ack ok.
void sendQueue() {
  int batch = 1;
  while (queueCount() > 0) {
    auto events = readOldest(50);
    bool last = queueCount() <= events.size();
    String id = sendOfflineEvents(batch++, last, events);
    if (!waitAck(id, 5000)) return;       // reintentar con los mismos ids
    removeFromQueue(events);
  }
}
```

## 11. Lista de verificación del firmware

Pruebas con el ESP32 real; ninguna se puede afirmar sin hardware. Cada punto con su resultado esperado.

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Conectar con la capacidad `offline` | El `hello` lleva `capabilities`, `deviceTime`, `queued`; el servidor responde `hello.ok` y envía `offline.snapshot` |
| 2 | Conectar un firmware sin la capacidad | Funciona como v0 y no recibe snapshot |
| 3 | Cortar la red y pasar una huella del roster en ventana | Muestra «Entrada local»; hay una línea `entry` en la cola |
| 4 | Pasar la misma huella otra vez | Es salida; luego, una tercera vez, «Ya marco salida» sin anotar |
| 5 | Pasar una huella fuera de ventana | «Ingreso cerrado»; la cola no crece |
| 6 | Pasar una huella que no está en el roster | «No reconocida»; una línea `unknown` |
| 7 | Reiniciar sin red | La cola, el `seq` y el snapshot siguen; sin hora válida se rechazan entradas («Sin hora») |
| 8 | Llenar la cola (500) | «Cola llena»; no se sobrescribe ningún evento |
| 9 | Llegar al fin del horario con alguien dentro | Suena la sirena local; al apagarla se anota **un** `alarm` |
| 10 | Reconectar con eventos en cola | Lotes de 1 a 50, el último con `last: true`; la cola se vacía solo con `ack` ok |
| 11 | Cortar la red a mitad de un lote | Al reconectar se reenvían los mismos `id`; el panel no muestra duplicados |
| 12 | Reenviar un lote ya recibido | El servidor responde `ack` ok sin crear sesiones |
| 13 | Reloj con 45 s de desfase | El panel avisa del desfase en la pantalla del dispositivo |
| 14 | Snapshot de 162 estudiantes | Se guarda y se lee sin agotar memoria (`ArduinoJson`) |
| 15 | Evento en conflicto (p. ej. dos entradas) | Aparece en «Por revisar» del panel con su motivo |

Vectores de prueba (JSON válidos e inválidos) en [`fixtures/offline/`](./fixtures/offline/): el servidor los verifica con sus esquemas en cada ejecución de las pruebas.
