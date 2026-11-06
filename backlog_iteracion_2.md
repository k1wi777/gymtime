# Backlog, iteración 2: solución completa (panel, cuentas, métricas, producción y modo sin conexión)

Objetivo de la iteración: completar la solución de la ficha de software. La iteración 1 entregó todo lo que habla con el dispositivo (backend, protocolo, CLI y simulador). La iteración 2 agrega lo que usan las personas (panel web, cuentas, horarios por semestre, métricas) y lo que lo pone en producción (nube, seguridad, respaldos, modo sin conexión).

Documentos relacionados: `contexto_de_la_idea.md`, `detalles_de_software.md`, `backlog_iteracion_1_backend.md`, `reporte_iteracion_1.md`.

Las tareas continúan la numeración de la iteración 1 (E0 a E12), así que esta empieza en E13. Tamaños de complejidad: **S** = simple, **M** = moderada, **L** = compleja.

---

## 1. Alcance

**Dentro:**

- Cuentas con dos roles (asistente y administrador), creadas por el administrador.
- Panel web en español: monitoreo en vivo, registro manual, enrolamiento, órdenes al dispositivo, gestión de estudiantes, periodos, horarios y listados, usuarios e historial.
- Un **periodo** (semestre) con días sin servicio, y generación de las ocurrencias de cada horario.
- Estudiantes: alta uno por uno e importación por CSV.
- Métricas y reportes con filtros y exportación a CSV.
- Mensaje en pantalla (`display.message`), pendiente de la iteración 1.
- Producción en la nube: despliegue, `wss`, token por dispositivo, respaldos, consentimiento y supresión de datos (Ley 1581), runbook y piloto.
- Modo sin conexión: cambios del protocolo y del servidor, más una guía con código de ejemplo para el equipo de firmware.

**Fuera (otras iteraciones):** más de un dispositivo en operación, notificaciones por correo, aplicación para estudiantes, integración con el sistema de matrícula de la universidad, pagos y membresías.

**Responsabilidades:** el firmware lo sigue haciendo el equipo de hardware. Este equipo entrega el servidor, el panel, el contrato del protocolo y las guías.

## 2. Resultado de la iteración 1 que condiciona esta

- El equipo de pruebas no encontró nada que corregir en el contrato, los slots ni los tiempos. El protocolo v0 se mantiene y todo cambio de esta iteración es **aditivo** (el firmware actual sigue funcionando).
- La pantalla del dispositivo es un **LCD de 16 × 2** (2 líneas de 16 caracteres, sin tildes). Los textos de `scan.result` de la iteración 1 deben ajustarse a ese límite (E13-4).
- El servidor decide con **su propia hora** al recibir el escaneo. Funciona en línea, pero con eventos acumulados tras una caída de red falsearía las métricas. Por eso el modo sin conexión es también un cambio de protocolo (hito H12).
- `GET /events` exige `x-api-key` por cabecera, que un navegador no puede enviar con `EventSource`. El panel usará sesión con cookie (hito H7).
- Las asignaciones `schedule_students` de la iteración 1 no tienen vigencia. Sin ella, las inasistencias salen mal si alguien se une a mitad de semestre (E14-1).
- El scheduler corre dentro del proceso del servidor. En la nube, un despliegue sin interrupción puede levantar dos instancias a la vez y duplicar órdenes de alarma (E25-12).

## 3. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Despliegue | Proveedor en la nube (Railway o un VPS), con PostgreSQL gestionado y `wss` |
| Estudiantes | Importación por CSV **y** alta uno por uno |
| Horarios | Rigen por un solo semestre (un periodo) con días sin servicio |
| Cuentas | Las crea el administrador; contraseña local y sin recuperación por correo (el administrador la restablece) |
| Modo sin conexión | Entra en esta iteración (H12), con código de ejemplo para firmware |
| CLI | Se mantiene con su clave de administrador, como herramienta de soporte |
| Panel | Next.js (App Router) con TypeScript, **desplegado aparte** del servidor, en `app.<dominio>`; la API en `api.<dominio>` |
| Dominio | **Se define al desplegar.** Ningún dominio va escrito en el código: todo se configura por variables de entorno (sección 4). Requisito de despliegue: panel y API como subdominios del mismo dominio |
| Pantalla | LCD de 16 × 2, con mensajes mínimos y claros (Anexo B) |
| Datos de la lista de estudiantes | **Pendiente de aclarar con la universidad.** La importación y el modelo se diseñan para cambiar sin reescribir código |

## 4. Supuestos por defecto

Son propuestas; se pueden cambiar sin alterar el diseño.

