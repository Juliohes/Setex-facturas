# HANDOVER · FASE 1B Descongelado del Refactor v3

> Documento de cierre para la sesión que ejecute Etapas 5-6.
> Si llegas aquí en una sesión nueva sin contexto previo, lee solo este fichero +
> `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` y arranca.

| Campo | Valor |
|---|---|
| Creado | 2026-04-27 23:55 UTC |
| Estado | 🟢 Etapas 0-4 cerradas y mergeadas a `develop` · 🟡 Etapas 5-6 pendientes |
| Próxima acción | Disparar `deploy-staging.yml` y vigilar 24-48h |
| Trabajar en | `/opt/setex/staging` (Etapa 5) y nuevo branch desde `develop` (Etapa 6) |

---

## ¿Qué se ha hecho hoy?

5 PRs mergeados a `develop` que dejan el v3 listo para swap:

| PR | Squash | Resumen |
|---|---|---|
| #85 | `6c9f65b` | Etapa 0: rollback Round 16 (server.js = monolito · server.next.js = v3 congelado) |
| #86 | `5513b5f` | Etapa 1: 5 rutas auth_request portadas al v3 |
| #87 | (cierre) | Etapas 2+3+4: paridad CI + healthcheck endurecido + smoke HTTP + HSTS staging |

Estado actual de `develop` (`HEAD`):
- `app/backend/src/server.js` = 4308 líneas (monolito legacy, runtime activo)
- `app/backend/src/server.next.js` = 61 líneas (v3 modular, listo para arrancar)
- 5 rutas críticas portadas y testadas
- Test paridad CI: paridad 1:1 estricta legacy↔v3, allowlist vacía
- Healthcheck container apunta a la ruta crítica
- Smoke HTTP post-deploy en ambos workflows

---

## Lo que está blindado (no hace falta repetir trabajo)

1. **Test paridad legacy↔v3 corre en CI** en cada PR a `develop`/`main`.
   - Si un PR introduce una ruta nueva en el monolito sin portarla al v3, CI rompe.
   - Allowlist documentada y vacía: `tests/contracts/api-surface-parity.test.js` → `ALLOWLIST_NOT_PORTED`.

2. **Healthcheck container** apunta a `/api/internal/check-access` (no `/health`).
   - 200/403 → healthy · cualquier otro (incluido 404) → unhealthy → Docker reinicia.
   - Detecta el incidente Round 16 EN RUNTIME, no en logs.

3. **Smoke HTTP post-deploy** en `deploy-staging.yml` y `deploy-prod.yml`.
   - 3 verificaciones (~5s): `/health` 200, `/api/internal/check-access` 200/403 (NO 404), `/api/auth/login` 401.
   - Si falla, deploy aborta. En prod prefijo `REVISAR INMEDIATAMENTE`.

4. **`uuid@14` override** activo en `package.json` + lockfile (`overrides` block).
   - Cierra GHSA-w5hq-g745-h8pq. Cualquier `npm ci` reproduce uuid 14.0.0.

5. **Actions @v5** en CI (silencia warning Node 20 deprecation hasta junio 2026).

---

## Etapa 5 — Validación staging 24-48h (manual de Julio)

### Pre-condiciones

- [ ] PR #87 mergeado a `develop`
- [ ] CI verde sobre el merge

### Pasos

1. **Disparar deploy-staging.yml**:
   - Opción A: `git push origin develop` (si hay nuevos commits) → trigger automático.
   - Opción B: GitHub Actions web → `Deploy a staging` → Run workflow → Branch `develop`.

2. **Verificar que el deploy completa con smoke verde**:
   ```
   ── Esperando healthchecks (60s máx) ──
   ── Healthchecks verdes en Nx5s ──
   ── Smoke HTTP post-deploy (FASE 1B Etapa 4) ──
   [smoke] OK   /health -> 200
   [smoke] OK   /api/internal/check-access -> 200 (válido)
   [smoke] OK   /api/auth/login -> 401 (endpoint vivo)
   [smoke] OK · 3/3 rutas críticas respondieron como se esperaba.
   ── Deploy staging OK ──
   ```

3. **24-48h vigilando staging**:
   - `docker logs setex-staging-backend --tail 100` (sin errores nuevos)
   - `tail -f /opt/setex/staging/logs/watchdog.log` (sin alertas)
   - `curl -sk https://staging.setex-facturas.es/health` (200)
   - Si tienes Sentry/equivalente, sin nuevos issues

4. **Si todo verde** → seguir a Etapa 6.
   **Si rojo** → revisar logs, abrir issue, NO hacer Etapa 6 hasta resolver.

### Resultado esperado

Staging debe arrancar **con el monolito** (server.js = 4308 líneas) — el v3 NO está en runtime todavía. Esta etapa solo valida que todo el plumbing nuevo (paridad CI, healthcheck endurecido, smoke post-deploy) funciona contra runtime monolítico estable.

---

## Etapa 6 — Swap v3 a runtime + tag v2.0.0 + promoción a prod (manual de Julio)

### Pre-condiciones

- [ ] Etapa 5 completada con 24-48h staging verde sin alertas
- [ ] CI sigue verde sobre develop
- [ ] Smoke staging diario verde 7+ días (opcional pero recomendable)

### Pasos

