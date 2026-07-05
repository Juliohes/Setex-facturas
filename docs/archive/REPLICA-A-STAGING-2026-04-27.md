# Replicación a STAGING — Hotfixes 2026-04-27 (PM)

> **Origen**: hotfixes aplicados en `/opt/setex/prod/` el 2026-04-27 PM tras incidencias detectadas en reunión con Carlos (Setex). Este documento permite reproducir EXACTAMENTE los mismos cambios en `/opt/setex/staging/` cuando termine el bloque del descongelado v3 (`docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md`).
>
> **Orden recomendado**: cerrar primero la Fase 1B (Etapas 0-6 del plan v3) y SOLO ENTONCES aplicar este pack — así el resultado en staging contiene v3 + estos hotfixes y queda listo para promocionar a prod en un único cutover.
>
> **Asunción**: en el momento de aplicar este pack, el código de staging ya está alineado con el v3 descongelado. Si el v3 ha tocado los mismos ficheros que esta replicación (especialmente `server.js` o `ocr/*`), comparar diffs antes de aplicar — los rangos de líneas pueden haber cambiado.

---

## 0. Preparación

```bash
cd /opt/setex/staging
git status                         # rama limpia antes de empezar
docker ps --format "table {{.Names}}\t{{.Status}}" | grep setex-staging-
./scripts/health-check.sh          # baseline 4/4 healthy
```

Los ficheros a tocar son los mismos paths que en prod. Los containers son `setex-staging-{backend,frontend,...}` (autodetect vía `scripts/lib/paths.sh`).

---

## 1. Fix 3 — OCR multi-IVA

### 1.1 Prompt OpenAI más asertivo con multi-IVA

**Fichero**: `app/backend/src/ocr/openai.js`

Localizar el bloque `DESGLOSE DE IVA — LEE CON MÁXIMA ATENCIÓN:` (alrededor de línea 75). Sustituir desde la línea `━━━ DECISIÓN PREVIA (siempre primero) ━━━` hasta el final del bloque CASO 2 (justo antes de la línea `━━━ IRPF — RETENCIÓN ...`) por el bloque nuevo. Diff de referencia:

```bash
# Comprobar que el bloque actual coincide con el de prod ANTES de aplicar
diff /opt/setex/prod/app/backend/src/ocr/openai.js /opt/setex/staging/app/backend/src/ocr/openai.js | head -100
```

Aplicar el cambio copiando el bloque exacto desde prod:

```bash
# Si el resto del fichero está alineado con prod, opción 1: copiar fichero entero
cp /opt/setex/prod/app/backend/src/ocr/openai.js /opt/setex/staging/app/backend/src/ocr/openai.js
node --check /opt/setex/staging/app/backend/src/ocr/openai.js
```

Si el resto del fichero no está alineado (v3 lo tocó), aplicar manualmente con Edit los dos cambios documentados en el historial (sección "Fix 3" del `INFORME_SISTEMA_COMPLETO.md` de prod, entrada 2026-04-27 PM):

1. Reescritura del bloque `DECISIÓN PREVIA + CASO 1 + CASO 2` con criterios anti-conservadores y ejemplo de hostelería.
2. `optimizeImage(filePath, mimeType, override = {})` lee `image_max_resolution` y `image_jpeg_quality` desde features.json en cada llamada (defaults 2048/90).

### 1.2 features.json a 2048/90

**Fichero**: `app/backend/src/config/features.json`

```bash
cd /opt/setex/staging
# Backup primero
cp app/backend/src/config/features.json app/backend/src/config/features.json.bak-2026-04-27
# Aplicar
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('app/backend/src/config/features.json')
d = json.loads(p.read_text())
d['image_max_resolution'] = 2048
d['image_jpeg_quality'] = 90
p.write_text(json.dumps(d, indent=2) + '\n')
PY
cat app/backend/src/config/features.json
```

### 1.3 Recalcular agregados desde tramos

**Fichero**: `app/backend/src/ocr/index.js`

En la función `compareOCRResults`, justo después del bloque `const merged = { ... };` y ANTES de `// ── Salvaguarda aritmética IRPF ──`, insertar el bloque "Coherencia multi-IVA" que recalcula `base_imponible`, `cuota_iva` y `iva_porcentaje` cuando `merged.lineas_iva.length >= 2`.

```bash
# Bloque exacto disponible en prod
sed -n '/── Coherencia multi-IVA ──/,/── Salvaguarda aritmética IRPF ──/p' /opt/setex/prod/app/backend/src/ocr/index.js
```

