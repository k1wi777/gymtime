# Backlog, iteración 1: backend para probar el hardware

Objetivo de la iteración: dejar un **backend local** al que se conecte el ESP32 (firmware hecho por otros compañeros) para probar el registro de huellas, el reconocimiento y la alarma de fin de horario. Se maneja desde la terminal.


---

## 1. Alcance

**Dentro:**

- Registro completo de huellas: iniciar enrolamiento desde la terminal, recibir la plantilla del ESP32, guardarla cifrada.
- Reconocimiento: el ESP32 envía el slot identificado y el backend responde si es entrada, salida o rechazo.
- Horarios con listado de estudiantes, y sincronización de plantillas al lector.
- Alarma: al llegar la hora de fin del horario suena unos segundos; si queda alguien adentro, sigue sonando hasta que salga o alguien la apague.
- Control desde una CLI y Swagger.
- Un simulador de ESP32 para probar el backend sin hardware.

**Fuera (otras iteraciones):** panel web, login y roles, reportes y métricas, modo sin conexión del ESP32, TLS, firmware, avisos previos al fin del horario.

**Responsabilidades:** el firmware lo hacen los compañeros de hardware. Este equipo entrega el servidor, el **contrato del protocolo** (sección 5) y una guía de integración para que ellos conecten el ESP32.

## 2. Decisiones ya tomadas

| Tema | Decisión |
|---|---|
| Base de datos | PostgreSQL en Docker |
| Interfaz de control | CLI + Swagger UI en `/docs` (sin HTML propio) |
| Dedos por estudiante | Uno |
| Cifrado de plantillas | Desde ya (AES-256-GCM, clave en variable de entorno) |
| Protocolo | Esquema de mensajes versionado, con `ack` e idempotencia desde el inicio |
| Arquitectura | Modular, con patrón repository en cada módulo |
| Red | Backend y ESP32 en la misma red local, `ws://` sin TLS |
| Autenticación | Token fijo del dispositivo y clave de administrador, ambos en `.env` |
| Avisos | Solo la alarma al fin del horario |
| Alarma al fin del horario | Siempre suena unos segundos. Si queda alguien adentro, sigue sonando hasta que esa persona salga o alguien la desactive |

## 3. Supuestos por defecto

Son propuestas. Si alguna no sirve, se cambia antes de empezar la tarea que la usa. Todas son configurables por variable de entorno o por horario.

| Tema | Valor por defecto |
|---|---|
| Ventana de ingreso | Desde 10 min antes del inicio hasta 5 min antes del fin |
| Salida | Siempre se permite si hay sesión abierta, incluso después del fin |
| Salir y volver a entrar en el mismo horario | Se rechaza (`ALREADY_EXITED`) |
| Duración del aviso corto | 5 segundos (`ALARM_BEEP_SECONDS`) |
| Alarma apagada por botón o CLI | Queda silenciada; las sesiones abiertas se marcan "salida no registrada" |
| Cierre automático de sesiones abandonadas | 30 min después del fin del horario |
| Zona horaria | Se guarda en UTC; se muestra en America/Bogota |
| Sincronización de plantillas | 15 min antes de cada horario (antes de que abra la ventana de ingreso), al conectar el dispositivo, al terminar un enrolamiento, tras el cierre de un horario y a pedido por CLI |
| Contenido de la sincronización | Plantillas de los horarios en curso o que empiezan pronto, **más** las de quienes aún tienen sesión abierta. Así el grupo que sale y el que entra conviven en el lector (cabe: 2 grupos de ~30 frente a 162 slots) |
| Hora usada para decidir | La del servidor al recibir el escaneo. El `ts` del dispositivo se guarda solo como referencia, para no depender de que el ESP32 tenga la hora bien |
| Slots del lector | Temporales: se reasignan (1..N) en cada sincronización. El enrolamiento usa un slot de trabajo fijo (`ENROLL_SLOT`) |
| Capacidad del lector | 162 slots (`SLOT_MAX`). Un slot es la posición de memoria del lector donde se guarda una plantilla |
| Dispositivos | Uno solo en esta iteración, aunque el modelo de datos soporta varios |

