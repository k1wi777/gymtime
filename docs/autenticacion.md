# Autenticación, roles y sesiones del panel

Guía para el equipo del panel web y para quien opere el servidor. Cubre la
iteración 2, hito H7.

## 1. Dos credenciales

| Credencial | Quién la usa | Rol efectivo | Actor en la auditoría |
|---|---|---|---|
| Cabecera `x-api-key: <ADMIN_API_KEY>` | La CLI `gym` y los scripts | `admin` | `system` |
| Cookie de sesión `gt_session` | El panel web (personas) | `asistente` o `admin` | `user` con el id de la cuenta |

- Toda ruta HTTP exige una de las dos, salvo `GET /health`, Swagger (`/docs`,
  `/docs-json`) y `POST /auth/login`. La autorización **deniega por defecto**:
  una ruta nueva sin regla explícita exige una sesión de cualquier rol.
- Una `x-api-key` presente pero inválida da 401 aunque venga una cookie válida.
- El WebSocket `/device` no cambia: sigue autenticado solo con `DEVICE_TOKEN`.
- Las rutas de cuenta (`/auth/me`, `/auth/logout`, `/auth/password`) piden una
  sesión; con `x-api-key` responden 403 `ACCOUNT_REQUIRED` porque la clave de
  sistema no tiene cuenta.

## 2. Matriz endpoint × rol

Administración = estructura y datos maestros, o acciones destructivas.
Operación = lo que el asistente hace cada día en el gimnasio.

| Endpoint | Sin credencial | Asistente | Admin | `x-api-key` |
|---|:-:|:-:|:-:|:-:|
| `GET /health`, `/docs`, `/docs-json`, `POST /auth/login` | sí | sí | sí | sí |
| `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` | 401 | sí | sí | 403 |
| `GET /users`, `POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password` | 401 | 403 | sí | sí |
| `GET/POST /students`, `PATCH /students/:id` | 401 | sí | sí | sí |
| `DELETE /students/:id` | 401 | 403 | sí | sí |
| `POST /students/:id/enrollments`, `POST /enrollments/:id/cancel`, `GET /enrollments/:id` | 401 | sí | sí | sí |
| `GET /attendance/open`, `GET /attendance/sessions`, `POST /attendance/entry`, `POST /attendance/exit` | 401 | sí | sí | sí |
| `GET /alarm/status`, `POST /alarm/on`, `/alarm/test`, `/alarm/off` | 401 | sí | sí | sí |
| `GET /devices/status`, `POST /devices/messages`, `POST /sync` | 401 | sí | sí | sí |
| `GET /panel/now`, `GET /panel/schedules/:id/roster`, `GET /panel/fingerprints` | 401 | sí | sí | sí |
| `GET /events` (SSE) | 401 | sí | sí | sí |
| `GET /schedules`, `GET /schedules/:id`, `GET /schedules/resolve` | 401 | sí | sí | sí |
| `POST /schedules`, `PUT/DELETE /schedules/:id/students/:studentId` | 401 | 403 | sí | sí |

La matriz está ejecutable en `server/test/permissions.e2e-spec.ts`: si alguien
añade una ruta y no la declara allí, la prueba falla. Un endpoint reservado al
administrador se marca en el código con `@Roles('admin')`; uno público, con
`@Public()`.

Códigos de error estables en el campo `code` de 401/403/429:
`INVALID_CREDENTIALS`, `FORBIDDEN_ROLE`, `PASSWORD_CHANGE_REQUIRED`,
`CSRF_REJECTED`, `ACCOUNT_REQUIRED`, `RATE_LIMITED`.

## 3. Sesión

1. `POST /auth/login` con `{ "username", "password" }` responde 200 con los
   datos de la cuenta (incluido `role` y `mustChangePassword`) y la cookie.
2. La cookie `gt_session` es `httpOnly`, `Path=/`, `Secure` cuando
   `NODE_ENV=production`, `SameSite` según `COOKIE_SAMESITE` (por defecto
   `Strict`) y `Domain` solo si `COOKIE_DOMAIN` está definido.
3. El valor son 32 bytes aleatorios; en la base solo se guarda su SHA-256
   (`auth_sessions.token_hash`), de modo que una fuga de la tabla no permite
   suplantar sesiones. La sesión es revocable.
