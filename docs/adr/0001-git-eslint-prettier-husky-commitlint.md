# 0001. Git + ESLint + Prettier + Husky + commitlint obligatorios

- **Status:** accepted
- **Fecha:** 2026-04-21
- **Decisores:** @Juliohes + Claude Code

## Context

SETEX pasó de prototipo a producto en producción entre enero y abril de 2026, con un mantenedor único (Julio) y colaboración de Claude Code. El crecimiento rápido generó:

- **Inconsistencias de estilo** en `server.js` (var/let mezclados, comillas simples vs dobles, formato de import) — 4081 líneas en un solo fichero.
- **Commits con mensajes libres** sin convención (`fix`, `actualizar`, sin scope) — dificulta generar changelog automático.
- **No se detectan regresiones de sintaxis** hasta el deploy (smoke-test-syntax del CI es la única red de seguridad).
- **Risk de drift** entre dev-local y CI: cada colaborador con su propia configuración.

El ROADMAP Q2 ya identifica "ESLint + Prettier base + commitlint hook" como item de calidad.

## Alternativas consideradas

1. **No hacer nada** — mantener el estado actual. Riesgo de deuda acumulada y onboarding lento para futuros colaboradores. Descartada por la regla del proyecto "sin excepciones" en calidad.
2. **Solo ESLint** — lint sintáctico. Mínimo viable pero no cubre formato ni reglas de commits.
3. **ESLint + Prettier + Husky + lint-staged + commitlint** (decisión) — pipeline completo pre-commit.
4. **TypeScript + compiler strict** — cubre más que lint, pero es un cambio mucho mayor; se aborda en ADR-0003 como fase posterior.

## Decision

Adoptar un pipeline de calidad completo y **obligatorio** en cada commit a `develop` y `main`:

1. **ESLint flat config** (`eslint.config.js`) — ya existe en el repo desde Fase 0 P0-3 con reglas `max-lines: 500` y `max-lines-per-function: 80`. Exención temporal para `server.js` durante el refactor Strangler-Fig (ver ADR-0002).
2. **Prettier** (`.prettierrc.json` + `.prettierignore`) — ya presente. Estilo único y no discutible.
3. **Husky** hooks `.husky/`:
   - `pre-commit`: ejecuta `lint-staged` (ESLint + Prettier solo en ficheros staged)
   - `commit-msg`: ejecuta `commitlint` (validación formato Conventional Commits)
4. **commitlint** (`commitlint.config.js`) con preset `@commitlint/config-conventional`:
   - Tipos permitidos: `fix`, `feat`, `docs`, `chore`, `refactor`, `test`, `perf`, `style`, `build`, `ci`, `revert`, `sync`, `release`
   - Scope opcional pero recomendado (ej. `fix(ocr):`, `feat(admin):`)
   - Longitud máxima del subject: 100 caracteres

Los hooks deben ser **obligatorios en local** (instalados con `npm run prepare` automático vía `postinstall`) y validados también en CI (`ci.yml`).

## Consequences

### Positivo
- Commits consistentes → changelog automático con `conventional-changelog` en futuros releases
- Cero "small commit" con fallos de sintaxis — ESLint los atrapa pre-commit
- Estilo uniforme sin discusión cada PR
- Onboarding rápido: `git clone + npm install` ya instala los hooks
- CI verifica lo mismo que local (un único source of truth)

### Negativo
- Fricción inicial en el flujo: cada commit tarda 2-3s más (lint-staged + commitlint)
- Commits rápidos tipo "typo" necesitan respetar el formato → obliga a escribir `fix(docs): typo` en vez de `typo`
- Las reglas `max-lines` obligarán a dividir `server.js` (ya en curso con Strangler-Fig, ADR-0002)

### Seguimiento requerido
- Configurar `.husky/` y `commitlint.config.js` (pendiente en este PR)
- Migrar commits pasados: no rewriteamos historia; aplicamos la convención desde `v1.0.2+`
- Documentar en `CONTRIBUTING.md` cómo desactivar hooks en emergencia (`--no-verify` está prohibido por regla del proyecto, excepto con OK explícito de Julio)
