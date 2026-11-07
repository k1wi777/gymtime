# Runbook de operación

Procedimientos del día a día y de emergencia. Cada comando de este documento se
probó contra el servidor real (ver `docs/despliegue.md`, sección «Verificación»).
Los ejemplos usan `docker compose` con `deploy/docker-compose.prod.yml`; en una
instalación sin Docker ejecuta los mismos comandos con `node` desde `server/`.

## 1. Arranque y migraciones

El contenedor del servidor aplica las migraciones pendientes al arrancar
(`prisma migrate deploy`) y luego inicia la API. Prisma serializa dos ejecuciones
simultáneas con un candado de la base, de modo que un despliegue con dos
contenedores solapados es seguro. `RUN_MIGRATIONS=false` las omite.

Las tareas periódicas (alarma, sincronización, vencimiento de enrolamientos,
reparación de ocurrencias, limpieza de sesiones, alertas de lector) las ejecuta
**una sola instancia**: la que obtiene el candado `pg_try_advisory_lock` en una
conexión propia a PostgreSQL. Si esa instancia cae, otra toma el candado en
`LEADER_RETRY_SECONDS` (10 por defecto). Requiere conexión directa a PostgreSQL;
PgBouncer en modo transacción rompe el candado. El log dice `leader_acquired` y
`leader_lost`.

## 2. Respaldo

```bash
DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/gymtime deploy/backup.sh
```

- Genera `gymtime-<fecha UTC>.dump` (formato custom de `pg_dump`), con permisos
  `600` en un directorio `700`, y lo verifica con `pg_restore --list`.
- `BACKUP_KEEP_DAYS` (30 por defecto; `0` conserva todo) borra los respaldos más
  antiguos. **La universidad debe confirmar el plazo de retención** (Pendientes
  externos en `docs/despliegue.md`).
- **El respaldo no contiene la clave de cifrado.** Las plantillas de huella van
  cifradas en el volcado; sin `ENCRYPTION_KEY` (y las anteriores de
  `ENCRYPTION_KEYS_RETIRED`) son irrecuperables. Guarda las claves **aparte** de
  los volcados, en un gestor de secretos o un sobre cerrado, y comprueba que
  puedes leerlas.
- Programa el respaldo (por ejemplo `cron` a diario) y copia los volcados fuera
  del servidor. La copia externa es una decisión del proveedor.

## 3. Restauración

```bash
createdb -h <host> gymtime_restore            # una base vacía
deploy/restore.sh backups/gymtime-20261106T030000Z.dump postgresql://.../gymtime_restore
```

`restore.sh` se niega a restaurar sobre una base con tablas y sobre la base que
indica `DATABASE_URL` (la de producción) salvo `--force`. Después aplica las
migraciones que falten. Para volver a producción: detén el servidor, restaura
en la base definitiva con `--force` (sabiendo que sustituye lo que haya) y
arranca con las **mismas claves** del momento del respaldo.

**Después de restaurar un respaldo anterior a una supresión de datos**, esos
datos reaparecen. Reaplica las supresiones:

```bash
gym student erase --id <uuid> --reapply --yes     # por cada estudiante suprimido
```

El panel lista como «Datos suprimidos» a los estudiantes anonimizados que
sigan en la base; los respaldos antiguos conservan los datos hasta que vencen
según la retención.

## 4. Rotación de la clave de cifrado

La clave se rota sin perder plantillas ni apagar el servicio. Hace falta una
ventana corta con **ambas** claves configuradas.

1. Haz un respaldo (sección 2) y guarda la clave vigente.
2. Genera la nueva: `openssl rand -base64 32`.
3. En el entorno del servidor: `ENCRYPTION_KEY=<nueva>`,
   `ENCRYPTION_KEY_VERSION=<versión anterior + 1>` y
   `ENCRYPTION_KEYS_RETIRED=<versión anterior>:<clave anterior>`. Reinicia el
   servidor: arranca solo si puede leer todas las plantillas con las claves
   configuradas; si falta una versión, falla con el número de versión.
4. Re-cifra: `docker compose exec server node dist/keys/rotate.js`
   (`--batch N` fija el tamaño del lote, `--limit N` se detiene tras N filas y
   se puede repetir; es idempotente y se puede interrumpir).