| Tema | Valor por defecto |
|---|---|
| Sesión del panel | Cookie `httpOnly` y `SameSite=Strict`; expira tras 30 min sin actividad o 8 h en total |
| Cookie entre subdominios | Por variables de entorno: `COOKIE_DOMAIN` (por ejemplo `.<dominio>`), `COOKIE_SAMESITE` (por defecto `Strict`) y `Secure` en producción. Con `app.` y `api.` bajo el mismo dominio, la cookie viaja con `Strict`. Si no fueran del mismo sitio habría que usar `None`, que algunos navegadores bloquean |
| CORS | Lista de orígenes permitidos por variable de entorno (`CORS_ORIGINS`), con credenciales; cualquier otro origen se rechaza |
| Cómo se llama a la API | El navegador llama **directo** a la API (no a través de un proxy de Next.js), porque el stream de eventos dura mucho y los proxies y funciones sin servidor lo cortan |
| Render del panel | Componentes de cliente (`use client`) con carga de datos desde el navegador; Next.js aporta rutas, estructura y despliegue. No se hace SSR de datos autenticados |
| Repositorio | Una sola raíz con dos proyectos independientes, `server/` y `web/`: cada uno con su `package.json`, dependencias, lockfile, scripts y despliegue. `web` no importa código de `shared`; sus tipos salen del OpenAPI del servidor |
| Contraseñas | Mínimo 10 caracteres, hash argon2, cambio obligatorio en el primer inicio de sesión |
| Bloqueo de inicio de sesión | 5 intentos fallidos, bloqueo de 15 min |
| Columnas del CSV | Provisional: `documento`, `nombre`, `programa` (obligatorias las dos primeras). Es lo que se confirmará con la universidad; el importador asigna las columnas en pantalla |
| Pantalla | `DISPLAY_COLS`=16, `DISPLAY_ROWS`=2, `DISPLAY_RESULT_SECONDS`=3 |
| Importar CSV | Primero una vista previa; solo se importan las filas válidas; el documento ya existente se actualiza |
| Consentimiento | Obligatorio antes de enrolar la huella; guarda versión del texto, fecha y quién lo registró |
| Alta de asignación en un horario | Con vigencia desde hoy; al quitar a un estudiante se cierra la vigencia, no se borra el historial |
| Generación de ocurrencias | Para todo el periodo, saltando los días sin servicio; al editar un horario solo cambian las ocurrencias futuras sin sesiones |
| "Faltó" | El estudiante estaba asignado (con vigencia) a una ocurrencia que ya terminó y no tiene sesión |
| Permanencia | Se calcula solo con sesiones cerradas normalmente; las `no_registrada` y las "por revisar" se excluyen del promedio y se cuentan aparte |
| Supresión de datos | Se elimina la plantilla y se anonimizan los datos personales (nombre y documento); las asistencias se conservan sin identificar para las estadísticas |
| Desfase de reloj tolerado (modo sin conexión) | 30 s; mayor desfase marca los eventos "por revisar" |
| Cola del dispositivo sin conexión | Máximo 500 eventos, con aviso en pantalla al llenarse |
| Eventos sin conexión muy antiguos | Más de 24 h de antigüedad se marcan "por revisar" |
| Idioma y hora del panel | Español, hora de America/Bogota |

## 5. Arquitectura

Se agrega un workspace y nuevos módulos:

```
/web           Panel Next.js: proyecto independiente, con su propio package.json y lockfile
/server        + módulos: auth, users, periods, reports, import, panel, offline
/cli           + comandos: device register/rotate, user create, report
/simulator     + modo sin conexión
/shared        + esquemas de v1 aditivo
/docs          + manual de operación, runbook, modo sin conexión
```

**Autenticación:** el servidor acepta dos credenciales, la clave `x-api-key` (CLI, actor "sistema") o la cookie de sesión (panel). Un guard común aplica los roles. Los endpoints de administración exigen rol `admin`; los de operación, `asistente` o `admin`.

**Panel en vivo:** el panel abre el stream por SSE con `EventSource` y `withCredentials: true`, y la cookie de sesión lo autentica. El servidor envía un comentario de latido cada 15 a 25 s para que los proxies no cierren la conexión. Al abrirse, el panel pide una foto del estado actual y luego aplica los eventos.

**Raíz del repositorio:** `server/`, `simulator/`, `cli/` y `shared/` siguen como workspaces de npm (comparten el protocolo). `web/` queda **fuera** de los workspaces: se instala con `npm --prefix web install` y se ejecuta con `npm --prefix web run dev`. En la raíz solo hay scripts de conveniencia (`dev:server`, `dev:web`). Esto permite desplegar `web/` en un proveedor apuntando a esa carpeta como raíz, sin depender del resto.

**Tipos del panel sin código compartido:** el servidor exporta su esquema OpenAPI (`openapi.json`) y el panel genera sus tipos a partir de él con `openapi-typescript`. El contrato entre ambos es la API, no un paquete.

**Panel y servidor separados:** el panel (`app.<dominio>`) y la API (`api.<dominio>`) son orígenes distintos pero del mismo sitio. Esto exige CORS con credenciales y una cookie con `Domain`, y a cambio permite desplegar el panel sin reiniciar el servidor (cada reinicio corta la conexión del ESP32).

**Protección de la ruta en Next.js:** un `middleware` revisa solo que exista la cookie de sesión y, si no, redirige al inicio de sesión. La validación real y los roles los aplica la API; el panel oculta secciones según el rol que devuelve `GET /auth/me`.

**Desarrollo local:** panel en `localhost:3000` y API en `localhost:3001`. Las cookies no distinguen puertos, así que la sesión funciona; el CORS permite `http://localhost:3000`.

## 6. Cambios al protocolo (aditivos)

Se mantiene `v: 1` en el sobre y la compatibilidad con el firmware actual: todo lo nuevo se activa solo si el dispositivo lo anuncia en `hello`.

| Mensaje | Dirección | Cambio |
|---|---|---|
| `hello` | dispositivo → servidor | Nuevo `capabilities` (lista, por ejemplo `["offline"]`) y `deviceTime` (hora Unix del dispositivo) |
| `display.message` | servidor → dispositivo | Ya definido en v0: se implementa de punta a punta (`line1`, `line2`, `durationSec`); cada línea tiene como máximo 16 caracteres ASCII (Anexo B) |
| `offline.snapshot` | servidor → dispositivo | Nuevo: horario vigente y siguiente, mapa slot → nombre, slots con sesión abierta y slots que ya salieron |
| `offline.events` | dispositivo → servidor | Nuevo: lote de eventos hechos sin conexión (`id`, `type`: `entry`/`exit`/`unknown`/`alarm`, `slot`, `ts`) con `seq` creciente |
| `ack` de `offline.events` | servidor → dispositivo | Con `payload.results`: por cada evento, `ok`, `needsReview` o `rejected` |

Los eventos de `offline.events` conservan la hora **del dispositivo** (`ts`), a diferencia del flujo en línea. El servidor la usa para reconstruir las sesiones.

## 7. Cambios al modelo de datos

