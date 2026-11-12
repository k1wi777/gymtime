# Mensajes de la pantalla TFT (título, subtítulo y tono)

Guía para el equipo de firmware: qué texto envía el servidor, qué textos muestra el firmware por su cuenta y qué reglas cumple la pantalla. El contrato de los mensajes está en [`protocolo_v0.md`](./protocolo_v0.md) (`scan.result` y `display.message`); el estado de cada capacidad, en [`estado_firmware.md`](./estado_firmware.md).

## La pantalla

TFT a color de 3,5 pulgadas, 240 × 320 px, en orientación **horizontal** (320 px de ancho × 240 de alto). Muestra tildes y la ñ (el firmware ya tiene la librería de fuentes), admite salto de línea y el **firmware decide el tamaño de la letra** (`setTextSize`) y el RGB final de cada color. Antes el contrato asumía un LCD 16 × 2 monocromo solo ASCII; ya no.

## Estructura de un mensaje

Cada mensaje que el servidor manda a la pantalla (`scan.result.payload.display` y `display.message.payload`) tiene:

| Campo | Qué es |
|---|---|
| `title` | Título: una línea, obligatorio (salvo el mensaje de limpiar la pantalla). Es lo más importante: nombre del estudiante o el aviso. |
| `subtitle` | Subtítulo: texto de apoyo, `""` si no hay (a veces solo hay título). Puede traer un salto de línea `\n` (hasta dos líneas). |
| `tone` | Intención de color: `success`, `error`, `warning` o `info`. El servidor expresa la intención; el firmware elige el RGB y el contraste. |

Sugerencia de maquetación: el título arriba y grande (achicar la letra si es largo), el subtítulo debajo y más pequeño, texto en blanco sobre un fondo o encabezado del color del tono.

### Colores sugeridos por tono

No son normativos: el firmware puede ajustar el RGB (contraste, tema). El RGB565 exacto lo verifica el firmware al compilar.

| `tone` | Uso | Color | RGB sugerido | RGB565 |
|---|---|---|---|---|
| `success` | entrada, salida | verde | `#2E9E5B` | `0x34EB` |
| `error` | rechazo, huella no reconocida | rojo | `#D64545` | `0xD9A8` |
| `warning` | aviso, alarma | naranja | `#F08A24` | `0xF449` |
| `info` | neutro (mensajes del operador por defecto) | azul | `#4A6FA5` | `0x4B74` |

## Reglas de los textos

- **Con tildes y ñ.** El servidor ya **no** quita las tildes (`Salió`, `Núñez`, `Ñandú`). Rechaza solo los caracteres no imprimibles (de control). No valida contra una tabla de fuente: si el firmware no tiene un glifo, debe dibujar uno de reemplazo (por ejemplo `?`) y no fallar.
- **Título:** una línea, hasta `DISPLAY_TITLE_MAX` caracteres (32 por defecto). Con la letra mediana caben unos 26 caracteres en 320 px y con la grande unos 17: el firmware debe achicar la letra o cortar si no cabe.
- **Subtítulo:** hasta `DISPLAY_SUBTITLE_MAX` caracteres en total (80) y `DISPLAY_SUBTITLE_LINES` líneas (2) separadas por `\n`. Las líneas largas se parten por palabras a criterio del firmware.
- **Nombre del estudiante** (`<NOMBRE>` = `display_name`): hasta `DISPLAY_NAME_MAX` caracteres (24), con tildes. Se genera al registrarlo (nombre completo si cabe; si no, primer nombre e inicial del siguiente, p. ej. `Ana M.`) y el asistente puede editarlo. El nombre completo sigue en `scan.result.payload.studentName`. El **modo sin conexión** mantiene el nombre del roster en ASCII de hasta 16 caracteres (ver [`modo_sin_conexion_firmware.md`](./modo_sin_conexion_firmware.md)).
- Los cuatro límites son variables de entorno del servidor: se ajustan sin cambiar código si la prueba con la pantalla real lo pide.
- **Tiempo en pantalla:** un resultado de escaneo se muestra `DISPLAY_RESULT_SECONDS` segundos (3 por defecto) y luego la pantalla vuelve al reposo. En `display.message` lo indica `durationSec` (1 a 60 s para el operador).
- **Limpiar la pantalla:** un `display.message` con `title` y `subtitle` vacíos (`""`) retira el mensaje en curso; es la única forma con título vacío. Si el lector no limpia con textos vacíos, el mensaje desaparece al cumplirse su `durationSec`.
- **Confirmación:** todo `display.message` y todo `scan.result` se confirma con `ack`, se pueda dibujar o no.

