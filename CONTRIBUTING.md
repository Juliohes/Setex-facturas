# Contribuir a SETEX Captura de Facturas

Esta guía documenta el flujo de trabajo para hacer cambios en el proyecto. Está pensada para Julio (mantenedor único) y para 1-2 colaboradores futuros sin reescribir nada.

## Flujo general — GitHub Flow + develop

```
feature/* ──► develop ──► main
              │           │
              │           └──► auto-deploy a producción (con aprobación)
              │
              └──► auto-deploy a staging
```

Reglas duras:

- `main` siempre refleja lo que hay en producción. **Nunca se rompe.**
- `develop` es la rama de integración — staging apunta aquí.
- `feature/*`, `fix/*`, `chore/*`, `docs/*` son ramas cortas. Vida útil: horas o pocos días.
- Toda promoción a `main` o `develop` pasa por **Pull Request**. Push directo bloqueado.

## Convención de nombres de ramas

| Prefijo | Uso | Ejemplo |
|---|---|---|
| `feature/` | Funcionalidad nueva | `feature/cif-aeat-warning-perfil` |
| `fix/` | Corrección de bug | `fix/ux-captura-y-ocr-openai-schema` |
| `chore/` | Limpieza, dependencias, build | `chore/security-bumps-multer-nodemailer` |
| `docs/` | Sólo documentación | `docs/contributing-and-templates` |
| `sync/` | Sincronización de ramas (post-squash) | `sync/main-into-develop` |
| `release/` | Lote a promocionar de develop a main | `release/2026-04-19-lote` |

Sufijo recomendado al final: la fecha `YYYY-MM-DD`. Facilita auditoría posterior.

## Convención de commits

Formato Conventional Commits:

```
<tipo>(<ámbito>): <descripción imperativa corta>

<cuerpo opcional con detalle del por qué>

<footer opcional con referencias o trailers>
```

Tipos válidos: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`, `style`.

Ejemplo real del repo:

```
fix(ocr): restaurar OpenAI por schema strict + bypass /api/internal en auto-block

- ocr/openai.js: OpenAI Structured Outputs strict no admite oneOf/anyOf desde
  2026-Q1. Cambiado a type: ['array','null']...
- server.js: bypass de /api/internal/* en el auto-block. nginx auth_request
  sólo acepta 200/401/403...
```

Reglas:

- El asunto va en imperativo ("añadir", "corregir") no pasado.
- Máximo 72 caracteres en el asunto.
- En el cuerpo, explicar **por qué** se hace, no qué (el diff ya muestra el qué).
- Si el commit lo escribe Claude Code, añadir trailer `Co-Authored-By: Claude Opus ... <noreply@anthropic.com>` para trazabilidad.

## Flujo de feature (caso normal)

```bash
# 1. Partir siempre de develop actualizada
git checkout develop
git pull --ff-only

# 2. Crear rama de feature
git checkout -b feature/<nombre-descriptivo>-YYYY-MM-DD

# 3. Hacer cambios, commits temáticos pequeños
git add <ficheros-relacionados>
git commit -m "feat(ámbito): descripción"

# 4. Push y crear PR a develop
git push --set-upstream origin feature/<nombre>-YYYY-MM-DD
gh pr create --base develop --title "..." --body "..."

# 5. Tras merge a develop → CI/CD desplegará a staging automáticamente
# 6. Verificar en https://staging.setex-facturas.es (BasicAuth)
# 7. Cuando staging valide, abrir PR develop → main para promocionar a prod
gh pr create --base main --head develop --title "release: <descripción>"
```

## Flujo de hotfix (caso urgente para producción)

Cuando hay un bug en producción que no puede esperar al ciclo normal:

```bash
# 1. Partir de main (no de develop), porque develop puede tener cambios sin validar
git checkout main
git pull --ff-only
git checkout -b fix/<descripcion-urgente>-YYYY-MM-DD

# 2. Hacer la corrección mínima necesaria
git add ...
git commit -m "fix(ámbito): corregir <X> en producción"

# 3. PR directo a main
git push --set-upstream origin fix/<descripcion>-YYYY-MM-DD
gh pr create --base main --title "fix: <descripción>" --body "Hotfix urgente..."

# 4. Tras merge a main, propagar a develop
git checkout develop
git pull --ff-only
git merge origin/main --no-ff -m "sync: hotfix <descripción> de main"
git push
```

Nota: con CI/CD activo, el merge a main dispara deploy a producción **con aprobación manual obligatoria**. Esto es la red de seguridad — usa el botón de aprobación sólo cuando estés seguro.

## Flujo de cambio que sólo es para staging (experimentación)

Si quieres probar algo en staging sin que llegue a producción:

```bash
# Hacer la rama desde develop
git checkout develop && git pull --ff-only
git checkout -b feature/experiment-XYZ-YYYY-MM-DD

# Trabajar, commitear, push, PR a develop
# Tras merge a develop → staging se actualiza solo
# Si no convence, NO se abre PR develop → main. La feature se queda en develop/staging.
# Si convence, sí se promueve.
```

**El usuario Julio puede romper staging las veces que quiera sin afectar producción** — ese es el propósito del entorno.

## Cómo resolver conflictos de merge

Caso 1 — conflicto al rebasar tu rama sobre develop actualizado:

```bash
git fetch origin
git rebase origin/develop
# Git pausa en el conflicto. Editar los ficheros marcados con <<<<<<< / =======.
git add <ficheros-resueltos>
git rebase --continue
git push --force-with-lease  # NUNCA --force a secas
```

Caso 2 — conflicto al hacer merge de develop into tu rama:

```bash
git merge origin/develop
# Editar ficheros con conflicto
git add <ficheros>
git commit  # crea el merge commit
git push
```

Regla: si el conflicto es complejo o no entiendes, **paras y preguntas**. Nunca resuelvas adivinando.

## Cheatsheet de comandos git esenciales

| Acción | Comando |
|---|---|
| Ver en qué rama estás | `git branch --show-current` |
| Estado del working tree | `git status -s` |
| Ver últimos 5 commits | `git log --oneline -5` |
| Ver diff de cambios sin stage | `git diff` |
| Ver diff de cambios staged | `git diff --cached` |
| Sincronizar rama actual con remoto | `git pull --ff-only` |
| Crear rama nueva | `git checkout -b nombre-rama` |
| Cambiar a rama existente | `git checkout nombre-rama` |
| Borrar rama local mergeada | `git branch -d nombre-rama` |
| Borrar rama remota | `git push origin --delete nombre-rama` |
| Ver ramas remotas | `git ls-remote --heads origin` |

## Playbook de emergencias

Ver `docs/PLAYBOOK_EMERGENCIAS.md` para:

- Cómo revertir un deploy fallido
- Cómo restaurar la BD desde backup GPG
- Cómo recuperar un commit borrado por accidente
- Quién/qué tocar si producción está caída

## Recursos

- Estado del producto: `docs/INFORME_SISTEMA_COMPLETO.md`
- Decisiones arquitectónicas: `docs/DECISIONS.md`
- Auditorías: `docs/audits/`
- Roadmap trimestral: `docs/ROADMAP.md`

## Pregunta estás dudoso?

Antes de mergear o pushear algo que toque producción, pregunta. Es preferible perder 5 minutos consultando que romper el sitio.