4. Caduca a los 30 min sin actividad (`SESSION_IDLE_MINUTES`) o a las 8 h desde
   el inicio (`SESSION_MAX_HOURS`); entonces responde 401 y no se reactiva.
5. `POST /auth/logout` (204) revoca la sesión y borra la cookie.
6. `GET /auth/me` devuelve la cuenta de la sesión vigente: **el panel decide qué
   vistas mostrar por el `role` que devuelve**.

Un administrador puede desactivar una cuenta, restablecer su contraseña o
cambiarle el rol: lo primero y lo segundo cierran sus sesiones en el acto, y el
rol se lee de la base en cada petición.

## 4. Contraseñas, bloqueo y límite de tasa

- De 10 a 128 caracteres, distinta del usuario y de la actual. Se guardan solo
  como hash argon2id (`crypto.argon2` de Node ≥ 24.7, sin dependencias; 19 MiB,
  2 pasadas, sal propia, formato PHC).
- El administrador **no elige** la contraseña de otro: al crear una cuenta o
  restablecerla el servidor genera una temporal (16 caracteres) que se devuelve
  **una sola vez** (`temporaryPassword`, con `Cache-Control: no-store`) y no se
  guarda ni se audita. La cuenta queda con cambio obligatorio.
- Con la contraseña temporal solo responden `/auth/me`, `/auth/logout` y
  `/auth/password`; el resto da 403 `PASSWORD_CHANGE_REQUIRED`. Cambiar la
  contraseña (`POST /auth/password` con `currentPassword` y `newPassword`) quita
  la marca y revoca las demás sesiones de la cuenta.
- Un fallo de inicio de sesión responde siempre el mismo 401
  (`INVALID_CREDENTIALS`), sea porque el usuario no existe, está desactivado,
  está bloqueado o la contraseña es errónea, y tarda lo mismo (se verifica un
  hash de relleno cuando el usuario no existe).
- 5 fallos seguidos (`LOGIN_MAX_ATTEMPTS`) bloquean la cuenta 15 min
  (`LOGIN_LOCK_MINUTES`) aunque se teclee la contraseña correcta; los intentos
  durante el bloqueo no lo alargan, y un acierto reinicia el contador. El
  bloqueo vive en la base y sobrevive a los reinicios.
- Por IP: más de `LOGIN_RATE_LIMIT` intentos por minuto dan 429 con
  `Retry-After`, sin evaluar la contraseña. El contador está en memoria (hay una
  sola instancia). Detrás de un proxy define `TRUST_PROXY` con el número de
  saltos para que `req.ip` sea la del cliente.
- Un administrador no puede desactivarse ni cambiarse el rol a sí mismo (409
  `SELF_CHANGE_FORBIDDEN`).

## 5. CORS y CSRF

**CORS** (`CORS_ORIGINS`): lista de orígenes exactos (`scheme://host[:port]`,
sin `*` ni rutas), con credenciales, métodos `GET, POST, PUT, PATCH, DELETE,
OPTIONS`, cabeceras `content-type` y `x-gymtime-client`, `retry-after` expuesta
y preflight cacheado 10 min. Un origen no listado no recibe ninguna cabecera
CORS. `x-api-key` no se permite desde navegadores a propósito. Vacío (por
defecto) = ningún acceso entre orígenes.

**CSRF**: toda petición que modifica datos (POST, PUT, PATCH, DELETE) y no usa
`x-api-key` —incluido `POST /auth/login`— debe llevar:

- la cabecera `x-gymtime-client: panel`, y
- un `Origin` que sea exactamente uno de `CORS_ORIGINS` (el navegador lo envía
  siempre en estas peticiones).

Si falta alguna: 403 `CSRF_REJECTED` y la acción no se ejecuta. Se suma
`SameSite`. Las lecturas (GET) no se protegen. Las peticiones con `x-api-key`
no necesitan nada de esto (la cabecera no la envía el navegador sola).

Ejemplo con `fetch` desde el panel:

```ts
await fetch(`${process.env.NEXT_PUBLIC_API_URL}/students`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json', 'x-gymtime-client': 'panel' },
  body: JSON.stringify({ document: '100', name: 'Ana', consented: true }),
});
```

## 6. Tiempo real (SSE) y actividad

`GET /events` acepta la cookie desde un origen permitido
(`new EventSource(url, { withCredentials: true })`). El servidor envía un latido
`keepalive` cada 15 s, por lo que la conexión sobrevive minutos sin eventos.

