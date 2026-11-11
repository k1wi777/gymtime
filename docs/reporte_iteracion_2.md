# Reporte de la iteración 2 — GymTime UniCórdoba

**Fecha del reporte:** 7 de noviembre de 2026
**Periodo:** del 5 al 7 de noviembre de 2026 (siete hitos y el cierre, en tres días)
**Estado:** iteración 2 completa
**Alcance:** panel web, cuentas y roles, periodos, importación, reportes, producción y modo sin conexión

---

## 1. Resumen ejecutivo

La iteración 2 completa la solución de software: lo que usan las personas (panel
web para el asistente y el administrador, cuentas, periodos por semestre,
importación de estudiantes, reportes y métricas) y lo que la prepara para
producción (HTTPS, token por lector, respaldo y restauración, rotación de la
clave de cifrado, supresión de datos, consentimiento) más el modo sin conexión
del lector. El gimnasio ya puede operar a diario desde el panel, sin la CLI.

Se cerraron los siete hitos restantes del backlog (H6 a H12) y el cierre de la
iteración: 8 Work Items, todos en `done`, con revisión independiente, y 14
migraciones nuevas (20 en total, 6 de la iteración 1). El cierre añade los
escenarios B1–B17, una prueba de carga y datos de muestra de desarrollo.

**Lo que queda fuera de esta iteración:** la prueba con el ESP32 real (incluido
el modo sin conexión, que está listo en el servidor y el simulador pero sin
probar en hardware), el estado de los periféricos, el despliegue real en un
proveedor, el piloto y los datos reales. La iteración 3 los aborda (sección 12).

---

## 2. Objetivo y principios respetados

**Objetivo:** completar la solución de la ficha de software: que el gimnasio se
opere desde el panel, que la administración obtenga sus métricas y que el
sistema pueda ponerse en producción de forma segura.

Principios aplicados:

- **Solo huella:** sin cambios; el panel no agrega otro método de identificación
  para los estudiantes.
- **Hora de salida fija por horario:** salir y volver a entrar sigue sin dar más
  tiempo (`ALREADY_EXITED`); los horarios rigen por un periodo con días sin
  servicio.
- **El servidor decide, el dispositivo ejecuta:** el modo sin conexión es la
  excepción prevista: el lector decide con un snapshot guardado y el servidor
  reconcilia después, dejando «por revisar» lo que contradice el estado.
- **Protocolo robusto:** todo cambio es aditivo (`v: 1`); un firmware sin
  `capabilities` funciona como en v0. Los lotes sin conexión son idempotentes por
  `(dispositivo, id)`.
- **Protección de datos biométricos (Ley 1581):** consentimiento registrado y
  exigido por el servidor antes de enrolar, plantillas cifradas con versión de
  clave y rotación, supresión que elimina la plantilla y anonimiza al estudiante,
  auditoría con actor y baja irreversible.
- **Bajo costo:** un VPS pequeño con Docker Compose y Caddy; PostgreSQL y un solo
  dispositivo.

---

## 3. Estado por hito

| Hito | Contenido | Estado | Commit |
|---|---|---|---|
| **H6. Pendientes y preparación** | E13 (`display.message`, catálogo LCD, nombre corto), E14 (auditoría con actor, vigencia por estudiante en horario, índices de reportes) | Completo | `d1e2e2c` |
| **H7. Cuentas y roles** | E15 (usuarios, sesiones con cookie, roles, CSRF, CORS, primer administrador) | Completo | `d5bbe29` |
| **H8. Panel base y asistente** | E16 (base Next.js, OpenAPI, SSE), E17 (Ahora, Registro, Enrolar, Alarma y mensajes, Dispositivo, Horarios) | Completo | `ea35888` |
| **H9. Panel del administrador** | E18 (periodos y ocurrencias), E19 (horarios), E20 (estudiantes, importación CSV, consentimiento), E21 (usuarios), E22 (historial y auditoría) | Completo | `bd48705` |
| **H10. Métricas y reportes** | E23 (reportes del servidor y CSV), E24 (reportes y resumen en el panel) | Completo | `8c7abbc` |
| **H11. Producción y seguridad** | E25 (imágenes, HTTPS, token por lector, respaldos, rotación de clave, supresión, revisión de seguridad, runbook) | Completo | `c552451` |
| **H12. Modo sin conexión** | E26 (servidor, simulador, «Por revisar»), E27 (guía para firmware) | Completo | `1b363a8` |
| **Cierre** | E28 (escenarios B1–B17, prueba de carga, datos de muestra, rechazo de claves de ejemplo) | Completo | `b5ac0fa` |

