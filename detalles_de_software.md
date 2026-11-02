# GymTime UniCórdoba: detalles del software

Documento de planeación del software del sistema de control de permanencia y acceso para el gimnasio institucional de la Universidad de Córdoba. Está pensado para que cualquier integrante del equipo entienda el sistema completo: qué hace, cómo se comunican sus partes y qué decisiones ya se tomaron.

> El nombre "GymTime UniCórdoba" es provisional.

Documentos relacionados: `Ficha_de_Software_GymTime.pdf` (ficha resumida), `idea_proyecto_gimnasio.md` (contexto original) y `lista_componentes_gimnasio.md` (hardware).

---

## 1. Qué es el sistema

Un sistema que controla cuánto tiempo permanecen los estudiantes dentro del gimnasio. Cada horario tiene una hora de inicio y una hora de fin fijas (normalmente de 1 hora). El estudiante se identifica con su huella al entrar y al salir. Si al terminar el horario hay personas que no han marcado su salida, suena una alarma hasta que lo hagan.

El control del tiempo no debe depender de que una persona esté vigilando. Además, el software guarda todos los registros para generar métricas de asistencia.

## 2. Actores y roles

| Rol | Qué hace |
|---|---|
| **Estudiante** | Pone su huella al entrar y al salir. No usa el panel web. |
| **Asistente** | Opera el día a día desde el panel: registros manuales, enrolar huellas, ver quién está dentro, enviar órdenes al dispositivo (por ejemplo, hacer sonar o apagar la alarma). |
| **Administrador** | Todo lo del asistente, más: crear horarios y listados de estudiantes, ver todas las métricas y reportes, y gestionar usuarios del panel. |

## 3. Arquitectura general

```
┌──────────────┐   WebSocket (wss)   ┌────────────────────┐    REST + WS    ┌──────────────┐
│    ESP32     │ ◄─────────────────► │  Servidor (nube)   │ ◄─────────────► │ Panel web    │
│  + periféri- │   mensajes JSON     │  lógica + datos    │                 │ (asistente / │
│    cos       │                     │  PostgreSQL        │                 │  admin)      │
└──────────────┘                     └────────────────────┘                 └──────────────┘
```

**Principio central:** el ESP32 es un controlador de dispositivos. Captura datos de los sensores, ejecuta órdenes y muestra resultados. **Toda la lógica de negocio y el almacenamiento están en el servidor.** La única excepción es la operación sin conexión (sección 8), donde el ESP32 usa datos guardados localmente.

### Hardware conectado al ESP32

- Lector de huellas AS608 (compara internamente).
- Pantalla táctil SPI para mostrar resultados al usuario.
- Sensor de proximidad: enciende la pantalla cuando hay alguien cerca.
- Alarma (sirena de 12 V, con relé).
- Botón físico para apagar la alarma.
- Alimentación con respaldo de batería para el ESP32 (decisión del equipo).

## 4. Reglas del sistema

1. **Identificación solo por huella.** No hay tarjetas ni claves para los estudiantes.
2. **Mismo lector para entrada y salida.** Si el estudiante no tiene sesión abierta, es una entrada; si la tiene, es una salida.
3. **Horario fijo y hora de salida común.** Todos los estudiantes de un horario deben salir a la hora de fin del horario, sin importar a qué hora entraron. Entrar tarde no extiende la permanencia.
4. **Ventana de ingreso.** Se puede entrar en cualquier momento dentro de la franja válida del horario (por defecto, durante la hora del horario).
5. **Solo entran los asignados.** Si la huella es reconocida pero el estudiante no pertenece al horario en curso, se rechaza y se informa en pantalla.
6. **Alarma.** Al llegar la hora de fin, si existe al menos una sesión abierta, suena la alarma. Se apaga cuando se cierra la última sesión abierta, o cuando el botón físico o el asistente desde el panel la apagan (ver decisiones pendientes).
7. **Registro manual.** Si el huellero falla, el asistente puede registrar entradas y salidas desde el panel, con motivo obligatorio. Se distinguen de los registros por huella.
8. **Toda acción queda registrada** (quién, qué, cuándo), incluidas las órdenes enviadas al dispositivo.

## 5. Flujos principales

### 5.1 Entrada y salida con huella