| Tabla | Cambio |
|---|---|
| `panel_users` (nueva) | id, nombre, usuario, hash de contraseña, rol, activo, debe cambiar contraseña, intentos fallidos, bloqueado hasta |
| `auth_sessions` (nueva) | id, user_id, creada, última actividad, expira, revocada |
| `periods` (nueva) | id, nombre, fecha de inicio, fecha de fin, activo |
| `service_exceptions` (nueva) | id, period_id, desde, hasta, motivo |
| `schedules` | + `period_id` |
| `schedule_students` | + `valid_from`, `valid_to` |
| `schedule_instances` | + `generated_at`; solo existen en días con servicio |
| `students` | + `display_name` (máx. 16 caracteres ASCII), `consent_version`, `consent_at`, `consent_by`, `anonymized_at`, `import_batch_id` |
| `import_batches` (nueva) | id, archivo, usuario, fecha, filas válidas, filas con error |
| `fingerprints` | + `key_version` (para rotar la clave de cifrado) |
| `devices` | + `token_hash`, `revoked_at`, `clock_skew_ms`, `capabilities` |
| `attendance_sessions` | + `needs_review`, `review_reason`, `reviewed_by`, `reviewed_at`, `device_ts` |
| `event_log` | + `actor_type` (`user`/`system`/`device`), `actor_id` |

---

## 8. Backlog

### E13. Pendientes de la iteración 1

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E13-1 | Orden `display.message`: endpoint REST, envío con confirmación persistida y reenvío al reconectar | M | Un mensaje enviado con el dispositivo caído se entrega al reconectarse |
| E13-2 | `display.message` en la CLI y en el simulador | S | `gym device message "texto"` se ve en la consola del simulador |
| E13-3 | Actualizar `protocolo_v0.md`, `estado_firmware.md` y la guía de integración | S | El estado del mensaje pasa de "pendiente" a "disponible" |
| E13-4 | Catálogo de mensajes para el LCD de 16 × 2 (Anexo B), campo `display_name` y ajuste de los textos de `scan.result` | M | Una prueba verifica que ningún mensaje de ningún motivo de rechazo excede 16 caracteres por línea ni lleva tildes |
| E13-5 | Validar `display.message` en la API y la CLI: normaliza tildes y rechaza más de 2 líneas o más de 16 caracteres por línea | S | Un texto largo se rechaza con un error claro; uno con tildes se envía sin ellas |
| E13-6 | Mensaje en pantalla durante la alarma: con `PENDING_EXIT`, "Tiempo cumplido / Registre salida" hasta apagarla | S | Se envía junto con `alarm.set` y se retira con `CLEARED` |
| E13-7 | `docs/mensajes_pantalla.md` para el equipo de firmware, con los mensajes locales y los del servidor | S | Cubre todo el Anexo B |

### E14. Preparación de datos

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E14-1 | Vigencia en `schedule_students`: al asignar, `valid_from` = hoy; al quitar, se cierra `valid_to` en vez de borrar | M | Quitar a un estudiante no borra su historial; la sincronización solo incluye vigencias activas |
| E14-2 | Autor en `event_log` (`actor_type`, `actor_id`) | S | Todo evento nuevo indica quién lo originó (usuario, sistema o dispositivo) |
| E14-3 | Índices para los reportes (sesiones por fecha, estudiante y horario) | S | Las consultas de la sección E23 usan índice en las pruebas de plan de ejecución |
| E14-4 | Migraciones de esta iteración con datos de la iteración 1 conservados | M | Una base de la iteración 1 migra sin pérdida y el simulador sigue funcionando |

### E15. Cuentas y roles (H7)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E15-1 | Módulo `auth`: inicio y cierre de sesión con cookie, sesión en base (revocable), expiración por inactividad | L | La cookie es `httpOnly`, `SameSite=Strict` y con `Domain` configurable (`COOKIE_DOMAIN`); cerrar sesión la invalida en el servidor |
| E15-2 | Módulo `users`: el administrador crea, edita y desactiva cuentas, y restablece contraseñas | M | Una cuenta desactivada pierde su sesión en el acto |
| E15-3 | Cambio obligatorio de contraseña en el primer inicio de sesión y política de contraseñas | S | No se puede usar el panel sin cambiar la contraseña temporal |
| E15-4 | Bloqueo tras intentos fallidos y límite de tasa en el inicio de sesión | S | Al 5.º fallo se bloquea 15 min y queda registrado |
| E15-5 | Guard con dos credenciales (`x-api-key` o cookie) y roles `asistente` y `admin` | M | Un asistente recibe 403 en los endpoints de administración; la CLI sigue funcionando |
| E15-6 | Protección CSRF: `SameSite=Strict`, cabecera obligatoria en las peticiones que modifican datos y verificación de la cabecera `Origin` contra `CORS_ORIGINS` | S | Una petición que modifica datos desde un origen no permitido, o sin la cabecera, es rechazada |
| E15-7 | Creación del primer administrador (comando de arranque o variable) | S | Se puede crear el primer admin sin acceso a la base de datos |
| E15-8 | Auditoría con el usuario responsable en todas las acciones sensibles | M | Cada acción del panel y de la CLI queda con `actor_type` y `actor_id` |
| E15-9 | Eventos SSE y estado accesibles con la cookie, con CORS de credenciales y latido periódico | S | El panel, desde otro origen permitido, recibe `GET /events` sin `x-api-key` y la conexión sobrevive 10 min sin eventos |
| E15-11 | Dominio solo por configuración: `COOKIE_DOMAIN`, `COOKIE_SAMESITE`, `CORS_ORIGINS` en el servidor y `NEXT_PUBLIC_API_URL` en el panel, con `.env.example` documentado y sin ningún dominio escrito en el código | S | Cambiar de dominio solo requiere cambiar variables de entorno |
| E15-10 | CORS: lista de orígenes por variable de entorno, con credenciales, métodos y cabeceras permitidos y caché de las respuestas previas (preflight) | S | Un origen no listado es bloqueado y uno listado funciona con cookie; hay pruebas de ambos casos |

