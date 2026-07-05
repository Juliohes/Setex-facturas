# 0006. Vanilla JavaScript ES6+ como stack permanente (supersede ADR-0003)

- **Status:** accepted
- **Fecha:** 2026-05-06
- **Decisores:** @Juliohes + Claude Code
- **Supersede:** ADR-0003 (TypeScript gradual, 2026-04-21)
- **Relacionado con:** ADR-0001 (lint pipeline), ADR-0004 (modular SOLID), ADR-0005 (Awilix DI)

## Context

ADR-0003 (2026-04-21) estableció migración gradual a TypeScript con `allowJs: true` y plan en 8 módulos ordenados por ROI. La decisión se tomó tras detectar 2 bugs de tipado (IRPF OCR, client-companies.repo.js) en el primer trimestre 2026.

Tras 6+ meses de operación real del proyecto (entrega v1.0.0 al cliente, v1.1.0 multi-IVA, intento v2.0.0 con bug LL-002 ajeno a tipos), las premisas de ADR-0003 deben reevaluarse:

- **Solo developer + mantenibilidad humana**: Julio trabaja solo y conoce el código línea a línea. Los costes de aprender/aplicar TypeScript no se compensan con los bugs evitados en este contexto.
- **Bugs de tipado son raros**: ambos bugs históricos se resolvieron con tests unitarios + revisión. TypeScript no era la única solución.
- **El bug grave fue de contrato API, no de tipos**: LL-002 (rollback v2.0.0 del 28-abr) fue por shape JSON `{items, total}` vs `{facturas, total}`. TypeScript no lo habría detectado sin types compartidos frontend↔backend (que requieren stack TS uniforme).
- **Refactor v3 (ADR-0004 + ADR-0005) ya aporta**: testabilidad real, inyección de dependencias, separación de capas — sin necesidad de TS.
- **Coste/beneficio negativo**: estimación 80-120h para migración gradual completa, tiempo que se invierte mejor en multi-empresa (Q3), RGPD endpoints (Q2), observabilidad (Q3).

## Alternativas consideradas

1. **Mantener ADR-0003 (TypeScript gradual con allowJs)** — descartada
   - Pros: detecta una clase de bugs, alineación con ecosistema Node moderno
   - Cons: 80-120h dev en proyecto solo-developer; convivencia `.js+.ts` durante meses; build adicional; deps `@types/*`; complejidad sin valor proporcional

2. **JSDoc + `tsc --checkJs`** (tipado por comentarios sin migración)
   - Pros: tipos sin migrar a `.ts`; reversible
   - Cons: cobertura parcial (solo donde se anote); IDE peor que TS nativo; sintaxis verbosa; no resuelve el problema de fondo (bugs raros en este contexto)

3. **Migrar frontend a HTMX/Alpine.js** (mencionado en ROADMAP línea 84)
   - Pros: tipado HTML-céntrico, menos JS
   - Cons: solo justificable si entran colaboradores que no quieran tocar JS plano; mantenedor único actual = NO se justifica

4. **Vanilla JavaScript ES6+ permanente** (decisión)
   - Pros: simplicidad, sin build step, velocidad de desarrollo, código uniforme, sin convivencia de stacks, ROADMAP frontend simple
   - Cons: bugs de tipo siguen posibles; IDE refactor menos potente

## Decision

Mantener **Vanilla JavaScript ES6+** como stack permanente del proyecto SETEX, tanto en backend (Node 20 + Express) como en frontend (HTML/CSS/JS plano).

**NO migrar a TypeScript.** La promesa de ADR-0003 queda formalmente cancelada: no se hará la migración gradual prevista para Fase 2-3-4 del MACROPLAN.

**NO migrar el frontend a HTMX, Alpine.js, React, Svelte ni cualquier otro framework.**

**Ámbito de aplicación:**
- Todo código nuevo se escribe en `.js` (ES6+ con módulos CommonJS o ESM según fichero existente).
- ESLint flat config (ADR-0001) sigue siendo el enforcer de calidad sintáctica.
- JSDoc opcional en funciones públicas críticas (ROI/seguridad) cuando aporte clarity, sin obligatoriedad.
- Si en el futuro entran colaboradores que NO conozcan el código y NO sepan JS, reabrir decisión.

## Consequences

### Positivo
- **Cero coste de migración**: 80-120h liberadas para tareas de producto (multi-empresa, RGPD, observabilidad).
- **Sin build step adicional**: `node src/server.js` arranca directamente; deploy más rápido.
- **Código uniforme**: sin convivencia `.js + .ts`, sin confusión sobre dónde aplica `strict`.
- **Velocidad de desarrollo**: edit-save-restart sin compilación intermedia.
- **Onboarding más simple**: cualquier dev con conocimiento de JavaScript puede contribuir.

### Negativo
- **Bugs de tipado siguen siendo posibles**: mitigación con tests unitarios sólidos (ROADMAP Q2 línea 76).
- **IDE menos potente**: refactor automático y completion limitados.
- **Riesgo de regresión**: cambios en shape de respuestas API (ej. LL-002) requieren tests de paridad de body shape (Bloque C del plan estratégico 2026-05-05).
- **Decisión reversible con coste alto**: si más adelante se decide migrar, la deuda acumulada será mayor.

### Seguimiento requerido
- **ROADMAP línea 83** ("TypeScript progresivo") queda **descartada** como tarea pendiente.
- **Tests unitarios** (ROADMAP línea 76) pasan a ser **prioritarios**: sin TypeScript, los tests son la red de seguridad principal contra bugs de tipos.
- **JSDoc en funciones críticas**: añadir progresivamente en `validateCIF`, `viesValidator`, `mergeLineasIva`, OCR adapters — sin convertir esto en obligación bloqueante.
- **Reabrir decisión SI**: (a) entra equipo de 2+ devs, (b) el código supera 30k líneas, (c) hay un bug grave atribuible directamente a falta de tipos.
- **ADR-0003** queda como histórico marcado por convención `superseded by ADR-0006` en su lectura cruzada (su contenido NO se modifica por respeto a la regla 10 de inmutables).

## Notas

ADR-0003 NO se borra del repositorio (es histórico). Su contenido se mantiene íntegro por respeto a la regla 10 (inmutables). La superseción se documenta en este ADR-0006. Esta es la práctica estándar de los Architecture Decision Records: las decisiones se invalidan formalmente, no se eliminan, para preservar la trazabilidad del razonamiento del proyecto a lo largo del tiempo.
