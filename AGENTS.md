# AGENTS.md — REI Harness

> Este archivo es el **punto de entrada universal** para cualquier agente de IA que trabaje en este repositorio.
>
> Su objetivo es proporcionar únicamente el contexto esencial para orientarse dentro del proyecto y saber dónde encontrar información adicional. **No debe contener toda la documentación del proyecto.**
>Carga únicamente el contexto necesario para la tarea actual.
> Las responsabilidades específicas de cada rol se encuentran en `.rei/agents/`.
> Cada rol se define en `.rei/agents/<rol>.md` con frontmatter, un `## Contrato`
> autosuficiente y una `## Referencia` opcional; a los subagentes se les
> transmite únicamente el `## Contrato`. Consulta `.rei/docs/harness/adapters.md`.

**No ignores estas reglas.**

---

# 1. Antes de comenzar

Antes de realizar cualquier modificación en el proyecto:

1. Ejecuta `rei check --quiet`.
2. Si falla, DETENTE e informa el problema.
3. Carga únicamente la documentación necesaria para la tarea actual siguiendo el orden de la Sección 8.

No continúes hasta completar estos pasos.

---

# 2. Propósito del proyecto

## Qué construimos

**GymTime UniCórdoba** (nombre provisional) es un sistema de control de acceso y de tiempo de permanencia para el gimnasio institucional de la Universidad de Córdoba, que funciona por horarios de aproximadamente una hora con un grupo de estudiantes asignado a cada uno. Cada estudiante marca entrada y salida con su huella en un dispositivo ESP32; un servicio en la nube decide si es entrada, salida o rechazo, registra la asistencia y activa una alarma cuando termina el horario y aún hay gente adentro. Un panel web permite a los encargados controlar en vivo, hacer registros manuales y consultar métricas. Así el control del tiempo deja de depender de una persona vigilando el reloj.

Estado actual: iteración 2 completa (servidor, CLI, simulador, panel web para asistente y administrador, periodos, importación, reportes, producción y modo sin conexión; ver `backlog_iteracion_2.md` y `docs/decisiones_iteracion_2.md`). La iteración 3 depende del hardware (pruebas con el ESP32 real, estado de periféricos).

## Para quién

- **Estudiante:** pone su huella al entrar y al salir; no necesita nada más.
- **Asistente del gimnasio:** atiende el día a día desde el panel (quién está dentro, registros manuales, enrolar huellas, encender o apagar la alarma).
- **Administrador:** todo lo del asistente, más crear horarios, asignar estudiantes, ver métricas y administrar usuarios del panel.
- **Equipo de firmware:** consume el contrato del protocolo ESP32 ↔ servidor.

## Principios

*Todas las decisiones deben respetar estos principios.*

- **Solo huella** — los estudiantes se identifican únicamente por huella; el mismo lector sirve para entrada y salida.
- **Hora de salida fija por horario** — es igual para todos; entrar tarde no da más tiempo. Solo entran los estudiantes asignados al horario.
- **El servidor decide, el dispositivo ejecuta** — el ESP32 captura y muestra; excepcionalmente funciona sin conexión con lo que tiene guardado y reconcilia después.
- **Protocolo robusto** — WebSocket versionado con `ack` e idempotencia.
- **Protección de datos biométricos (Ley 1581)** — solo se guarda la plantilla (nunca la imagen), cifrada, con la clave fuera de la base de datos, con consentimiento registrado, auditoría y derecho a eliminación.
- **Bajo costo** — preferir soluciones simples y baratas.

## Qué NO es

*Fuera del alcance por ahora:*

- Cobros, pagos o membresías.
- Tarjetas, claves u otros métodos de identificación para los estudiantes.
- Aplicación móvil para estudiantes.
- Control de máquinas, casilleros o puertas.
- Más de un gimnasio o más de un dispositivo (el diseño deja la puerta abierta, pero el primer objetivo es uno).

---

# 3. Stack técnico

## Tecnologías principales

- **Lenguaje:** TypeScript en servidor, CLI, simulador y panel, con tipos compartidos.
- **Framework:** NestJS 12 (servidor); React (panel web); WebSocket `ws` nativo (sin Socket.IO); esquemas compartidos con zod.
- **Base de datos:** PostgreSQL (Docker en desarrollo) con Prisma.
- **Testing:** vitest 4 (unitarios y e2e con supertest); lint con oxlint; formato con prettier.
- **Despliegue:** local en la iteración 1; objetivo VPS pequeño o Railway/Render con HTTPS/`wss`.
- **Hardware:** ESP32 con lector de huellas AS608 (firmware a cargo de otro equipo, Arduino/PlatformIO).