Work Items cerrados de la iteración: 8 (todos features). Con los 13 de la
iteración 1 son 21 Work Items en `done`.

| # | Work Item | Tipo |
|---|---|---|
| 1 | `2026-11-05_23-46__h6-pantalla-y-preparacion-datos` | feature |
| 2 | `2026-11-06_00-23__h7-cuentas-y-roles` | feature |
| 3 | `2026-11-06_01-16__h8-panel-base-y-asistente` | feature |
| 4 | `2026-11-06_03-13__h9-panel-administrador` | feature |
| 5 | `2026-11-06_14-37__h10-reportes-y-metricas` | feature |
| 6 | `2026-11-06_16-49__h11-produccion-y-seguridad` | feature |
| 7 | `2026-11-06_21-25__h12-modo-sin-conexion` | feature |
| 8 | `2026-11-07_00-22__cierre-iteracion-2` | feature |

---

## 4. Qué se dejó listo

### 4.1 Arquitectura

Monorepo npm con cuatro workspaces (`server/`, `shared/`, `simulator/`, `cli/`,
sin cambio de rol) y dos carpetas nuevas fuera de ellos:

| Carpeta | Contenido |
|---|---|
| `web/` | Panel Next.js (App Router, TypeScript), proyecto aparte con su propio `package.json`; sus tipos se generan de `server/openapi.json`. |
| `deploy/` | Compose de producción, Caddy, respaldo y restauración, verificación de imágenes y revisión de seguridad. |

Módulos nuevos del servidor: `auth`, `users`, `reports`, `panel`, `offline`,
además de periodos, importación, consentimiento y auditoría con actor
(`common/audit`).

### 4.2 API del panel y de reportes

Las rutas aceptan la clave `x-api-key` (CLI, actor «sistema») o la cookie de
sesión del panel; un guard global deniega por defecto y aplica los roles
(administrador y asistente). El OpenAPI exportado tiene 70 rutas. Familias:

| Familia | Función |
|---|---|
| `/auth`, `/users` | Inicio y cierre de sesión, cambio de contraseña, cuentas del panel. |
| `/panel` | Estado actual, lista del horario del día, huellas. |
| `/periods`, `/schedules` | Periodos con días sin servicio, horarios recurrentes, ocurrencias y asignaciones con vigencia. |
| `/students` | Alta, importación CSV, consentimiento, baja y supresión. |
| `/attendance`, `/history`, `/audit` | Registro manual, historial y auditoría. |
| `/devices`, `/alarm`, `/events` | Lector, tokens, mensajes de pantalla, alarma y stream SSE. |
| `/reports` | Reportes y resumen del administrador, con exportación CSV auditada. |
| `/offline` | Eventos sin conexión por revisar, aprobación y descarte. |
| `/enrollments`, `/sync`, `/health` | Como en la iteración 1. |

### 4.3 Protocolo

Sigue `v: 1`; todo es aditivo y el firmware v0 sigue funcionando.

| Mensaje | Dirección | Estado |
|---|---|---|
| `display.message` | servidor | Disponible (2 líneas de 16 caracteres ASCII, persistido y reenviado al reconectar) |
| `hello` con `capabilities`, `deviceTime` y `queued` | dispositivo | Disponible, opcional |
| `offline.snapshot` | servidor | Disponible, solo si el lector declara `offline` |
| `offline.events` | dispositivo | Disponible, lotes de 1 a 50 con `ack` por evento |
| Estado de periféricos | dispositivo | **Pendiente** (iteración 3) |

Contrato en `docs/protocolo_v0.md`; guía del modo sin conexión en
`docs/modo_sin_conexion_firmware.md` (puntos C1 a C11 pendientes de confirmación
del equipo de firmware).

### 4.4 Panel web

| Rol | Pantallas |
|---|---|
| Asistente y administrador | Ahora (en vivo por SSE), Registro manual, Enrolar, Órdenes y alarma, Dispositivo, Horarios, Por revisar (eventos sin conexión) |
| Solo administrador | Resumen, Periodos, Horarios (edición), Estudiantes (importación CSV, consentimiento, baja, supresión), Historial, Auditoría, Reportes y Usuarios |