1. El sensor de proximidad detecta a alguien y se enciende la pantalla.
2. El estudiante pone el dedo. El AS608 lo compara con las plantillas cargadas y devuelve un **slot** (posición de la plantilla).
3. El ESP32 envía `fingerprint.scan` al servidor con el slot y la hora.
4. El servidor identifica al estudiante, valida que pertenece al horario en curso y decide si es entrada o salida.
5. El servidor responde con `scan.result` y el ESP32 muestra el mensaje en pantalla: nombre y "Entrada registrada" / "Salida registrada", "Huella no reconocida", "No pertenece a este horario" o el error ocurrido.

### 5.2 Fin del horario y alarma

1. El servidor vigila los vencimientos. A la hora de fin del horario cuenta las sesiones abiertas.
2. Si hay alguna, envía `alarm.set` (encendida). El ESP32 activa el relé de la sirena.
3. Cada salida registrada actualiza el conteo. Al llegar a cero, el servidor envía `alarm.set` (apagada).
4. Además, el ESP32 guarda la hora de fin en su memoria y puede activar la alarma por sí mismo si no hay conexión.

### 5.3 Enrolar una huella (primera vez)

1. El asistente selecciona al estudiante en el panel y pulsa "Registrar huella".
2. El servidor envía `enroll.start` al ESP32, que entra en modo de registro.
3. El estudiante pone el dedo dos veces. El ESP32 envía `enroll.progress` para que el panel muestre cada paso.
4. El ESP32 sube la plantilla con `enroll.done`. El servidor la guarda **cifrada** y la asocia al estudiante.
5. En el siguiente horario del estudiante, la plantilla se carga en el lector (sección 7).

### 5.4 Registro manual

El asistente elige al estudiante y si es entrada o salida, escribe el motivo y confirma. El servidor crea o cierra la sesión marcándola como manual. Si hay una alarma activa y era la última sesión abierta, la alarma se apaga.

## 6. Comunicación ESP32 ↔ servidor (WebSocket)

Se usa **un solo canal WebSocket seguro (`wss://`)** entre el ESP32 y el servidor. Se eligió sobre HTTP con polling porque las órdenes llegan al instante (alarma, modo de registro) y no hay consultas constantes. En el servidor se usa la librería `ws` nativa; **no usar Socket.IO**, porque es un protocolo propio y complica el cliente del ESP32.

### 6.1 Formato de los mensajes

Todos los mensajes son JSON con esta forma:

```json
{ "id": "uuid", "type": "fingerprint.scan", "ts": 1760000000, "payload": { "slot": 12 } }
```

Los mensajes que responden a otro llevan `ref` con el `id` original:

```json
{ "id": "uuid", "type": "ack", "ref": "uuid-del-mensaje" }
```

### 6.2 Reglas de entrega (importante)

- Cada evento lleva un `id` único generado por quien lo envía.
- El receptor responde con `ack`. Si no llega el `ack`, el emisor **reenvía**.
- El receptor **ignora los duplicados** (mismo `id`). Esto hace seguro el reenvío tras una caída.
- El ESP32 guarda los eventos pendientes de confirmar y los reenvía al reconectar.
- Reconexión automática con espera creciente (1 s, 2 s, 4 s… hasta un máximo).
- Ping/pong periódico para detectar conexiones muertas.
- Cada evento lleva la hora **en que ocurrió**, no la de envío, para que las métricas sean correctas aunque lleguen tarde.

### 6.3 Mensajes del ESP32 al servidor

| Tipo | Cuándo | Contenido principal |
|---|---|---|
| `hello` | Al conectar | token del dispositivo, versión de firmware, estado de periféricos |
| `fingerprint.scan` | Huella reconocida por el lector | `slot`, hora |
| `fingerprint.unknown` | Huella no reconocida | hora |
| `enroll.progress` | Paso del registro de huella | paso, resultado |
| `enroll.done` | Registro terminado | `slot`, plantilla (base64) |
| `alarm.state` | Cambia el estado de la alarma | encendida/apagada, origen |
| `button.pressed` | Botón físico de apagado | hora |
| `status` | Periódico (heartbeat) | periféricos, memoria, señal WiFi, sesiones abiertas |
| `ack` | Confirma un mensaje del servidor | `ref` |

### 6.4 Mensajes del servidor al ESP32