### E16. Base del panel (H8)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E16-1 | Proyecto `web/` independiente (Next.js App Router + TypeScript, con su `package.json` y lockfile) y URL de la API por `NEXT_PUBLIC_API_URL` | M | `npm --prefix web run dev` abre el panel contra el servidor local; `web/` compila sin importar nada de `shared` |
| E16-2 | Cliente de la API con `credentials: 'include'`, cabecera anti-CSRF, y manejo central de 401 (redirige al inicio de sesión) y 403 (aviso de permisos) | M | Una sesión expirada lleva al inicio de sesión sin perder el mensaje de error |
| E16-3 | Pantalla de inicio de sesión, cambio de contraseña, `middleware` que exige la cookie, y menú según el rol de `GET /auth/me` | M | Sin cookie, toda ruta redirige al inicio de sesión; un asistente no ve las secciones de administrador |
| E16-4 | Cliente SSE (`EventSource` con `withCredentials`) con reconexión y estado de conexión visible | M | Si se cae la red, el panel muestra "desconectado" y se actualiza solo al volver |
| E16-5 | Componentes base: tablas con filtros y paginación, formularios con validación, avisos, confirmaciones | M | Los reutilizan todas las pantallas |
| E16-6 | Fechas y horas siempre en America/Bogota | S | Una sesión guardada en UTC se muestra en hora de Bogotá |
| E16-7 | Completar el esquema OpenAPI del servidor (DTOs, respuestas y errores de todos los endpoints) y exportarlo a `openapi.json` con un script | M | Cada endpoint aparece en `/docs` con sus tipos de entrada y salida |
| E16-8 | Generar los tipos del panel desde `openapi.json` (`npm --prefix web run gen:api`) y verificar en CI que el archivo versionado está al día | S | Cambiar un DTO del servidor sin regenerar los tipos hace fallar la verificación |
| E16-9 | Publicar los tipos de los eventos del stream (SSE) como esquemas en el OpenAPI | S | El panel tiene tipos para cada evento sin copiarlos a mano |

### E17. Panel del asistente (H8)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E17-1 | Endpoint de foto del estado: horario en curso, esperados, dentro, salieron, faltan, tiempo restante y estado de la alarma | M | Devuelve la lista correcta en los escenarios de la sección 9 |
| E17-2 | Pantalla "Ahora": estado del horario actual y de ingreso, actualizada en vivo | L | Un escaneo del simulador mueve a la persona de "faltan" a "dentro" sin recargar |
| E17-3 | Registro manual de entrada y salida desde el panel, con motivo obligatorio | M | La sesión queda marcada como manual y aparece el usuario responsable |
| E17-4 | Enrolamiento desde el panel con progreso en vivo, y cancelación | L | El asistente ve cada paso del dispositivo y el resultado final |
| E17-5 | Órdenes al dispositivo: alarma (encender, apagar, probar) y mensaje en pantalla (2 líneas de hasta 16 caracteres, con contador) | M | Cada orden muestra su estado (enviada, confirmada o fallida) |
| E17-6 | Estado del dispositivo: en línea, última conexión, versión, órdenes pendientes y desfase de reloj | S | El panel avisa cuando el dispositivo pasa a fuera de línea |
| E17-7 | Consulta de listados de cualquier horario (quiénes deben asistir, quiénes asistieron y quiénes faltan) | M | Se puede consultar un horario pasado, uno en curso y uno futuro |
| E17-8 | Aviso visible cuando suena la alarma, con acción para apagarla y confirmación | S | Queda registrado quién la apagó y cuántas sesiones quedaron abiertas |

### E18. Periodos y generación de ocurrencias (H9)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E18-1 | CRUD de periodos (nombre, inicio, fin) con un solo periodo activo | S | No se puede activar un periodo que se cruza con otro |
| E18-2 | CRUD de días sin servicio (rangos con motivo) | S | Se pueden agregar festivos y vacaciones al periodo |
| E18-3 | Generar las ocurrencias de cada horario recurrente para todo el periodo, saltando los días sin servicio | L | Para un horario de lunes a viernes en un periodo con un festivo, no se crea la ocurrencia del festivo |
| E18-4 | Regeneración al editar horarios o días sin servicio: solo cambian las ocurrencias futuras sin sesiones | M | Una ocurrencia con asistencia nunca se modifica ni se borra |
| E18-5 | Job diario que verifica que el periodo activo tenga todas sus ocurrencias | S | Se repara la falta de ocurrencias y se registra en el log |
| E18-6 | Horarios de una sola fecha siguen funcionando (pruebas y eventos) | S | Un horario creado con `--ends-in` no depende del periodo |
| E18-7 | Gestión de periodos y días sin servicio en el panel | M | El administrador crea un periodo completo sin usar la CLI |

### E19. Horarios y listados en el panel (H9)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E19-1 | CRUD de horarios recurrentes dentro de un periodo (día, inicio, fin, margen de ingreso) | M | La validación evita horarios que se cruzan en el mismo dispositivo |
| E19-2 | Asignar y quitar estudiantes en un horario desde el panel, con vigencia | M | Quitar a un estudiante deja el historial intacto |
| E19-3 | Asignar muchos estudiantes de una vez pegando o cargando una lista de documentos | M | Informa cuáles no existen y asigna los demás |
| E19-4 | Copiar el listado de un horario a otro | S | Copia solo estudiantes activos |
| E19-5 | Vista semanal de los horarios del periodo | S | Muestra los horarios y la cantidad de asignados |