Reportes con seis pestañas (afluencia, asistencia, permanencia, tardes,
alarmas y calidad), detalle por estudiante y exportación a CSV con BOM, `;` y
hora de Bogotá. El panel y la API se sirven como subdominios del mismo dominio.

### 4.5 CLI y simulador

- **CLI:** `gym device message` (mensaje en la pantalla), `device register`,
  `device rotate` y revocación del token por lector, y `gym student erase`.
- **Simulador:** consola de mensajes de pantalla y modo sin conexión (cola
  local, snapshot, reconciliación al reconectar).

### 4.6 Producción y seguridad

- HTTPS con Caddy y `wss://`; guía de `wss` y NTP para el firmware.
- Token propio por lector, con rotación y revocación.
- Respaldo y restauración (`deploy/backup.sh`, `deploy/restore.sh`), que se niega
  a pisar una base con datos; ejemplo de `cron`.
- Rotación de la clave de cifrado de plantillas, con interrupción y reanudación.
- Supresión de datos (anonimiza y elimina la plantilla), con auditoría.
- Cabeceras de seguridad y CSP en el panel; candado de líder para las tareas
  periódicas con más de una instancia.
- Rechazo en producción de claves y contraseñas de ejemplo.
- Runbook de operación y revisión de seguridad (`npm audit` y búsqueda de
  secretos).

### 4.7 Datos y migraciones

Catorce migraciones nuevas, sobre las seis de la iteración 1 (20 en total):

| Hito | Migraciones |
|---|---|
| H6 | `student_display_name`, `student_contact`, `schedule_student_validity`, `event_log_actor_and_report_indexes` |
| H7 | `panel_users_auth_sessions` |
| H9 | `h9_periods`, `h9_student_consent`, `h9_import_batches` |
| H11 | `h11_schedule_validity_backfill`, `h11_device_tokens`, `h11_key_version`, `h11_erasure_alerts` |
| H12 | `h12_attendance_source_offline`, `h12_offline_tables` |

Tablas nuevas: `panel_users`, `auth_sessions`, `periods`, `service_exceptions`,
`import_batches`, `offline_snapshots` y `offline_events`.

Datos de muestra de desarrollo: `npm run seed:dev` deja la base local con 30
estudiantes, 5 horarios, 172 asistencias y los usuarios `admin.demo` y
`asistente.demo` (ver `docs/datos_de_muestra.md`).

---

## 5. Verificación y pruebas

Resultados de ejecutar los comandos el 7 de noviembre de 2026 (comandos rápidos)
o tomados del registro de verificación del cierre (comandos lentos, marcados).

| Verificación | Comando | Resultado |
|---|---|---|
| Harness | `rei check --quiet` | Exit 0 |
| Lint y typecheck servidor | `npm --prefix server run lint`, `tsc --noEmit -p server/tsconfig.json` | Pasan (el lint avisa de advertencias, sin errores) |
| Unitarias servidor | `npm --prefix server test` | 98 archivos, 944 pruebas |
| Unitarias `shared` | `npm run test -w shared` | 5 archivos, 167 pruebas |
| CLI y simulador | `npm run test -w cli -w simulator` | CLI: 15 archivos y 114 pruebas; simulador: 13 archivos y 100 pruebas |
| Lint y typecheck CLI y simulador | `npm run lint -w cli -w simulator`, `npm run typecheck -w cli -w simulator` | Pasan |
| Panel | `npm --prefix web test`, lint y typecheck | 16 archivos, 173 pruebas; `gen:api:check` pasa; lint y typecheck pasan |
| E2E servidor (V4) | `npm --prefix server run test:e2e` | 14 archivos, 397 pruebas (según el registro del cierre) |
| Escenarios | `npm run test:scenarios` | 21 archivos, 488 pruebas; B12 y B17 impresos como pendientes de despliegue; B13 solo con `--db` (según el registro del cierre) |
| Panel en navegador (V12) | `npm --prefix web run test:e2e` | Pasa, Playwright con Chrome (según el registro del cierre) |
| Build del panel (V13) | `NEXT_PUBLIC_API_URL=http://localhost:3001 npm --prefix web run build` | Pasa (según el registro del cierre) |
| Migración (V14) | `npm run test:migration` | Pasa, base desechable (según el registro del cierre) |
| Reportes en base real (V15) | `npm --prefix server run test:reports-db` | Pasa (según el registro del cierre) |
| Operaciones (V16) | `npm --prefix server run test:ops-db` | Pasa; incluye respaldo y restauración, B13 (según el registro del cierre) |
| Carga (V19) | `npm run test:load` | Pasa, 2 ejecuciones, unos 10 s (según el registro del cierre) |
| Secretos (V18, parcial) | `deploy/scan-secrets.sh` | Limpio (según el registro del cierre) |

