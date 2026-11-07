# Escenarios de aceptación (A1-A12 y B1-B17)

Un solo comando ejecuta los escenarios que no necesitan despliegue:

```bash
npm run test:scenarios           # A1-A12 y los B en memoria; sin PostgreSQL ni hardware
npm run test:scenarios -- --db   # además B13 (npm run test:ops-db; requiere PostgreSQL)
```

Al final imprime una tabla por escenario (`ok`, `FAILED`, `MISSING`) y la lista de
los que **solo pueden demostrarse en el despliegue de prueba** (B12 y B17): no se
simulan ni se dan por pasados. El código de salida es distinto de cero si falla
cualquier prueba o si falta la prueba de un B.

El mapa B → prueba vive en `server/test/scenarios/b-map.ts` (una sola fuente). La
prueba `server/test/scenarios/b-map.e2e-spec.ts` falla si falta algún B1-B17, si
un archivo o título del mapa no existe o si la tabla de abajo difiere del mapa:
al cambiar una, cambie la otra. Las aserciones de `a1-a12.e2e-spec.ts` no se
modifican.

## A1-A12 (iteración 1)

Archivo: `server/test/scenarios/a1-a12.e2e-spec.ts` (simulador real, servidor en
memoria, reloj controlado). Comando: `npm run test:scenarios`. Entorno: memoria.

| # | Escenario | Resultado esperado |
|---|---|---|
| A1 | Enrolar la huella de un estudiante | Plantilla guardada y cifrada; listo para sincronizar |
| A2 | Estudiante asignado pone la huella dentro del horario | `entry` y sesión abierta |
| A3 | El mismo estudiante pone la huella otra vez | `exit` y sesión cerrada |
| A4 | Huella desconocida | `unknown` |
| A5 | Estudiante que no pertenece al horario | `denied` con `NOT_IN_SCHEDULE` |
| A6 | Escaneo sin horario en curso | `denied` con `NO_ACTIVE_SCHEDULE` |
| A7 | Horario que termina con alguien adentro | Alarma continua a la hora de fin |
| A8 | Sale el último con la alarma encendida | Alarma apagada |
| A9 | Se apaga la alarma por botón o CLI | Alarma silenciada y sesiones `no_registrada` |
| A10 | Conexión caída y mensaje duplicado | Órdenes entregadas al volver; el duplicado no se procesa dos veces |
| A11 | Horario que termina con todos fuera | Aviso corto de 5 s y se apaga sola |
| A12 | Dos horarios seguidos | Cada grupo se registra en su horario |

## B1-B17 (iteración 2)

Columnas: prueba(s) que lo demuestran, comando y entorno. «memoria» = servidor con
repositorios en memoria; «PostgreSQL» = base desechable; «despliegue de prueba» =
solo a mano contra el despliegue real.