### E20. Estudiantes (H9)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E20-1 | Alta, edición, desactivación y búsqueda de estudiantes en el panel | M | Documento único; búsqueda por nombre o documento |
| E20-2 | Importación por CSV con asignación de columnas en pantalla, vista previa, validación y reporte de errores | L | Las columnas del archivo se asignan a los campos sin cambiar código; un CSV con filas malas muestra cuáles y por qué, y solo se importan las válidas |
| E20-7 | Definición única de los campos de la lista de estudiantes (obligatorios y opcionales), para que agregar o quitar un campo no obligue a reescribir la importación | S | Un campo nuevo se agrega en un solo lugar y aparece en la asignación de columnas |
| E20-8 | Generar el `display_name` al importar o crear un estudiante, y poder editarlo | S | Ningún `display_name` supera 16 caracteres ni lleva tildes |
| E20-3 | Registro de lotes de importación (`import_batches`) | S | Cada importación queda trazada con su usuario y su resultado |
| E20-4 | Registro del consentimiento (versión del texto, fecha y quién lo registró) | M | No se puede iniciar un enrolamiento sin consentimiento registrado |
| E20-5 | Estado de huella por estudiante (sin huella, enrolada, fecha) | S | El listado permite filtrar por quién falta enrolar |
| E20-6 | Descarga de una plantilla de CSV de ejemplo | S | El archivo descargado se puede volver a importar sin errores |

### E21. Usuarios del panel (H9)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E21-1 | Pantalla para crear, editar, desactivar y restablecer contraseñas | M | Al restablecer, se muestra la contraseña temporal una sola vez |
| E21-2 | Reglas de seguridad: el administrador no puede desactivarse a sí mismo ni dejar el sistema sin administradores | S | Se bloquea con un mensaje claro |

### E22. Historial y auditoría (H9)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E22-1 | Historial de ingresos y egresos con filtros (fecha, horario, estudiante, origen) | M | Distingue huella, manual y sin conexión |
| E22-2 | Vista de auditoría: acciones, usuario, fecha y detalle | M | Solo la ve el administrador |
| E22-3 | Historial de órdenes enviadas al dispositivo y de alarmas | S | Muestra quién ordenó, cuándo y el resultado |

### E23. Reportes, servidor (H10)

Todos los reportes aceptan filtros por rango de fechas, horario, programa y estudiante, y se pueden exportar a CSV.

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E23-1 | Afluencia: personas por hora y por día de la semana | M | Para un conjunto de datos de prueba, los conteos coinciden con los calculados a mano |
| E23-2 | Horas pico y días de mayor afluencia | S | Devuelve el top N con su cantidad |
| E23-3 | Inasistencias por estudiante, horario y periodo (asignado y sin sesión en una ocurrencia terminada) | L | Respeta la vigencia, los días sin servicio y las ocurrencias futuras |
| E23-4 | Cumplimiento: sesiones a las que asistió frente a las que debía asistir | M | Cálculo por estudiante y por periodo |
| E23-5 | Permanencia por sesión y promedio por estudiante (mes, varios meses y periodo) | L | Excluye las sesiones `no_registrada` y "por revisar", y las cuenta aparte |
| E23-6 | Llegadas tarde: minutos entre el inicio del horario y la entrada | S | Promedio por estudiante y por horario |
| E23-7 | Alarmas: cantidad, duración y cómo se cerraron (todos salieron, botón, panel o tiempo) | M | Cuadra con `alarm_events` |
| E23-8 | Calidad de los datos: registros manuales, sesiones `no_registrada` y registros "por revisar" | S | Sirve para detectar fallas del huellero |
| E23-9 | Exportación a CSV con las mismas columnas y filtros que la pantalla | M | El CSV se abre bien en Excel (codificación UTF-8 con BOM y separador adecuado) |
| E23-10 | Datos de prueba generados (un semestre simulado) para validar los reportes | M | Un comando crea datos reproducibles con resultados esperados conocidos |

### E24. Reportes, panel (H10)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E24-1 | Pantalla de reportes con filtros comunes y selección del reporte | M | Cambiar un filtro actualiza la pantalla |
| E24-2 | Gráficas de afluencia y horas pico | M | Se entienden sin leyenda externa; el eje horario está en hora de Bogotá |
| E24-3 | Tablas de inasistencias, cumplimiento y permanencia por estudiante | M | Se ordenan y filtran; abrir un estudiante muestra su detalle |
| E24-4 | Botón de exportación en cada reporte | S | Descarga lo que se está viendo |
| E24-5 | Resumen del administrador al abrir sesión (indicadores del periodo) | S | Muestra asistencia del día, de la semana y alertas |