## Mensajes que envía el servidor

`scan.result` (campo `display`) y `display.message`. `<NOMBRE>` es el nombre corto.

| Situación | `title` | `subtitle` | `tone` | Se envía hoy |
|---|---|---|---|---|
| Entrada registrada | `<NOMBRE>` | `Entrada registrada` | `success` | Sí |
| Salida registrada | `<NOMBRE>` | `Salida registrada` | `success` | Sí |
| Huella no reconocida (`unknown`, `UNKNOWN_SLOT`) | `Huella no reconocida` | `Intente de nuevo` | `error` | Sí |
| `NOT_IN_SCHEDULE` | `<NOMBRE>` | `No es su horario` | `error` | Sí |
| `NO_ACTIVE_SCHEDULE` | `Sin horario` | `No hay un horario activo en este momento` | `warning` | Sí |
| `OUTSIDE_ENTRY_WINDOW`, ya cerrado | `Ingreso cerrado` | `El ingreso a este horario ya terminó` | `warning` | Sí |
| `ALREADY_EXITED` | `<NOMBRE>` | `Ya registró su salida` | `warning` | Sí |
| `STUDENT_INACTIVE` | `<NOMBRE>` | `No está habilitado` | `error` | Sí |
| Alarma continua (`PENDING_EXIT`) | `Tiempo cumplido` | `Registre su salida` | `warning` | Sí (`display.message`) |
| Alarma apagada (`CLEARED`) | (vacío) | (vacío) | `info` | Sí (`display.message`, limpia la pantalla, 1 s) |
| `OUTSIDE_ENTRY_WINDOW`, antes de abrir | `Ingreso abre a las HH:MM` | (vacío) | `warning` | **Reservado, no se envía** |
| Error del servidor | `Error del sistema` | `Llame al asistente` | `error` | **Reservado, no se envía** |

Si se desconoce el estudiante en un rechazo que lleva nombre, el título es `Estudiante`.

Notas sobre los dos mensajes reservados:

- `Ingreso abre a las HH:MM`: hoy, antes de abrirse la ventana de ingreso, el servidor responde `NO_ACTIVE_SCHEDULE`; distinguir «aún no abre» exige un cambio en la decisión de entrada que queda para otra iteración.
- `Error del sistema / Llame al asistente`: el servidor no responde `scan.result` cuando falla (el escaneo recibe un `ack` negativo). Está en el catálogo para cuando exista ese camino, y el firmware puede usarlo cuando no obtenga respuesta.

### Mensajes de la alarma

Con la alarma continua (`PENDING_EXIT`, al terminar un horario con gente adentro) el servidor envía, junto con `alarm.set`, un `display.message` `Tiempo cumplido` / `Registre su salida` de tono `warning` con `durationSec` igual a `ALARM_TIMEOUT_MINUTES × 60`: es el tope de vida de la alarma, porque el protocolo no tiene «hasta nueva orden». Al apagarla (salió el último, botón, `gym alarm off` o tiempo agotado) envía `CLEARED` y un `display.message` con título y subtítulo vacíos.