1. **Crear branch del swap**:
   ```bash
   cd /opt/setex/staging  # o worktree limpio
   git fetch origin develop
   git checkout -b refactor/v3-swap-runtime-2026-XX-XX origin/develop
   ```

2. **Inversión de los renames** (es exactamente la inversa del rollback de Etapa 0):
   ```bash
   cd app/backend/src
   mv server.js server.legacy.js
   mv server.next.js server.js
   ```

3. **Ajustar configuración**:
   - `app/backend/package.json`:
     ```diff
     -    "start:next": "node src/server.next.js",
     +    "start:legacy": "node src/server.legacy.js",
     ```
   - `app/backend/eslint.config.js`:
     ```diff
     -  files: ['src/server.js'],     // monolito 4308 líneas
     +  files: ['src/server.legacy.js'],  // monolito legacy preservado por rollback rápido
     ```

4. **Verificar localmente**:
   ```bash
   cd /tmp/<worktree>/app/backend
   node --check src/server.js       # (ahora es el v3)
   node --check src/server.legacy.js
   npm install --no-audit --no-fund
   node --test tests/               # 44/44 deben pasar
   npm run depcruise                # 0 errors
   ```

5. **PR a develop, merge**:
   ```bash
   git add app/backend/src/server.js app/backend/src/server.legacy.js \
           app/backend/src/server.next.js app/backend/package.json \
           app/backend/eslint.config.js
   git commit -m "feat(v3): swap runtime · server.js ahora es el v3 modular (Etapa 6)"
   git push -u origin refactor/v3-swap-runtime-2026-XX-XX
   gh pr create --base develop --title "feat(v3): swap runtime — Etapa 6 cierre FASE 1B" --body "..."
   # CI debe pasar (paridad sigue verde porque ambos siguen presentes; ahora el v3 ES el runtime)
   gh pr merge --squash
   ```

6. **Deploy a staging automático**:
   - Push a develop → trigger automático.
   - Smoke debe pasar verde inmediato (las 5 rutas auth_request están portadas).

7. **24-48h adicionales en staging** con v3 en runtime real.

8. **Si todo OK, promoción a main + tag v2.0.0**:
   ```bash
   gh pr create --base main --head develop --title "release: v2.0.0 · v3 modular en runtime"
   gh pr merge --squash
   git fetch origin main
   git checkout main
   git pull
   git tag -a v2.0.0 -m "v2.0.0 · refactor v3 modular en runtime tras descongelado FASE 1B"
   git push origin v2.0.0
   ```

9. **Deploy a producción manual**:
   - GitHub Actions → `Deploy a producción (manual)` → Run workflow → escribir `DESPLEGAR`.
   - Smoke prod debe pasar. Si falla → rollback inmediato (sección "Rollback de ETAPA 6 en prod" del PLAN-FASE-4).

10. **Monitoring 24h prod**:
    - `docker logs setex-prod-backend` cada par de horas.
    - `https://setex-facturas.es/health` cada hora (cron watchdog ya lo hace).
    - Sin nuevos issues en Sentry/alertas.

### Resultado esperado tras Etapa 6

- `main` y `develop` ambos con `server.js` = v3 modular (53 líneas + bootstrap)
- `server.legacy.js` = monolito 4308 líneas (preservado 30 días por seguridad, borrado en Q3)
- `tag v2.0.0` publicado en GitHub
- `setex-facturas.es` corriendo v3 modular sin regresión observada en 7 días
- `INFORME_SISTEMA_COMPLETO.md` con entrada "v2.0.0 promoción exitosa"

---

## Plan de rollback (si Etapa 6 se tuerce en prod)

```bash
ssh deploy@srv1027670
cd /opt/setex/prod
git fetch origin
# El último commit antes del swap v3 es donde main estaba previamente.
# Buscar con: git log --oneline main -5
git reset --hard <commit-pre-v2.0.0>
cd app
docker compose build backend && docker compose up -d backend
# Verificar smoke:
/opt/setex/prod/scripts/smoke-test-http.sh
```

---

## Lo que NO se aborda en esta sesión (deuda técnica conocida)

| Tarea | Por qué no ahora | Cuándo |
|---|---|---|
| Migrar cookie `setex_admin` a Bearer JWT | Mezclar con descongelado = riesgo. Reduciría superficie | Q3 (post v2.0.0) |
| Borrar `server.legacy.js` definitivamente | Mantener 30 días como rescate post-swap | Q3 |
| TypeScript progresivo (ocr/, validators/) | ADR-0003 lo planifica post-descongelado | Q3 |
| Eliminar `gemini.js` (266 líneas, DESACTIVADO) y `paddleocr.js` (39 líneas, sin uso) | PR de limpieza tras v2.0.0 | Q3 |
| chown automatizado en `scripts/fix-permissions.sh` | Tarea operacional independiente, no bloquea descongelado | Q2 cierre |

---

## Referencias

- `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` — plan original con detalle técnico
- `docs/plans/MACROPLAN-SETEX-v2.0.md` — plan maestro
- `docs/INFORME_SISTEMA_COMPLETO.md` entrada `2026-04-27 (noche)` — bitácora detallada
- `docs/ROADMAP.md` — Q2/Q3/Q4 con tareas check
- `.claude/CLAUDE.md` — siguiente bloque de trabajo apuntado a Etapas 5-6