### E25. Producción (H11)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E25-1 | `Dockerfile` en varias etapas del servidor | M | La imagen arranca con solo las variables de entorno |
| E25-2 | Configuración de producción del servidor: variables, proxy de confianza, cookies con `Domain` y `Secure`, `CORS_ORIGINS`, cabeceras de seguridad | M | Detrás del proxy del proveedor la cookie se marca `Secure` y solo el origen del panel pasa CORS |
| E25-3 | Despliegue en el proveedor elegido con PostgreSQL gestionado, migraciones automáticas y `wss` en el puerto 443 | L | El simulador se conecta por `wss://` a `api.<dominio>` y `/health` responde por HTTPS |
| E25-4 | Token por dispositivo: alta, rotación y revocación (hash en base) | M | `gym device register`, `rotate` y `revoke`; el token anterior deja de funcionar |
| E25-5 | Cifrado con versión de clave y comando de rotación | M | Se rota la clave sin perder ninguna plantilla |
| E25-6 | Respaldos automáticos de la base de datos, y prueba de restauración | L | Se restaura en una base limpia y el sistema funciona |
| E25-7 | Respaldo de la clave de cifrado **separado** de la base de datos | S | Sin la clave las plantillas no se recuperan; el procedimiento queda documentado |
| E25-8 | Supresión de datos: eliminar la plantilla, anonimizar al estudiante y retirarlo del lector | M | En la siguiente sincronización la huella desaparece del lector |
| E25-9 | Texto del consentimiento versionado y mostrado en el panel | S | El texto lo proporciona la universidad; se guarda la versión aceptada |
| E25-10 | Alertas: el dispositivo lleva más de N minutos fuera de línea (aviso en el panel y en el log) | M | El umbral es configurable |
| E25-11 | Monitoreo externo de `/health` y de la disponibilidad | S | Un servicio externo avisa si el servidor no responde |
| E25-12 | Candado de Postgres (`pg_advisory_lock`) para que solo una instancia ejecute los schedulers | M | Con dos instancias levantadas, la alarma se ordena una sola vez |
| E25-13 | Guía de `wss` para el firmware: sincronizar la hora por NTP **antes** de abrir TLS, certificado raíz del proveedor, puerto 443 | M | Un ESP32 se conecta por `wss` siguiendo la guía; con la hora incorrecta, la guía explica el fallo |
| E25-14 | Revisión de seguridad: dependencias, límites de tasa, secretos fuera del repositorio | M | `npm audit` sin vulnerabilidades altas; sin secretos en el historial |
| E25-15 | Runbook: despliegue, respaldos, restauración, rotación de claves y tokens, qué hacer si el dispositivo no conecta, si no suena la alarma o si el servidor cae | M | Una persona del equipo ejecuta cada procedimiento sin ayuda |
| E25-16 | Manual corto de uso del panel para el asistente y el administrador | M | Cubre los casos de uso del documento de contexto |
| E25-18 | Despliegue del panel Next.js (carpeta `web/` como raíz del proyecto) en un proveedor compatible (por ejemplo Vercel, o un contenedor Node en el mismo proveedor del servidor) con `NEXT_PUBLIC_API_URL` y cabeceras de seguridad (CSP, `X-Frame-Options`) | M | El panel carga por HTTPS en `app.<dominio>`, inicia sesión y recibe eventos en vivo desde `api.<dominio>` |
| E25-19 | Cuando se defina el dominio: DNS, subdominios `app.` y `api.` con certificados y carga de las variables de entorno | S | Ambos responden por HTTPS y la cookie de sesión se envía entre ellos |
| E25-20 | Pipelines de integración continua separados por carpeta (`server/` y `web/`), que corren solo cuando cambia su carpeta | S | Un cambio solo en `web/` no ejecuta las pruebas del servidor, y viceversa |
| E25-17 | Piloto de una semana con un grupo reducido y lista de verificación | M | Se registran los problemas y quedan resueltos o priorizados |

### E26. Modo sin conexión, servidor (H12)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E26-1 | Esquemas del protocolo aditivo: `hello` ampliado, `offline.snapshot`, `offline.events` y su `ack` | M | Un firmware sin `capabilities` sigue funcionando igual |
| E26-2 | Medir el desfase del reloj con `deviceTime` en cada `hello` y guardarlo | S | El panel avisa si supera 30 s |
| E26-3 | Enviar `offline.snapshot` al conectar, al sincronizar y cuando cambia el horario | M | Contiene lo necesario para decidir sin servidor y se confirma con ack |
| E26-4 | Recibir `offline.events`: validación, idempotencia por `id`, orden por `ts` y `seq` | L | Un lote repetido no duplica sesiones |
| E26-5 | Motor de reconciliación: el dominio recibe el instante como parámetro y reconstruye entradas y salidas con el `ts` original | L | Las sesiones quedan con la hora real del evento y no con la de llegada |
| E26-6 | Conflictos → "por revisar" con motivo: salida sin entrada, entrada duplicada, fuera de ventana, `ts` futuro o muy antiguo | M | Ningún evento se pierde ni se acepta sin avisar |
| E26-7 | Alarmas locales: registrar los eventos de alarma del dispositivo con su hora | S | Quedan en `alarm_events` con origen `local` |
| E26-8 | Pantalla "Por revisar": aprobar, corregir la hora o descartar, con auditoría | M | Cada resolución registra usuario y motivo |
| E26-9 | Simulador con modo sin conexión: decisión local, cola, desfase configurable y reenvío al reconectar | L | Reproduce el escenario B15 |
| E26-10 | Reporte de calidad incluye eventos reconciliados y por revisar | S | Se cuentan aparte en E23-8 |

### E27. Guía para el firmware sin conexión (H12)

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E27-1 | `docs/modo_sin_conexion_firmware.md`: qué guarda el ESP32, cómo decide, formato de la cola y de `offline.events`, límites y avisos | M | Un compañero lo implementa sin preguntar |
| E27-2 | Esbozo de código en C++ (anexo A) revisado con el equipo de hardware | S | El equipo confirma que se ajusta a su firmware |
| E27-3 | Lista de verificación de pruebas del firmware: apagar el WiFi, escanear, reconectar, llenar la cola, reiniciar sin conexión | S | Cada punto indica el resultado esperado |

### E28. Pruebas

| ID | Tarea | Tam. | Criterio de aceptación |
|---|---|---|---|
| E28-1 | Pruebas unitarias de auth, roles, periodos, generación de ocurrencias, importación y reportes | L | Los repositorios en memoria permiten correrlas sin base de datos |
| E28-2 | Pruebas de integración de permisos: cada endpoint contra cada rol | M | Una matriz de endpoints y roles se verifica automáticamente |
| E28-3 | Escenarios B1 a B17 ejecutables con un solo comando, como los A1 a A12 | L | Pasan en el servidor en memoria y en el despliegue de prueba |
| E28-4 | Pruebas del panel (componentes clave y flujos principales en un navegador real) contra el servidor en memoria con CORS activo | M | Inicio de sesión, "Ahora", enrolamiento e importación tienen pruebas |
| E28-5 | Prueba de carga ligera: una hora de operación simulada con 30 estudiantes por horario | M | Sin pérdida de mensajes ni alarmas duplicadas |

---

## 9. Escenarios de aceptación

Se suman a los A1 a A12 de la iteración 1, que deben seguir pasando.