- En cada latido revalida la sesión y **cierra el stream** si ya no es válida
  (cerró sesión, caducó o la cuenta se desactivó), como máximo 15 s después.
- El stream **no renueva** la inactividad: una pantalla abandonada caduca a los
  30 min. El panel debe llamar a `GET /auth/me` (o a cualquier endpoint) con la
  actividad real del usuario para mantener viva la sesión, y al cerrarse el
  stream o recibir un 401 llevar al usuario al inicio de sesión.
- Las conexiones con `x-api-key` no se revalidan.

Cada frame es `event: <tipo>` y `data: {type, at, data}`. Tipos: `device.connected`,
`device.disconnected`, `scan`, `command`, `alarm`, `keepalive` y, desde H8,
`attendance` (una sesión se abrió o cerró, por huella o a mano) y `enrollment`
(un enrolamiento cambió de estado o paso; nunca lleva la plantilla). Su forma
exacta está en `server/openapi.json` (`GET /events`, esquemas `*EventDto`).

## 7. Configuración

Todo sale de variables de entorno validadas al arrancar (el mensaje de error
lista las inválidas); no hay dominios en el código. Valores y defectos en
`.env.example`.

| Variable | Defecto | Notas |
|---|---|---|
| `COOKIE_DOMAIN` | vacío (host-only) | `.<dominio>` en producción para compartir entre subdominios |
| `COOKIE_SAMESITE` | `Strict` | `Lax` o `None`; `None` exige `NODE_ENV=production` |
| `CORS_ORIGINS` | vacío | orígenes exactos separados por comas |
| `SESSION_IDLE_MINUTES` / `SESSION_MAX_HOURS` | 30 / 8 | |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | 5 / 15 | |
| `LOGIN_RATE_LIMIT` | 10 | intentos por IP y minuto |
| `TRUST_PROXY` | 0 | saltos de proxy para `req.ip` |
| `FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD` | vacío | ver sección 8 |

`NEXT_PUBLIC_API_URL` **no la lee el servidor**: es la variable del futuro panel
Next.js con la URL base de la API.

Desarrollo local con el panel: panel en `http://localhost:3000`, API en
`http://localhost:3001` (`PORT=3001`) y `CORS_ORIGINS=http://localhost:3000`.
Producción: panel y API como subdominios del mismo dominio por HTTPS,
`COOKIE_DOMAIN=.<dominio>` y `CORS_ORIGINS=https://panel.<dominio>`.

## 8. Primer administrador y recuperación

1. Antes de arrancar con la tabla `panel_users` vacía, define
   `FIRST_ADMIN_USERNAME` y `FIRST_ADMIN_PASSWORD` (mínimo 10 caracteres; van
   juntas). Al arrancar se crea un `admin` con cambio de contraseña obligatorio
   y se audita como `user.bootstrap_admin`.
2. Inicia sesión, cambia la contraseña y **retira las dos variables**. Si ya
   existen cuentas se ignoran (y se avisa en el log, sin mostrar los valores).
3. **Si se pierde la única cuenta de administrador:** las variables no actúan
   con cuentas existentes. Es un procedimiento de soporte, con acceso a la
   base: vaciar `panel_users` (`DELETE FROM panel_users;`, que borra también las
   sesiones por cascada) y reiniciar con las variables definidas. Es el último
   recurso y deja rastro en la base, no en el panel.

## 9. Auditoría y datos sensibles

Se registra en `event_log` el inicio de sesión (correcto, fallido, bloqueo,
límite de tasa), el cierre, el cambio de contraseña y las altas, ediciones,
desactivaciones y restablecimientos (`auth.*`, `user.*`). Las acciones de
operación y administración hechas con cookie llevan `actor_type=user` y el id de
la cuenta; las de la CLI, `system`. Se añaden trazas de `enrollment.started`,
`enrollment.cancelled` y `sync.triggered`; la alarma ya dejaba
`alarm.manual_on` (con `reason` `MANUAL` o `TEST`) y `alarm.manual_off`.

Nunca se escriben en los logs ni en la auditoría las contraseñas (ni las
temporales), los hashes ni los valores de cookie o token: el redactor de logs
y el filtro de la auditoría los descartan, y los fallos de inicio de sesión no
guardan el usuario tecleado.