5. Comprueba: `docker compose exec server node dist/keys/rotate.js --verify`
   debe decir que todas las plantillas se leen con la clave actual **sola**.
6. Retira la clave anterior de `ENCRYPTION_KEYS_RETIRED` solo cuando ya no
   quede un respaldo que la necesite (los volcados anteriores a la rotación
   siguen cifrados con ella).

El script no imprime claves ni plantillas, y las claves nunca viajan por la API.

## 5. Tokens de lector

Cada lector tiene su propio token (se guarda solo su hash; el valor se muestra
**una vez**).

```bash
gym device register esp32-01      # alta: imprime el token una vez
gym device rotate esp32-01        # token nuevo; el anterior deja de valer y la conexión abierta se cierra (4410)
gym device revoke esp32-01 --yes  # nada vale hasta rotar; cierra la conexión
gym device status                 # columna token: own | legacy | revoked
```

Las tres acciones exigen rol administrador y quedan en la auditoría. Flashea el
token en el firmware (`docs/guia_wss_firmware.md`). `DEVICE_TOKEN` compartido
sigue valiendo solo para lectores sin token propio y no revocados, con un aviso
en el log (`legacy_token_used`): quítalo del entorno al terminar la transición.

## 6. Alertas de lector sin conexión

Un lector que se conectó alguna vez y lleva más de `DEVICE_OFFLINE_ALERT_MINUTES`
(5; `0` desactiva) sin conexión genera **una** alerta: aviso rojo y persistente
en el panel del asistente, evento `device.offline_alert` en el registro y en el
log. Al reconectar queda `device.recovered`. Qué hacer: revisar corriente y wifi
del lector (`docs/integracion_firmware.md`, sección 8) y, si hay clase en curso,
registrar manualmente las asistencias. El monitoreo **externo** (que avise si
cae el servidor entero) es un pendiente del despliegue.

## 7. Supresión de datos personales (Ley 1581)

```bash
gym student erase <documento> --yes
```

o el botón «Suprimir datos» en la ficha del estudiante (pide teclear el
documento). Elimina las plantillas y los enrolamientos, anonimiza nombre,
documento, nombre corto y programa, y conserva la fila y sus sesiones para que
los reportes sigan sumando. Pide al lector que borre la huella en la siguiente
sincronización. Queda `student.erased` en la auditoría, sin datos personales. Con la clave de API (la CLI) el actor de la auditoría es `system`, no una persona; desde el panel es la cuenta que la ejecuta.

## 8. Texto de consentimiento oficial

Mientras no haya texto oficial, el servidor usa el provisional (`v1-provisional`)
y avisa al arrancar en producción. Para cambiarlo:

1. Copia `docs/consentimiento.ejemplo.json`, pon la `version` y el `text` oficiales
   (50 a 4000 caracteres).
2. Móntalo en el contenedor y define `CONSENT_FILE=/config/consentimiento.json`.
3. Reinicia. Los estudiantes con otra versión deberán volver a registrar su
   consentimiento antes de enrolar.

## 9. Auditoría de dependencias y secretos

```bash
deploy/security-review.sh    # npm audit --omit=dev (raíz y web/); falla con alta o crítica
deploy/scan-secrets.sh       # archivos versionados e historial; nunca imprime el secreto
```

Una vulnerabilidad alta o crítica se corrige o se justifica por escrito antes
de publicar. Un secreto real obliga a rotarlo y limpiar el historial.

## 10. Alarma que no suena y servidor caído

**La alarma no suena** (termina el horario y la sirena calla):

1. `gym alarm status`: ¿dice `ON`, con qué motivo y para qué instancia?
2. `gym device status`: si el lector está desconectado o `pending` > 0, la orden
   `alarm.set` no se confirmó y se reenviará al reconectar.
3. `gym alarm on` enciende la sirena a mano; `gym alarm test` da el pitido corto.
4. Si el servidor la ordenó y el lector no suena, es del lector (GPIO o
   alimentación del buzzer): `docs/integracion_firmware.md`, sección 8.8.1.

