# PLAN FASE 4 — Descongelado del Refactor v3

> **Documento autocontenido**. Si llegas aquí en una sesión nueva, lee solo este fichero
> + `INFORME_SISTEMA_COMPLETO.md` (sección Historial 2026-04-22 y 2026-04-27) y arranca.
> No necesitas más contexto previo.

| Campo | Valor |
|---|---|
| Creado | 2026-04-27 |
| Última actualización | 2026-04-27 23:55 UTC |
| Estado | 🟢 **Etapas 0-4 CERRADAS** · 🟡 Etapas 5-6 pendientes (acción manual de Julio) |
| Tiempo estimado restante | 24-48h validación staging + ~2h sesión de swap final |
| Trabajar en | `/opt/setex/staging` (Etapa 5) y nuevo branch (Etapa 6) |
| Rama base | `develop` (deployable: monolito en runtime, v3 listo en `server.next.js`) |
| Promoción a prod | Solo tras 24-48h de staging post-swap estable + tag `v2.0.0` |

### Estado de las etapas

| Etapa | Estado | PR | Squash commit | Verificación |
|---|---|---|---|---|
| 0. Rollback en develop | ✅ MERGEADO | #85 | `6c9f65b` | server.js=4308 líneas, server.legacy.js borrado, plan presente |
| 1. Portar 5 rutas faltantes | ✅ MERGEADO | #86 | `5513b5f` | 20/20 tests pass, 5 controllers nuevos en v3 |
| 2. Test paridad + CI | ✅ MERGEADO | (cierre PR) | (squash) | 4 tests paridad pass, job CI `tests` activo |
| 3. Healthcheck endurecido | ✅ MERGEADO | (cierre PR) | (squash) | Dockerfile apunta a /api/internal/check-access |
| 4. Smoke HTTP post-deploy | ✅ MERGEADO | (cierre PR) | (squash) | scripts/smoke-test-http.sh + step en staging+prod workflows |
| 5. Validación staging 24-48h | 🟡 PENDIENTE | — | — | dispara `deploy-staging.yml` y observa |
| 6. Swap v3 a runtime | 🟡 PENDIENTE | — | — | tras Etapa 5 verde, branch swap → PR → merge → tag v2.0.0 |

**Lo que ya está blindado** (no hace falta repetir trabajo en futuras sesiones):
- Cualquier PR que haga `develop` regrese una ruta del monolito sin portarla al v3 → CI rompe (test paridad).
- Container con `/api/internal/check-access` 404 → unhealthy automático → Docker reinicia.
- Deploy con superficie API rota → `smoke-test-http.sh` aborta el job antes de marcar éxito.

---

## 1. ¿Qué es el refactor v3 y por qué está congelado?

