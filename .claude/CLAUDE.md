# CLAUDE.md — SETEX Captura de Facturas
## setex-facturas.es · Abril 2026

## ⚠️ REGLA OBLIGATORIA — INFORME DEL SISTEMA
Al finalizar CUALQUIER sesión de desarrollo que introduzca cambios, DEBES actualizar:
`docs/INFORME_SISTEMA_COMPLETO.md` del entorno en el que estés trabajando.
Añadir entrada en la sección "Historial de Cambios" con fecha y descripción.
Este documento es la fuente de verdad del producto completo.

---

## 🎯 SIGUIENTE BLOQUE DE TRABAJO (2026-04-27 → próxima sesión)

**FASE 1B · Descongelado del refactor v3.** El código v3 (Rounds 1-15 + 5 hotfixes) está mergeado en `develop`, pero el SWAP runtime falló el 22-Abr (5 rutas `auth_request` faltantes). Está CONGELADO.

**Antes de tocar nada, lee este plan ejecutable autocontenido:**

📄 **`docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md`**

6 etapas, 3-4h concentradas:
- Etapa 0: PR a `develop` con rollback Round 16 (PRE-REQUISITO obligatorio)
- Etapa 1: portar 5 rutas faltantes al v3
- Etapa 2: test de paridad legacy↔v3 + integración CI
- Etapa 3: endurecer healthcheck container
- Etapa 4: smoke HTTP post-deploy
- Etapa 5: validación staging 24-48h
- Etapa 6: swap v3 a runtime + tag v2.0.0

⚠️ **Mina pisada hoy**: `develop` apunta al swap v3 ROTO (`0e48ab3`). Cualquier `deploy-staging.yml` reproduciría el incidente. La Etapa 0 elimina ese riesgo y debe hacerse PRIMERO.

📚 **Contexto adicional**: `docs/plans/MACROPLAN-SETEX-v2.0.md` (sección 5 historial Rounds, sección 17 estado ejecutable, sección 18 riesgos), `docs/INFORME_SISTEMA_COMPLETO.md` (entradas 2026-04-22 y 2026-04-27), `docs/ROADMAP.md` (Q2/Q3/Q4 actualizado).

---

## 📍 ESTADO ACTUAL DEL PROYECTO (2026-04-27)

La aplicación está construida y funcionando en producción. OCR integrado, tag **v1.0.0** entregado al cliente 2026-04-21. **NO es un proyecto OCR en construcción. ES un producto en producción.**
**Google Drive, Google Sheets y n8n completamente eliminados (2026-04-16).**

### Dos entornos paralelos (post-cutover Fase 4 · 2026-04-20)

| Entorno | Ruta | Dominio | Containers |
|---|---|---|---|
| Producción | `/opt/setex/prod/`  | `setex-facturas.es` | `setex-prod-{backend,frontend,postgres,redis}` |
| Staging    | `/opt/setex/staging/` | `staging.setex-facturas.es` | `setex-staging-{backend,frontend,postgres,redis}` |

Traefik reverse-proxy compartido (`n8n-traefik-1`) con Let's Encrypt para ambos.

**Contexto de entorno en scripts:** todos los scripts bash sourcean `scripts/lib/paths.sh`, que **autodetecta prod/staging** a partir del directorio de instalación (basename del `BASE_DIR`). Un mismo fichero paths.sh sirve para ambos entornos.

### Lo que YA FUNCIONA ✅
- Frontend vanilla JS — cámara, subida, preview, auth (ambos entornos)
- Backend Node.js — Express, multer, JWT, bcrypt
- Autenticación completa — registro, login, recuperación de contraseña por email
- OCR multi-motor dual — GPT-4.1 + Azure DI
- Procesamiento síncrono — OCR → confirmación → PostgreSQL
- Redis — cache de seguridad (rate limiting, bloqueos, previews OCR)
- Validación anti-alucinación — validateCIF.js + lista negra de CIFs falsos
- Detección duplicados — unique(user_id, nif, fecha, total)
- Panel admin en `/admin-facturas.html` — listado con Tabulator v6.3.0, edición inline, eliminar filas facturas/empresas, exportación Excel
- Rate limiting — auth 10/15min, uploads 30/15min
- Auditoría completa — tabla audit_logs con JSONB
- HTTPS — Traefik + Let's Encrypt (certificado a 3 meses renovación auto)
- Optimización imagen — sharp 1536px, JPEG 85% (~300KB vs 6MB)
- Endpoints RGPD — GET /api/me/export (art. 15+20) · DELETE /api/me/account (art. 17)
- Watchdog 5min + fix-permissions 1h + backup cifrado 03:00 + smoke OCR 04:30 + offsite 05:00 (prod; staging sin crons por defecto)

---

## ⚠️ PROBLEMAS CONOCIDOS ACTIVOS