- Si el lector se reconecta con la alarma encendida, recibe de nuevo el `alarm.set` y el mensaje con los segundos que faltan.
- Si la alarma se apaga mientras el lector está desconectado, el mensaje viejo se descarta y no se reproduce.
- `END_BEEP`, `TEST` y `MANUAL` no envían mensaje.

### Mensajes del operador

`POST /devices/messages` (`title`, `subtitle?`, `tone?` por defecto `info`, `durationSec?`), `gym device message "título" ["subtítulo"] [--tone T] [--seconds N]` y el formulario del panel (Alarma y mensajes) envían un `display.message` libre. Se rechaza (400) lo que no cabe, indicando el campo (`title` o `subtitle`) y el límite. Sin segundos se usa `DISPLAY_RESULT_SECONDS`; el operador puede indicar de 1 a 60 s. Si el lector está desconectado la orden queda en cola y se entrega, en orden, al reconectar.

## Mensajes locales del firmware

No pasan por el servidor; el firmware los dibuja por su cuenta, con tildes. El tono es una sugerencia para que la pantalla sea coherente con los mensajes del servidor.

| Situación | Título | Subtítulo | Tono sugerido |
|---|---|---|---|
| Reposo (alguien se acerca) | `Ponga su huella` | (vacío) | `info` |
| Leyendo la huella | `Leyendo…` | (vacío) | `info` |
| Lectura fallida | `No se pudo leer` | `Reintente` | `error` |
| Sin conexión (modo local) | `Sin conexión` | `Modo local` | `warning` |
| Enrolamiento: primer dedo | `Ponga su dedo` | `en el lector` | `info` |
| Enrolamiento: retirar | `Retire el dedo` | (vacío) | `info` |
| Enrolamiento: segundo dedo | `Ponga el mismo dedo` | `otra vez` | `info` |
| Enrolamiento: procesando | `Procesando…` | (vacío) | `info` |
| Enrolamiento: listo | `Huella guardada` | (vacío) | `success` |
| Enrolamiento: error | `Error. Reintente` | (vacío) | `error` |

### Sin conexión (modo local, H12)

Los dibuja el firmware con el snapshot; ver [`modo_sin_conexion_firmware.md`](./modo_sin_conexion_firmware.md). Pendientes de confirmación (C11). El nombre sale del roster, que sigue en ASCII.

| Situación | Título | Subtítulo | Tono sugerido |
|---|---|---|---|
| Entrada decidida en el lector | `<NOMBRE>` | `Entrada local` | `success` |
| Salida decidida en el lector | `<NOMBRE>` | `Salida local` | `success` |
| Cola llena (500) | `Cola llena` | `Avise al asistente` | `error` |
| Sin hora válida | `Sin hora` | `No registra` | `warning` |
| Sin horario próximo | `Sin horario` | `No hay un horario activo en este momento` | `warning` |

## Compatibilidad y retiro de `line1`, `line2` y `color`

El protocolo sigue en `v: 1`. Durante la transición el servidor envía, además de `title`, `subtitle` y `tone`, los campos antiguos con estos valores:

- `line1 = title` y `line2 = subtitle` (sin recorte a 16 caracteres ni sin tildes: ya no sirven a un LCD 16 × 2);
- `color` derivado del tono: `success→green`, `error→red`, `warning→orange`, `info→white`.

**`line1`, `line2` y `color` están obsoletos.** El firmware debe leer `title`, `subtitle` y `tone`; ArduinoJson ignora los campos que no usa, así que no hace falta quitar nada del lado del lector. Se retirarán en un Work Item posterior, cuando el firmware confirme que usa los campos nuevos (se anotará en [`estado_firmware.md`](./estado_firmware.md)). `POST /devices/messages` sigue aceptando `line1`/`line2` como alias de `title`/`subtitle` durante la transición (si llegan ambos, gana `title`).

Se descartó subir a `v: 2` porque obligaría a negociar versión en `hello` y mantener dos serializadores para un cambio de contenido y un solo dispositivo.