Monorepo: workspaces npm `server/`, `cli/`, `simulator/` y `shared/`; el panel `web/` (Next.js) vive fuera de los workspaces con su propio `package.json`; además `deploy/` (producción) y `docs/`.

## Comandos principales

*Servidor, desde `server/` (npm).*

- `cd server && npm run start:dev` — Desarrollo.
- `cd server && npm test` — Tests unitarios.
- `cd server && npm run test:e2e` — Tests e2e (lentos).
- `cd server && npm run lint` — Linter.
- `cd server && npx tsc --noEmit` — Typecheck.
- `cd server && npm run build` — Build.

*Desde la raíz.*

- `npm run test:scenarios` — Escenarios A1-A12 y B (`-- --db` añade B13); `npm run test:load` — prueba de carga (V19).
- `npm run seed:dev` — Datos de muestra de la base local de desarrollo (pide confirmación; `docs/datos_de_muestra.md`).
- `npm run dev:server` (API en 3001) y `npm run dev:web` (panel en 3000); `npm run install:web` instala el panel.

*Panel, con `npm --prefix web`:* `run lint`, `run typecheck`, `test`, `run test:e2e` (Chrome real) y `run build` (con `NEXT_PUBLIC_API_URL`).

---

# 4. Estructura del repositorio

*Utiliza este mapa para orientarte dentro del proyecto.*

| Ruta | Propósito |
|------|-----------|
| `server/` | Servidor NestJS (API REST, WebSocket, Prisma); sus tests están en `server/src` y `server/test`. |
| `cli/`, `simulator/`, `shared/` | CLI `gym`, ESP32 simulado y esquemas compartidos (workspaces npm). |
| `web/` | Panel web Next.js (asistente y administrador); proyecto aparte. |
| `deploy/` | Compose de producción, Caddy, respaldo/restauración y revisión de seguridad. |
| `docs/` | Protocolo, guías de firmware, manuales, despliegue, escenarios y datos de muestra. |
| `.rei/specs/` | Work Items y planificación del REI Harness. |
| `.rei/progress/` | Estado actual (`current.md`), historial general (`history.md`) y detalle de Work Items. |
| `.rei/progress/work-items/` | Registros detallados de cada Work Item, organizados cronológicamente. |
| `.rei/docs/harness/` | Documentación del arnés (workflow, specs, progreso). |
| `.rei/docs/project/` | Documentación específica del proyecto. |
| `.rei/agents/` | Roles y comportamiento de los subagentes (frontmatter + `## Contrato` + `## Referencia`). |
| `.rei/adapters/` | Adaptadores de runtime (plantilla + mapa de herramientas); p. ej. `opencode/`. |
| `cmd/`, `internal/` | Código del CLI `rei` (Go). |
| `.rei/templates/` | Plantillas canónicas (`current.md`, `history.md`, `meta.json`). Fuente única de verdad. |

---

# 5. Workflow

Todo Work Item debe seguir el workflow definido por el proyecto.

Antes de comenzar cualquier trabajo consulta:

`.rei/docs/harness/workflow.md`

**No omitas ninguna etapa del workflow.**

### Modo directo autorizado

El **modo directo** es una vía fuera del workflow de Work Items —no un tipo ni un
estado— para que el Leader aplique un cambio trivial solicitado explícitamente.
Solo se activa si el usuario pide un «cambio directo» o «sin Work Item»; el
Leader nunca lo inicia por iniciativa propia.

- **Elegible:** documentación, erratas, formato, comentarios o ajustes triviales
  sin cambio de comportamiento.
- **Negativa:** si afecta comportamiento, seguridad, datos, dependencias, API
  pública, arquitectura, más de un archivo o necesita especificación o revisión,
  el Leader se niega y ofrece Task o Feature. La insistencia del usuario no es
  autorización: no hay override.
- **Autorización:** aun siendo elegible, el Leader pide confirmación explícita e
  informa de que no habrá planificación, rama ni registro. Si duda, avisa y exige
  esa confirmación; el defecto es **no** aplicar el modo directo.
- **Sin registro:** no crea Work Item, spec, `meta.json`, `current.md`,
  `history.md`, `direct.md`, sesión, issue ni rama, ni altera Work Items
  existentes; opera sobre la rama y el árbol actuales y su única traza es el
  diff/commit y la conversación.
