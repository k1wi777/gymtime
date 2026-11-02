# Verification

> **Documento del proyecto** — personaliza este archivo al adaptar REI Harness a tu repositorio.
>
> Este documento define cómo se verifica que un Work Item ha sido implementado correctamente.
>
> El objetivo no es indicar **qué** se implementó, sino **cómo demostrar que funciona**.

## Estrategia de verificación

Cada Work Item se verifica con lint, typecheck y tests unitarios (checkpoints rápidos). La verificación completa (e2e y build) es lenta y se ejecuta solo cuando el usuario la pida. Siempre que sea posible, verificar solo el módulo afectado (por ejemplo `cd server && npx vitest run src/<módulo>`). Todos los comandos se ejecutan desde la raíz del repositorio o con `cd server`.

---

## Checkpoints de verificación

_Indica los comandos que normalmente deben ejecutarse antes de considerar un Work Item listo para revisión._

Cada checkpoint posee un identificador estable (`V1`, `V2`, ...). El Implementer y el Reviewer deben referenciar estos IDs en sus reportes en vez de describir la verificación de forma libre.

Los checkpoints se dividen en **rápidos** y **lentos** según su costo.

### Checkpoints rápidos (se declaran en `.rei/config.json`)

Verificaciones de bajo costo que pueden ejecutarse muchas veces al día (linter, type-check, tests rápidos). `rei check` se ejecuta de forma constante —al iniciar sesión, al implementar y al revisar—, así que **aquí no deben ir checks lentos**.

| ID | Comando | Descripción |
|----|---------|-------------|
| `V1` | `npm --prefix server run lint` | Linter (oxlint con type-aware) sobre `src/` y `test/` |
| `V2` | `npm --prefix server test` | Tests unitarios (vitest) |
| `V3` | `node_modules/.bin/tsc --noEmit -p server/tsconfig.json` | Typecheck de `server` |

### Checkpoints lentos (NO van en `.rei/config.json`)

Build completo, e2e, integración, etc. Se ejecutan en CI o manualmente, se documentan aquí y se referencian en la evidencia, pero **no se declaran en `.rei/config.json`**.

| ID | Comando | Descripción |
|----|---------|-------------|
| `V4` | `npm --prefix server run test:e2e` | Tests e2e (muy lentos); solo bajo petición del usuario |
| `V5` | `npm --prefix server run build` | Build de producción de `server`; solo bajo petición del usuario |

> Los checkpoints rápidos se declaran en `.rei/config.json`:
>
> ```json
> {
>   "checks": [
>     { "id": "V1", "description": "<qué valida>", "command": ["<cmd>", "<arg>"] }
>   ]
> }
> ```
>
> `rei check` ejecuta cada `command` (sin shell intermedio) y refleja su resultado en el código de salida. Si añades o modificas un checkpoint, actualiza también `.rei/config.json`.

> **Recomendación de personalización:** cuando el proyecto lo permita, prefiere verificar solo el módulo o los módulos afectados por el Work Item en lugar de la suite completa. REI Harness no impone cómo invocarlos porque es agnóstico al lenguaje y al framework de test.

---

## Evidencia

_Describe qué evidencia debe dejar el Implementer para demostrar que el trabajo fue verificado._

Como mínimo, por cada checkpoint ejecutado:

- ID del checkpoint (`V1`, `V2`, ...);
- resultado (pasa / falla);
- comando ejecutado;
- observaciones relevantes (logs, capturas, validaciones manuales) cuando el checkpoint no sea automatizable.

La evidencia debe documentarse en:

```
.rei/progress/work-items/<work-item-id>/impl.md
```

---

## Bloqueos

Un Work Item pasa a `blocked` cuando alguna verificación falla y no puede resolverse dentro del alcance de la sesión.

El protocolo exacto para declarar un bloqueo (qué documentar, dónde, y cómo detenerse) está definido en el archivo de rol correspondiente (`.rei/agents/implementer.md`, `.rei/agents/reviewer.md`).

Nunca continúes la implementación ni solicites revisión ignorando una verificación fallida.

---

## Qué NO hacer

- No asumir que un cambio funciona sin verificarlo contra los checkpoints definidos.
- No omitir checkpoints definidos para el proyecto.
- No solicitar revisión sin evidencia suficiente por cada checkpoint.
- No describir una verificación de forma libre si ya existe un ID (`V1`, `V2`, ...) para ella.