| Tipo | Cuándo | Contenido principal |
|---|---|---|
| `hello.ok` | Respuesta a `hello` | hora del servidor, configuración |
| `scan.result` | Respuesta a un scan | `ref`, resultado, textos y color para la pantalla |
| `schedule.set` | Antes de cada horario | hora de inicio, fin y ventana de ingreso |
| `templates.sync` | Antes de cada horario | plantillas a agregar y slots a borrar |
| `enroll.start` / `enroll.cancel` | El asistente inicia o cancela | `student_id`, slot libre |
| `alarm.set` | Alarma encendida o apagada | estado, motivo |
| `display.message` | Mensaje libre en pantalla | texto, duración |
| `ack` | Confirma un evento del ESP32 | `ref` |

> Esta lista es el punto de partida. Los nombres y campos exactos se fijan en un archivo de esquema compartido (ver sección 12).

## 7. Manejo de huellas

- **Se guarda la plantilla (minucias), nunca la imagen.** Unos 500 bytes por huella.
- **El servidor tiene la copia maestra**, cifrada, con la clave fuera de la base de datos. El lector solo guarda copias de trabajo.
- **El lector compara internamente.** Tiene capacidad para unas 160 plantillas y cada horario tiene como máximo unos 30 estudiantes, así que sobra margen.
- **Carga por horario.** Antes de cada horario, el servidor envía `templates.sync` con las plantillas de los estudiantes de ese horario. Cargar 30 plantillas toma pocos segundos.
- **Sincronización por diferencias.** Solo se agregan las plantillas que faltan y se borran las que ya no corresponden. Quien repite horario no se vuelve a cargar.
- **Momento de la carga.** Unos minutos antes del inicio de cada horario, para que el lector esté listo cuando llegue el primer estudiante.
- **Mapa slot → estudiante.** El servidor guarda, por dispositivo, qué estudiante ocupa cada slot. El ESP32 solo conoce slots; el servidor sabe quién es quién.
- **Cambio de lector.** Las plantillas del AS608 son de formato propietario, pero como el servidor tiene la copia maestra, cambiar de lector no obliga a volver a registrar a todos (puede requerir conversión según el modelo).

## 8. Operación sin conexión y recuperación

El sistema debe seguir funcionando si cae el internet o el servidor.

**En el ESP32 (memoria flash/NVS):**

- Hora de inicio y fin del horario en curso.
- Mapa slot → nombre de los estudiantes del horario (para mostrar el nombre en pantalla).
- Conjunto de slots con sesión abierta (para decidir entrada o salida).
- Cola de eventos pendientes de enviar.

**Comportamiento sin conexión:**

1. El lector sigue identificando por slot. Si el slot pertenece al horario cargado, se acepta y se muestra el nombre.
2. El ESP32 decide entrada o salida con su conjunto local de sesiones abiertas.
3. Los eventos se guardan en la cola con su hora real.
4. La alarma suena a la hora de fin si quedan sesiones abiertas.
5. Al volver la conexión, el ESP32 envía la cola. El servidor reconcilia y marca para revisión cualquier inconsistencia (por ejemplo, una salida sin entrada).

**Hora:** el ESP32 toma la hora por NTP al arrancar y la corrige con la hora que envía el servidor en `hello.ok`. Un módulo RTC (DS3231) es opcional; con el respaldo de batería del ESP32 ya no es crítico, pero sigue siendo una opción barata.

**Sesiones abiertas al final del día:** si una sesión queda abierta mucho después de terminar el horario (alguien se fue sin marcar), el servidor la cierra automáticamente con la marca "salida no registrada" para no contaminar las métricas.

## 9. Modelo de datos (PostgreSQL)

Esquema inicial. Se refinará al implementar.