- **Verificación:** siempre `rei check` y, según el cambio, los checks del
  proyecto declarados en `.rei/config.json`/`verification.md`; el Leader reporta
  comandos y resultado. Sin Reviewer salvo petición explícita del usuario.
- **Entrega:** sin una orden explícita no hay commit, push, PR ni merge.

Esta es la única excepción a «no omitas etapas» y a la prohibición de implementar
del rol Leader; el resto de reglas duras sigue vigente. Ver
`.rei/docs/harness/workflow.md`.

---

# 6. Rol del agente principal

El agente que recibe directamente las solicitudes del usuario actúa siempre como **Leader**.

Antes de comenzar cualquier tarea DEBE consultar:

`.rei/agents/leader.md`

El Leader es el único responsable de:

- comprender la solicitud del usuario;
- seleccionar el workflow adecuado;
- coordinar a los demás subagentes.

Ningún otro agente debe asumir estas responsabilidades.

Al delegar en un subagente, el Leader transmite únicamente la sección `## Contrato`
del rol correspondiente, nunca el archivo completo (`## Referencia` es detalle
opcional y no se envía). Si el runtime dispone de un adaptador nativo
(`rei init opencode`), el subagente recibe ese mismo Contrato como system prompt.

Si el usuario pide personalizar el proyecto (por ejemplo, «personaliza mi
proyecto»), el Leader NO crea un Work Item: delega directamente en el rol
`initializer` (`.rei/agents/initializer.md`) transmitiéndole su `## Contrato` y
espera a que finalice. En un runtime con adaptador nativo, el comando
`/personalize` ejecuta este mismo camino.

---

# 7. Documentación

Consulta únicamente la documentación necesaria para la tarea actual.

## Documentación de REI Harness

Define cómo funciona el arnés. No requiere personalización por proyecto.

| Si necesitas... | Consulta... |
|-----------------|-------------|
| Workflow | `.rei/docs/harness/workflow.md` |
| Spec Driven Development | `.rei/docs/harness/specs.md` |
| Sistema de progreso | `.rei/docs/harness/progress.md` |
| Estructura de `meta.json` | `.rei/docs/harness/meta.md` |
| Roles y adaptadores | `.rei/docs/harness/adapters.md` |
| El comportamiento de un agente | `.rei/agents/<role>.md` |

## Documentación del proyecto

Describe las reglas de **este repositorio**. Debe personalizarse al implementar REI Harness.

| Si necesitas... | Consulta... | Quién lo lee por defecto |
|-----------------|-------------|--------------------------|
| Arquitectura | `.rei/docs/project/architecture.md` | Implementer, Spec Author (diseño) |
| Convenciones | `.rei/docs/project/conventions.md` | Implementer |
| Verificación | `.rei/docs/project/verification.md` | Reviewer |

## Work Items

| Si necesitas... | Consulta... |
|-----------------|-------------|
| Un Work Item concreto | `.rei/specs/<work-item-id>/` |
| El comportamiento de un agente | `.rei/agents/<role>.md` |
No cargues documentación que no aporte contexto a la tarea actual.

---

# 8. Carga de contexto

Prioriza siempre la carga de información en el siguiente orden:

1. `AGENTS.md`
2. `.rei/agents/<role>.md`
3. `docs/...`
4. `.rei/specs/<work-item-id>/`

Carga únicamente el contexto necesario para completar la tarea actual.

---

# 9. Principios generales

Estas reglas aplican a cualquier agente del repositorio.

- La documentación es la fuente de verdad.
- Trabaja sobre un único Work Item por sesión. El **modo directo autorizado**
  (§5) es la excepción: no abre ni modifica Work Items ni sesión, y solo se usa
  con disparador y confirmación explícitos.
- No omitas etapas del workflow.
- Consulta la documentación antes de asumir comportamientos no especificados.
- Si encuentras documentación contradictoria, DETENTE y repórtala.
- Para conocer el estado de la sesión o de los Work Items, usa el CLI (`rei session`, `rei items status`); no escanees `meta.json` manualmente.
- No releas un archivo que ya esté en tu contexto; para localizar un dato concreto usa búsquedas en lugar de releer el archivo completo.
- En caso de conflicto entre documentos, prevalece el orden inverso de la Sección 8:
  `.rei/specs/<work-item-id>/` > `.rei/docs/...` > `.rei/agents/<role>.md` > `AGENTS.md`.