## 4. Arquitectura propuesta

Monorepo en TypeScript:

```
/server        NestJS: API REST + gateway WebSocket + scheduler
/cli           Comandos de terminal (llaman al REST)
/simulator     ESP32 simulado en Node
/shared        Esquemas de mensajes (zod) y tipos compartidos
/docs          Contrato del protocolo y guía para el equipo de firmware
docker-compose.yml   PostgreSQL
```

**Módulos del servidor** (cada uno con su `repository`, `service` y `controller`):

| Módulo | Responsabilidad |
|---|---|
| `devices` | Conexión WebSocket, autenticación, ack, reintentos, estado y órdenes pendientes |
| `students` | Datos de estudiantes |
| `fingerprints` | Plantillas cifradas, enrolamiento, asignación de slots |
| `schedules` | Horarios, listados, ventana de ingreso |
| `attendance` | Sesiones, decisión de entrada o salida, registro manual |
| `alarm` | Vigilancia de vencimientos, estado de la alarma, cierre automático |
| `admin` | Endpoints REST para la CLI, stream de eventos |

**Repository:** las interfaces viven en el dominio. Hay una implementación con Prisma y otra **en memoria**, que se usa en las pruebas para probar la lógica sin base de datos.

## 5. Contrato del protocolo, versión 0

Es lo primero que necesita el equipo de firmware, por eso va en la primera tarea.

**Conexión:** `ws://<ip-del-backend>:3000/device`. El primer mensaje del dispositivo debe ser `hello`.

**Sobre de todo mensaje:**

```json
{ "v": 1, "id": "uuid", "type": "fingerprint.scan", "ts": 1760000000, "ref": null, "payload": {} }
```

`ts` es la hora Unix en segundos (UTC) en que ocurrió el evento. `ref` solo se usa en las respuestas y contiene el `id` del mensaje original.

**Reglas de entrega:**

- Todo mensaje que no sea `ack` se confirma con `ack` (`ref` = `id`) en menos de 5 s.
- Sin `ack`, el emisor reenvía hasta 3 veces con el mismo `id`.
- El receptor ignora un `id` que ya procesó, pero **vuelve a enviar el ack**.
- El `ack` puede traer `payload` con `ok` y un código de error.
- El servidor guarda las órdenes sin confirmar y las reenvía cuando el dispositivo se reconecta.

**Dispositivo → servidor:**

| Tipo | Payload |
|---|---|
| `hello` | `deviceId`, `token`, `fw` |
| `fingerprint.scan` | `slot`, `confidence` |
| `fingerprint.unknown` | (vacío) |
| `enroll.progress` | `enrollmentId`, `step` (`place_finger`, `remove_finger`, `place_again`, `processing`) |
| `enroll.done` | `enrollmentId`, `template` (base64) |
| `enroll.failed` | `enrollmentId`, `reason` |
| `alarm.state` | `on`, `source` (`server`, `button`, `local`) |
| `button.pressed` | (vacío) |
| `status` | `uptime`, `heap`, `rssi`, `fingerprintCount` |

**Servidor → dispositivo:**

| Tipo | Payload |
|---|---|
| `hello.ok` | `serverTime`, `heartbeatSec` |
| `scan.result` | `result` (`entry`, `exit`, `denied`, `unknown`), `studentName`, `reason`, `display` (`line1`, `line2`, `color`) |
| `enroll.start` | `enrollmentId`, `scratchSlot`, `timeoutSec` |
| `enroll.cancel` | `enrollmentId` |
| `templates.sync` | `syncId`, `chunk` (`index`, `total`), `templates` (lista de `slot`, `template`) |
| `schedule.set` | `scheduleId`, `start`, `end`, `entryOpensAt`, `entryClosesAt` |
| `alarm.set` | `on`, `durationSec` (número = suena ese tiempo y se apaga sola; `null` = suena hasta recibir otra orden), `reason` (`END_BEEP`, `PENDING_EXIT`, `MANUAL`, `TEST`, `CLEARED`) |
| `display.message` | `line1`, `line2`, `durationSec` |

