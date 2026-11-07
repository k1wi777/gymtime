# Mensajes de la pantalla LCD (16 × 2)

Guía para el equipo de firmware: qué texto envía el servidor, qué textos muestra el firmware por su cuenta y qué reglas cumple la pantalla. El contrato de los mensajes sigue en [`protocolo_v0.md`](./protocolo_v0.md); el estado de cada capacidad, en [`estado_firmware.md`](./estado_firmware.md).

## Reglas de la pantalla

- **Tamaño:** 16 caracteres × 2 líneas. Es configurable en el servidor con `DISPLAY_COLS` (16) y `DISPLAY_ROWS` (2); si el hardware definitivo fuera otro, se cambia la variable y no el código.
- **Solo ASCII imprimible:** las pantallas LCD de este tipo no muestran tildes ni la ñ. El servidor quita las tildes (`á→a`, `ñ→n`) antes de enviar y rechaza cualquier otro carácter. Los textos del firmware deben seguir la misma regla (`Salio`, no `Salió`).
- **Cada línea** tiene como máximo 16 caracteres. La línea 2 puede ir vacía.
- **Tiempo en pantalla:** los mensajes de resultado de un escaneo se muestran `DISPLAY_RESULT_SECONDS` segundos (3 por defecto) y luego la pantalla vuelve al reposo o se apaga si el sensor de proximidad ya no detecta a nadie. En `display.message` el tiempo lo indica `durationSec`.
- **Color:** el campo `color` de `scan.result` no aplica a una pantalla monocroma; el firmware puede ignorarlo (se mantiene en el contrato).
- **Limpiar la pantalla:** un `display.message` con las dos líneas vacías (`""`) retira el mensaje en curso. Es un supuesto del servidor a confirmar con el firmware: si el lector no limpia con líneas vacías, el mensaje desaparece igualmente al cumplirse su `durationSec`.
- **Confirmación:** todo `display.message` y todo `scan.result` se confirma con `ack`, se pueda dibujar o no.

`<NOMBRE>` es el `display_name` del estudiante: máximo 16 caracteres ASCII. Se genera al registrarlo (nombre completo si cabe; si no, primer nombre e inicial del siguiente, p. ej. `Ana M.`) y el asistente puede editarlo (`PATCH /students/:id`, `gym student edit --display-name`). El nombre completo sigue viajando en `scan.result.payload.studentName`; la pantalla debe dibujar `display.line1`.

## Mensajes que envía el servidor

`scan.result` (campo `display`) y `display.message`.

| Situación | Línea 1 | Línea 2 | Se envía hoy |
|---|---|---|---|
| Entrada registrada | `<NOMBRE>` | `Entrada OK` | Sí |
| Salida registrada | `<NOMBRE>` | `Salida OK` | Sí |
| Huella no reconocida (`unknown`, `UNKNOWN_SLOT`) | `No reconocida` | `Intente de nuevo` | Sí |
| `NOT_IN_SCHEDULE` | `<NOMBRE>` | `No es su horario` | Sí |
| `NO_ACTIVE_SCHEDULE` | `Sin horario` | `en este momento` | Sí |
| `OUTSIDE_ENTRY_WINDOW`, ya cerrado | `Ingreso cerrado` | (vacía) | Sí |
| `ALREADY_EXITED` | `<NOMBRE>` | `Ya marco salida` | Sí |
| `STUDENT_INACTIVE` | `<NOMBRE>` | `No habilitado` | Sí |
| Alarma continua (`PENDING_EXIT`) | `Tiempo cumplido` | `Registre salida` | Sí (`display.message`) |
| Alarma apagada (`CLEARED`) | (vacía) | (vacía) | Sí (`display.message`, limpia la pantalla, 1 s) |
| `OUTSIDE_ENTRY_WINDOW`, antes de abrir | `Ingreso abre` | `a las HH:MM` | **Reservado, no se envía** |
| Error del servidor | `Error de sistema` | `Llame asistente` | **Reservado, no se envía** |