Validar:

```bash
node --check app/backend/src/ocr/index.js
```

---

## 2. Fix 2 — UI desglose IVA

### 2.1 Layout grid + labels en `renderDesgloseBlocks`

**Fichero**: `app/frontend/src/admin-facturas.js`

Localizar la función `renderDesgloseBlocks` (≈línea 1433). Sustituir el div con `display:flex; flex:1/2/2` por el nuevo `display:grid; grid-template-columns:110px 1fr 1fr auto; gap:10px`. Inputs con `font-size:14px`, `padding:7px 8px`, `box-sizing:border-box`. Labels en `#2c5282` con `font-size:11px;letter-spacing:.3px` y sufijo `(€)` en BASE/CUOTA. Botón `✕ Tramo` con `height:fit-content`.

### 2.2 Eliminar `updateDesgloseSummary` y todas sus referencias

En el mismo `admin-facturas.js`:
- Eliminar las dos líneas `container.oninput = () => updateDesgloseSummary();` y `updateDesgloseSummary();` justo antes del `}` de cierre de `renderDesgloseBlocks`.
- Eliminar la función `updateDesgloseSummary()` completa (≈27 líneas, fuera de `renderDesgloseBlocks`).

**Fichero**: `app/frontend/src/admin-facturas.html`

Eliminar la línea:

```html
<div id="desglose-summary" style="margin-top:10px;padding:8px 10px;background:#ebf8ff;border:1px solid #bee3f8;border-radius:4px;font-size:12px;color:#2c5282;"></div>
```

Bumpear el cache-buster del script:

```html
<!-- antes -->
<script src="admin-facturas.js?v=20260421-003"></script>
<!-- después -->
<script src="admin-facturas.js?v=20260427-001"></script>
```

Verificación de limpieza:

```bash
cd /opt/setex/staging
grep -c "updateDesgloseSummary\|desglose-summary" app/frontend/src/admin-facturas.{js,html}
# debe imprimir 0 y 0
node --check app/frontend/src/admin-facturas.js
```

---

## 3. Fix 1 — Rate-limit granular + exención JWT

### 3.1 `authLimiter` con keyGenerator email+ip y `max: 20`

**Fichero**: `app/backend/src/middleware/rate-limit.js`

Sustituir la definición de `authLimiter` por la versión nueva con `keyGenerator` compuesto. Bloque exacto:

```javascript
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  keyGenerator: (req) => {
    const rawEmail = (req.body && typeof req.body.email === 'string') ? req.body.email : '';
    const email = rawEmail.trim().toLowerCase();
    const ip = (req.ip || '').replace(/^::ffff:/, '');
    return email ? `${email}|${ip}` : ip;
  },
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
});
```

### 3.2 Exención JWT en auto-block global

**Fichero**: `app/backend/src/server.js`

Localizar el middleware `// Capa 2: auto-block por exceso de peticiones` (≈línea 466). Justo después del `if (req.path.startsWith('/api/internal/')) return next();` y ANTES del `const cfg = loadSecurityConfig();`, insertar:

```javascript
const bearer = req.headers.authorization;
if (bearer && bearer.startsWith('Bearer ') && jwtSecretCached) {
  try {
    jwt.verify(bearer.slice(7), jwtSecretCached);
    return next();
  } catch { /* token inválido o expirado → seguir al contador */ }
}
```

Validar sintaxis:

```bash
node --check app/backend/src/middleware/rate-limit.js
node --check app/backend/src/server.js
```

---

## 4. Despliegue staging

```bash
cd /opt/setex/staging/app
docker compose build backend
docker compose stop backend && docker compose up -d backend
docker compose build frontend
docker compose stop frontend && docker compose up -d frontend
sleep 10
cd /opt/setex/staging
./scripts/health-check.sh
docker logs --tail 30 setex-staging-backend 2>&1 | grep -iE "error|warn" || echo "(sin warnings/errors)"
```

---

## 5. Validación post-deploy

### 5.1 OCR multi-IVA

Subir desde `https://staging.setex-facturas.es/` (basic-auth + login normal) una factura típica de hostelería con 21 % + 10 %. Los logs deben mostrar:

```
[DualOCR] Multi-IVA detectado (2 tramos) — agregados recalculados desde tramos: base=... cuota=... pct_dominante=...
```

En el panel admin, abrir el modal de desglose: deben aparecer los 2 tramos con sus inputs anchos y legibles, sin bloque Σ al pie.

### 5.2 UI desglose