**Motivos de rechazo (`reason`):** `UNKNOWN_SLOT`, `NO_ACTIVE_SCHEDULE`, `NOT_IN_SCHEDULE`, `OUTSIDE_ENTRY_WINDOW`, `ALREADY_EXITED`, `STUDENT_INACTIVE`.

**Notas para firmware:**

- Al recibir `templates.sync`, el lector debe **borrar todas sus plantillas** y cargar las recibidas en los slots indicados. Con cada `chunk` se confirma por separado; el backend envía bloques de 10 plantillas para no desbordar la memoria del ESP32.
- La plantilla es el modelo de ~512 bytes que genera el AS608, en base64.
- El dispositivo debe mandar `status` cada `heartbeatSec` segundos.
- En `alarm.set` con `durationSec` numérico, el dispositivo apaga la alarma por sí mismo al cumplirse ese tiempo y envía `alarm.state`. Con `durationSec` en `null`, la mantiene hasta recibir `alarm.set` con `on: false`. El botón físico la apaga en ambos casos y envía `button.pressed`.

## 6. Backlog

Tamaños de complejidad: **S** = simple, **M** = moderada, **L** = compleja (varias piezas o muchos casos borde).

### E0. Fundaciones

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E0-1 | Monorepo, versión de Node fija, gestor de paquetes, lint y formato | S | `npm install` y `npm run lint` funcionan en limpio |
| E0-2 | `docker-compose.yml` con PostgreSQL | S | `docker compose up -d` deja la base lista |
| E0-3 | Configuración por `.env` validada al arrancar, con `.env.example` | S | El servidor no arranca si falta una variable obligatoria y dice cuál |
| E0-4 | Prisma, migración inicial y esquema de datos | M | `npm run migrate` crea todas las tablas (sección 7) |
| E0-5 | Logging estructurado y legible en terminal | S | Cada mensaje WebSocket y cada decisión relevante se registra con nivel y contexto |
| E0-6 | Endpoint `/health` y Swagger en `/docs` | S | `/docs` lista todos los endpoints de administración |

### E1. Contrato del protocolo

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E1-1 | Esquemas zod de todos los mensajes en `/shared` | M | Cada tipo de la sección 5 tiene su esquema y un mensaje inválido es rechazado con motivo |
| E1-2 | Documento `docs/protocolo_v0.md` para el equipo de firmware, con ejemplos JSON completos | M | Un compañero de hardware puede implementar el cliente leyendo solo ese documento |
| E1-3 | Códigos de error y de rechazo documentados | S | Lista única usada por el servidor, el simulador y la guía |

### E2. Gateway de dispositivos

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E2-1 | Servidor WebSocket en `/device` y autenticación con `hello` y token | M | Sin `hello` válido en 5 s, se cierra la conexión; con token incorrecto, se rechaza |
| E2-2 | Registro de conexiones y estado del dispositivo (en línea, última conexión, versión) | S | `device status` muestra el estado real |
| E2-3 | Ack, reintentos con el mismo `id` e idempotencia (tabla `processed_messages`) | L | Un mensaje repetido no se procesa dos veces y recibe de nuevo su ack |
| E2-4 | Órdenes con confirmación: guardar, enviar, esperar ack, reintentar y reenviar al reconectar (`device_commands`) | L | Una orden enviada con el dispositivo caído se entrega al reconectarse |
| E2-5 | Ping/pong y detección de conexiones muertas | S | Una conexión sin respuesta se marca "fuera de línea" |
| E2-6 | Stream de eventos del sistema para la CLI (SSE) | M | `watch` muestra en vivo conexiones, escaneos, órdenes y alarma |

### E3. Estudiantes

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E3-1 | CRUD de estudiantes (documento, nombre, programa, activo) con repository | M | Crear, listar, editar y dar de baja; el documento es único |
| E3-2 | Baja de estudiante: se desactiva y se elimina su plantilla | S | Un estudiante dado de baja no puede entrar y su plantilla ya no se sincroniza |