| # | Escenario | Resultado esperado |
|---|---|---|
| B1 | Inicio de sesión de administrador y de asistente | Cada uno ve solo lo de su rol; el asistente recibe 403 en administración |
| B2 | El administrador crea un periodo con días sin servicio y un horario recurrente | Se generan las ocurrencias y se omiten los días sin servicio |
| B3 | Importar un CSV con filas inválidas | Vista previa con errores, y se importan solo las válidas |
| B4 | Alta manual de un estudiante | Aparece en el listado y puede asignarse a un horario |
| B5 | El asistente mira el panel mientras el simulador escanea | El estado cambia sin recargar |
| B6 | Enrolar una huella desde el panel | Se ven los pasos en vivo y queda guardada y cifrada, con el consentimiento registrado |
| B7 | Registro manual desde el panel | Queda con motivo y con el usuario en la auditoría |
| B8 | Alarma y mensaje en pantalla desde el panel | La orden llega al simulador y su estado se ve en el panel |
| B9 | Reporte de inasistencias de un periodo | Cuenta solo a los asignados con vigencia en ocurrencias terminadas |
| B10 | Promedio de permanencia de un estudiante en un mes | Coincide con el cálculo manual y excluye sesiones `no_registrada` |
| B11 | Exportar un reporte a CSV | El contenido coincide con la pantalla |
| B12 | Despliegue en la nube con `wss` y reinicio del servicio | El dispositivo se reconecta y las sesiones abiertas se conservan; el panel se reconecta solo |
| B13 | Restaurar un respaldo en una base limpia | El sistema funciona con la clave de cifrado respaldada |
| B14 | Supresión de un estudiante | Se elimina la plantilla, se anonimiza y desaparece del lector en la siguiente sincronización |
| B15 | Modo sin conexión: se desconecta el simulador, se hacen entradas y salidas, se reconecta | El servidor reconstruye las sesiones con las horas originales; los conflictos quedan "por revisar" |
| B16 | Rotar el token de un dispositivo | El token anterior deja de funcionar y el nuevo conecta |
| B17 | Panel y API en subdominios distintos | El inicio de sesión, la cookie y el stream en vivo funcionan; una petición desde un origen no permitido es rechazada |

## 10. Pendientes y decisiones diferidas

Ninguno bloquea el inicio de H6 y H7.

**Pendientes por aclarar:**

1. **Datos de la lista de estudiantes.** Hay que preguntar a la universidad exactamente qué datos maneja de cada estudiante (campos, formato del archivo, de dónde sale y quién lo entrega). Mientras tanto se trabaja con `documento`, `nombre` y `programa`, y el importador está pensado para cambiar (E20-2, E20-7). Conviene pedir **solo los datos necesarios**, porque entre menos datos personales se guarden, menos obligaciones trae la Ley 1581.
2. **Consentimiento y retención de datos.** La universidad debe dar el texto del consentimiento y definir cuánto tiempo se conservan las asistencias. La propuesta de supresión (eliminar la plantilla y anonimizar) debería validarla la oficina jurídica o el responsable de protección de datos. Se necesita antes del piloto.

**Diferidas al despliegue:**

3. **Proveedor y dominio.** No están garantizados. Todo es configurable por variables de entorno (E15-11), y se decide al llegar a E25. Condición de fondo: panel y API como subdominios del mismo dominio.

**Cerradas:**

4. **Pantalla.** LCD de 16 × 2, con mensajes mínimos (Anexo B). Si el hardware definitivo fuera otro, se cambia `DISPLAY_COLS` y `DISPLAY_ROWS`.

## 11. Orden de trabajo recomendado

| Hito | Contenido | Qué desbloquea |
|---|---|---|
| **H6. Pendientes y preparación** | E13, E14 | `display.message` completo y la base de datos lista para el panel |
| **H7. Cuentas y roles** | E15 | Todo el panel depende de esto |
| **H8. Panel del asistente** | E16, E17 | El gimnasio opera a diario sin la CLI |
| **H9. Panel del administrador** | E18, E19, E20, E21, E22 | Se operan los semestres sin ayuda del equipo de desarrollo |
| **Uso real** | Una semana de operación entre H9 y H10 | Datos reales para validar los reportes |
| **H10. Métricas y reportes** | E23, E24 | Las respuestas que pide la administración |
| **H11. Producción** | E25 | La solución completa y el piloto |
| **H12. Modo sin conexión** | E26, E27 | Operar sin red. Puede ir en paralelo con H8 a H10 porque depende más del equipo de firmware |

**Dependencias que conviene vigilar:**

- E15 antes de cualquier pantalla del panel. El CORS (E15-10) debe estar antes de que el panel intente llamar a la API.
- **Dominio al desplegar** (E25-19). Es la única decisión que falta para el primer despliegue de pruebas. Panel y API deben quedar como subdominios del mismo dominio; si no, la cookie se trata como de terceros y Safari y otros navegadores la bloquean, y el inicio de sesión falla sin dar un error claro. En desarrollo local no hay problema.
- E14-1 (vigencia) y E18-3 (ocurrencias) antes de los reportes de inasistencias (E23-3).
- E25-13 (guía de `wss`) debe entregarse al equipo de firmware **antes** de desplegar en la nube: sin la hora correcta, TLS falla en el ESP32.
- E26-1 (esquemas) debe entregarse cuanto antes al equipo de firmware, aunque H12 sea el último hito, para que empiecen en paralelo.

---

## Anexo A. Esbozo de código para el firmware sin conexión

> **Ilustrativo, no probado en hardware.** Muestra la estructura y las decisiones clave. El equipo de firmware lo adapta a su librería de huellas y a la organización de su proyecto.

Librerías: `WebSocketsClient` (links2004/WebSockets), `ArduinoJson` 7, `LittleFS` y `time.h`.

