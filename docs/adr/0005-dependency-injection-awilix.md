# 0005. Dependency Injection con Awilix · Container explícito para el backend

- **Status:** accepted
- **Fecha:** 2026-04-22
- **Decisores:** @Juliohes + Claude Code
- **Relacionado con:** ADR-0004 (Arquitectura modular + SOLID + Patrones)

## Context

ADR-0004 establece que todo el backend migra a una arquitectura modular con Ports & Adapters y cumplimiento SOLID enforced por CI. La **Dependency Inversion** (D de SOLID) exige que las capas altas (controllers, services) no dependan de implementaciones concretas (pg, ioredis, OpenAI SDK, nodemailer), sino de **abstracciones**.

Hoy, cada fichero hace su propio `require('pg')` o `require('ioredis')` y construye clientes de forma ad-hoc. Consecuencias:

- **No se puede testear sin DB/Redis reales** (los mocks requieren hackear `require.cache`)
- **No se puede sustituir un adapter** (p.ej. cambiar OpenAI por Anthropic) sin editar los call sites
- **No hay gestión explícita del ciclo de vida** de clientes singleton (pool de pg, cliente Redis, nodemailer transporter)
- **Request context** (requestId, userId, tenantId) se pasa manualmente por parámetros o via `req.*`

Sin un contenedor DI, Ports & Adapters es papel mojado: aunque definamos `OcrPort` e implementemos `openai.adapter.js`, los controllers seguirían haciendo `require('./adapters/ocr/openai.adapter')` y perderíamos la inversión.

## Alternativas consideradas

1. **Sin DI — pasar dependencias manualmente a cada función** (arg drilling)
   - Pros: cero deps extras, cero magia
   - Cons: boilerplate masivo; cada controller recibe 5-8 args; refactor quirúrgico ante cambios; el `bootstrap.js` se vuelve un monstruo de 500 líneas cableando a mano

2. **Hand-rolled container** (objeto plano con getters lazy)
   - Pros: cero deps, trivial de entender
   - Cons: sin scopes (singleton vs per-request), sin detección de ciclos, sin lifecycle hooks; reinventar Awilix mal

3. **`inversify` ^6**
   - Pros: ecosistema TS maduro, decoradores
   - Cons: requiere `reflect-metadata` + decorators + probablemente TypeScript desde el día 1 (conflicto con ADR-0003 gradual); 250KB; sintaxis invasiva

4. **`typedi` ^0.x**
   - Pros: decoradores limpios
   - Cons: también pide TS nativo; menos mantenido; no encaja con migración gradual

5. **`awilix` ^10.x (decisión)**
   - Pros: JS puro compatible (no requiere TS ni decorators); API explícita (`asClass`, `asFunction`, `asValue`); scopes integrados (`SINGLETON`, `SCOPED`, `TRANSIENT`); `createScope()` per-request para inyectar `requestId`/`user`; maduro (100K+ DL/week, 10+ años, 0 CVE abiertas 2026-04-22); integración Express via `awilix-express` opcional
   - Cons: una dep extra (~30KB); curva de aprendizaje mínima

## Decision

Adoptar **Awilix 10.x** como contenedor DI del backend. Estructura:

### `src/container.js` (~80 líneas)

```js
// Crea y configura el container raíz.
// Los providers concretos se registran en bootstrap.js.
const { createContainer, InjectionMode } = require('awilix');

function createAppContainer() {
  return createContainer({
    injectionMode: InjectionMode.PROXY, // deps por destructuring
    strict: true,                        // falla loud si una dep no existe
  });
}

module.exports = { createAppContainer };
```

### `src/bootstrap.js` (~100 líneas — delega en módulos por capa)

Registra providers agrupados por capa. Cada capa tiene su archivo de registro para evitar que `bootstrap.js` crezca:

```
src/bootstrap/
├── index.js                  ← orquesta; registra todo en orden
├── infra.providers.js        ← pool pg, redis, mailer, logger
├── adapters.providers.js     ← OCR adapters, mail adapter, cache adapter
├── factories.providers.js    ← factories
├── repositories.providers.js ← repos (reciben pool inyectado)
├── services.providers.js     ← services (reciben repos + ports)
└── controllers.providers.js  ← controllers (reciben services)
```

### Scopes

| Scope | Ejemplos | Motivo |
|---|---|---|
| `SINGLETON` | `pool`, `redis`, `mailer`, `logger`, todos los adapters stateless, todos los services/repos | Creados una vez; ciclo de vida = proceso |
| `SCOPED` (per-request) | `requestId`, `user`, `auditContext` | `app.use((req,res,next) => { req.container = container.createScope(); req.container.register(...); })` |
| `TRANSIENT` | ninguno por defecto | Solo si un service necesita una instancia fresca por invocación |

### Patrón en controllers

```js
// controllers/uploads/confirm.controller.js
module.exports = function makeConfirmController({ confirmInvoiceService, logger }) {
  return async function confirmController(req, res) {
    const dto = req.validatedBody;   // del middleware Zod
    const result = await confirmInvoiceService.execute(dto, req.user);
    res.json(result);
  };
};
```

El router monta el controller resolviéndolo del scope:

```js
// routes/uploads.routes.js
router.post('/upload-confirm', validate(confirmSchema), asyncHandler((req, res) =>
  req.container.resolve('confirmController')(req, res)
));
```

### Patrón en services

```js
// services/invoices/confirm-invoice.service.js
module.exports = function makeConfirmInvoiceService({ uploadsRepo, auditService, logger }) {
  return {
    async execute(dto, user) {
      // lógica pura, deps inyectadas
    }
  };
};
```

### Patrón en repositories

```js
// repositories/uploads.repo.js
module.exports = function makeUploadsRepo({ pool }) {
  return {
    async findById(id) { /* pool.query(...) */ },
    async create(data) { /* pool.query(...) */ },
  };
};
```

## Consequences

### Positivo
- **Testabilidad real**: inyectar `{ pool: mockPool, logger: silentLogger }` en cualquier service — cero magia, cero `jest.mock`
- **Sustitución de adapters en 1 línea**: `container.register({ ocrEngine: asFunction(makeAzureAdapter) })`
- **Scopes per-request**: `requestId` y `user` disponibles en cualquier service sin pasarlos por cada firma
- **Ciclo de vida controlado**: `await container.dispose()` cierra pool/redis/mailer en SIGTERM (Round 15)
- **Type safety futuro** (ADR-0003): Awilix tiene `.d.ts` completo; `resolve<T>('name')` con TypeScript

### Negativo
- **Dep extra**: ~30KB en `node_modules`
- **Curva**: colaboradores deben entender `asClass/asFunction/asValue` + scopes
- **Debugging ligeramente más complejo**: stack traces pasan por Awilix resolver (mitigado con `strict: true`)
- **Ningún framework adoptado en el código actual**: no hay ejemplos previos en el repo a los que mirar (mitigado por los patrones documentados en ADR-0004 y este ADR)

### Seguimiento requerido
- Medir impacto en cold start (esperado <10ms con ~100 providers)
- Decidir si adoptar `awilix-express` en alguna fase futura (por ahora `req.container.resolve()` manual basta)
- Considerar un test `tests/container.test.js` que instancie el container y resuelva todos los providers para detectar deps no registradas en CI