### E4. Huellas

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E4-1 | Servicio de cifrado AES-256-GCM con clave en `.env` | S | La plantilla en la base no es legible; la prueba cifra y descifra y falla si cambia un byte |
| E4-2 | Flujo de enrolamiento: crear `enrollment`, enviar `enroll.start`, recibir `progress`, `done` o `failed`, con estados y expiración | L | Desde la CLI se enrola un estudiante de principio a fin y la plantilla queda guardada y cifrada |
| E4-3 | Un dedo por estudiante: reenrolar reemplaza la plantilla anterior | S | Nunca hay dos huellas activas para un estudiante |
| E4-4 | Cancelar enrolamiento y manejar tiempo agotado o dispositivo desconectado | M | Un enrolamiento sin respuesta pasa a `expired` y el dispositivo vuelve a modo normal |
| E4-5 | Validar la plantilla recibida (base64 válido, tamaño esperado) | S | Una plantilla vacía o corrupta se rechaza con error claro |

### E5. Horarios y listados

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E5-1 | Horarios recurrentes (día de la semana, inicio, fin) y horarios de una sola fecha | M | Se crea un horario con fecha y hora exactas |
| E5-2 | Creación rápida para pruebas: `--ends-in 3m` | S | Crea un horario que empieza ahora y termina en N minutos |
| E5-3 | Asignar y quitar estudiantes de un horario | S | Un estudiante aparece o no en el listado |
| E5-4 | Generar las ocurrencias con fecha (`schedule_instances`) y saber cuál está en curso | M | Dado un instante y un estudiante, devuelve el horario que le corresponde (en curso o con ingreso abierto) o ninguno. Debe funcionar con dos horarios seguidos |
| E5-5 | Ventana de ingreso configurable | S | Los límites se leen de la configuración y se prueban |

### E6. Sincronización al lector

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E6-1 | Construir el conjunto de plantillas (horarios en curso o próximos, más estudiantes con sesión abierta) y asignar slots 1..N (`device_slots`) | M | Cada plantilla tiene un slot único, no se repiten estudiantes y el mapa slot → estudiante queda guardado |
| E6-2 | Enviar `templates.sync` en bloques de 10, con ack por bloque | M | El simulador recibe todas las plantillas y confirma; si falla un bloque, se reintenta |
| E6-3 | Disparadores: al conectar, 15 min antes de cada horario, al terminar un enrolamiento, tras el cierre de un horario y por CLI (`sync`) | M | Cada disparador envía el conjunto correcto; tras el cierre se retiran las plantillas de quien ya no tiene sesión ni horario cercano |
| E6-4 | Enviar `schedule.set` junto con la sincronización | S | El dispositivo recibe inicio, fin y ventana del horario |

### E7. Asistencia

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E7-1 | Resolver `fingerprint.scan`: slot → huella → estudiante | S | Un slot que no existe devuelve `UNKNOWN_SLOT` |
| E7-2 | Reglas de validación y decisión de entrada o salida | L | Se cubren con pruebas unitarias todos los motivos de rechazo de la sección 5, incluido el caso de dos horarios seguidos (un estudiante sale del primero mientras otro entra al segundo) |
| E7-3 | Persistir sesiones (`attendance_sessions`) con entrada, salida y origen | M | Cada escaneo aceptado crea o cierra una sesión |
| E7-4 | Responder `scan.result` con el mensaje de pantalla | S | El texto incluye el nombre y el resultado |
| E7-5 | Manejar `fingerprint.unknown` | S | Se registra el evento y se responde "Huella no reconocida" |
| E7-6 | Registro manual de entrada o salida con motivo obligatorio | M | La sesión queda marcada como manual y cierra la alarma si era la última |
| E7-7 | Consultar sesiones abiertas | S | `sessions open` lista quién está dentro |