Los escenarios de aceptación B1–B17 están mapeados a su prueba en
`docs/escenarios.md`, con una guardia que falla si falta uno. B12 (reinicio con
`wss`) y B17 (subdominios y CORS) son manuales y solo pueden demostrarse en un
despliegue de prueba; B13 requiere PostgreSQL. A1–A12 de la iteración 1 siguen
sin cambios.

---

## 6. Decisiones clave

Seis decisiones del dueño del producto (antes registradas en un archivo aparte,
ya integradas aquí):

- La baja de un estudiante es irreversible y elimina la huella; la supresión
  anonimiza y conserva las sesiones para los reportes. Por la Ley 1581 no hay
  reactivación: para volver a entrar se registra y se enrola de nuevo; la
  supresión se hace con `gym student erase` o desde el panel.
- Salir y volver a entrar no está permitido (`ALREADY_EXITED`).
- La exportación es solo CSV (CSV con BOM, `;` como separador y fechas en hora de
  Bogotá, que Excel abre directamente).
- La importación no sobrescribe estudiantes existentes: el documento repetido es
  un error de esa fila.
- El modo sin conexión (ventana de 72 h) queda listo pero sin probar hasta contar
  con el ESP32 real: el servidor y el simulador ya lo cubren
  (`docs/modo_sin_conexion_firmware.md`), pero la atomicidad de LittleFS, la hora
  tras un reinicio sin red y la deriva del reloj solo se verifican con hardware.
- El estado de los periféricos lo reportará el ESP32 con un mensaje aditivo, en
  la iteración 3.

Decisiones de diseño del backlog (secciones 3 y 5):

- **Un periodo por semestre**, con días sin servicio; las ocurrencias de cada
  horario se generan solo en días con servicio.
- **Panel y API en subdominios del mismo dominio**, sin dominio escrito en el
  código (todo por variables de entorno); si no, la cookie se trata como de
  terceros.
- **Hora del servidor** para decidir; en el modo sin conexión se conserva la hora
  del dispositivo y se reconcilia ordenando por `ts`, `seq` e `id`.
- **Cuentas locales** creadas por el administrador; sin recuperación por correo.
- **Protocolo aditivo:** las capacidades nuevas se activan solo si el lector las
  anuncia en `hello`.

---

## 7. Documentación entregada

| Documento | Contenido |
|---|---|
| `docs/manual_asistente.md`, `docs/manual_administrador.md` | Uso del panel por rol. |
| `docs/despliegue.md` | Despliegue en VPS, variables y pendientes externos. |
| `docs/runbook.md` | Operación: respaldo, restauración, rotación de clave, supresión y alertas. |
| `docs/autenticacion.md` | Cuentas, sesiones, roles, CSRF y CORS. |
| `docs/guia_wss_firmware.md` | `wss`, token por lector y sincronización de hora (NTP) para el firmware. |
| `docs/modo_sin_conexion_firmware.md` | Contrato, cola, reconciliación, puntos C1–C11 y lista de verificación. |
| `docs/mensajes_pantalla.md` | Catálogo de la pantalla LCD de 16 × 2. |
| `docs/escenarios.md` | Escenarios A1–A12 y B1–B17 y su mapa a pruebas. |
| `docs/datos_de_muestra.md` | `seed:dev`: protecciones, qué borra y qué crea. |
| `docs/estado_firmware.md` | Estado de cada mensaje del protocolo. |
| `backlog_iteracion_2.md` | Backlog e hitos de la iteración. |

---

## 8. Cómo probarlo