| # | Escenario | Pruebas | Comando | Entorno | Resultado esperado |
|---|---|---|---|---|---|
| B1 | Inicio de sesión de administrador y de asistente | `server/src/auth/auth.controller.spec.ts`, `server/test/permissions.e2e-spec.ts` | `npm run test:scenarios` | memoria | Cada uno ve solo lo de su rol; el asistente recibe 403 en administración |
| B2 | Periodo con días sin servicio y horario recurrente | `server/src/schedules/periods/periods.service.spec.ts`, `server/src/schedules/periods/occurrence-dates.spec.ts` | `npm run test:scenarios` | memoria | Se generan las ocurrencias y se omiten los días sin servicio |
| B3 | Importar un CSV con filas inválidas | `server/src/students/import/student-import.service.spec.ts` | `npm run test:scenarios` | memoria | Vista previa con errores; se importan solo las válidas |
| B4 | Alta manual de un estudiante | `server/test/scenarios/b4-student-assign.e2e-spec.ts`, `server/src/students/students.controller.spec.ts` | `npm run test:scenarios` | memoria | Aparece en el listado y puede asignarse a un horario |
| B5 | El asistente mira el panel mientras el simulador escanea | `server/test/scenarios/b5-live.e2e-spec.ts`, `server/test/permissions.e2e-spec.ts` | `npm run test:scenarios` | memoria | El flujo de eventos entrega entrada y salida sin recargar (la parte del navegador es V12, `web/tests/e2e/ahora.spec.ts`) |
| B6 | Enrolar una huella desde el panel | `server/test/enrollment.e2e-spec.ts` | `npm run test:scenarios` | memoria | Pasos en vivo; queda cifrada y con el consentimiento registrado |
| B7 | Registro manual desde el panel | `server/src/attendance/attendance.controller.spec.ts`, `server/test/permissions.e2e-spec.ts` | `npm run test:scenarios` | memoria | Queda con motivo y con el usuario en la auditoría |
| B8 | Alarma y mensaje en pantalla desde el panel | `server/test/display.e2e-spec.ts`, `server/src/alarm/alarm.controller.spec.ts` | `npm run test:scenarios` | memoria | La orden llega al simulador y su estado se ve |
| B9 | Reporte de inasistencias de un periodo | `server/src/reports/mini-semester.spec.ts`, `server/src/reports/reports.service.spec.ts` | `npm run test:scenarios` | memoria | Cuenta solo a los asignados con vigencia en ocurrencias terminadas |
| B10 | Promedio de permanencia de un estudiante en un mes | `server/src/reports/mini-semester.spec.ts` | `npm run test:scenarios` | memoria | Coincide con el cálculo manual y excluye `no_registrada` |
| B11 | Exportar un reporte a CSV | `server/src/reports/reports.controller.spec.ts`, `server/src/reports/csv-export.spec.ts` | `npm run test:scenarios` | memoria | El CSV coincide con la respuesta de la pantalla |
| B12 | Despliegue con `wss` y reinicio del servicio | — | manual | despliegue de prueba | El dispositivo se reconecta y las sesiones abiertas se conservan; el panel se reconecta solo |
| B13 | Restaurar un respaldo en una base limpia | `server/scripts/verify-ops-db.sh` | `npm run test:scenarios -- --db` | PostgreSQL | El sistema funciona con la clave de cifrado respaldada |
| B14 | Supresión de un estudiante | `server/test/erasure.e2e-spec.ts` | `npm run test:scenarios` | memoria | Plantilla eliminada, anonimizado y fuera del lector en la siguiente sincronización |
| B15 | Modo sin conexión | `server/test/scenarios/b15-offline.e2e-spec.ts` | `npm run test:scenarios` | memoria | Sesiones con las horas originales; conflictos «por revisar» |
| B16 | Rotar el token de un dispositivo | `server/test/device-token.e2e-spec.ts` | `npm run test:scenarios` | memoria | El token anterior deja de funcionar y el nuevo conecta |
| B17 | Panel y API en subdominios distintos | — | manual | despliegue de prueba | Inicio de sesión, cookie y stream funcionan; un origen no permitido es rechazado |

### Procedimientos manuales (solo en el despliegue de prueba)

**B12 — reinicio con `wss`.** Con el lector (o el simulador apuntando a `wss://`) conectado
y una sesión abierta: reinicie el servicio de la API (`docker compose restart server`).
Esperado: el dispositivo se reconecta solo y recibe sus órdenes pendientes; la sesión
abierta sigue en *Ahora*; el panel recupera el flujo en vivo sin recargar.

**B17 — subdominios reales.** Con el panel en `https://app.<dominio>` y la API en
`https://api.<dominio>` (`CORS_ORIGINS` y `COOKIE_DOMAIN` configurados, ver
`docs/despliegue.md`): inicie sesión, compruebe que la cookie se envía a la API y que
*Ahora* recibe eventos; luego pida a la API desde otro origen
(`curl -H 'Origin: https://otro.example' -i https://api.<dominio>/health`).
Esperado: sin cabeceras `access-control-allow-origin`. Respaldo en memoria (no
sustituye la prueba): `server/test/permissions.e2e-spec.ts` (cookie, CORS, stream).

## Prueba de carga ligera (V19)

```bash
npm run test:load
```

Una hora de operación simulada (reloj controlado) con dos horarios consecutivos de 30
estudiantes: entradas y salidas, reenvíos con el mismo `id`, tres estudiantes que no
salen. Comprueba que todo mensaje recibe `ack`, que cada estudiante tiene exactamente
una sesión por horario, que la alarma se ordena una sola vez por horario y que con dos
instancias solo la líder la ordena y la otra retoma sin repetirla. Corrección, no
rendimiento: no mide umbrales. **Límite:** dos instancias sobre memoria; la elección de
líder real con PostgreSQL la cubre `npm run test:ops-db` (V16). No forma parte de
`rei check` (es el checkpoint lento V19).