Visualmente: 3 inputs (`IVA %` 110px, `BASE TRAMO` y `CUOTA TRAMO` 1fr cada uno), font-size 14px, alineación derecha en BASE/CUOTA. Cero referencia a `Σ bases`, `Σ cuotas`, `Total IVA` en pie del modal.

### 5.3 Rate-limit granular

```bash
# Test: 21 intentos fallidos del MISMO email desde la misma IP → 429 (correcto)
for i in $(seq 1 22); do
  curl -s -o /dev/null -w "$i: %{http_code}\n" \
    -X POST https://staging.setex-facturas.es/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"smoke-rate-limit@example.invalid","password":"x"}'
done
# Las primeras ~20 deben dar 401, a partir de la 21 → 429
```

```bash
# Test: 21 intentos con emails distintos desde la misma IP → todos 401, ninguno 429
for i in $(seq 1 22); do
  curl -s -o /dev/null -w "$i: %{http_code}\n" \
    -X POST https://staging.setex-facturas.es/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"user-$i@example.invalid\",\"password\":\"x\"}"
done
```

### 5.4 Exención JWT en auto-block global

Saturar el contador desde una IP de staging con peticiones autenticadas (`Authorization: Bearer <jwt-válido>`) — verificar que NUNCA se llega al 429. El mismo flujo sin token o con token inválido sí debe llegar al 429 tras 400 req/300s.

---

## 6. Rollback rápido (si algo va mal)

```bash
cd /opt/setex/staging
git stash               # si los cambios no están commiteados
# o
git checkout -- app/backend/src/ocr/openai.js \
                app/backend/src/ocr/index.js \
                app/backend/src/middleware/rate-limit.js \
                app/backend/src/server.js \
                app/frontend/src/admin-facturas.js \
                app/frontend/src/admin-facturas.html
mv app/backend/src/config/features.json.bak-2026-04-27 app/backend/src/config/features.json
cd app
docker compose build backend frontend
docker compose stop backend frontend && docker compose up -d backend frontend
```

---

## 7. Promoción staging → prod (cutover futuro)

Estado a 2026-04-27 noche: las Etapas 0-4 del descongelado v3 ya están mergeadas en `develop` (CI paridad + healthcheck + smoke HTTP). Pendientes Etapas 5 (validación staging 24-48h con monolito) y 6 (swap v3 a runtime + tag v2.0.0).

**Orden recomendado** para que estos hotfixes lleguen a prod sin colisiones:

1. **Cerrar Etapa 5** (validación 24-48h con monolito tras `deploy-staging.yml` arrancado).
2. **Cerrar Etapa 6** (swap a runtime v3 + 24-48h adicional con v3 en producción staging).
3. **Aplicar este pack a staging** sobre la rama `develop` ya con v3 en runtime — hacerlo en una rama dedicada `hotfix/2026-04-27-multi-iva-vpn` para que el diff sea revisable.
4. **PR de la rama de hotfixes a `develop`** + paso por CI paridad.
5. **PR `develop → main` + tag `v2.0.0`** que arrastra v3 + hotfixes en un único merge.
6. **Despliegue a prod manual** con `DESPLEGAR`. **Importante**: prod YA TIENE estos hotfixes aplicados directamente el 2026-04-27 PM. El merge `develop → main` puede generar conflictos en los 7 ficheros listados en la sección 8 — la decisión correcta en el conflicto es **quedarse con la versión de develop/staging** (que incluye los hotfixes integrados sobre v3).
7. **Verificación post-deploy prod**: `./scripts/health-check.sh` + smoke-test-ocr 04:30 del día siguiente + monitoring 24h.

---

## 8. Inventario de ficheros tocados (PM·1 + PM·2)

