# Arquitectura

> **Documento del proyecto** — personaliza este archivo al adaptar REI Harness a tu repositorio.
>
> Este documento define las decisiones arquitectónicas del proyecto.
> El Implementer debe respetarlas durante la implementación y el Reviewer las utilizará como criterio de validación.

---

# Objetivo

Describe cómo está organizado el proyecto y las reglas arquitectónicas que deben mantenerse durante su evolución.

No documenta requisitos funcionales ni decisiones específicas de una Feature.

---

# Principios

- Arquitectura modular: cada módulo con `repository`, `service` y `controller`.
- Las interfaces de repository viven en el dominio; hay una implementación Prisma y otra en memoria (usada en tests).
- La lógica de negocio vive en los services, nunca en controllers ni gateways.
- El servidor es la fuente de decisión (entrada, salida, rechazo); la hora usada es la del servidor.
- El esquema de mensajes se define una sola vez en `shared` (zod) y se reutiliza en servidor, CLI y simulador.
- Simplicidad antes que complejidad.

---

# Organización del proyecto

Monorepo TypeScript (hoy solo existe `server/`; el resto es el plan del backlog):

```text
server/      NestJS: API REST + gateway WebSocket + scheduler
cli/         Comandos de terminal (llaman al REST)
simulator/   ESP32 simulado en Node
shared/      Esquemas de mensajes (zod) y tipos compartidos
docs/        Contrato del protocolo y guía para el equipo de firmware
web/         Panel React (iteraciones posteriores)
```

Módulos del servidor (`server/src/<módulo>/`):

| Módulo | Responsabilidad |
|---|---|
| `devices` | Conexión WebSocket, autenticación, ack, reintentos, estado y órdenes pendientes |
| `students` | Datos de estudiantes |
| `fingerprints` | Plantillas cifradas, enrolamiento, asignación de slots |
| `schedules` | Horarios, listados, ventana de ingreso |
| `attendance` | Sesiones, decisión de entrada o salida, registro manual |
| `alarm` | Vigilancia de vencimientos, estado de la alarma, cierre automático |
| `admin` | Endpoints REST para la CLI, stream de eventos |

---

# Flujo general

```text
ESP32 (lector AS608) <--ws/wss + ack--> devices (gateway)
                                            ↓
                          attendance / fingerprints / schedules / alarm (services)
                                            ↓
                                   repository (Prisma | en memoria)
                                            ↓
                                       PostgreSQL

CLI / Panel web --REST--> admin / controllers --> services
```

---

# Restricciones arquitectónicas

- Los controllers y el gateway no acceden a Prisma directamente: solo a través de services y repositories.
- Los services dependen de interfaces de repository, no de la implementación Prisma.
- Un módulo no accede al repository de otro: usa su service.
- Prohibidas las dependencias circulares entre módulos.
- Las plantillas biométricas nunca se guardan ni se registran en claro; la clave de cifrado vive fuera de la base de datos (variable de entorno).
- Los mensajes del protocolo se validan con los esquemas de `shared`; no se duplican definiciones.
- Los tiempos se guardan en UTC y se muestran en America/Bogota.

---

# Decisiones importantes

- Backend NestJS con WebSocket `ws` nativo (sin Socket.IO) y PostgreSQL + Prisma.
- Protocolo versionado con `ack` e idempotencia; comparación de huellas en el lector, con plantillas sincronizadas por horario.
- Cifrado de plantillas AES-256-GCM; Ley 1581 aplica a los datos biométricos.
- Autenticación de dispositivo por token y de administración por clave en `.env` (iteración 1); roles y login en el panel en iteraciones posteriores.
- Transporte `ws://` sin TLS en red local en la iteración 1; `wss`/HTTPS en producción.
- Operación sin conexión: el ESP32 conserva el horario en curso y reconcilia con el servidor al reconectar.
- Fuentes detalladas: `detalles_de_software.md` y `backlog_iteracion_1_backend.md`.

---

# Qué NO documentar

Este archivo NO debe contener:

- requisitos funcionales;
- decisiones temporales;
- planificación de Features;
- detalles de implementación concretos;
- cambios específicos de un Work Item.
