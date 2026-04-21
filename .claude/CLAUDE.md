# CLAUDE.md — SETEX Captura de Facturas (prod)
## setex-facturas.es · Estado real · Abril 2026

## ⚠️ REGLA OBLIGATORIA — INFORME DEL SISTEMA
Al finalizar CUALQUIER sesión de desarrollo que introduzca cambios, DEBES actualizar:
`/opt/setex/prod/docs/INFORME_SISTEMA_COMPLETO.md`
Añadir entrada en la sección "Historial de Cambios" con fecha y descripción.
Este documento es la fuente de verdad del producto completo.

---

## 📍 ESTADO ACTUAL DEL PROYECTO (2026-04-21)

La aplicación está construida y funcionando en producción. OCR integrado, entregada al cliente.
**NO es un proyecto OCR en construcción. ES un producto en producción con tag v1.0.0.**
**Google Drive, Google Sheets y n8n completamente eliminados (2026-04-16).**

### Rutas reales post-cutover Fase 4 (2026-04-20)
- Código vivo: `/opt/setex/prod/` y `/opt/setex/staging/`
- Legacy symlink (pendiente de borrar tras semana de gracia): `/opt/setex-captu-facture → /opt/setex-captu-facture.OLD-2026-04-20`
- Todos los scripts operativos usan `scripts/lib/paths.sh` como fuente única de rutas, contenedores y dominio.

### Infraestructura Docker activa (post-cutover)
```
setex-prod-postgres    postgres:15-alpine   (healthy)
setex-prod-backend     app-backend          (healthy)
setex-prod-redis       redis:7-alpine       (healthy)
setex-prod-frontend    app-frontend         (healthy)
n8n-traefik-1          traefik:latest       (reverse proxy HTTPS)
```

Staging: mismos servicios con prefijo `setex-staging-*` sirviendo `staging.setex-facturas.es`.

### Lo que YA FUNCIONA ✅
- Frontend vanilla JS — cámara, subida, preview, auth
- Backend Node.js — Express, multer, JWT, bcrypt
- Autenticación completa — registro, login, recuperación de contraseña por email
- OCR multi-motor dual — GPT-4.1 + Azure DI
- Procesamiento síncrono — OCR → confirmación → PostgreSQL
- Redis — cache de seguridad (rate limiting, bloqueos, previews OCR)
- Validación anti-alucinación — validateCIF.js + lista negra de CIFs falsos
- Detección duplicados — unique(user_id, nif, fecha, total)
- Panel admin OCR — cambio de motor en caliente sin rebuild
- Rate limiting — auth 10/15min, uploads 30/15min
- Auditoría completa — tabla audit_logs con JSONB
- HTTPS — Traefik + Let's Encrypt (`setex-facturas.es`)
- Optimización imagen — sharp 1536px, JPEG 85% (~300KB vs 6MB)
- Endpoints RGPD — GET /api/me/export (art. 15+20) · DELETE /api/me/account (art. 17)
- Watchdog 5min + fix-permissions 1h + backup cifrado 03:00 + smoke OCR 04:30 + offsite 05:00

---

## ⚠️ PROBLEMAS CONOCIDOS ACTIVOS

### MEDIO — PaddleOCR instalado pero sin usar
- Venv en directorio `ocr-service/` del symlink legacy (~3 GB)
- `paddleocr.js` existe pero `ocr/index.js` NO lo llama
- Decisión pendiente: integrarlo o desinstalarlo (ROADMAP Q3)

### BAJO — Symlink legacy activo
- `/opt/setex-captu-facture → /opt/setex-captu-facture.OLD-2026-04-20`
- Pendiente de borrar tras 1 semana de gracia (ROADMAP Q2)
- Ningún script/cron activo depende del symlink tras el fix de 2026-04-21

---

## 🗂️ MAPA DE ARCHIVOS CRÍTICOS

```
/opt/setex/prod/
├── app/
│   ├── backend/src/
│   │   ├── server.js                    ← CORE (toda la lógica HTTP)
│   │   ├── config/
│   │   │   ├── features.json            ← TOGGLES EN CALIENTE (sin rebuild)
│   │   │   └── index.js                 ← loader con defaults seguros
│   │   ├── ocr/
│   │   │   ├── index.js                 ← orquestador multi-motor
│   │   │   ├── openai.js                ← GPT-4.1 ACTIVO
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
│   │   ├── app.js                       ← JS frontend (cache-buster v=AAAAMMDD-NNN)
│   │   └── index.html
│   └── docker-compose.yml               ← NO TOCAR sin OK de Julio
├── scripts/
│   ├── lib/paths.sh                     ← FUENTE ÚNICA rutas/containers/dominio
│   ├── watchdog.sh                      ← cron 5min (idéntico al de staging)
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
├── config/crontab.txt                   ← template cron actualizado
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

## 🛠️ COMANDOS OPERATIVOS (post-cutover)

```bash
# Estado general
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep setex-prod

# Rebuild y redeploy backend (cuando cambia código fuente)
cd /opt/setex/prod/app
docker compose build backend && docker compose stop backend && docker compose up -d backend

# Solo restart (cuando cambian features.json o secrets)
docker compose restart backend

# Logs en tiempo real
docker compose logs -f backend
docker compose logs -f frontend

# Redis debug (container: setex-prod-redis)
docker exec setex-prod-redis redis-cli -a "$(docker exec setex-prod-redis grep -m1 requirepass /etc/redis/redis.conf | awk '{print $2}')" INFO memory

# PostgreSQL — facturas procesadas (container: setex-prod-postgres)
docker exec setex-prod-postgres psql -U setex_user -d setex_db \
  -c "SELECT COUNT(*), COUNT(procesado_en) AS procesadas FROM uploads;"

# Backup manual cifrado
/opt/setex/prod/scripts/backup-postgres.sh

# Health check rápido
/opt/setex/prod/scripts/health-check.sh
```

---

## ⚠️ REGLAS CRÍTICAS

1. **NUNCA** tocar `docker-compose.yml` sin confirmación explícita de Julio
2. **NUNCA** modificar rutas de auth sin confirmación
3. **SIEMPRE** rebuild antes de restart cuando cambias código en `src/`
4. **features.json** cambia en caliente → NO rebuild necesario
5. **Secretos** en `/run/secrets/` SIEMPRE, nunca hardcoded ni en `.env`
6. **Cache-buster** en `index.html` → actualizar `?v=YYYYMMDD-NNN` al cambiar JS/CSS
7. `docker compose restart` NO recarga env vars → usar `stop` + `up -d`
8. **Google Drive, Sheets y n8n eliminados** — no añadir código relacionado
9. **Scripts bash NUEVOS** deben `source "${SCRIPT_DIR}/lib/paths.sh"` para contenedores/dominio/rutas; NO hardcodear `setex-*` ni `setex-facturas.es`
10. **Auditorías firmadas** (`INFORME_SEGURIDAD.md`, `AUDIT-*.md`, `REVISION_*`) son históricas — no reescribir contenido antiguo, solo añadir entradas nuevas al historial

---

*SETEX Captura Facturas · setex-facturas.es · Actualizado 2026-04-21 tras fix watchdog post-cutover*