Entre el 2026-04-22 mañana y mediodía se ejecutó un refactor masivo del backend (15 Rounds + 5 hotfixes + un swap final en PR #83). Cambió el monolito `server.js` (4308 líneas) por una arquitectura modular: DI container con Awilix, ports/adapters, repositories, services, controllers thin, validación Zod en bordes, tests de arquitectura. El nuevo entry point se llamaba `src/server.next.js` (~50 líneas, solo bootstrap + listen).

El **2026-04-22 por la tarde** Julio activó el swap (renombró `server.next.js` → `server.js`, el monolito viejo a `server.legacy.js`). **Staging entró en 404 masivo** en `/`, `/admin-facturas.html`, `/api/*`. Tras autenticar la basic-auth de Traefik, todo devolvía "Not Found".

### Causa raíz documentada (no especular en sesión nueva)

El v3 **NO portó 5 rutas internas** que `nginx.conf` del frontend usa como `auth_request`:

```nginx
# Bloques afectados en /opt/setex/{prod,staging}/app/frontend/nginx.conf:
location / { auth_request /api/internal/check-access; ... }
location /api/ { auth_request /api/internal/check-access; ... }
location = /admin-facturas.html { auth_request /api/internal/check-admin-page; ... }
location = /service-worker.js { auth_request /api/internal/check-access; ... }
```

Cuando el v3 devolvía 404 a esas rutas internas, nginx mapeaba TODA la petición a `@bloqueado` (404 genérico).

### Las 5 rutas que faltaron (estas son las que hay que portar)

1. `/api/internal/check-access` — auth_request para /, /api/, service-worker
2. `/api/internal/check-admin-page` — auth_request para admin-facturas.html
3. `/api/admin/refresh-session` — utilidad admin
4. `/api/admin/retry-failed/:id` — reintentar jobs admin
5. `/api/admin/security/time` — info hora servidor para panel admin

**Fuente de verdad de comportamiento**: `app/backend/src/server.js` (= el monolito, hoy en runtime). Cualquier porte al v3 debe ser fiel byte-a-byte en respuestas: status code, headers, body shape, side effects (audit log, etc.).

### Lo que se hizo después del incidente

- Rollback en disco staging: `server.next.js` → `server.next.js` (queda) y `server.legacy.js` → `server.js` (vuelve a ser monolito). Container rebuild y `up -d backend`. App OK.
- En `prod` el swap NUNCA se aplicó realmente (la imagen Docker corría con el monolito embebido vía COPY del Dockerfile, no se rebuildeó). El 2026-04-27 se completó el cleanup en disco: prod queda con `server.js` = monolito, `server.next.js` paralelo CONGELADO.
- Lo cambios "post-rollback" (renombrados + ajuste `package.json` + `eslint.config.js`) **están en filesystem pero NO en `develop`**. Develop todavía tiene HEAD apuntando al swap roto. **Por eso ETAPA 0 de este plan es prioritaria — sin ella, cualquier deploy a staging desde develop reproduce el incidente.**

---

## 2. Estado actual del repo (snapshot 2026-04-27)

```
main:    788ff6a chore(ops): cleanup post-cutover Fase 4 (#84)
         ├─ server.js = monolito 4308 líneas (intacto desde v1.1.0)
         ├─ NO existe server.next.js
         ├─ HSTS 10 años, xanflatest a labels Docker
         └─ uuid override @14 (vulnerabilidad cerrada)

develop: 0e48ab3 feat(v2.0.0-rc1): swap runtime v3 (#83)  ← ⚠️ ESTADO ROTO
         ├─ server.js = v3 mini de 53 líneas (NO sirve sin endpoints faltantes)
         ├─ server.legacy.js = monolito 4308 líneas (rescate)
         ├─ src/{controllers,services,repositories,routes,adapters,ports,...} ← refactor v3 completo
         ├─ tests/{architecture.test.js, contracts/}
         └─ docs/adr/{0004,0005}.md

filesystem prod (post-deploy 2026-04-27):
         git status limpio, HEAD == origin/main = monolito puro funcionando

filesystem staging (post-rollback 2026-04-22):
         9 ficheros sin commitear (rollback Round 16 NUNCA pusheado a develop)
         Branch local: hotfix/rollback-v3-swap-2026-04-23 (con commit ead1772 LOCAL, no en remote)
```

---

## 3. Etapas de descongelado — orden NO negociable

### ETAPA 0 · Higiene de develop (PRE-REQUISITO obligatorio · ~30 min)

**Objetivo**: dejar `develop` en estado **deployable** (= si alguien dispara `deploy-staging.yml` ahora, NO se rompe). Hoy no lo está: develop apunta a 0e48ab3 (v3 swap roto). Hay que aplicar a develop el equivalente del rollback que se hizo en disco el 22-Abr.

**Cambios netos** (sobre HEAD de develop = `0e48ab3`):
- `app/backend/src/server.js` ← contenido del monolito (= `server.legacy.js` actual de develop, 4308 líneas)
- `app/backend/src/server.legacy.js` ← BORRAR (no debe existir)
- `app/backend/src/server.next.js` ← contenido del v3 mini (= el `server.js` actual de develop, 53 líneas)
- `app/backend/package.json` ← `"start:legacy"` → `"start:next"`, target a `src/server.next.js`
- `app/backend/eslint.config.js` ← excepción `max-lines: off` aplicada a `src/server.js` (no a `src/server.legacy.js`)
- `app/backend/src/server.next.js` (cabecera) ← comentario "CONGELADO desde 2026-04-22" + plan descongelado

**Procedimiento**:

```bash
# 1. Worktree limpio desde develop (no tocar /opt/setex/staging directamente)
cd /opt/setex/staging
git fetch origin
git worktree add /tmp/setex-rollback-develop -b refactor/v3-rollback-en-develop-2026-04-XX origin/develop
cd /tmp/setex-rollback-develop

# 2. Rollback: renombrado + ajustes paquete
mv app/backend/src/server.legacy.js /tmp/_monolito.js
mv app/backend/src/server.js app/backend/src/server.next.js
mv /tmp/_monolito.js app/backend/src/server.js

# 3. package.json: start:legacy → start:next
sed -i 's|"start:legacy": "node src/server.legacy.js"|"start:next": "node src/server.next.js"|' app/backend/package.json

# 4. eslint.config.js: 'src/server.legacy.js' → 'src/server.js'
sed -i "s|files: \['src/server.legacy.js'\]|files: ['src/server.js']|" app/backend/eslint.config.js

# 5. Comentario cabecera de server.next.js (reemplazar las líneas 1-10)
# Editar manualmente para poner el comentario "CONGELADO desde 2026-04-22"
# (ver formato exacto en /opt/setex/prod/app/backend/src/server.next.js NO existe en main,
#  pero /opt/setex/staging tiene el comentario actualizado en disco — copiar de ahí)

# 6. Verificación
node --check app/backend/src/server.js          # ✅ sintaxis monolito
node --check app/backend/src/server.next.js     # ✅ sintaxis v3
node -e "JSON.parse(require('fs').readFileSync('app/backend/package.json'))"  # ✅
test ! -e app/backend/src/server.legacy.js && echo "✅ legacy borrado"

# 7. Commit + push + PR a develop
git add app/backend/src/server.js app/backend/src/server.next.js app/backend/package.json app/backend/eslint.config.js
# (server.legacy.js queda borrado - git lo detecta como D)
git commit -m "fix(rollback): aplica rollback Round 16 en develop · server.js vuelve a ser monolito

Sincroniza develop con el estado funcional del filesystem prod/staging post-incidente
del 2026-04-22. Nada del refactor v3 se pierde — sigue accesible como src/server.next.js
(renombrado desde el swap roto). El v3 queda CONGELADO para la sesión de descongelado.

Razón crítica: hasta este commit, develop apuntaba al swap v3 (PR #83) que sabemos
roto en runtime. Cualquier disparador de deploy-staging.yml habría reproducido el
incidente Round 16 en staging. Este commit elimina esa mina pisada.

Files:
- src/server.js: monolito 4308 líneas restaurado (movido desde server.legacy.js)
- src/server.legacy.js: borrado (no más fichero residual)
- src/server.next.js: v3 mini de 53 líneas (movido desde server.js post-swap)
- package.json: scripts.start:legacy -> scripts.start:next (apunta a server.next.js)
- eslint.config.js: excepción max-lines aplicada a src/server.js (= monolito)
- src/server.next.js (cabecera): comentario CONGELADO + plan descongelado

Verificación: node --check de los dos server*.js OK, JSON.parse package.json OK,
server.legacy.js no existe.

Co-Authored-By: Claude <noreply@anthropic.com>"

git push -u origin refactor/v3-rollback-en-develop-2026-04-XX
gh pr create --base develop --head refactor/v3-rollback-en-develop-2026-04-XX --title "..." --body "..."

# 8. Mergear el PR a develop (squash). Develop queda deployable.

# 9. Limpiar worktree
cd /opt/setex/staging
git worktree remove /tmp/setex-rollback-develop
```

**Verificación post-merge a develop**:

```bash
# develop ahora tiene server.js = monolito
git -C /opt/setex/staging fetch origin
git show origin/develop:app/backend/src/server.js | wc -l    # ≈ 4308
git show origin/develop:app/backend/src/server.next.js | wc -l   # ≈ 50

# Si dispararamos deploy-staging.yml ahora, staging arrancaría con el monolito (= a prod).
# Plumbing OK. Listo para ETAPA 1.
```

**Limpieza adicional** (cuando ETAPA 0 mergeada):
- Borrar rama local `hotfix/rollback-v3-swap-2026-04-23` en staging:
  ```bash
  git -C /opt/setex/staging branch -D hotfix/rollback-v3-swap-2026-04-23
  ```

---

### ETAPA 1 · Portar las 5 rutas faltantes al v3 (~60-90 min)

**Objetivo**: que `src/server.next.js` arrancando responda igual que el monolito a las 5 rutas.

**Trabajar en** `/opt/setex/staging` (rama nueva desde develop, post-ETAPA-0):

```bash
git -C /opt/setex/staging checkout develop
git -C /opt/setex/staging pull --ff-only
git -C /opt/setex/staging checkout -b refactor/v3-port-internal-routes-2026-04-XX
```

**Para cada ruta, 2 referencias obligatorias**:

1. Implementación actual en `src/server.js` (monolito) — **comportamiento exacto a preservar**.
2. Stack v3 ya disponible: `src/services/`, `src/controllers/`, `src/routes/`. Solo añadir.

#### Ruta 1: `/api/internal/check-access`

**En el monolito**: busca el bloque `app.get('/api/internal/check-access'` en `src/server.js`. Es lo que nginx llama como `auth_request` antes de servir contenido público. Devuelve:
- 200 si la IP/sesión está OK
- 401 si no autenticado (cuando aplica)
- 403 si IP bloqueada
- 503 fail-secure si BD/Redis caído

**En v3**: crear:
- `src/controllers/internal/check-access.controller.js` (factory DI thin)
- `src/routes/internal.routes.js` (router con health + check-access + check-admin-page)
- Mount en `src/routes/index.js`

#### Ruta 2: `/api/internal/check-admin-page`

Igual que ruta 1 pero verifica que el user es admin además de autenticado.

#### Ruta 3: `/api/admin/refresh-session`

Renueva token de admin sin pedir login. Probablemente usa `refreshTokenService` ya disponible en v3.

#### Ruta 4: `/api/admin/retry-failed/:id`

Reintenta un job que falló. Endpoint admin. Probablemente sin uso real pero hay que portarlo por paridad.

#### Ruta 5: `/api/admin/security/time`

Devuelve hora del servidor para que el panel admin pueda mostrar reloj sincronizado y aplicar reglas de bloqueo horario (00-06 prod).

**Reglas de implementación obligatorias**:
- Cada controller ≤ 50 líneas (regla v3).
- Tests unitarios mínimos en `tests/contracts/internal-routes.test.js` (sigue patrón de `tests/contracts/ocr-port.test.js`).
- NO tocar `src/server.js` (monolito) — sigue siendo nuestro fallback.

**Verificación intermedia**:

```bash
cd /opt/setex/staging/app/backend
npm run start:next &  # arranca el v3 en puerto distinto (3100)
sleep 3

# Probar las 5 rutas con curl. Todas deben devolver lo mismo que el monolito.
# Comparación lado a lado contra http://localhost:3000 (monolito) si lo tienes corriendo.

curl -sI http://localhost:3100/api/internal/check-access
curl -sI http://localhost:3100/api/internal/check-admin-page
# ... etc

kill %1
```

**Commit + PR a develop**.

---

### ETAPA 2 · Test de paridad legacy ↔ v3 (~45-60 min)

**Objetivo**: detectar AUTOMÁTICAMENTE cualquier ruta que el v3 no porte. Lo que falló en Round 16 fue la ausencia de este test.

**Implementar** `tests/contracts/api-surface-parity.test.js`:

```javascript
// Pseudocódigo / esquema:
// 1. Levantar el monolito (require('../../src/server.js')) y extraer rutas:
//    const legacyRoutes = app._router.stack
//      .filter(l => l.route)
//      .map(l => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
//    También recursivo para sub-routers (routes/*).
//
// 2. Levantar el v3 (require('../../src/server.next.js') + bootstrap container) y extraer rutas igual.
//
// 3. Comparar: cada ruta en legacy DEBE existir en v3 (a menos que esté en allowlist documentada).
//
// 4. Para rutas con métodos públicos (no /api/internal/*), hacer SMOKE HTTP:
//    request a v3 → status code esperado (puede ser 401/400 sin auth, ese es OK,
//    NO 404 porque eso indicaría falta del endpoint)
```

**Allowlist de rutas que pueden no estar en v3** (documentada en el test):
- Endpoints DEPRECATED si los hay
- Endpoints que el equipo decide que no se portan

**CI integration**: añadir step en `.github/workflows/ci.yml` que ejecute este test en cada PR. Si falla → red, no se mergea.

**Verificación**:

```bash
cd /opt/setex/staging/app/backend
node --test tests/contracts/api-surface-parity.test.js
# Esperado: PASS con N rutas comparadas, 0 missing en v3
```

**Commit + PR a develop**.

---

### ETAPA 3 · Endurecer healthcheck del container (~15 min)

**Hoy** el `Dockerfile` de backend define:
```Dockerfile
HEALTHCHECK ... CMD node -e "require('http').get('http://localhost:3000/health')"
```

`/health` es trivial (200 con `{"status":"ok"}`) — no detecta el incidente Round 16.

**Cambiar a**:
```Dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/internal/check-access', r => process.exit(r.statusCode < 400 ? 0 : 1)).on('error', () => process.exit(1))"
```

Razón: `check-access` es la ruta más crítica (la que nginx usa como `auth_request`). Si esta cae, todo el frontend cae. Hacer que el container se marque unhealthy automáticamente.

**Verificación**:

```bash
cd /opt/setex/staging/app
docker compose build backend
docker compose stop backend && docker compose up -d backend
sleep 35  # esperar primer healthcheck
docker inspect setex-staging-backend --format '{{.State.Health.Status}}'
# Esperado: healthy
```

**Commit + PR a develop**.

---

### ETAPA 4 · Smoke test post-deploy (~30 min)

**Objetivo**: que `deploy-staging.yml` (y `deploy-prod.yml` cuando llegue) ejecute un smoke real (login + preview + confirm) tras el rebuild, antes de declarar éxito.

**Crear** `scripts/smoke-test-http.sh` (sourcea `scripts/lib/paths.sh` para autodetectar entorno):

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/paths.sh"

DOMAIN="$SETEX_DOMAIN"  # setex-facturas.es / staging.setex-facturas.es
BASE="https://${DOMAIN}"
USER_EMAIL="$(cat /run/secrets/smoke-test-user-email 2>/dev/null || echo 'smoke@setex-facturas.es')"
USER_PASS="$(cat /run/secrets/smoke-test-user-password 2>/dev/null || exit 0)"  # skip si no hay creds
FIXTURE="${SCRIPT_DIR}/samples/factura-muestra.jpg"

echo "── Smoke 1/4: /health 200 ──"
curl -fsk "${BASE}/health" >/dev/null

echo "── Smoke 2/4: login real ──"
TOKEN=$(curl -fsk -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${USER_EMAIL}\",\"password\":\"${USER_PASS}\"}" | jq -r .token)
[ -n "$TOKEN" ] || { echo "ERROR: no token"; exit 1; }

echo "── Smoke 3/4: upload-preview con fixture ──"
PREVIEW=$(curl -fsk -X POST "${BASE}/api/upload-preview" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "factura=@${FIXTURE}" | jq -r .previewId)
[ -n "$PREVIEW" ] || { echo "ERROR: no preview"; exit 1; }

echo "── Smoke 4/4: confirm con campos esperados (cleanup) ──"
# ... idempotente, marca el preview como descartado en lugar de persistir

echo "Smoke OK."
```

**Workflow**: añadir step al final de `deploy-staging.yml` (y `deploy-prod.yml` posteriormente):

```yaml
- name: Smoke HTTP post-deploy
  run: |
    sleep 15  # margen para que backend levante
    /opt/setex/$ENV/scripts/smoke-test-http.sh
```

Si el smoke falla → workflow rojo → operador notificado. **Esto es lo que hubiera detectado el incidente Round 16 inmediatamente.**

**Verificación local**:

```bash
cd /opt/setex/staging
./scripts/smoke-test-http.sh
# Esperado: 4 OK + "Smoke OK."
```

**Commit + PR a develop**.

---

### ETAPA 5 · Validación staging 24-48h (sin tocar nada · 24-48h)

**Acciones**:
1. Mergear todas las PRs ETAPA 0 → 4 a develop.
2. Disparar `deploy-staging.yml` manualmente (o esperar al automático en push).
3. Staging debe arrancar `src/server.js` (que **sigue siendo el monolito** — no hemos hecho swap aún).
4. Verificar que el smoke post-deploy pasa.
5. Dejar correr 24-48h. Vigilar:
   - `docker logs setex-staging-backend` sin errores nuevos
   - `/var/log/.../watchdog.log` sin alertas
   - Si tienes Sentry/equivalente, sin nuevos issues

**El v3 NO está en runtime aún**. Solo está disponible como fichero `src/server.next.js`. Esto es intencional — primero validamos el plumbing del rollback en develop + tests + smoke. Después el swap final.

---

### ETAPA 6 · Swap v3 a runtime + promoción (sesión propia, ~2h)

**Pre-condiciones** (NO arrancar etapa hasta cumplir todas):
- [ ] ETAPAS 0-5 mergeadas a develop y staging estable 24-48h.
- [ ] Smoke post-deploy verde 30+ días sin fallar.
- [ ] Test de paridad CI verde en cada PR.
- [ ] Healthcheck endurecido funcionando.

**Plan del swap final**:

1. **Rama** `refactor/v3-swap-runtime-2026-04-XX` desde develop.
2. **Inversión de renames**:
   ```bash
   mv app/backend/src/server.js app/backend/src/server.legacy.js
   mv app/backend/src/server.next.js app/backend/src/server.js
   ```
3. **Ajustes**:
   - `package.json`: `start:next` → `start:legacy`, target a `src/server.legacy.js`
   - `eslint.config.js`: excepción max-lines a `src/server.legacy.js`
4. **Verificación local**: `npm start` arranca el v3, `/health` 200, `/api/internal/check-access` 200.
5. **PR a develop, merge**.
6. **Deploy a staging** automático.
7. **Smoke post-deploy debe pasar** (las 5 rutas internas están portadas).
8. **24-48h adicionales** observando staging real.
9. **Solo entonces**: PR develop → main + tag `v2.0.0` + `Deploy a producción (manual)` con `DESPLEGAR`.
10. **Monitoring 24h en prod**.

---

## 4. Plan de rollback (si algo se tuerce en cualquier etapa)

### Rollback de ETAPA 0 (rama)
```bash
git -C /opt/setex/staging checkout develop
git push origin --delete refactor/v3-rollback-en-develop-2026-04-XX  # cancela PR
```

### Rollback de ETAPA 1-4 (PRs no mergeados)
Cierra el PR sin mergear. Develop queda como estaba post-ETAPA-0.

### Rollback de ETAPA 6 (swap fallido en staging)
```bash
# Inversa del swap:
cd /opt/setex/staging/app/backend
mv src/server.js src/server.next.js
mv src/server.legacy.js src/server.js
# Revertir package.json, eslint.config.js
docker compose build backend && docker compose up -d backend
```

### Rollback de ETAPA 6 en prod (CRÍTICO)
```bash
ssh deploy@srv1027670
cd /opt/setex/prod
git fetch origin
git reset --hard <commit-pre-v2.0.0>  # commit anterior al tag v2.0.0
cd app
docker compose build backend && docker compose up -d backend
# Verificar /health 200
```

---

## 5. Criterios de éxito

Una vez completadas las 6 etapas:

- ✅ `develop` y `main` ambos con server.js = v3 (NO monolito legacy)
- ✅ `server.next.js` borrado (ya no necesario)
- ✅ `eslint.config.js` sin la excepción max-lines (el v3 cumple < 500 líneas por fichero)
- ✅ `tests/contracts/api-surface-parity.test.js` verde en CI
- ✅ Healthcheck container apunta a `/api/internal/check-access`
- ✅ Smoke post-deploy en `deploy-staging.yml` y `deploy-prod.yml` verde
- ✅ Tag `v2.0.0` publicado en GitHub
- ✅ `setex-facturas.es` corre v3 modular sin regresión observada en 7 días
- ✅ `docs/INFORME_SISTEMA_COMPLETO.md` con entrada "v2.0.0 promoción"
- ✅ `MACROPLAN-SETEX-v2.0.md` sección FASE 1 marcada cerrada
- ✅ `ROADMAP.md` Q2 cerrado al 100%

---

## 6. Apuntes y decisiones a tomar durante la sesión

- **¿Borrar `server.legacy.js` después de v2.0.0+30 días?** Sí, Q3 según ROADMAP. Mantener como rescate hasta entonces.
- **¿TypeScript en este sprint?** NO. ADR-0003 lo planifica para Q3, después del descongelado v3. Mezclar dos refactors es pedir incidente.
- **¿Cobertura de tests objetivo en este sprint?** 0% → ~30% (validators, calculators, parity). Ver MACROPLAN sección 11.
- **¿Auto-arrancar smoke desde cron en staging?** Opcional. Recomendable: cron 04:30 (después del backup) que ejecute smoke-test-http.sh y mande email si rojo.

---

## 7. Comandos de verificación rápida (cualquier momento)

```bash
# Estado del refactor v3 en develop
git -C /opt/setex/staging show origin/develop:app/backend/src/server.js | wc -l
# Pre-ETAPA-0: 53 líneas (v3 mini)  →  Post-ETAPA-0: 4308 líneas (monolito)

# Containers
docker ps --format "{{.Names}} {{.Status}}" | grep setex

# Endpoints públicos
curl -sk -o /dev/null -w "prod /health: %{http_code}\n" https://setex-facturas.es/health
curl -sk -o /dev/null -w "staging /health: %{http_code}\n" https://staging.setex-facturas.es/health

# uuid en prod (cerrada GHSA-w5hq-g745-h8pq)
docker exec setex-prod-backend node -e "console.log('uuid:', require('uuid/package.json').version)"
# Esperado: 14.0.0

# HSTS prod
curl -skI https://setex-facturas.es/ | grep -i strict-transport
# Esperado: max-age=315360000
```

---

## 8. Histórico de revisiones de este plan

| Fecha | Autor | Cambio |
|---|---|---|
| 2026-04-27 | Claude (Julio) | Creación tras cierre de Q2 cleanup post-cutover Fase 4 (FASES 1-3 + PR #84 + deploy) |
