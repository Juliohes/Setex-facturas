# CLAUDE.md — SETEX Captura de Facturas
## setex-facturas.es · Estado real del proyecto · Abril 2026

## ⚠️ REGLA OBLIGATORIA — INFORME DEL SISTEMA
Al finalizar CUALQUIER sesión de desarrollo que introduzca cambios, DEBES actualizar:
`/opt/setex-captu-facture/docs/INFORME_SISTEMA_COMPLETO.md`
Añadir entrada en la sección 18 (Historial de Cambios) con fecha y descripción de cada cambio.
Este documento es la fuente de verdad del producto completo.

---

## 📍 ESTADO ACTUAL DEL PROYECTO (2026-04-16)

La aplicación está construida y funcionando en producción. El OCR ya está integrado.
**NO es un proyecto OCR en construcción. ES un producto en producción.**
**Google Drive, Google Sheets y n8n han sido completamente eliminados del proyecto (2026-04-16).**

### Lo que YA FUNCIONA ✅
- Frontend vanilla JS — cámara, subida, preview, auth
- Backend Node.js — Express, multer, JWT, bcrypt
- Autenticación completa — registro, login, recuperación de contraseña por email
- OCR multi-motor — GPT-4.1 + Azure DI dual mode
- Procesamiento síncrono — OCR → confirmación → PostgreSQL (sin cola async)
- Redis — cache de seguridad (rate limiting, bloqueos, previews OCR)
- Validación anti-alucinación — validateCIF.js + lista negra de CIFs falsos
- Detección de duplicados — unique constraint (user_id, nif, fecha, total)
- Panel admin OCR — cambio de motor en caliente sin rebuild
- Rate limiting — auth 10/15min, uploads 30/15min (configurable)
- Auditoría completa — tabla audit_logs con JSONB
- HTTPS — Traefik + Let's Encrypt (xanflatest.com)
- Optimización de imagen — sharp resize 1536px, JPEG 85% (~300KB vs 6MB)

### Infraestructura Docker activa
```
setex-postgres   postgres:15-alpine   (healthy)
setex-backend    app-backend          (healthy)
setex-redis      redis:7-alpine       (healthy)
setex-frontend   app-frontend         (healthy)
traefik          traefik:latest       (reverse proxy HTTPS)
```

---

## ⚠️ PROBLEMAS CONOCIDOS ACTIVOS

### MEDIO — PaddleOCR instalado pero sin usar
- Venv en `/opt/setex-captu-facture/ocr-service/` (~3 GB en disco)
- `paddleocr.js` existe pero `ocr/index.js` NO lo llama
- Consume espacio sin beneficio
- Decisión pendiente: integrarlo o desinstalarlo

---

## 🗂️ MAPA DE ARCHIVOS CRÍTICOS

```
/opt/setex-captu-facture/
├── app/
│   ├── backend/src/
│   │   ├── server.js                    ← CORE (803 líneas, toda la lógica)
│   │   ├── config/
│   │   │   ├── features.json            ← TOGGLES EN CALIENTE (sin rebuild)
│   │   │   └── index.js                 ← loader con defaults seguros
│   │   ├── ocr/
│   │   │   ├── index.js                 ← orquestador multi-motor (166 líneas)
│   │   │   ├── openai.js                ← GPT-4.1 ACTIVO (182 líneas)
│   │   │   ├── azure.js                 ← Azure DI listo (234 líneas)
│   │   │   ├── gemini.js                ← DESACTIVADO (266 líneas)
│   │   │   ├── paddleocr.js             ← local, NO integrado (39 líneas)
│   │   │   └── validateCIF.js           ← validador anti-alucinaciones (72 líneas)
│   │   ├── services/
│   │   │   └── viesValidator.js         ← validación VIES (NIF europeo)
│   │   └── queue/
│   │       └── index.js                 ← conexión Redis (seguridad + previews)
│   ├── frontend/src/
│   │   ├── app.js                       ← TODO el JS frontend (351 líneas)
│   │   └── index.html                   ← HTML + cache-buster version
│   └── docker-compose.yml               ← 143 líneas, 4 servicios + traefik
├── secrets/                             ← JWT, postgres, openai, azure, redis, smtp, backup
├── docs/
│   ├── INFORME_SEGURIDAD.md             ← auditoría (11 KB)
│   ├── INFORME_CAPACIDAD_Y_RENDIMIENTO.md ← stress test (11 KB)
│   └── INFORME_VERIFACTU.md             ← regulatorio España (66 KB)
└── ocr-service/                         ← PaddleOCR Python (sin usar)
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
10. Respuesta al usuario → success/duplicate/missing_fields
```

---

## 🚀 PRÓXIMOS PASOS (ordenados por prioridad)

### P1 — Mejoras de seguridad pendientes
1. **CSRF protection**: middleware csrf-csrf (pendiente del informe de seguridad)
2. **httpOnly cookies**: migrar JWT de localStorage a httpOnly (más seguro)

### P2 — Funcionalidades nuevas
3. **Multi-empresa**: soporte para múltiples empresas con facturación separada
4. **Notificaciones**: email cuando se procesa una factura

### P3 — Optimización y limpieza
5. **Remover PaddleOCR o integrarlo**: decisión pendiente (3 GB en disco, sin uso)
6. **Backup offsite**: replicar backups cifrados a cloud storage externo

---

## 📊 RENDIMIENTO (stress test 2026-03-02)

| Concurrencia | Éxito | Facturas/min | Nota |
|:---:|:---:|:---:|:---|
| x1 | 100% | 15 | Referencia |
| x3 | **100%** | **58** | **ÓPTIMO** |
| x5 | 73% | 83 | Acceptable |
| x10 | 40% | 122 | Inestable |
| x15+ | 0% | — | Sharp CPU exhaustion |

**Bottleneck**: Sharp (0.5 CPU limit). Subir a 1.0 CPU → concurrencia óptima x5-x7.

---

## 🛠️ COMANDOS OPERATIVOS

```bash
# Estado general
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Rebuild y redeploy backend (cuando cambia código fuente)
cd /opt/setex-captu-facture/app
docker compose build backend && docker compose stop backend && docker compose up -d backend

# Solo restart (cuando cambian features.json o secrets)
docker compose restart backend

# Logs en tiempo real
docker compose logs -f backend
docker compose logs -f frontend

# Redis debug
docker exec setex-redis redis-cli -a "$(docker exec setex-redis grep -m1 requirepass /etc/redis/redis.conf | awk '{print $2}')" INFO memory

# PostgreSQL — facturas procesadas
docker exec setex-postgres psql -U setex_user -d setex_db \
  -c "SELECT COUNT(*), COUNT(procesado_en) AS procesadas FROM uploads;"

# Backup manual cifrado
/opt/setex-captu-facture/scripts/backup-postgres.sh
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

---

*SETEX Captura Facturas · setex-facturas.es · Actualizado 2026-04-16*
