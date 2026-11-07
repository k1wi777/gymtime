# Despliegue a producción

Este Work Item entrega **artefactos y guías**; no despliega nada. Lo que depende
de terceros está en «Pendientes externos» al final.

## Qué se entrega

| Archivo | Para qué |
|---|---|
| `server/Dockerfile`, `server/docker-entrypoint.sh` | Imagen de la API (contexto: la raíz del repositorio). Aplica migraciones al arrancar; falla con un mensaje claro si falta `DATABASE_URL`. |
| `web/Dockerfile` | Imagen del panel (contexto: `web/`). Exige `--build-arg NEXT_PUBLIC_API_URL`. |
| `deploy/docker-compose.prod.yml` | PostgreSQL + API + panel + Caddy; solo Caddy publica puertos. |
| `deploy/Caddyfile.example` | HTTPS automático y proxy de `wss`; un salto de proxy (`TRUST_PROXY=1`). |
| `deploy/.env.production.example` | Variables de producción (sin valores). |
| `deploy/backup.sh`, `deploy/restore.sh` | Respaldo y restauración (`docs/runbook.md`). |
| `deploy/verify-images.sh` | Construye ambas imágenes y las prueba (V17). |
| `deploy/security-review.sh`, `deploy/scan-secrets.sh` | Auditoría de dependencias y de secretos (V18). |
| `.github/workflows/server.yml`, `web.yml` | CI con filtros de rutas. |

## Pasos (con el proveedor ya elegido)

1. **Servidor** con Docker y Compose, un dominio y los registros DNS `api.<dominio>`
   y `app.<dominio>` apuntando a él.
2. **Imágenes.** La del panel es **una por entorno** porque `NEXT_PUBLIC_API_URL`
   se incrusta al construir (y también en la CSP):
   ```bash
   docker build -f server/Dockerfile -t gymtime-server .
   docker build --build-arg NEXT_PUBLIC_API_URL=https://api.<dominio> \
     -f web/Dockerfile -t gymtime-web web
   ```
3. **Configuración.** `cp deploy/.env.production.example deploy/.env.production`
   y completa cada valor (`openssl rand -base64 32` para los secretos);
   `cp deploy/Caddyfile.example deploy/Caddyfile` con tu dominio.
   `CORS_ORIGINS=https://app.<dominio>` y `COOKIE_DOMAIN=.<dominio>`.
   **Con `NODE_ENV=production` el servidor se niega a arrancar** si
   `ADMIN_API_KEY`, `DEVICE_TOKEN`, `FIRST_ADMIN_PASSWORD`, `ENCRYPTION_KEY` o la
   contraseña de `DATABASE_URL` conservan un valor de ejemplo (`change-me*`,
   `gymtime_dev_password`, bytes repetidos...); la lista está en `docs/runbook.md` §5.
4. **Arranque.**
   ```bash
   cd deploy
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d
   ```
5. **Primer administrador:** define `FIRST_ADMIN_USERNAME` y `FIRST_ADMIN_PASSWORD`
   la primera vez, entra al panel, cambia la contraseña temporal y quita ambas
   variables.
6. **Lectores:** `gym device register <id>` por cada uno y flashear su token
   (`docs/guia_wss_firmware.md`); después **retira `DEVICE_TOKEN`** y reinicia: el
   token compartido solo es una transición y el servidor lo avisa mientras exista
   (procedimiento en `docs/runbook.md` §5).
7. **Respaldos:** programa `deploy/backup.sh` y guarda las claves aparte
   (`docs/runbook.md`).

El servidor avisa al arrancar en producción si `TRUST_PROXY=0`, `COOKIE_DOMAIN`
o `CORS_ORIGINS` están vacíos, si usa el token compartido o el texto de
consentimiento provisional.

## Lista de verificación previa al piloto

- [ ] `rei check` y las pruebas lentas V4, V12–V17 en verde (`verification.md`).
- [ ] `deploy/security-review.sh` sin alta ni crítica; `deploy/scan-secrets.sh` limpio.
- [ ] HTTPS válido en `api.` y `app.`; el panel entra sin errores de CSP.
- [ ] `/health` responde; `/docs` da 404.
- [ ] Un lector real conectado por `wss` con su token propio (`gym device status`).
- [ ] Respaldo hecho, **restaurado en una base de prueba** y claves guardadas aparte.
- [ ] Texto de consentimiento oficial cargado (o el provisional aceptado por escrito).
- [ ] Alerta de lector sin conexión probada (apagar el lector y esperar el umbral).
- [ ] Monitoreo externo avisando al responsable.

## Verificación de este Work Item

Se ejecutó contra el servidor real (puerto 3001, panel en 3000, base desechable):
registro, rotación y revocación de token con el simulador; rotación de la clave
de cifrado sin perder plantillas; respaldo y restauración en una base limpia;
supresión de datos con retiro de la huella del lector; baja de un estudiante que
cierra su vigencia y baja las inasistencias de los reportes; cabeceras y CSP del
panel sin errores en consola. El detalle está en el `impl.md` del Work Item.

## Pendientes externos

Dependen de terceros y **no** están resueltos por el código:

1. **Proveedor de alojamiento** (VPS pequeño, Railway o Render) y su costo.
2. **Dominio y DNS** de la universidad (`api.` y `app.`).
3. **Texto oficial de consentimiento** de la Ley 1581, aprobado por la universidad
   (hoy el servidor usa el provisional `v1-provisional`).
4. **Plazo de retención** de los respaldos y de la auditoría, confirmado por la
   universidad.
5. **Monitoreo externo** (un servicio que sondee `https://api.<dominio>/health` y
   avise por correo o mensajería).
6. **Piloto** con el lector real, un grupo pequeño y una semana de observación.
7. **Equipo de firmware:** adopción de `wss://` y del token propio
   (`docs/guia_wss_firmware.md`).
8. **Copia externa de los respaldos** (fuera del servidor).
