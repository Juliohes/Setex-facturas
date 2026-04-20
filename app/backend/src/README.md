# Estructura del backend SETEX

> Este directorio está en **transición** hacia la estructura objetivo del Strangler-Fig refactor.
> Documento de referencia: `docs/plans/MACROPLAN-SETEX-v2.0.md` (sección 7).

## Estructura actual (2026-04-20, Fase 2 iniciada)

```
src/
├── server.js              ⚠️ MONOLITO (3992 líneas) — en proceso de vaciado
├── config/                ✅ parcial
│   ├── index.js
│   ├── features.json
│   └── security.json
├── domain/                🆕 PURA (sin side effects)
│   ├── validators/
│   │   ├── nif.js         ✓ extraído paso 1/22
│   │   └── iva.js         ✓ extraído paso 2/22
│   ├── calculators/       📦 placeholder
│   └── parsers/           📦 placeholder
├── lib/                   🆕 UTILIDADES AGNÓSTICAS
│   ├── errors.js          ✓ paso 3/22 (clases AppError)
│   ├── filename-generator.js  ✓ paso 4/22
│   └── normalize-amount.js    ✓ paso 5/22
├── ocr/                   ✅ ya modular (heredado, shims a domain/)
│   ├── index.js           (orquestador)
│   ├── openai.js
│   ├── azure.js
│   ├── validateCIF.js     SHIM → domain/validators/nif.js
│   └── validateIVA.js     SHIM → domain/validators/iva.js
├── services/              📦 placeholder (F2 semana 2-3)
│   ├── auth/
│   ├── invoices/
│   ├── email/
│   ├── audit/
│   ├── ocr/               (expansión del actual)
│   └── vies/
├── repositories/          📦 placeholder (F2 semana 2)
├── routes/                📦 placeholder (F2 semana 4)
├── controllers/           📦 placeholder (F2 semana 3-4)
├── middleware/            📦 placeholder (F2 semana 2)
├── schemas/               📦 placeholder (F2 con Zod)
├── db/
│   └── migrations/        📦 placeholder
└── queue/                 ✅ ya existe
```

## Reglas de capas

### domain/ — LÓGICA PURA
- **0 side effects**, **0 imports externos** (excepto stdlib), **100% testeable**
- Validadores (NIF/CIF, IVA), calculators, parsers
- Si una función aquí llama a BD/HTTP → **mal sitio, va a services/**

### services/ — ORQUESTACIÓN CON EFECTOS
- Llama a repositories (BD), APIs externas, email, etc.
- **Nunca SQL directo** — usa repositories
- **Nunca HTTP req/res** — eso es job de controllers
- Recibe tipos del dominio, devuelve tipos del dominio

### repositories/ — ACCESO A DATOS
- **Única capa que toca la BD** (`pool.query`)
- Métodos explícitos: `findByEmail`, `create`, `update`, etc.
- Sin lógica de negocio — mapea entre BD y objetos de dominio

### controllers/ — HTTP HANDLERS
- Valida input con Zod (schemas/)
- Llama a 1-3 services
- Devuelve response HTTP (JSON + status code)
- **Nunca** lógica de negocio aquí

### routes/ — CABLEADO HTTP
- `router.post('/login', authController.login)` y ya está
- Sin lógica

### middleware/ — CROSS-CUTTING
- Authenticate, rate-limit, audit, csrf, request-id

### lib/ — UTILIDADES AGNÓSTICAS
- Funciones genéricas reusables entre proyectos
- Sin dependencias del dominio SETEX

## Reglas operativas

1. **Tamaño máximo**: 500 líneas por archivo (ESLint `max-lines: 500`)
2. **Función máxima**: 80 líneas (ESLint `max-lines-per-function: 80`)
3. **Imports**: siempre relativos desde `src/` (ej: `require('../domain/validators/nif')`)
4. **Tests**: cada archivo en `src/domain/` o `src/services/` debe tener su `.test.js` gemelo

## Estado refactor Strangler-Fig

Ver `docs/plans/MACROPLAN-SETEX-v2.0.md` sección 8 y sección 17.

**Pasos completados**: 5/22 (2026-04-20 staging)
**Próximos**: extractCIFOnly parser, calculador totales factura, arbitrator OCR.