**Servidor caído** (el panel dice «Desconectado» y `/health` no responde):

1. `docker compose ps` y `docker compose logs --tail 100 server`; reinicia con
   `docker compose up -d server`. Al volver, aplica migraciones y recupera solo.
2. Si la base no responde, revisa el contenedor `postgres` y el disco; no borres
   el volumen. Restaurar el último respaldo es el último recurso (sección 3).
3. Mientras tanto el lector funciona sin conexión con lo que tiene guardado y
   reconcilia después; el asistente anota a mano y registra luego con **Registro
   manual** (`docs/manual_asistente.md`, «Qué hacer si el panel dice
   «Desconectado»»).
4. Una alarma de fin de horario no suena si el servidor está caído en ese
   instante: avisa al asistente para que vigile el reloj.

## 11. Estudiantes inactivos sin evento de baja

La migración que corrige la vigencia (`20261106200000_h11_schedule_validity_backfill`)
cierra los intervalos usando la fecha del primer evento `student.deactivated`. Los
estudiantes dados de baja **antes** de que existiera el registro de eventos no se
tocan (no se inventa la fecha) y la migración los cuenta en un aviso. Para
revisarlos a mano:

```sql
SELECT s.documento, s.nombre, ss.schedule_id, ss.valid_from
  FROM students s
  JOIN schedule_students ss ON ss.student_id = s.id AND ss.valid_to IS NULL
 WHERE NOT s.activo
   AND NOT EXISTS (
     SELECT 1 FROM event_log e
      WHERE e.tipo = 'student.deactivated'
        AND e.detalle ->> 'studentId' = s.id::text);
```

Para cada fila decide la fecha real de la baja y ciérrala:
`UPDATE schedule_students SET valid_to = '<fecha>' WHERE student_id = '<id>' AND valid_to IS NULL;`
(nunca anterior a `valid_from`). Mientras no se cierren, los reportes cuentan
inasistencias de esos estudiantes.

## 12. Una sola instancia efectiva

El candado `pg_try_advisory_lock` cubre el **solapamiento de un despliegue** (el
contenedor viejo y el nuevo conviven unos segundos: solo uno ejecuta las tareas
periódicas) y el traspaso si el líder cae. **No convierte el servicio en un
clúster:** el limitador de inicio de sesión es en memoria y por instancia
(`docs/autenticacion.md`), y el diseño supone un solo servidor. Para escalar a
varias instancias activas habría que compartir ese limitador.

## 13. Respaldo programado (ejemplo)

`cron` (como el usuario que tiene `DATABASE_URL` en su entorno), a las 03:00:

```cron
0 3 * * * cd /opt/gymtime && DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/gymtime deploy/backup.sh >> /var/log/gymtime-backup.log 2>&1
```

o con `systemd`: `/etc/systemd/system/gymtime-backup.service`

```ini
[Service]
Type=oneshot
WorkingDirectory=/opt/gymtime
EnvironmentFile=/etc/gymtime/backup.env   # DATABASE_URL y BACKUP_DIR, modo 600
ExecStart=/opt/gymtime/deploy/backup.sh
```

y `gymtime-backup.timer` con `OnCalendar=*-*-* 03:00:00` y `Persistent=true`
(`systemctl enable --now gymtime-backup.timer`). Revisa que aparezcan volcados
nuevos y prueba una restauración periódicamente (sección 3).

## 14. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| El servidor no arranca y nombra `ENCRYPTION_KEYS_RETIRED` | Falta la clave de la versión indicada; agrégala y reinicia (sección 4). |
| `/docs` da 404 | Es lo esperado en producción; `ENABLE_DOCS=true` lo publica. |
| Todos los intentos de login parecen de la misma IP | `TRUST_PROXY` debe ser el número de proxies (1 con Caddy). |
| El panel se ve en blanco y la consola menciona CSP | La imagen del panel se construyó con otro `NEXT_PUBLIC_API_URL`; reconstrúyela por entorno. |
| Dos tareas periódicas duplicadas | Hay dos instancias y el candado no funciona: revisa que `DATABASE_URL` sea directa (sin PgBouncer en modo transacción). |
