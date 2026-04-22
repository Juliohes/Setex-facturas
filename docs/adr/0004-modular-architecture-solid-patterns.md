# 0004. Arquitectura modular · SOLID explícito + patrones canónicos (Fase 1 MACROPLAN)

- **Status:** accepted
- **Fecha:** 2026-04-22
- **Decisores:** @Juliohes + Claude Code
- **Relacionado con:** ADR-0002 (Strangler-Fig), ADR-0005 (DI Container), MACROPLAN-SETEX-v2.0 Fase 1

## Context

El refactor iniciado en ADR-0002 (Strangler-Fig) avanzó Rounds 1-5 extrayendo `repositories/`, `services/auth/`, `services/audit/`, `domain/{validators,calculators,parsers}/` y `lib/`. Pese a ese progreso:

- **`server.js` sigue en 4308 líneas** (+227 desde 2026-04-21), 58 rutas HTTP
- **98 llamadas `pool.query(` permanecen en `server.js`** (Repository Pattern violado)
- **16 referencias directas a `redis.`/`ioredis` en `server.js`** (DIP violado)
- **`ocr/index.js` orquesta con `if openai / else if azure`** (OCP violado — añadir motor = editar monolito)
- **Directorios `controllers/`, `routes/`, `schemas/`, `services/{invoices,email}/` existen pero están vacíos** (skeleton sin contenido)
- **El plan v2 existente medía la calidad en líneas por fichero** (cuantitativo) sin atacar explícitamente SOLID ni los patrones ausentes

### Análisis SOLID (estado 2026-04-22)

| Principio | Estado | Evidencia |
|---|---|---|
| **S** — Single Responsibility | ❌ | `server.js` mezcla auth + uploads + OCR + admin + audit + email + security |
| **O** — Open/Closed | ❌ | Añadir motor OCR nuevo requiere editar `ocr/index.js` y `server.js` |
| **L** — Liskov | ⚠️ | Sin abstracciones/ports definidos, no aplicable hoy |
| **I** — Interface Segregation | ❌ | Sin contratos entre capas (ruta ↔ lógica ↔ persistencia) |
| **D** — Dependency Inversion | ❌ | Deps directas a `pg`, `ioredis`, `openai`, `@azure/ai-form-recognizer`, `nodemailer` |

### Análisis de patrones ausentes

| Patrón | Estado |
|---|---|
| Repository/DAO | Parcial (6 de ~11 repos) · 98 queries aún dispersas en `server.js` |
| Service Layer | Parcial (`auth`, `audit`, `viesValidator` existen) · faltan `invoices`, `email`, `security` |
| Controller (thin handler) | ❌ Ausente — la lógica HTTP vive en `app.post(...)` inline |
| Dependency Injection | ❌ Ausente — cada fichero resuelve sus propias dependencias con `require()` |
| Factory / Builder | ❌ Ausente |
| Ports & Adapters | ❌ Ausente |

## Alternativas consideradas

1. **Mantener `server.js` monolítico + seguir añadiendo features** — sigue acumulando deuda técnica; cada cambio aumenta blast radius; onboarding imposible. Descartada.
2. **Big-bang rewrite a microservicios** — sobredimensionado para 5 usuarios, 1 mantenedor. Descartada.
3. **Strangler-Fig cuantitativo (plan v2: <200 líneas por fichero, 15 rounds)** — progreso real pero no ataca explícitamente SOLID/OCP ni introduce DI. Ficheros pequeños mal acoplados siguen siendo mal diseño.
4. **Strangler-Fig cualitativo v3 (decisión) — SOLID explícito + patrones canónicos + DI + Ports/Adapters + enforcement CI** — superset de v2, añade rigor arquitectónico verificable.

## Decision

Adoptar la estructura **v3** como objetivo del refactor, aplicada en 16 rounds granulares sobre la rama `refactor/modular-architecture-2026-04-22` con deploy exclusivo a staging.

### Patrones canónicos adoptados

| Patrón | Dónde vive | Cómo se aplica |
|---|---|---|
| **Repository** | `src/repositories/*.repo.js` | Toda query SQL encapsulada en un método de repo. Regla CI: `pool.query` prohibido fuera de `repositories/` |
| **Service Layer** | `src/services/<dominio>/*.service.js` | Lógica de negocio pura, sin Express ni SQL directo. Recibe repos y ports por inyección |
| **Controller (thin)** | `src/controllers/<dominio>/*.controller.js` | 1 fichero por handler, ≤50 líneas cuerpo. Solo: validar DTO Zod → invocar service → serializar DTO respuesta |
| **Ports & Adapters (hexagonal light)** | `src/ports/*.port.js` + `src/adapters/<kind>/*.adapter.js` | Contratos JSDoc typedef en ports, implementaciones intercambiables en adapters |
| **Factory** | `src/factories/*.factory.js` | `OcrEngineFactory`, `EmailTransportFactory`, `LoggerFactory` — encapsulan selección/construcción |
| **Strategy** | `src/services/invoices/ocr-orchestration.service.js` | `OcrArbitrator` con estrategias `consensus`, `weighted`, `fallback` |
| **Builder** (opcional) | `src/services/invoices/invoice.builder.js` | Composición de factura desde OCR + validaciones + normalizaciones |
| **Dependency Injection** | `src/container.js` + `src/bootstrap.js` | Awilix 10.x — ver ADR-0005 |