### E8. Alarma y vencimientos

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E8-1 | Scheduler que, a la hora de fin de un horario, evalúa las sesiones abiertas | L | A la hora de fin se ejecuta con una precisión de ±1 s |
| E8-2 | Al fin del horario, enviar `alarm.set`: sin sesiones abiertas, aviso corto (`durationSec` = 5, `END_BEEP`); con sesiones abiertas, alarma continua (`durationSec` = `null`, `PENDING_EXIT`) | M | El simulador recibe la orden correcta en el segundo del vencimiento en ambos casos |
| E8-3 | Al cerrarse la última sesión abierta, enviar `alarm.set` (apagada) | M | La alarma se apaga cuando sale el último |
| E8-4 | Apagado manual (botón físico o CLI): silenciar y marcar sesiones "salida no registrada" | M | Queda registrado quién la apagó y cuántas sesiones quedaron abiertas |
| E8-5 | Disparo manual de prueba (`alarm test`), sin depender de un horario | S | Envía `alarm.set` con motivo `TEST` |
| E8-6 | Cierre automático de sesiones abandonadas | S | A los 30 min del fin, las sesiones abiertas se cierran como "no registrada" |
| E8-7 | Recuperación tras reiniciar el servidor | M | Con sesiones abiertas, reiniciar el servidor no pierde la alarma ni los vencimientos |

### E9. CLI

Comando base: `gym <grupo> <acción>`. Habla con el servidor por REST con la clave de administrador.

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E9-1 | Estructura de la CLI, configuración (URL y clave) y salida legible | S | `gym --help` lista todos los comandos |
| E9-2 | `student add/list/remove` | S | Funcionan contra el servidor |
| E9-3 | `enroll start --student <doc>` con progreso en vivo, y `enroll cancel` | M | Muestra cada paso que reporta el dispositivo |
| E9-4 | `schedule create`, `schedule create --ends-in 3m`, `schedule assign`, `schedule list/show` | M | Permite montar un horario de prueba en un solo comando |
| E9-5 | `sync` (enviar plantillas y horario al dispositivo) | S | Dispara E6 |
| E9-6 | `sessions open/list` y `attendance entry/exit` (manual) | S | Cubre E7-6 y E7-7 |
| E9-7 | `alarm on/off/test/status` | S | Cubre E8-4 y E8-5 |
| E9-8 | `device status` y `watch` (eventos en vivo) | M | `watch` muestra lo que pasa mientras se prueba el hardware |

### E10. Simulador de ESP32

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E10-1 | Cliente que implementa `hello`, ack, reintentos y heartbeat | M | Se conecta y se mantiene en línea |
| E10-2 | Enrolamiento simulado: responde `enroll.start` con progreso y `enroll.done` con una plantilla falsa | M | Completa un enrolamiento sin hardware |
| E10-3 | Lector simulado: guarda las plantillas recibidas por `templates.sync` | S | Mantiene el mapa slot → plantilla |
| E10-4 | Comandos interactivos: `scan <slot>`, `button`, `disconnect`, `reconnect` | M | Se puede recorrer cualquier escenario de la sección 8 a mano |
| E10-5 | Alarma simulada que se muestra por consola | S | Se ve cuándo se enciende y apaga |

### E11. Pruebas

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E11-1 | Pruebas unitarias de las reglas de asistencia y alarma con repositorios en memoria | L | Todos los motivos de rechazo y las transiciones de la alarma están cubiertos |
| E11-2 | Pruebas de integración de ack, idempotencia y reenvío de órdenes | M | Mensaje duplicado y reconexión funcionan |
| E11-3 | Pruebas de extremo a extremo con el simulador para los escenarios A1 a A12 | L | Se ejecutan con un solo comando |

### E12. Guía para el equipo de firmware

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E12-1 | `docs/integracion_firmware.md`: cómo levantar el backend, IP y puerto, token, secuencia de conexión (el servidor escucha en `0.0.0.0`, no solo en localhost), ejemplos de cada mensaje | M | Un compañero conecta su ESP32 sin preguntar nada |
| E12-2 | Guía de problemas comunes (firewall, IP, token, hora) | S | Cubre los fallos más probables de la primera conexión |

## 7. Modelo de datos inicial