| Fichero | Cambio |
|---|---|
| `app/backend/Dockerfile` | **PM·2**: `RUN apk add --no-cache poppler-utils` (5 MB; aporta `pdftoppm` para PDF→JPEG) |
| `app/backend/src/ocr/openai.js` | **PM·1**: prompt multi-IVA + `optimizeImage` configurable. **PM·2**: imports os/path/child_process + función `_pdfFirstPageToJpegBuffer` + branch `application/pdf` en `optimizeImage` |
| `app/backend/src/ocr/index.js` | **PM·1**: recalcular agregados desde `lineas_iva` cuando hay ≥2 tramos |
| `app/backend/src/config/features.json` | **PM·1**: `image_max_resolution: 2048`, `image_jpeg_quality: 90` |
| `app/backend/src/middleware/rate-limit.js` | **PM·1**: `authLimiter` keyGenerator `email|ip`, `max: 20` |
| `app/backend/src/server.js` | **PM·1**: exención JWT válido en auto-block global (capa 2) |
| `app/frontend/src/app.js` | **PM·2**: `renderLineasIvaMulti` grid + botón ✕ Eliminar tramo en 2ª fila + eliminación `updateLineasIvaSummary` y sus 6 llamadas |
| `app/frontend/src/index.html` | **PM·2**: eliminado `<div id="confirm-lineas-iva-summary">` + cache-buster `app.js?v=20260427-002` |
| `app/frontend/src/admin-facturas.js` | **PM·1**: grid + eliminación `updateDesgloseSummary`. **PM·2**: ✕ Eliminar tramo a 2ª fila |
| `app/frontend/src/admin-facturas.html` | **PM·1**: quitar `<div id="desglose-summary">`. **PM·2**: cache-buster `?v=20260427-002` |

**Total: 10 ficheros (Dockerfile incluido). Cero cambios en `docker-compose.yml`. Cero cambios en rutas de auth existentes.**

---

## 9. Pasos extra PM·2 al replicar a staging

### 9.1 Dockerfile — añadir poppler-utils

**Fichero**: `app/backend/Dockerfile`

En la stage final (`FROM node:20-alpine` después del builder), antes del `addgroup`/`adduser`:

```dockerfile
# poppler-utils: pdftoppm para convertir primera página de PDF→JPEG antes de
# enviar a OpenAI Vision (la API rechaza application/pdf, solo acepta image/*).
# Azure DI procesa PDFs nativamente y no requiere conversión.
RUN apk add --no-cache poppler-utils
```

Validación tras rebuild:

```bash
docker exec setex-staging-backend which pdftoppm
docker exec setex-staging-backend pdftoppm -v 2>&1 | head -2
```

### 9.2 `openai.js` — `_pdfFirstPageToJpegBuffer` + branch PDF en `optimizeImage`

**Fichero**: `app/backend/src/ocr/openai.js`

Añadir imports al top (después del `require('sharp')`):

```javascript
const os    = require('os');
const path  = require('path');
const { spawnSync } = require('child_process');
```

Añadir función `_pdfFirstPageToJpegBuffer(filePath)` justo antes de `optimizeImage`. Bloque exacto:

```bash
sed -n '/_pdfFirstPageToJpegBuffer/,/^}/p' /opt/setex/prod/app/backend/src/ocr/openai.js
```

Modificar `optimizeImage` para añadir el branch PDF (al inicio, antes del check `!mimeType.startsWith('image/')`):

```javascript
if (mimeType === 'application/pdf') {
  const pdfJpeg = _pdfFirstPageToJpegBuffer(filePath);
  const optimized = await sharp(pdfJpeg)
    .resize({ width: maxRes, height: maxRes, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  return { buffer: optimized, mime: 'image/jpeg' };
}
```

### 9.3 Frontend modal comprobación — `app.js` + `index.html`

**Fichero**: `app/frontend/src/app.js`

En `renderLineasIvaMulti()`, sustituir el div `display:flex; flex:1/2/2` por grid `110px 1fr 1fr` (sin botón en el grid). Botón ✕ Eliminar tramo en segunda fila con `display:flex;justify-content:flex-end`. Eliminar la función `updateLineasIvaSummary()` completa y sus 6 referencias (4 dentro de event handlers, 1 `oninput`, 1 al final del render).

```bash
# Bloque exacto disponible en prod
sed -n '/renderLineasIvaMulti/,/^function readLineasIvaFromUI/p' /opt/setex/prod/app/frontend/src/app.js | head -120
```

**Fichero**: `app/frontend/src/index.html`

Eliminar `<div id="confirm-lineas-iva-summary">` (línea ≈229). Bumpear cache-buster:

```html
<script src="app.js?v=20260427-002"></script>
```

### 9.4 Admin — botón a 2ª fila

**Fichero**: `app/frontend/src/admin-facturas.js`

En `renderDesgloseBlocks()`, mover el `<button class="btn-desg-del-tramo">` fuera del grid de 4 columnas y ponerlo en una segunda fila con `display:flex;justify-content:flex-end;margin-bottom:10px`. Cambiar grid de `110px 1fr 1fr auto` a `110px 1fr 1fr`.

**Fichero**: `app/frontend/src/admin-facturas.html`

Cache-buster `admin-facturas.js?v=20260427-001 → ?v=20260427-002`.

