# 0003. Migración gradual a TypeScript (Fase 3 MACROPLAN)

- **Status:** accepted
- **Fecha:** 2026-04-21
- **Decisores:** @Juliohes + Claude Code

## Context

El backend SETEX son ~6000 líneas JavaScript plano (Node 20 + Express). El frontend vainilla JS son ~2000 líneas. Durante enero-abril 2026 se han detectado bugs que TypeScript habría atrapado en tiempo de compilación:

- **Fix IRPF OCR (2026-04-21):** el schema JSON de OpenAI acepta `string | null` pero el código asumía `string` → comparación con `'0,0'` fallaba en `null`. Con TypeScript: `unknown | null` narrowing obligatorio.
- **Fix client-companies.repo.js (2026-04-21):** `approve()` usaba columnas inexistentes `approved_at`/`approved_by_email`. Con TypeScript + row types generados desde schema PostgreSQL (ej. `pg-to-ts`), imposible.
- **Bug watchdog containers pre-cutover:** strings hardcoded no validados. Con TypeScript + enum de container names, detectable en build.

La comunidad Node lleva años migrando (incluso AWS SDK, Express v5, etc.). TypeScript gradual (`allowJs: true`) es bajo coste de adopción.

ROADMAP Q3 del MACROPLAN ya identifica "TypeScript instalado `allowJs: true`" como item de Fase 2. En Fase 3 se profundiza.

## Alternativas consideradas

1. **Mantener JavaScript puro + JSDoc** — sin compilación, solo tipos como comentarios. Bajo coste pero beneficios limitados (IDE detecta menos, sin compilación real).
2. **Big-bang migration a `.ts`** — 3-4 semanas bloqueando features. Descartada.
3. **Migración gradual `allowJs: true` + `strict: false` inicial** (decisión) — TypeScript compila JS existente como está, ficheros nuevos se escriben en TS, migración módulo a módulo aprovechando Strangler-Fig.
4. **Migrar solo `domain/` y dejar el resto como JS** — híbrido permanente. Descartada por incoherencia.

## Decision

Adoptar **TypeScript gradual** con el siguiente plan (alineado con el MACROPLAN Fase 2-3):

### Paso 1 — Instalación (Fase 2, semana 2)

```bash
npm install --save-dev typescript @types/node @types/express @types/pg tsx
```

Crear `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "allowJs": true,
    "checkJs": false,
    "strict": false,
    "noImplicitAny": false,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

### Paso 2 — Módulos primeros a TS (Fase 2-3)

Ordenado por ROI descendente (alto impacto → bajo coste):

1. **`ocr/`** (`validateCIF.ts`, `validateIVA.ts`, `openai.ts`, `azure.ts`, `index.ts`) — funciones puras, tipos evidentes, caso de bug del IRPF
2. **`domain/`** (`validators/`, `calculators/`, `parsers/`) — ya están extraídos del Strangler-Fig
3. **`lib/`** (`errors.ts`, `filename-generator.ts`, `normalize-amount.ts`)
4. **`services/auth/`** (JWT, bcrypt, CSRF) — críticos para seguridad
5. **`repositories/`** (con row types generados desde schema PostgreSQL si se adopta `pg-to-ts`)
6. **`middleware/`**
7. **`routes/` + `controllers/`** (últimos: son los más acoplados a Express)
8. **`app.ts`** (ex `server.js`, ya renombrado tras Strangler-Fig Round 22)

### Paso 3 — Strict mode (Fase 4)

Cuando ≥80% del código sea `.ts`:

- `"strict": true` — activa `noImplicitAny`, `strictNullChecks`, etc.
- `"checkJs": true` — valida los `.js` restantes con JSDoc
- Migrar `.js` restantes a `.ts` uno a uno

### Frontend

Posponer frontend TypeScript a Fase 4 (se evaluará si migrar o reescribir con Vite + React/Svelte, fuera del alcance de este ADR).

## Consequences

### Positivo
- Tipos en boundaries críticos (OCR output, repo row shapes, DTOs de API) → bugs detectados en build
- IDE completion y refactor automático (renombres seguros)
- Base sólida para futuros colaboradores
- Alineación con el ecosistema actual (Express 5, Anthropic SDK, Playwright todos first-class TS)

### Negativo
- Añade un paso de build en el deploy (~5s de `tsc` o equivalente con tsx/esbuild)
- Los colaboradores deben conocer TypeScript básico (no es barrera alta)
- Deps `@types/*` sumarán ~50MB a `node_modules` — irrelevante
- Durante la migración gradual convive `.js` + `.ts` en el mismo árbol (confuso temporalmente)

### Seguimiento requerido
- Decidir tsconfig exacto cuando arranque Fase 2 (opinión del equipo sobre `strict`)
- Evaluar `pg-to-ts` vs `drizzle` vs `kysely` para tipado de queries (ADR-0004 pendiente)
- Ruta de rollback: `allowJs: true` permite quitar TS en cualquier momento simplemente compilando con `tsc --noEmit false` y distribuyendo los `.js` resultantes
- Medir tiempo real de build antes/después en CI