```bash
nvm use
npm install
cp .env.example .env        # DEVICE_TOKEN, ADMIN_API_KEY, ENCRYPTION_KEY
docker compose up -d
npm run migrate
npm run seed:dev -- --confirm gymtime   # datos de muestra (solo desarrollo)
npm run dev:server                      # API en 3001
```

En otra terminal:

```bash
npm run install:web
npm run dev:web                         # panel en http://localhost:3000
SIM_DEVICE_TOKEN=<DEVICE_TOKEN> npm run simulator
```

Usuarios de muestra y contraseñas: `docs/datos_de_muestra.md`. Pruebas:

```bash
npm run test:scenarios                  # A1-A12 y B en memoria (-- --db añade B13)
npm run test:load                       # prueba de carga de una hora simulada
```

---

## 9. Trazabilidad de commits

| Commit | Entrega |
|---|---|
| `d1e2e2c` | `display.message`, catálogo LCD y preparación de datos (H6). |
| `d5bbe29` | Cuentas, sesiones y roles del servidor (H7). |
| `ea35888` | Base del panel Next.js y panel del asistente (H8). |
| `bd48705` | Panel del administrador, periodos, importación CSV y consentimiento (H9). |
| `8c7abbc` | Reportes, métricas y resumen del administrador (H10). |
| `c552451` | Producción, tokens por lector y supresión de datos (H11). |
| `1b363a8` | Modo sin conexión, reconciliación y pantalla «Por revisar» (H12). |
| `b5ac0fa` | Cierre: escenarios, prueba de carga y datos de muestra. |

---

## 10. Pendiente y próximos pasos

| Pendiente | Nota |
|---|---|
| Prueba con el ESP32 real | Incluye `wss` con NTP y el modo sin conexión (C1–C11). |
| Estado de periféricos | Decisión 6: mensaje, tabla y pantalla aún no existen. |
| Despliegue real | Depende de proveedor y dominio; B12 y B17 pendientes. |
| Piloto | Una semana con lector real y grupo pequeño. |
| Datos reales | Formato de la lista de estudiantes de la universidad. |

El detalle y el orden sugerido están en la sección 12.

---

## 11. Observaciones conocidas

Del modo sin conexión (H12):

- No hay prueba automática del límite de frame de 64 KB (verificado a mano: el
  servidor cierra con 1009).
- La pantalla «Por revisar» solo tiene pruebas de componentes; el recorrido en
  navegador (V12) no la cubre.
- `findOfflineEffect` enlaza por (estudiante, tipo, `ts`, origen): dos eventos con
  distinto `id` y el mismo `ts` se enlazarían a una sola sesión, sin duplicar
  efectos.
- `capabilities` es un enum estricto: una capacidad desconocida en `hello`
  rechaza el mensaje entero; conviene confirmarlo con el firmware (C1, C10).
- Aprobar un evento aplica la sesión y luego lo marca; si hay una caída entre
  ambos pasos, reaprobar responde 409 `SESSION_ALREADY_OPEN` (recuperable).
- Los puntos C1–C11 figuran todos como «Pendiente».

De panel, reportes y producción (H9, H10, H11):

- `updateTimes` del repositorio Prisma no repite el filtro de historial que sí
  usa el borrado (riesgo teórico de carrera).
- V15 comprueba los índices con `enable_seqscan = off`; a este volumen
  PostgreSQL por defecto prefiere el recorrido secuencial.
- El filtro de texto local de una tabla del panel no se aplica a la exportación
  CSV (solo los filtros del servidor y el orden).
- El orden de texto del cliente (`localeCompare('es')`) y el del servidor
  (`Collator` con `numeric`) pueden diferir en cadenas con números.
- Al reconectar un lector con la alarma encendida, el servidor reenvía el
  `alarm.set` vigente; no es una orden nueva (hallazgo de la prueba de carga).

De los datos de muestra:

- `seed:dev --with-semester` carga el semestre simulado en una segunda
  transacción, posterior a la de la muestra principal: si fallara, la muestra
  principal ya estaría confirmada.

---

## 12. Propuesta para la iteración 3

La iteración 2 deja el software completo y verificado sin hardware ni despliegue.
La iteración 3 lo valida en el mundo real. No agrega alcance: cada fila sale de
las decisiones, los pendientes de `docs/despliegue.md` o las observaciones de
esta iteración.