### Mapeo SOLID → solución

- **SRP** → split en ~110 ficheros + ESLint `max-lines: 200` + `max-lines-per-function: 50` + JSDoc `@responsibility`
- **OCP** → nuevo motor OCR = crear 1 adapter en `adapters/ocr/` + registrar en factory. Cero edición de código existente
- **LSP** → tests de contrato por port (`tests/contracts/*.test.js`): mismo input → mismo shape; adapter que rompe contrato = CI rojo
- **ISP** → ports pequeños y focalizados (`OcrPort`, `MailPort`, `CachePort`, `QueuePort`, `StoragePort`, `AuthTokenPort`)
- **DIP** → DI container (ADR-0005). Controllers/services reciben dependencias inyectadas. Cero `require('pg')` fuera de `config/database.js` y `adapters/db/`

### Enforcement arquitectónico (Round 6)

1. **`eslint-plugin-boundaries` ^4.x** — declara capas `controllers → services → repositories → adapters → infra`. Salto = CI rojo
2. **`dependency-cruiser` ^16.x** (dev) — genera grafo + valida política en PR
3. **`tests/architecture.test.js`** — 5 invariantes auto-verificadas:
   - `controllers/**/*.js` no contiene `pool.query`
   - `repositories/**/*.js` no contiene `res.json`
   - Ningún fichero importa `server.js`
   - Cada `*.controller.js` tiene un `*.schema.js` emparejado en `schemas/`
   - Cada `*Port.js` tiene ≥1 adapter en `adapters/`
4. **Grep de humo en CI**:
   ```bash
   grep -rE "require.*['\"](pg|ioredis|openai|nodemailer|@azure/.+)['\"]" src/controllers src/services src/domain src/lib && exit 1
   ```

### Estructura target v3 (resumen)

```
src/
├── container.js            ← DI Awilix (ADR-0005)
├── bootstrap.js            ← registro providers
├── app.js                  (<60 líneas — compose Express)
├── server.js               (<40 líneas — listen + SIGTERM)
├── ports/                  ← contratos JSDoc typedef (NUEVO v3)
├── adapters/               ← implementaciones intercambiables (NUEVO v3)
│   ├── ocr/{openai,azure,gemini,paddle}.adapter.js
│   ├── mail/nodemailer.adapter.js
│   ├── cache/ioredis.adapter.js
│   ├── queue/inmemory.adapter.js
│   └── db/pg-pool.adapter.js
├── factories/              ← NUEVO v3
├── config/ middleware/ routes/ controllers/ services/
├── repositories/ domain/ lib/ schemas/
└── tests/
    ├── architecture.test.js
    └── contracts/*.test.js
```

### Plan de rounds (16)

Detalle completo en `docs/plans/MACROPLAN-SETEX-v2.0.md` sección "Refactor modular v3". Resumen:

- Round 1: rama + ADR-0004 + ADR-0005
- Rounds 2-3: `lib/`, `ports/`, `container.js`, `config/` split, adapters infra
- Rounds 4-5: `middleware/` completo + Zod
- Round 6: `repositories/` completados + enforcement (boundaries + architecture.test)
- Round 7: `adapters/ocr/*` + factory + OCR orchestration
- Round 8: `services/auth,email,security` + mail adapter/factory
- Rounds 9-14: `routes/` + `controllers/` por dominio
- Round 15: `app.js` + `server.js` finales + quitar exención ESLint
- Round 16: validación staging 24-48h

Cada round = 1 PR granular a `develop`. `deploy-prod.yml` NO se dispara durante la cadena. `main` permanece en v1.1.0 hasta validación.

## Consequences

### Positivo
- SOLID explícito y **verificable por CI** (no hay que confiar en la disciplina del autor)
- Añadir motor OCR nuevo = 1 PR de 1 fichero (OCP cumplido)
- Servicios testables sin Express ni DB real (inyección de mocks)
- `pool.query` confinada a `repositories/`: un cambio de schema afecta a 1 fichero, no a N
- Base lista para TypeScript (ADR-0003): tipar un port es trivial
- Onboarding: un colaborador puede leer `controllers/uploads/confirm.controller.js` + `services/invoices/*` y entender el flujo sin abrir `server.js`

### Negativo
- Curva de aprendizaje: colaboradores deben entender DI + Ports antes de contribuir
- Boilerplate inicial mayor (cada fichero pequeño requiere imports/exports)
- Refactor largo: ~15h trabajo efectivo + 16 PRs + validación staging 24-48h
- Periodo de convivencia largo: `server.js` coexistirá con la nueva estructura durante ~5-6 sesiones

### Seguimiento requerido
- Tras Round 15: tag `v2.0.0-rc1` en rama refactor + plan de promoción a `main`
- Medir cobertura de `architecture.test.js` en cada round (debe ser 100% al cerrar)
- Evaluar si frontend `app.js` (2000+ líneas) requiere ADR similar en Fase 2
- Tipado de queries (pg-to-ts vs drizzle vs kysely) permanece pendiente — se cubrirá en ADR futuro cuando arranque Fase 3 TypeScript