Notas sobre los dos mensajes reservados:

- `Ingreso abre a las HH:MM`: hoy, antes de abrirse la ventana de ingreso, el servidor responde `NO_ACTIVE_SCHEDULE` (`Sin horario / en este momento`); distinguir «aún no abre» exige un cambio en la decisión de entrada que queda para otra iteración.
- `Error de sistema / Llame asistente`: el servidor no responde `scan.result` cuando falla (el escaneo recibe un `ack` negativo). Está en el catálogo para cuando exista ese camino, y el firmware puede usarlo cuando no obtenga respuesta.

### Mensajes de la alarma

Con la alarma continua (`PENDING_EXIT`, al terminar un horario con gente adentro) el servidor envía, junto con `alarm.set`, un `display.message` `Tiempo cumplido` / `Registre salida` con `durationSec` igual a `ALARM_TIMEOUT_MINUTES × 60`: es el tope de vida de la alarma, porque el protocolo no tiene «hasta nueva orden». Al apagarla (salió el último, botón, `gym alarm off` o tiempo agotado) envía `CLEARED` y un `display.message` con las dos líneas vacías.

- Si el lector se reconecta con la alarma encendida, recibe de nuevo el `alarm.set` y el mensaje con los segundos que faltan.
- Si la alarma se apaga mientras el lector está desconectado, el mensaje viejo se descarta y no se reproduce.
- `END_BEEP`, `TEST` y `MANUAL` no envían mensaje.

### Mensajes del operador

`POST /devices/messages` y `gym device message "línea 1" ["línea 2"] [--seconds N]` envían un `display.message` libre. Se normalizan las tildes y se rechaza (400) lo que no cabe, indicando la línea y el límite. Sin `--seconds` se usa `DISPLAY_RESULT_SECONDS`; el operador puede indicar de 1 a 60 s. Si el lector está desconectado la orden queda en cola y se entrega, en orden, al reconectar.

## Mensajes locales del firmware

No pasan por el servidor; el firmware los dibuja por su cuenta.

| Situación | Línea 1 | Línea 2 |
|---|---|---|
| Reposo (alguien se acerca) | `Ponga su huella` | (vacía) |
| Leyendo la huella | `Leyendo...` | (vacía) |
| Lectura fallida | `No se pudo leer` | `Reintente` |
| Sin conexión (modo local) | `Sin conexion` | `Modo local` |
| Enrolamiento: primer dedo | `Ponga su dedo` | `en el lector` |
| Enrolamiento: retirar | `Retire el dedo` | (vacía) |
| Enrolamiento: segundo dedo | `Ponga el mismo` | `dedo otra vez` |
| Enrolamiento: procesando | `Procesando...` | (vacía) |
| Enrolamiento: listo | `Huella guardada` | (vacía) |
| Enrolamiento: error | `Error. Reintente` | (vacía) |

### Sin conexión (modo local, H12)

Los dibuja el firmware con el snapshot; ver [`modo_sin_conexion_firmware.md`](./modo_sin_conexion_firmware.md). Pendientes de confirmación (C11).

| Situación | Línea 1 | Línea 2 |
|---|---|---|
| Entrada decidida en el lector | `<NOMBRE>` | `Entrada local` |
| Salida decidida en el lector | `<NOMBRE>` | `Salida local` |
| Cola llena (500) | `Cola llena` | `Avise asistente` |
| Sin hora válida | `Sin hora` | `No registra` |
| Sin horario próximo | `Sin horario` | `en este momento` |

## Compatibilidad

Los cambios de H6 son aditivos: `scan.result` conserva su estructura (`result`, `studentName`, `reason`, `display.line1/line2/color`) y solo cambia el texto de `display`; `display.message` ya estaba en el contrato v0 (`v: 1`). Un firmware que ya dibuja `line1` y `line2` de `scan.result` no necesita cambios, y uno que aún no implementa `display.message` solo debe confirmarlo con `ack`.
