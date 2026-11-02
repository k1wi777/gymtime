# Requisitos — E0 Fundaciones del backend

Cubre E0-1 a E0-6 del backlog (§6). Modelo de datos: backlog §7.

## Entorno y herramientas (E0-1)

- **R1** — El sistema DEBE fijar la versión de Node (`.nvmrc` y `engines`) y declarar un único gestor de paquetes (npm) con workspaces en la raíz.
- **R2** — CUANDO se ejecuta `npm install` en la raíz en un clon limpio, el sistema DEBE instalar las dependencias del workspace `server` sin errores.
- **R3** — CUANDO se ejecuta `npm run lint` en la raíz, el sistema DEBE analizar `server` y terminar con código 0 en un árbol limpio.
- **R4** — CUANDO se ejecuta `npm run format` (y su variante de comprobación), el sistema DEBE aplicar (o verificar) un único estilo de formato en todo el código TypeScript.

## Base de datos local (E0-2)

- **R5** — CUANDO se ejecuta `docker compose up -d`, el sistema DEBE dejar una instancia de PostgreSQL accesible, con volumen persistente y healthcheck, usando credenciales coherentes con `.env.example`.

## Configuración (E0-3)

- **R6** — El sistema DEBE leer su configuración de variables de entorno (`.env`) y proveer `.env.example` con todas las variables, sin secretos reales. Variables: entorno, host, puerto, URL de la base de datos, token del dispositivo, clave de administrador, clave de cifrado AES-256-GCM y nivel de log.
- **R7** — SI falta o es inválida una variable obligatoria al arrancar, ENTONCES el sistema DEBE abortar el arranque con un mensaje que indique el nombre de cada variable defectuosa.
- **R8** — SI la clave de cifrado no decodifica a exactamente 32 bytes, ENTONCES el sistema DEBE rechazar el arranque con un mensaje que lo indique.
- **R9** — El sistema DEBE escuchar por defecto en `0.0.0.0` y en el puerto configurado, sin TLS.

## Datos (E0-4)

- **R10** — CUANDO se ejecuta `npm run migrate` sobre una base vacía, el sistema DEBE crear todas las tablas de la sección 7 del backlog con sus relaciones, claves únicas y enumeraciones de estado.
- **R11** — El sistema DEBE garantizar a nivel de base de datos que `students.documento` es único y que un estudiante tiene como máximo una huella activa.
- **R12** — El sistema DEBE ofrecer un servicio de acceso a base de datos inyectable que conecte al arrancar y cierre la conexión al apagar.

## Logging (E0-5)

- **R13** — El sistema DEBE emitir logs estructurados (JSON) con nivel, marca de tiempo y contexto, y el nivel DEBE ser configurable.
- **R14** — MIENTRAS el entorno sea de desarrollo, el sistema DEBE mostrar los logs en formato legible y con color en la terminal.
- **R15** — El sistema DEBE registrar cada petición HTTP con método, ruta, estado y duración, y DEBE omitir de los logs el token del dispositivo, la clave de administrador, la clave de cifrado y las plantillas de huella.

## Salud y documentación (E0-6)

- **R16** — CUANDO se solicita `GET /health`, el sistema DEBE responder 200 con estado y uptime, e indicar si la base de datos responde.
- **R17** — SI la base de datos no responde, ENTONCES `GET /health` DEBE responder 503 indicando el fallo.
- **R18** — El sistema DEBE publicar Swagger UI en `/docs` (y el JSON OpenAPI) con título, versión y esquema de autenticación por clave de administrador, listando `/health` y todo endpoint REST existente.