| Tabla | Propósito | Campos principales |
|---|---|---|
| `panel_users` | Cuentas del panel | id, nombre, correo, contraseña (hash), rol (`asistente`/`admin`), activo |
| `students` | Estudiantes | id, documento, nombre, programa, activo, consentimiento (fecha) |
| `fingerprints` | Plantillas | id, student_id, plantilla cifrada, formato, creada, revocada |
| `devices` | Dispositivos ESP32 | id, nombre, token (hash), última conexión, versión |
| `device_slots` | Qué hay en el lector | device_id, slot, fingerprint_id |
| `schedules` | Horarios recurrentes | id, nombre, día de la semana, inicio, fin, ventana de ingreso |
| `schedule_students` | Listado por horario | schedule_id, student_id, vigencia (desde/hasta) |
| `schedule_instances` | Cada ocurrencia con fecha | id, schedule_id, fecha, estado |
| `attendance_sessions` | Sesiones de permanencia | id, student_id, instance_id, entrada, salida, origen de entrada, origen de salida, estado (`abierta`/`cerrada`/`auto_cerrada`), motivo manual, creada por |
| `device_commands` | Órdenes enviadas | id, device_id, tipo, payload, estado, creada, confirmada |
| `alarm_events` | Alarmas | instance_id, inicio, fin, quién o qué la apagó |
| `audit_log` | Auditoría | id, usuario, acción, entidad, detalle, fecha |

`schedule_instances` existe para poder calcular inasistencias: permite saber quién **debía** asistir un día concreto y compararlo con quién asistió.

## 10. Funcionalidades del panel

### Asistente

- Ver el horario en curso: quiénes deben asistir, quiénes han entrado, quiénes siguen dentro, quiénes ya salieron y quiénes faltan.
- Tiempo restante de cada sesión y estado de la alarma en vivo (por WebSocket).
- Registrar entradas y salidas manualmente, con motivo.
- Poner el dispositivo en modo de registro y enrolar la huella de un estudiante.
- Enviar órdenes al dispositivo: sonar o apagar la alarma, mostrar un mensaje.
- Ver el estado del dispositivo (en línea, última conexión, errores).
- Consultar el listado de cualquier horario.

### Administrador (además de lo anterior)

- Crear y editar horarios, y asignar los listados de estudiantes.
- Gestionar estudiantes (alta, edición, baja).
- Gestionar cuentas del panel y roles.
- Ver todas las métricas y reportes.
- Consultar el historial y la auditoría completos.

## 11. Métricas y reportes

- Personas que entraron en una hora o rango específico.
- Afluencia por día de la semana, horas pico y días de mayor demanda.
- Estudiantes que faltaron a un horario o a un periodo.
- Inasistencias por estudiante frente a las sesiones que le correspondían (por mes o varios meses).
- Tiempo de permanencia por sesión.
- Promedio de permanencia por estudiante (1 mes, 4 meses, semestre).
- Cantidad de salidas tardías o "salida no registrada".
- Cantidad de veces que sonó la alarma y cuánto duró.
- Uso de registros manuales (para detectar fallas del huellero).
- Todos los reportes se filtran por fechas, horario, programa o estudiante, y se pueden exportar (CSV/PDF).

## 12. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript en servidor y panel, con tipos compartidos |
| Servidor | NestJS (o Fastify) |
| WebSocket | `ws` nativo (sin Socket.IO) |
| Base de datos | PostgreSQL + Prisma o Drizzle |
| Panel web | React (Vite o Next) |
| Firmware ESP32 | Arduino/PlatformIO con `WebSockets`, `ArduinoJson`, `Adafruit_Fingerprint` y tareas FreeRTOS |
| Tareas programadas | Job en el servidor (vigilancia de vencimientos, carga de plantillas) |
| Despliegue | VPS pequeño o Railway/Render con HTTPS |

**Decisiones de diseño del firmware:**

- Separar en tareas de FreeRTOS: una para red, otra para sensores y pantalla. Una operación lenta (leer huella, dibujar) no debe bloquear el WebSocket, o se pierde el heartbeat.
- TLS consume unos 40 KB de RAM; hay que dejar margen.
- El esquema de los mensajes se define **una sola vez** en un archivo compartido (por ejemplo JSON Schema) para validar en el servidor y en el firmware.

## 13. Seguridad y protección de datos

- Las huellas son **datos biométricos sensibles**. Aplica la **Ley 1581** de protección de datos personales: consentimiento explícito y registrado, finalidad clara y medidas de seguridad reforzadas.
- Solo se guarda la plantilla, nunca la imagen.
- Plantillas cifradas en la base de datos, con la clave fuera de ella.
- Conexiones cifradas (`wss`/HTTPS).
- Cada dispositivo se autentica con un token propio, que se guarda con hash en el servidor y se puede revocar.
- Contraseñas del panel con hash (argon2 o bcrypt) y control de acceso por rol.
- Auditoría de accesos y acciones sensibles (ver plantillas, registros manuales, cambios de horario).
- Un estudiante que se da de baja debe poder tener su plantilla eliminada.

