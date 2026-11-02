# Convenciones

> **Documento del proyecto** — personaliza este archivo al adaptar REI Harness a tu repositorio.
>
> Este documento define las convenciones de desarrollo del proyecto.
> El Implementer debe seguirlas durante la implementación y el Reviewer las utilizará para validar la calidad del código.

---

# Objetivo

Mantener un estilo de desarrollo consistente en todo el proyecto.

Las convenciones describen **cómo escribir el código**, no cómo está organizada la arquitectura del sistema.

---

# Organización del código

- Un directorio por módulo en `server/src/<módulo>/` con `*.repository.ts`, `*.service.ts`, `*.controller.ts` y su `*.module.ts`.
- Interfaces de repository y entidades de dominio dentro del módulo; implementaciones Prisma y en memoria junto a ellas.
- Esquemas y tipos compartidos solo en `shared/`.
- Tests unitarios junto al código (`*.spec.ts`); e2e en `server/test/` (`*.e2e-spec.ts`).

---

# Nombres

- Código (identificadores, comentarios, nombres de archivos) en **inglés**; documentación en **español**.
- Archivos en kebab-case; clases y tipos en PascalCase; funciones y variables en camelCase; constantes y variables de entorno en UPPER_SNAKE_CASE.
- Commits en formato **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`...).
- **Una rama por Work Item.**

---

# Estilo de implementación

- Formato con prettier y lint con oxlint; el código debe pasar ambos.
- Funciones pequeñas con una única responsabilidad; sin duplicación.
- Inyección de dependencias de NestJS; los services dependen de interfaces de repository.
- Tests: unitarios con repository en memoria (sin base de datos); e2e solo donde haga falta.

---

# Manejo de errores

- Validar entradas en el borde (DTO/zod) y rechazar mensajes inválidos con códigos de error explícitos del protocolo (por ejemplo `ALREADY_EXITED`).
- Usar excepciones HTTP de NestJS en controllers; no tragar errores silenciosamente.
- Nunca registrar plantillas biométricas, claves ni tokens en logs.

---

# Dependencias

- Reutilizar las existentes antes de añadir otras; justificar toda dependencia nueva en el Work Item.
- Evitar librerías innecesarias, especialmente en el firmware y el simulador.

---

# Comentarios

- Comentar el porqué de decisiones no evidentes (reglas de horario, protocolo), no lo que el código ya dice.
- Eliminar comentarios obsoletos.

---

# Qué NO hacer

Documenta aquellas prácticas que deben evitarse en este proyecto.

Ejemplos:

- duplicar lógica;
- dejar código muerto;
- mantener código comentado;
- utilizar nombres ambiguos;
- ignorar errores;
- añadir dependencias sin justificación.
