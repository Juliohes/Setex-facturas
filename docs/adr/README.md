# Architecture Decision Records (ADR)

Registro cronológico de decisiones técnicas significativas en SETEX Captura de Facturas. Siguiendo el formato [MADR 3.0](https://adr.github.io/madr/) simplificado.

## Formato

Cada ADR vive en un fichero `NNNN-titulo-corto.md` con las secciones:

- **Status** — `proposed` | `accepted` | `deprecated` | `superseded by NNNN`
- **Context** — qué problema motiva la decisión, qué alternativas se evaluaron
- **Decision** — qué se decidió hacer
- **Consequences** — qué cambia a partir de aquí (positivo y negativo)

## Índice

| ADR | Título | Status | Fecha |
|---|---|---|---|
| [0001](0001-git-eslint-prettier-husky-commitlint.md) | Git + ESLint + Prettier + Husky + commitlint obligatorios | accepted | 2026-04-21 |
| [0002](0002-strangler-fig-target-structure.md) | Estructura modular target: Strangler-Fig sobre `server.js` monolítico | accepted | 2026-04-21 |
| [0003](0003-typescript-gradual-migration.md) | Migración gradual a TypeScript (Fase 3 MACROPLAN) | accepted | 2026-04-21 |

## Cómo añadir un ADR nuevo

1. Copia la plantilla `template.md` a `NNNN-titulo-corto.md` (N+1 del último)
2. Rellena las secciones
3. Actualiza la tabla de este README
4. Inclúyelo en el PR del cambio que motive la decisión