## 14. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Comunicación | WebSocket seguro entre ESP32 y servidor, con `ack` e idempotencia |
| Comparación de huellas | En el lector, cargando solo las plantillas del horario |
| Capacidad | Máximo ~30 estudiantes por horario; sobra margen en el AS608 |
| Carga de plantillas | Por diferencias, antes de cada horario (cada hora) |
| Hora de salida | Fija por horario, igual para todos |
| Alarma sin internet | El ESP32 guarda la hora de fin y suena por sí mismo |
| Energía | Respaldo de batería para el ESP32 |
| Red | WiFi abierto o con clave común (sin portal cautivo ni WPA2-Enterprise) |
| Stack | TypeScript, NestJS, PostgreSQL, React |

## 15. Pendientes por definir

1. **Apagado manual de la alarma.** El botón físico y el panel pueden apagarla, pero falta decidir: ¿silencia solo hasta el final del horario o se vuelve a activar si siguen sesiones abiertas? Propuesta: queda silenciada, las sesiones abiertas se marcan como "salida no registrada" y se registra quién la apagó.
2. **Ventana de ingreso exacta.** ¿Se puede entrar desde unos minutos antes del inicio? ¿Hasta cuántos minutos antes del final?
3. **Estudiante que sale y vuelve a entrar** dentro del mismo horario: ¿se permite o se rechaza?
4. **Cierre automático** de sesiones abandonadas: ¿a los cuántos minutos del fin del horario?
5. **Alimentación de la sirena.** El respaldo de batería cubre el ESP32; falta definir si la sirena de 12 V también queda respaldada.
6. **Pantalla definitiva** (modelo, controlador y librería) y **sensor de proximidad** (modelo): faltan en la lista de componentes.
7. **Base de estudiantes.** ¿Se cargarán los datos desde un archivo (Excel/CSV) o se crean uno a uno? Si la universidad ya tiene un sistema de matrícula, ¿se integra?
8. **Número de dispositivos.** El diseño soporta varios (tabla `devices`), pero el primer alcance es uno.
9. **Red de la universidad:** confirmar que el gimnasio tiene cobertura WiFi estable y que el puerto de `wss` (443) sale sin restricciones.

## 16. Plan de trabajo sugerido

1. **Fase 0, verificación de hardware.** Probar por separado el AS608 (enrolar, comparar, subir y bajar plantillas), la pantalla, el relé con la sirena y el sensor de proximidad.
2. **Fase 1, servidor y protocolo.** Modelo de datos, WebSocket con `ack`, autenticación de dispositivos y un **simulador de ESP32 en Node** para desarrollar el servidor sin depender del hardware.
3. **Fase 2, firmware.** Conexión, `scan`, respuesta en pantalla, alarma, modo de registro, cola sin conexión y sincronización de plantillas.
4. **Fase 3, panel del asistente.** Monitoreo en vivo, registro manual, enrolamiento y órdenes al dispositivo.
5. **Fase 4, panel del administrador.** Horarios, listados, estudiantes, usuarios, métricas y reportes.
6. **Fase 5, endurecimiento y piloto.** Pruebas de caída de red y de luz, revisión de seguridad y cumplimiento de la Ley 1581, y una semana de prueba real con un grupo pequeño.

## 17. Cambios respecto a los documentos anteriores

- `idea_proyecto_gimnasio.md` dice que **no hay botón** para apagar la alarma; ahora **sí hay** (físico y desde el panel).
- Dice que el sistema **no tiene respaldo de energía**; ahora el ESP32 **sí tiene respaldo de batería**. Hay que actualizar `lista_componentes_gimnasio.md` (que descartó la UPS) con la solución elegida.
- Dice que la hora de vencimiento se calcula **al registrar la entrada**; ahora es la **hora de fin del horario**, igual para todos.
- La lógica ya no vive en el ESP32: el servidor decide, y el ESP32 solo conserva lo necesario para operar sin conexión.
- Se agrega el **sensor de proximidad**, que no estaba en la lista de componentes.
