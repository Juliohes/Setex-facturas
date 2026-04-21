# 0002. Estructura modular target: Strangler-Fig sobre `server.js` monolítico

- **Status:** accepted
- **Fecha:** 2026-04-21
- **Decisores:** @Juliohes + Claude Code

## Context

`app/backend/src/server.js` contiene 4081 líneas: todas las rutas HTTP, validaciones, queries SQL, middleware, integraciones con SMTP/OCR/Redis y lógica de negocio mezcladas. El fichero creció orgánicamente durante enero-abril 2026. Problemas concretos:

- **Riesgo de regresión alta** — un cambio pequeño puede afectar N endpoints no relacionados
- **Onboarding lento** — comprender el fichero entero lleva horas
- **Tests unitarios imposibles** — la lógica no está aislada en funciones puras
- **El CI ya marca** `max-lines: 500` como advertencia (exención temporal para server.js)
- **server.js** es el único fichero con exención de ESLint — huele mal

Fase 0 del MACROPLAN ya inició el refactor (P0-7) con los Rounds 1-5 completados. Falta cerrar Rounds 21b + 22.

## Alternativas consideradas

1. **Big-bang rewrite a Express Router + Controllers** — más rápido en tiempo de desarrollo total pero bloquea deploys 2-4 semanas y rompe la entrega al cliente.
2. **No refactorizar y aceptar la deuda** — bajo costo inmediato, alto costo incremental en cada release.
3. **Strangler-Fig pattern** (decisión) — extracción incremental en rounds, con `server.js` funcionando en paralelo hasta que queda vacío.
4. **Microservicios** — sobredimensionado para un producto de 5 usuarios y 1 mantenedor.

## Decision

Continuar el refactor **Strangler-Fig incremental** en 22 pasos, divididos en 5 rounds ya definidos en `docs/plans/MACROPLAN-SETEX-v2.0.md`.

### Estructura target (al cerrar Round 22)

```
app/backend/src/
├── app.js                   ← renombre de server.js, <100 líneas (solo bootstrap)
├── config/                  ← features.json + loader
├── middleware/              ← rate-limit, request-id, auth, error-handler
├── routes/                  ← Express Router por dominio
│   ├── auth.routes.js
│   ├── uploads.routes.js
│   └── admin.routes.js
├── controllers/             ← handlers HTTP finos (orquestan services)
├── services/                ← lógica de dominio (auth, audit, ocr, email, csrf)
│   ├── auth/
│   └── audit/
├── repositories/            ← Repository pattern sobre `pool` (ya 78 queries extraídas)
├── domain/                  ← calculators, parsers, validators puros
│   ├── validators/
│   ├── calculators/
│   └── parsers/
├── lib/                     ← errors, filename-generator, normalize-amount
└── ocr/                     ← multi-motor + validateCIF + validateIVA
```

### Progreso actual (cerrado Fase 0)

- ✅ Round 1 (PR #36): validators + lib — pasos 1-5
- ✅ Round 2 (PR #38): middleware + services/audit + domain — pasos 6-10
- ✅ Round 3 (PR #39): repositories — pasos 11-15 (78 queries extraídas)
- ✅ Round 4 (PR #40): config + services/auth — pasos 16-20
- ✅ Round 5 (commit 9226363): cableado paso 21a — 2026-04-20

### Pendiente Fase 1

- **Paso 21b** — cablear `services/auth` + `repositories` en las rutas existentes de server.js (reemplazar queries inline por llamadas a repo)
- **Paso 22** — eliminar shims + renombrar `server.js` → `src/app.js` (<100 líneas)

## Consequences

### Positivo
- Cero regresión durante los rounds (validado en Rounds 1-5: smoke OCR triple verde tras cada uno)
- Onboarding incremental: un nuevo colaborador puede leer `services/auth/` sin tocar el resto
- Tests unitarios viables en `domain/` y `services/` (puros, sin Express)
- ESLint `max-lines` aplicable a todos los ficheros tras Round 22
- Base clara para migración TypeScript (ADR-0003) módulo a módulo

### Negativo
- Periodo de convivencia de código duplicado (shims + nueva ubicación) durante el round
- Refactor requiere validación manual + smoke OCR en cada round
- `server.js` sigue siendo difícil de entender mientras se recorta

### Seguimiento requerido
- Paso 21b pendiente de programar (estimado 2 días en Fase 1)
- Paso 22 (renombre + cleanup) estimado 1 día post-21b
- Tras Round 22, eliminar exención ESLint de server.js/app.js
- Actualizar `docs/adr/` con el ADR-0004 si surge un nuevo patrón arquitectónico