### CRÍTICO — Refactor v3 CONGELADO en `develop` (post-incidente Round 16)
Develop tiene HEAD apuntando al SWAP v3 (PR #83) que SABEMOS roto en runtime: 5 rutas `auth_request` faltantes (`/api/internal/check-access`, `/check-admin-page`, `/admin/refresh-session`, `/admin/retry-failed/:id`, `/admin/security/time`). Cualquier `deploy-staging.yml` reproduce el incidente del 22-Abr. **Mitigación pendiente**: ejecutar Etapa 0 de `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` antes que cualquier otra cosa.

### MEDIO — Deuda de ownership root:root en /opt/setex/{prod,staging}
Detectada y mitigada manualmente el 2026-04-27 durante el deploy del PR #84. 195 ficheros del refactor v3 tenían owner `root:root` (contaminación por `git pull` previos como root) y el user `deploy` no podía borrarlos durante `git reset --hard origin/main`. Fix aplicado: `sudo chown -R deploy:deploy app scripts docs tests .husky package*.json commitlint.config.js .gitignore`. **Mitigación permanente pendiente**: añadir un step similar al `scripts/fix-permissions.sh` (cron 1h ya activo) que filtre con `-user root -o -group root` y aplique chown automáticamente. Tarea en ROADMAP Q2.

### MEDIO — PaddleOCR instalado pero sin usar (~3 GB)
`paddleocr.js` existe pero `ocr/index.js` NO lo llama. Decisión pendiente: integrarlo o desinstalar. ROADMAP Q3.

### (Resuelto 2026-04-27) — Symlink legacy y YAML estático Traefik eliminados
Ya no hay symlink `/opt/setex-captu-facture` ni target `/opt/setex-captu-facture.OLD-2026-04-20` (109 MB liberados, tarball en `/opt/setex/shared/backups/`). El YAML estático `/docker/n8n/traefik-dynamic/setex.yml` también borrado: HSTS migrado a nginx con `max-age=315360000` (10 años) y redirect xanflatest.com a labels Docker en `setex-prod-frontend`. `/etc/logrotate.d/setex` ahora cubre `/opt/setex/{prod,staging}/logs/*.log`. Vulnerabilidad GHSA-w5hq-g745-h8pq cerrada en `package.json` con `"overrides": {"uuid": "^14.0.0"}`. Detalle completo en `docs/INFORME_SISTEMA_COMPLETO.md` entrada 2026-04-27.

---

## 🗂️ MAPA DE ARCHIVOS CRÍTICOS (idéntico en ambos entornos)

```
{BASE_DIR}/
├── app/
│   ├── backend/src/
│   │   ├── server.js                    ← CORE (toda la lógica HTTP)
│   │   ├── config/
│   │   │   ├── features.json            ← TOGGLES EN CALIENTE (sin rebuild)
│   │   │   └── index.js                 ← loader con defaults seguros
│   │   ├── ocr/
│   │   │   ├── index.js                 ← orquestador multi-motor + salvaguarda aritmética IRPF
│   │   │   ├── openai.js                ← GPT-4.1 ACTIVO (prompt con regla IRPF reforzada 2026-04-21)
│   │   │   ├── azure.js                 ← Azure DI ACTIVO (dual)
│   │   │   ├── gemini.js                ← DESACTIVADO
│   │   │   ├── paddleocr.js             ← NO integrado (ver problemas)
│   │   │   └── validateCIF.js           ← anti-alucinaciones
│   │   ├── services/{audit,auth}/       ← Strangler-Fig Rounds 1-4
│   │   ├── repositories/                ← Repository pattern (R3)
│   │   ├── domain/{validators,calculators,parsers}/
│   │   ├── middleware/{rate-limit,request-id}.js
│   │   └── lib/{errors,filename-generator,normalize-amount}.js
│   ├── frontend/src/
│   │   ├── app.js                       ← JS usuario (cache-buster v=AAAAMMDD-NNN)
│   │   ├── index.html                   ← UI captura
│   │   ├── admin-facturas.{html,js,css} ← panel admin (Tabulator)
│   │   └── auth.js                      ← wrapper apiFetch + refresh JWT
│   └── docker-compose.yml               ← NO TOCAR sin OK de Julio
├── scripts/
│   ├── lib/paths.sh                     ← FUENTE ÚNICA (autodetect prod/staging)
│   ├── watchdog.sh                      ← cron 5min (idéntico en ambos entornos)
│   ├── fix-permissions.sh               ← cron :00
│   ├── backup-postgres.sh               ← cron 03:00 (GPG + PIPESTATUS + MIN_BYTES)
│   ├── backup-offsite-replicate.sh      ← cron 05:00 (VPS 72.62.189.27)
│   ├── smoke-test-ocr.js                ← cron 04:30 (OpenAI + Azure DI)
│   ├── health-check.sh                  ← manual
│   ├── manage-whitelist.sh              ← manual (allowed_emails)
│   ├── list-invalid-cifs.js             ← auditoría CIFs AEAT
│   ├── migrate-uploads.js               ← migración puntual
│   ├── seed-staging.{sh,js}             ← alta datos de prueba en staging
│   └── backup-db.sh                     ← ⚠️ DEPRECATED (usar backup-postgres.sh)
├── secrets/                             ← JWT, postgres, openai, azure, redis, smtp, backup, offsite
├── config/crontab.txt                   ← template cron del entorno
├── docs/
│   ├── INFORME_SISTEMA_COMPLETO.md      ← fuente de verdad + historial de cambios
│   ├── plans/MACROPLAN-SETEX-v2.0.md    ← plan maestro fases F0-F4
│   ├── ROADMAP.md                       ← Q2/Q3/Q4 2026
│   ├── PLAYBOOK_EMERGENCIAS.md
│   ├── GUIA_USUARIO.md                  ← manual cliente (RGPD, ventana 00-06, soporte)
│   ├── DECISIONS.md                     ← ADRs
│   └── audits/AUDIT-YYYY-MM-DD.md       ← auditorías forenses trimestrales
└── tests/
    ├── stress-test.sh                   ← sourcea ../scripts/lib/paths.sh
    └── e2e-tests.sh
```

---

## ⚙️ CONFIGURACIÓN ACTIVA (features.json)

```json
{
  "ocr_enabled": true,
  "ocr_mode": "dual",
  "ocr_primary_engine": "openai",
  "image_max_resolution": 1536,
  "image_jpeg_quality": 85
}
```

**Cambios en features.json → efecto INMEDIATO (volume-mounted). NO requiere rebuild.**

---

## 🔄 FLUJO COMPLETO DE UNA FACTURA

```
1. POST /api/upload-preview  →  multer diskStorage → /app/uploads/
2. Validación magic bytes (JPEG/PNG/PDF)
3. Sharp optimize → 1536px, JPEG 85% (~300 KB)
4. OCR síncrono → GPT-4.1 + Azure DI dual (2-5s, usuario espera)
5. Preview almacenado en Redis (TTL 30min)
6. Usuario revisa/corrige en modal de confirmación
7. POST /api/upload-confirm → validación campos → CIF/NIF + fecha + total
8. Detección duplicados → unique(user_id, nif, fecha, total)
9. INSERT uploads table → PostgreSQL (procesado_en = NOW())
10. Respuesta → success | duplicate | missing_fields
```

---

## 🛠️ COMANDOS OPERATIVOS

Todos los comandos asumen `cd /opt/setex/prod` o `cd /opt/setex/staging` previo. Los scripts resuelven containers y rutas automáticamente vía `scripts/lib/paths.sh`.

```bash
# Estado general del entorno activo
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep "setex-$(basename $PWD)-"

# Rebuild y redeploy backend (cuando cambia código fuente)
cd app
docker compose build backend && docker compose stop backend && docker compose up -d backend

# Solo restart (cuando cambian features.json o secrets)
docker compose restart backend

# Logs en tiempo real
docker compose logs -f backend
docker compose logs -f frontend

# Health check rápido (detecta entorno automáticamente)
./scripts/health-check.sh

# Redis debug (usa paths.sh para el nombre de container)
source scripts/lib/paths.sh && docker exec "$CONTAINER_REDIS" redis-cli -a "$(docker exec "$CONTAINER_REDIS" grep -m1 requirepass /etc/redis/redis.conf | awk '{print $2}')" INFO memory

# PostgreSQL — facturas procesadas
source scripts/lib/paths.sh && docker exec "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT COUNT(*), COUNT(procesado_en) AS procesadas FROM uploads;"

# Backup manual cifrado
./scripts/backup-postgres.sh
```

---

## ⚠️ REGLAS CRÍTICAS

1. **NUNCA** tocar `docker-compose.yml` sin confirmación explícita de Julio
2. **NUNCA** modificar rutas de auth sin confirmación
3. **SIEMPRE** rebuild antes de restart cuando cambias código en `src/`
4. **features.json** cambia en caliente → NO rebuild necesario
5. **Secretos** en `/run/secrets/` SIEMPRE, nunca hardcoded ni en `.env`
6. **Cache-buster** en `index.html` + `admin-facturas.html` → actualizar `?v=YYYYMMDD-NNN` al cambiar JS/CSS
7. `docker compose restart` NO recarga env vars → usar `stop` + `up -d`
8. **Google Drive, Sheets y n8n eliminados** — no añadir código relacionado
9. **Scripts bash NUEVOS** deben `source "${SCRIPT_DIR}/lib/paths.sh"` para contenedores/dominio/rutas; NO hardcodear `setex-prod-*`, `setex-staging-*` ni dominios. El fichero paths.sh autodetecta el entorno.
10. **Auditorías firmadas** (`INFORME_SEGURIDAD.md`, `AUDIT-*.md`, `REVISION_*`, `DECISIONS.md`) son documentos históricos — no reescribir contenido antiguo, solo añadir entradas nuevas al historial

---

*SETEX Captura Facturas · setex-facturas.es · Actualizado 2026-04-27 (cierre Q2 cleanup post-cutover Fase 4 · PR #84 + deploy + uuid override + plan FASE 1B descongelado v3)*