### 9.5 Verificación post-deploy PM·2

```bash
# Cero referencias a Σ y a la summary en frontend desplegado
docker exec setex-staging-frontend grep -rE "Σ|sumBase|confirm-lineas-iva-summary|desglose-summary" /usr/share/nginx/html/ 2>/dev/null | head
# debe estar vacío

# pdftoppm operativo
docker exec setex-staging-backend pdftoppm -v 2>&1 | head -2

# Subir un PDF y revisar logs
docker logs --since 5m setex-staging-backend | grep -E "\[OCR\]|\[DualOCR\]"
# Debe verse OpenAI OK con lineasIva=N (antes fallaba con Invalid MIME type)
```

---

## 10. Pasos extra 2026-04-28 — Captura de foto profesional

### 10.1 Refactor `doCapturePhoto` + diálogo accesible

**Fichero**: `app/frontend/src/app.js`

Sustituir la función `doCapturePhoto()` (≈18 líneas) y añadir 3 funciones auxiliares (`showCameraDialog`, `closeCameraDialog`, `showCameraHelp`) además de las constantes `_cameraFailCount`, `_cameraFallbackForSession`, `CAMERA_TIMEOUT_MS`. Bloque exacto disponible en prod:

```bash
sed -n '/let _cameraFailCount/,/^function handleFile/p' /opt/setex/prod/app/frontend/src/app.js
```

Cambios funcionales clave (asegurar que están todos):
- Detección de capacidades + `isSecureContext` antes de cualquier intento.
- `navigator.permissions.query({name:'camera'})` envuelto en try/catch.
- `Promise.race(getUserMedia, timeout 8s)` con cleanup de tracks si la promesa real resuelve tarde.
- Diccionario de errores por `error.name`: `NotAllowedError`, `NotReadableError`, `NotFoundError`, `OverconstrainedError`, `SecurityError`, `AbortError`.
- `_cameraFailCount` con fallback a archivo tras 2 fallos.
- `showCameraDialog` con `role=dialog`, `aria-modal=true`, `aria-labelledby`, Esc cierra, click-outside cierra, focus automático en CTA primario, scroll-lock del body, sanitización HTML.

### 10.2 Cache-buster

**Fichero**: `app/frontend/src/index.html`

```html
<script src="app.js?v=20260428-001"></script>
```

### 10.3 Verificación post-deploy

```bash
# Sintaxis JS
node --check /opt/setex/staging/app/frontend/src/app.js

# Cache-buster servido
docker exec setex-staging-frontend grep -E "app\\.js\\?v=" /usr/share/nginx/html/index.html
# debe imprimir: app.js?v=20260428-001

# Test manual: en navegador, denegar cámara una vez → ver diálogo nuestro
# (no el del SO solamente). Reintentar → tras 2 fallos, el botón abre input
# file directamente en esa sesión.
```

### 10.4 Inventario actualizado (10 → 12 ficheros)

Añadir a la tabla de la sección 8:

| Fichero | Cambio |
|---|---|
| `app/frontend/src/app.js` | **2026-04-28**: refactor profesional `doCapturePhoto` (capabilities + Permissions API + timeout 8s + manejo errores específicos + memoria fallos sesión + diálogo accesible) |
| `app/frontend/src/index.html` | **2026-04-28**: cache-buster `app.js?v=20260428-001` |

### 10.5 Limpieza al replicar

Verificar que no quedan referencias del flujo antiguo:

```bash
grep -nE "\.catch\(\(\) => \{[[:space:]]*document\.getElementById\('camera-input'\)" \
  /opt/setex/staging/app/frontend/src/app.js
# debe estar vacío (ese era el catch silencioso del flujo previo)
```

```bash
# Cero referencias a Σ y a la summary en frontend desplegado
docker exec setex-staging-frontend grep -rE "Σ|sumBase|confirm-lineas-iva-summary|desglose-summary" /usr/share/nginx/html/ 2>/dev/null | head
# debe estar vacío

# pdftoppm operativo
docker exec setex-staging-backend pdftoppm -v 2>&1 | head -2

# Subir un PDF y revisar logs
docker logs --since 5m setex-staging-backend | grep -E "\[OCR\]|\[DualOCR\]"
# Debe verse OpenAI OK con lineasIva=N (antes fallaba con Invalid MIME type)
```

---

*Documento generado tras la sesión de hotfixes 2026-04-27 PM en `/opt/setex/prod/`. Mantener junto a `docs/INFORME_SISTEMA_COMPLETO.md` (entrada del mismo día).*