```cpp
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>
#include <map>
#include <set>

// ---- Estado local (llega en offline.snapshot y se guarda en flash) ----
std::map<uint16_t, String> roster;   // slot -> nombre
std::set<uint16_t> openSlots;        // slots con sesión abierta
std::set<uint16_t> exitedSlots;      // slots que ya salieron (no pueden reingresar)
time_t entryOpensAt, entryClosesAt, endAt;   // epoch UTC del horario vigente
bool online = false;

// ---- 1) Cola persistente: un evento JSON por línea ----
// El mismo id se reutiliza en cada reintento (el servidor lo usa para no duplicar).
bool queuePush(const char* type, uint16_t slot, time_t ts) {
  File f = LittleFS.open("/queue.jsonl", "a");
  if (!f) return false;
  JsonDocument doc;
  doc["id"]   = newUuid();          // generar un UUID por evento
  doc["type"] = type;               // "entry" | "exit" | "unknown"
  doc["slot"] = slot;
  doc["ts"]   = (uint32_t)ts;       // hora del dispositivo, ya sincronizada por NTP
  serializeJson(doc, f);
  f.print('\n');
  f.close();
  return true;                      // si la cola supera 500 líneas: avisar en pantalla
}

// ---- 2) Decisión local cuando no hay conexión ----
void onFingerprintOffline(uint16_t slot) {
  time_t now = time(nullptr);
  auto it = roster.find(slot);
  if (it == roster.end()) { showMessage("Huella no reconocida"); return; }

  if (openSlots.count(slot)) {                          // estaba dentro -> salida
    openSlots.erase(slot);
    exitedSlots.insert(slot);
    queuePush("exit", slot, now);
    showMessage(it->second + "\nSalida registrada");
  } else if (exitedSlots.count(slot)) {                 // ya salió -> rechazo
    showMessage("Ya registró su salida");
  } else if (now >= entryOpensAt && now <= entryClosesAt) {
    openSlots.insert(slot);                             // dentro de la ventana -> entrada
    queuePush("entry", slot, now);
    showMessage(it->second + "\nEntrada registrada");
  } else {
    showMessage("Fuera del horario");
  }
  saveLocalState();                                     // persistir sets en flash (reinicio sin red)
}

// ---- 3) Al reconectar: enviar la cola en lotes y borrar solo lo confirmado ----
void flushQueue(WebSocketsClient& ws) {
  // Leer hasta N líneas de /queue.jsonl, armar un mensaje offline.events:
  //   { "v":1, "id":"<uuid>", "type":"offline.events", "payload": { "seq": n, "events":[...] } }
  // Enviarlo y esperar el ack. Con ack ok, eliminar esas líneas del archivo.
  // Sin ack: reintentar el mismo lote con el mismo id.
}

// ---- 4) Alarma local a la hora de fin ----
void loopAlarm() {
  time_t now = time(nullptr);
  if (now >= endAt && !openSlots.empty()) alarmOnContinuous();  // suena hasta que salga el último
  else if (now >= endAt && !endBeepDone) { alarmOnForSeconds(5); endBeepDone = true; }
  // El botón físico la apaga siempre y se encola como evento.
}

// ---- 5) Reglas de oro ----
// - Sincronizar la hora por NTP ANTES de conectar por wss (TLS valida fechas).
// - Al arrancar sin red, cargar el estado local desde flash y seguir funcionando.
// - Al reconectar: enviar "hello" con deviceTime y capabilities ["offline"],
//   esperar "offline.snapshot" y luego vaciar la cola.
// - No borrar la cola hasta recibir ack; limitar su tamaño para no desgastar la flash.
```

---

## Anexo B. Mensajes para la pantalla LCD de 16 × 2

La pantalla muestra **2 líneas de 16 caracteres**. Los mensajes dan solo el feedback necesario: quién es y qué pasó. Reglas:

- Máximo 16 caracteres por línea, solo ASCII: las pantallas LCD de este tipo no muestran tildes ni la ñ (los textos van sin tildes: "Salio", no "Salió").
- `<NOMBRE>` es el `display_name` del estudiante: máximo 16 caracteres ASCII. Se genera al registrarlo (nombre completo si cabe; si no, primer nombre y la inicial del segundo, por ejemplo `Ana M.`) y el asistente puede editarlo.
- Los mensajes de resultado se muestran `DISPLAY_RESULT_SECONDS` (por defecto 3 s) y luego la pantalla vuelve al reposo o se apaga si el sensor de proximidad ya no detecta a nadie.
- El campo `color` de `scan.result` no aplica a una pantalla monocroma; el firmware puede ignorarlo.
- El tamaño es configurable (`DISPLAY_COLS` y `DISPLAY_ROWS`, por defecto 16 y 2). Si el hardware definitivo fuera otro, se cambia la variable y no el código.

**Mensajes que envía el servidor** (`scan.result` y `display.message`):

| Situación | Línea 1 | Línea 2 |
|---|---|---|
| Entrada registrada | `<NOMBRE>` | `Entrada OK` |
| Salida registrada | `<NOMBRE>` | `Salida OK` |
| Huella no reconocida (`unknown`, `UNKNOWN_SLOT`) | `No reconocida` | `Intente de nuevo` |
| `NOT_IN_SCHEDULE` | `<NOMBRE>` | `No es su horario` |
| `NO_ACTIVE_SCHEDULE` | `Sin horario` | `en este momento` |
| `OUTSIDE_ENTRY_WINDOW`, antes de abrir | `Ingreso abre` | `a las HH:MM` |
| `OUTSIDE_ENTRY_WINDOW`, ya cerrado | `Ingreso cerrado` | (vacía) |
| `ALREADY_EXITED` | `<NOMBRE>` | `Ya marco salida` |
| `STUDENT_INACTIVE` | `<NOMBRE>` | `No habilitado` |
| Error del servidor | `Error de sistema` | `Llame asistente` |
| Alarma continua (`PENDING_EXIT`) | `Tiempo cumplido` | `Registre salida` |

**Mensajes locales del firmware** (no pasan por el servidor):

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