| Tabla | Campos principales |
|---|---|
| `students` | id, documento (único), nombre, programa, activo, consentimiento |
| `fingerprints` | id, student_id (único activo), plantilla cifrada, iv, creada |
| `enrollments` | id, student_id, device_id, estado (`pending`, `in_progress`, `done`, `failed`, `expired`, `cancelled`), expira |
| `devices` | id, nombre, última conexión, versión de firmware |
| `device_slots` | device_id, slot, fingerprint_id, sync_id |
| `schedules` | id, nombre, día de la semana o fecha, inicio, fin, margen de ingreso |
| `schedule_students` | schedule_id, student_id |
| `schedule_instances` | id, schedule_id, fecha, inicio, fin, estado |
| `attendance_sessions` | id, student_id, instance_id, entrada, salida, origen entrada, origen salida, estado (`abierta`, `cerrada`, `no_registrada`), motivo manual |
| `device_commands` | id, device_id, tipo, payload, estado (`pending`, `sent`, `acked`, `failed`), intentos |
| `processed_messages` | message_id, device_id, recibido, respuesta |
| `alarm_events` | id, instance_id, inicio, fin, cerrada por (`all_exited`, `button`, `cli`, `timeout`) |
| `event_log` | id, tipo, detalle, fecha |

## 8. Escenarios de aceptación

La iteración se da por terminada cuando todos funcionan con el simulador y los tres primeros, más A7, A11 y A12, también con el ESP32 real.

| # | Escenario | Resultado esperado |
|---|---|---|
| A1 | Enrolar la huella de un estudiante | La plantilla queda guardada y cifrada, y el estudiante queda listo para sincronizarse |
| A2 | Estudiante asignado pone la huella dentro del horario | `entry` y sesión abierta |
| A3 | El mismo estudiante pone la huella otra vez | `exit` y sesión cerrada |
| A4 | Huella desconocida | `unknown` |
| A5 | Estudiante que no pertenece al horario | `denied` con `NOT_IN_SCHEDULE` |
| A6 | Escaneo sin horario en curso | `denied` con `NO_ACTIVE_SCHEDULE` |
| A7 | Horario de prueba que termina con alguien adentro | `alarm.set` continua (sin duración) en la hora de fin |
| A8 | Sale el último estudiante con la alarma encendida | `alarm.set` apagada |
| A9 | Se apaga la alarma por botón o CLI | Alarma silenciada y sesiones marcadas como "salida no registrada" |
| A10 | Se cae la conexión y vuelve; mensaje duplicado | Las órdenes pendientes se entregan y el duplicado no se procesa dos veces |
| A11 | Horario de prueba que termina con todos ya fuera | `alarm.set` de 5 s (aviso corto) y la alarma se apaga sola |
| A12 | Dos horarios seguidos: el grupo 1 sale mientras el grupo 2 ya entra | Ambos grupos son reconocidos en el lector; cada uno se registra en su horario |

## 9. Preguntas abiertas

Ninguna por ahora. Los valores de la sección 3 quedan como están y se pueden ajustar más adelante sin cambiar el diseño.

## 10. Orden de trabajo recomendado

Los compañeros de hardware dependen del contrato y de una conexión que funcione, así que se prioriza lo que los desbloquea.

| Hito | Contenido | Qué desbloquea |
|---|---|---|
| **H1. Conexión** | E0, E1, E2-1 a E2-3, E10-1, E12-1 | El ESP32 real se conecta, hace `hello` y recibe `ack` |
| **H2. Enrolamiento** | E3, E4, E9-1 a E9-3, E10-2 | Probar el registro de huellas con el lector real |
| **H3. Reconocimiento** | E5, E6, E7, E10-3, E10-4 | Probar entrada y salida con huella real |
| **H4. Alarma** | E8, E9-4 a E9-7, E10-5 | Probar la sirena a la hora de fin de un horario de prueba |
| **H5. Cierre** | E2-4 a E2-6, E9-8, E11, E12-2 | Robustez, pruebas completas y guía final |

Las tareas E1-2 y E12-1 (documentos para firmware) se entregan al terminar H1, para que los compañeros empiecen a trabajar en paralelo.