### 12.1 Depende del hardware (ESP32 real)

| Qué | Depende de | Criterio de salida |
|---|---|---|
| Confirmar C1–C11 de `docs/modo_sin_conexion_firmware.md` | Equipo de firmware | Los once puntos confirmados por escrito o ajustados. |
| Validar `wss` con sincronización NTP (`docs/guia_wss_firmware.md`) | Lector real y un despliegue | El lector conecta por `wss://` y mantiene la hora. |
| Recorrer la lista de verificación del modo sin conexión (sección 11 de la guía): atomicidad de LittleFS, hora tras reiniciar sin red, deriva del reloj, ventana de 72 h | Lector real | Las 15 pruebas con su resultado esperado. |
| Estado de periféricos por mensaje aditivo (decisión 6) | Acuerdo del mensaje con firmware | Mensaje, tabla y pantalla; sería una Feature con su propio spec. |

### 12.2 Despliegue de prueba (VPS y dominio temporales)

| Qué | Depende de | Criterio de salida |
|---|---|---|
| Desplegar con `deploy/docker-compose.prod.yml` | Proveedor y dominio | Panel y API en subdominios, con `/health` en verde. |
| Ejecutar B12 (reinicio con `wss`) y B17 (subdominios y CORS) de `docs/escenarios.md` | Despliegue; basta el simulador | Ambos procedimientos pasados y registrados. |
| Correr `npm run test:scenarios -- --db` (B13) en ese entorno | PostgreSQL del despliegue | B13 en verde. |

### 12.3 Depende de decisiones externas

| Qué | Depende de | Criterio de salida |
|---|---|---|
| Proveedor y dominio/DNS | La universidad | Decisión tomada (es la más temprana). |
| Texto oficial de consentimiento (hoy `v1-provisional`) y plazo de retención de respaldos y auditoría | La universidad y revisión jurídica de la supresión | Texto y plazo aprobados y cargados. |
| Monitoreo externo de `/health` | Proveedor | Alerta por correo o mensajería comprobada. |
| Piloto de una semana con lector real y grupo pequeño | Todo lo anterior | Informe del piloto. |
| Datos reales: formato de la lista de estudiantes | La universidad | Importador ajustado al formato real. |

Preguntas abiertas al dueño del producto (no se propone respuesta):

- ¿Cuál debe ser el margen de ingreso por horario?
- ¿Las sesiones que quedan abiertas deben cerrarse automáticamente, y cuándo?

### 12.4 Técnico opcional (no bloqueante)

| Qué | Nota | Criterio de salida |
|---|---|---|
| Playwright en CI | Hoy el flujo del panel (`web.yml`) ejecuta lint, typecheck, pruebas y build; Playwright (V12) se corre a mano. | V12 en el flujo de CI. |
| Respaldos programados con copia externa | El runbook da un ejemplo de `cron`; la copia externa es una decisión del proveedor. | Respaldo diario y restauración probada desde la copia. |
| Observaciones menores de H12 | Sección 11 de este reporte. | Cada una cerrada o descartada. |
| Purga de `event_log` | No existe política de purga; depende del plazo de retención. | Política decidida e implementada. |
| Corrida independiente de e2e, migración y Playwright | Los registros salen del entorno de desarrollo. | Las tres pasan en una máquina limpia. |

### 12.5 Orden sugerido

| Paso | Qué | Criterio de salida | Tipo de Work Item |
|---|---|---|---|
| 1 | Decisiones externas que desbloquean (proveedor y dominio) y envío de las guías al equipo de firmware | Proveedor y dominio definidos; guías entregadas | Sin Work Item |
| 2 | Despliegue de prueba con B12, B17 y B13 | Los tres escenarios pasados | Task |
| 3 | Validación con el ESP32 real: `wss` y C1–C11 primero, modo sin conexión al final | Lista de verificación completa | Task |
| 4 | Piloto de una semana (exige consentimiento, retención, monitoreo y datos reales) | Informe del piloto | Task |
| 5 | Mejoras técnicas, en paralelo desde el inicio | Cada mejora cerrada | Task (la purga de `event_log`, si se decide, sería Feature) |
| 6 | Estado de periféricos, tras confirmar el mensaje con firmware | Mensaje, tabla y pantalla | Feature |
