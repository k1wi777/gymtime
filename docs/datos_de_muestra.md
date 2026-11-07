# Datos de muestra de desarrollo (`seed:dev`)

Un solo comando deja la base **local de desarrollo** con un conjunto completo y
reproducible para que el panel y todos los reportes se vean con datos.

```bash
npm run seed:dev -- --dry-run                  # muestra qué se borra y qué se crea; no cambia nada
npm run seed:dev -- --confirm gymtime          # ejecuta (el valor es el nombre de la base)
npm run seed:dev                               # en una terminal pide escribir el nombre de la base
npm run seed:dev -- --confirm gymtime --today 2026-11-07   # fija «hoy» (reproducible)
npm run seed:dev -- --confirm gymtime --with-semester      # además el semestre simulado SIM- de seed:reports (en una segunda transacción, posterior a la de la muestra principal: si fallara, la muestra principal ya está confirmada)
```

## Protecciones

- Nunca corre con `NODE_ENV=production`.
- Solo contra un host local (`localhost`, `127.0.0.1`, `::1`; el host `postgres` de Docker se rechaza) y una base llamada `gymtime` o cuyo nombre contenga `demo`, `seed`, `test` o `dev`. No hay variable para saltarse la regla.
- Sin confirmación (nombre de la base) solo describe. Muestra la base como `host:puerto/base` (sin credenciales), los conteos por tabla y los documentos de estudiantes y ids de dispositivos que se borrarán.
- Las migraciones pendientes (aditivas) se aplican antes; el borrado y la carga ocurren en **una transacción**: si algo falla, queda todo como estaba.
- No lee ni imprime secretos, no modifica `.env` y no usa `TRUNCATE` ni borra el esquema.

## Qué se BORRA y qué se CONSERVA

Se vacían, con `DELETE` en orden de claves foráneas, estas tablas: `offline_events`, `offline_snapshots`, `alarm_events`, `attendance_sessions`, `schedule_students`, `schedule_instances`, `schedules`, `service_exceptions`, `periods`, `enrollments`, `device_slots`, `device_commands`, `fingerprints`, `processed_messages`, `students`, `import_batches`, `auth_sessions`, `panel_users`, `devices` y `event_log`. Una prueba falla si el esquema recibe una tabla nueva que no esté en la lista.

Se conserva el esquema, la tabla `_prisma_migrations`, `.env` y las claves, las demás bases y los respaldos.

## Qué se CREA (documentos `DEMO-####`, fechas relativas a hoy en Bogotá)

- 30 estudiantes: 21 activos con consentimiento y huella de muestra, 3 con consentimiento sin huella, 3 activos sin consentimiento, 2 de baja y 1 anonimizado por supresión; todos con documento, nombre, nombre corto, programa, correo y teléfono (ficticios, dominio `demo.example.edu`).
- 1 periodo activo (8 semanas atrás y 6 adelante) con dos intervalos sin servicio, uno pasado y uno futuro.
- 4 horarios semanales (lunes 06:00, martes 18:00, miércoles 06:00, jueves 18:00) y 1 puntual de ayer, con asignaciones vigentes, una reasignada y dos bajas intermedias; ocurrencias según las reglas del periodo.
- Asistencias históricas (entradas tardías, salidas manuales, entradas manuales con motivo, `no_registrada`), alarmas cerradas por salida, botón, CLI y tiempo, y una alarma local del lector.
- 1 lote de importación, el dispositivo `esp32-sim-01` (sin sesiones abiertas), 9 eventos sin conexión (2 en «Por revisar», 1 aprobado) y entradas de auditoría con su actor (solo ids).
- No hay sesiones abiertas ni asistencia de hoy: para ver *Ahora* en vivo use el simulador (`npm run simulator`).

## Usuarios del panel (solo desarrollo)

| Usuario | Rol | Contraseña |
|---|---|---|
| `admin.demo` | administrador | `Demo-Admin-2026` |
| `asistente.demo` | asistente | `Demo-Asistente-2026` |

Son públicas y válidas únicamente en bases locales: el comando se niega a correr en otras, y en producción el servidor rechaza contraseñas que empiecen por `demo-`. No las cree nunca en un servidor real.

## Huellas de muestra

Cada plantilla son 512 bytes **aleatorios** cifrados con el mecanismo y la clave vigentes (`ENCRYPTION_KEY`): no hay biometría real y no coinciden con ningún dedo. Sirven para que el panel marque «con huella» y la sincronización cargue plantillas; en un lector real nunca producirán coincidencia.

## Dispositivo y token

`esp32-args` (una prueba manual anterior) se borra y se siembra `esp32-sim-01`, el identificador por defecto del simulador, **sin token propio**: conecta con el `DEVICE_TOKEN` de desarrollo que ya está en `.env`. Para probar token propio: `gym device register esp32-sim-01`. Nunca se siembra ningún token.

## Repetir

Dos ejecuciones con el mismo `--today` dejan el mismo conjunto (salvo el IV y la etiqueta del cifrado, aleatorios por diseño). Sin `--today` las fechas se desplazan con el día de ejecución.
