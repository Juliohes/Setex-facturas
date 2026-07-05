# CLAUDE.md — SETEX Captura de Facturas (DOCUMENTO MAESTRO)

> **Última actualización**: 2026-05-03 · **Versión**: 1.0 (consolidación documental)
>
> Este documento sustituye a: `README.md`, `CONTRIBUTING.md`, `GUIA_ADMINISTRACION.md`, `INFORME-TECNICO-SETEX.md`, `INSTALL_AGENTS_v3.md`.
>
> **NO sustituye** (intocables, regla 10): `docs/DECISIONS.md`, `docs/INFORME_SEGURIDAD.md`, `docs/INFORME_AUDITORIA_SEGURIDAD_2026.md`, `docs/audits/AUDIT-*.md`, `docs/REVISION_*`, `docs/adr/000*.md`.
>
> **Documentos vivos paralelos** (referenciados en §11, no absorbidos): `docs/INFORME_SISTEMA_COMPLETO.md`, `docs/plans/MACROPLAN-SETEX-v2.0.md`, `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md`, `docs/ROADMAP.md`, `docs/PLAYBOOK_EMERGENCIAS.md`, `docs/GUIA_USUARIO.md`, `docs/INFORME_CAPACIDAD_Y_RENDIMIENTO.md`, `docs/INFORME_OCR_IVA_FACTURAS_ESPANOLAS.md`.

---

## 0. Cómo leer este documento

| Si eres… | Empieza por |
|---|---|
| **Claude Code** (cualquier sesión) | §4 (reglas críticas) — son inviolables. Después §3 (arquitectura) y §10 (estado actual) para contexto. |
| **Humano operando** (deploy, mantenimiento) | §8 (operación diaria) y §9 (flujo git). |
| **Auditor de seguridad** | §5 (seguridad y cumplimiento) y §11 (referencias a documentos firmados). |
| **Cualquiera que dude** si tocar algo | §4 (reglas críticas). En la duda, NO se toca. |

**⚠️ REGLA OBLIGATORIA — INFORME DEL SISTEMA**

Al finalizar CUALQUIER sesión de desarrollo que introduzca cambios, DEBES actualizar `docs/INFORME_SISTEMA_COMPLETO.md` del entorno en el que estés trabajando. Añadir entrada en la sección "Historial de Cambios" con fecha y descripción. Es la fuente de verdad histórica del producto.

---

## 1. CONTEXTO DEL PROYECTO

### 1.1 Qué es SETEX

SETEX es una asesoría contable y fiscal española que gestiona la administración de múltiples empresas clientes (pymes y autónomos). Esta aplicación es una **PWA (Progressive Web App) para captura móvil de facturas**: el cliente fotografía la factura desde el móvil, la IA extrae los datos fiscales (NIF, fecha, base imponible, IVA, IRPF, total, proveedor…), el usuario los confirma y la factura queda registrada en PostgreSQL para consumo del equipo contable.

**Flujo en una frase**: cliente saca foto → IA lee datos → usuario confirma → factura registrada en BD.

### 1.2 Cliente, volumen, escala

| Magnitud | Valor |
|---|---|
| Cliente | Asesoría contable española (~200-250 empresas cliente) |
| Volumen normal | ~5 000-6 000 facturas/mes |
| Picos trimestrales | hasta ~15 000 facturas/mes (cierres fiscales: Enero, Abril, Julio, Octubre) |
| Concurrencia óptima medida | 3 simultáneas (100 % éxito) — ver `docs/INFORME_CAPACIDAD_Y_RENDIMIENTO.md` |
| Throughput máximo fiable | 58 facturas/minuto |
| Latencia OCR media | 3 s/factura (dual GPT-4.1 + Azure DI) |

### 1.3 Dominios y entorno

| Concepto | Valor |
|---|---|
| Dominio principal | `setex-facturas.es` |
| Dominio alias | `xanflatest.com` (apunta al mismo backend) |
| Subdominio staging | `staging.setex-facturas.es` (BasicAuth Traefik) |
| VPS | Hostinger KVM 2, Ubuntu 24.04 LTS, IP `72.60.186.89` |
| Datacenter | París (ventaja GDPR) |
| Cumplimiento | RGPD/LOPDGDD aplica · Verifactu descartado como aplicable a SETEX |

### 1.4 Estado: producción + staging

La aplicación está construida y funcionando en producción. OCR integrado, tag **v1.0.0** entregado al cliente 2026-04-21, **v1.1.0** (desglose multi-IVA) en main. **v2.0.0 promocionada el 2026-04-28 con bug LL-002 y revertida quirúrgicamente en disco el mismo día**: producción runtime corre el **monolito 4308 líneas**. El revert (`508d7ae`) **no está mergeado a main** — ver §10.1 y REGLA 11. **Esto NO es un proyecto en construcción. ES un producto en producción.**

### 1.5 Historia breve

El proyecto vivió originalmente en `/opt/setex-captu-facture` (entorno único). El 2026-04-20 se cutoverea a la convención de dos entornos paralelos en `/opt/setex/{prod,staging}/` (Fase 4). Google Drive, Google Sheets y n8n se eliminaron completamente el 2026-04-16 (regla 8). El symlink legacy `/opt/setex-captu-facture` se retiró el 2026-04-27 (109 MB liberados, tarball en `/opt/setex/shared/backups/`).

---

## 2. STACK TÉCNICO REAL

### 2.1 Componentes con versiones exactas

| Capa | Tecnología | Versión / detalle |
|---|---|---|
| Frontend | Vanilla JavaScript ES6+ + HTML5 + CSS3 | Sin framework, sin bundler. Tabulator v6.3.0 en panel admin |
| Backend | Node.js + Express | Node 20, Express 4.18 |
| Base de datos | PostgreSQL | 15 (Alpine) — 12 tablas, ~68 MB |
| Cache / seguridad | Redis | 7 (Alpine) — rate limiting + previews OCR (TTL 30 min) |
| Servidor web interno | Nginx | 1.25 (Alpine) — sirve estáticos + reverse proxy a Express |
| Reverse proxy externo | Traefik | Compartido — contenedor `n8n-traefik-1` (nombre histórico, n8n eliminado 2026-04-16; el contenedor sigue operativo solo como Traefik). Let's Encrypt automático |
| OCR primario | OpenAI GPT-4.1 Vision | dual con Azure DI (consenso + salvaguarda aritmética IRPF) |
| OCR secundario | Azure Document Intelligence | `prebuilt-invoice` v4.0 (2024-11-30 GA) |
| Optimización imagen | sharp | 1536 px máx · JPEG 85 % (~300 KB vs 6 MB original) |
| Contenedores | Docker Compose | 4 prod + 4 staging + 1 Traefik compartido |
| Autenticación | bcrypt (12 rounds) + JWT (refresh rotation) | Access en memoria · Refresh httpOnly cookie |
| Email | Nodemailer (SMTP) | Recuperación de contraseña |

### 2.2 OCR dual GPT-4.1 + Azure DI — por qué

GPT-4.1 Vision lee la factura como un humano y devuelve campos estructurados (~95 % precisión, 6-8 s, ~0,007 USD/factura). Azure DI `prebuilt-invoice` aporta extracción especializada con tablas y separación proveedor/receptor. La salvaguarda aritmética IRPF en `app/backend/src/ocr/index.js` cruza ambas fuentes y corrige errores antes de mostrar al usuario. Detalle técnico exhaustivo en `docs/INFORME_OCR_IVA_FACTURAS_ESPANOLAS.md`.

### 2.3 Lo que NO está y NO debe volver

- **Google Drive**, **Google Sheets**, **n8n**: eliminados completamente el 2026-04-16. No reintroducir código relacionado (regla 8).
- **PaddleOCR**: instalado en disco (~3 GB) pero `ocr/index.js` NO lo llama. Decisión pendiente Q3 2026: integrarlo o desinstalar.
- **Gemini**: `gemini.js` desactivado (no llamado desde el orquestador).

---

## 3. ARQUITECTURA Y FLUJO

### 3.1 Diagrama de capas

```
Internet (HTTPS / Let's Encrypt)
      │
  Traefik 443/80  ──── BasicAuth para staging.setex-facturas.es
      │
setex-{env}-frontend (Nginx 1.25)
      │  reverse proxy → / y /api/
      ▼
setex-{env}-backend (Node.js 20 + Express 4.18)
      │
      ├──► setex-{env}-postgres (PostgreSQL 15)
      ├──► setex-{env}-redis    (Redis 7 — rate limit + OCR cache)
      ├──► OpenAI API           (GPT-4.1 Vision)
      └──► Azure DI API         (prebuilt-invoice)

env ∈ {prod, staging} — autodetectado por scripts/lib/paths.sh
```

Toda la red interna Docker está aislada. Solo el frontend está expuesto vía Traefik.

### 3.2 Las 12 tablas de BD (resumen)

`users`, `password_reset_tokens`, `allowed_emails`, `uploads`, `audit_logs`, `failed_logins`, `refresh_tokens`, `revoked_tokens`, `admin_sessions`, `cif_blacklist`, `feature_flags`, `health_checks`. Esquema y FKs detallados en `docs/INFORME_SISTEMA_COMPLETO.md`.

### 3.3 Flujo completo de una factura

```
1. POST /api/upload-preview  →  multer diskStorage → /app/uploads/
2. Validación magic bytes (JPEG/PNG/PDF) — fail-secure
3. sharp optimize → 1536 px, JPEG 85 % (~300 KB)
4. OCR síncrono → GPT-4.1 + Azure DI dual (2-5 s, usuario espera)
5. Salvaguarda aritmética IRPF en ocr/index.js
6. Preview almacenado en Redis (TTL 30 min)
7. Usuario revisa/corrige en modal de confirmación
8. POST /api/upload-confirm → validateCIF.js + lista negra + validación campos
9. Detección duplicados → unique(user_id, nif, fecha, total)
10. INSERT uploads → PostgreSQL (procesado_en = NOW())
11. Respuesta → success | duplicate | missing_fields
```

### 3.4 Latencias y capacidad

| Métrica | Valor medido |
|---|---|
| Latencia OCR (dual) | 2-5 s |
| Concurrencia óptima | 3 simultáneas |
| Throughput máximo fiable | 58 facturas/minuto |
| Capacidad horaria | ~3 480 facturas/hora |
| Cuello de botella | CPU del backend (limitado a 0.5 vCPU) — no OCR ni RAM ni red |
| Disponibilidad OCR | 100 % (con failover GPT-4.1 ↔ Azure DI) |

---

## 4. REGLAS CRÍTICAS INVIOLABLES

Estas 11 reglas son la frontera de seguridad operativa del proyecto. Violarlas tiene consecuencias en producción.

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
11. **DESCALCE main vs runtime tras LL-002** — `origin/main` declara v2.0.0 desplegado pero producción corre el monolito 4308 líneas (rollback quirúrgico 2026-04-28). Commit revert `508d7ae` (rama `hotfix/revert-v3-swap-2026-04-28`) **NO mergeado a main**. Cualquier `docker compose build && docker compose up -d` desde main reconstruye con v3 roto y rompe producción. Antes de cualquier deploy desde main: verificar que `508d7ae` está mergeado/aplicado, o aplicar manualmente. Ver §10.2 + INFORME §761-784.

### 4.x Restricciones del entorno (complemento)

- **NUNCA** `chown -R` sobre `/opt/setex` (deuda histórica root:root contenida con `scripts/fix-permissions.sh`, cron horario).
- **NUNCA** reiniciar/parar/recrear contenedores Docker arbitrariamente.
- **NUNCA** modificar `/etc/ssh/sshd_config`, `ufw`, `iptables`, `nftables`.
- **NUNCA** modificar los `CLAUDE.md` globales de `/root/.claude/` ni `/home/devuser/.claude/` desde una sesión de proyecto.

---

## 5. SEGURIDAD Y CUMPLIMIENTO

### 5.1 Cumplimiento regulatorio

- **RGPD** (Reglamento UE 2016/679) y **LOPDGDD** (LO 3/2018): aplican.
- **Verifactu** (RD 1007/2023): **descartado** como aplicable a SETEX (análisis completo en `docs/archive/INFORME_VERIFACTU.md`).
- **Endpoints RGPD implementados**: `GET /api/me/export` (art. 15+20 — derecho de acceso y portabilidad) · `DELETE /api/me/account` (art. 17 — derecho al olvido).
- **Datacenter en París** (Hostinger): ventaja GDPR vs proveedores fuera de la UE.

### 5.2 Capas de seguridad activas

| Capa | Implementación |
|---|---|
| Secretos | Docker Secrets (`/run/secrets/<nombre>`) — nunca hardcoded ni `.env` |
| Passwords | bcrypt 12 rounds |
| Sesiones | JWT Access en memoria + Refresh httpOnly cookie · token_version para revocación inmediata · detección de reuso (revoca familia) |
| Headers | Helmet.js + CSP · HSTS `max-age=315360000` (10 años) en nginx |
| Rate limiting | auth 10 req/15 min · uploads 30 req/15 min · password-reset 5/15 min |
| Validación uploads | magic bytes (JPEG/PNG/PDF) — fail-secure |
| Validación CIF | algoritmo AEAT (`ocr/validateCIF.js`) + lista negra anti-alucinación |
| Auditoría | tabla `audit_logs` JSONB completa |
| Red | Docker network interna aislada, solo frontend expuesto vía Traefik |
| Sistema | fail2ban + UFW |
| Backups | GPG AES-256 03:00 · offsite VPS secundario 05:00 · smoke OCR 04:30 |

### 5.3 Auditorías firmadas (regla 10 — inmutables)

Ver §11 para listado completo. Resumen:

- `docs/INFORME_SEGURIDAD.md` — auditoría base de seguridad implementada
- `docs/INFORME_AUDITORIA_SEGURIDAD_2026.md` — auditoría 2026 (37 KB, 697 líneas)
- `docs/audits/AUDIT-2026-04-20.md` — auditoría forense Q2 2026
- `docs/REVISION_ACCESO_AISLAMIENTO_2026.md` — revisión de aislamiento de acceso
- `docs/REVISION_QUIRURGICA_SEGURIDAD_2026.md` — revisión quirúrgica de seguridad

---

## 6. ESTRUCTURA DE FICHEROS Y CARPETAS

### 6.1 Árbol del proyecto (idéntico en prod y staging)

```
{BASE_DIR}/                                  # /opt/setex/prod o /opt/setex/staging
├── app/
│   ├── backend/src/
│   │   ├── server.js                        ← CORE HTTP (refactor v3 strangler-fig en curso)
│   │   ├── config/
│   │   │   ├── features.json                ← TOGGLES EN CALIENTE (sin rebuild)
│   │   │   └── index.js                     ← loader con defaults seguros
│   │   ├── ocr/
│   │   │   ├── index.js                     ← orquestador dual + salvaguarda aritmética IRPF
│   │   │   ├── openai.js                    ← GPT-4.1 ACTIVO
│   │   │   ├── azure.js                     ← Azure DI ACTIVO
│   │   │   ├── gemini.js                    ← DESACTIVADO
│   │   │   ├── paddleocr.js                 ← NO integrado
│   │   │   └── validateCIF.js               ← anti-alucinaciones AEAT
│   │   ├── services/{audit,auth}/           ← Strangler-Fig Rounds 1-4
│   │   ├── repositories/                    ← Repository pattern (R3)
│   │   ├── domain/{validators,calculators,parsers}/
│   │   ├── middleware/{rate-limit,request-id}.js
│   │   └── lib/{errors,filename-generator,normalize-amount}.js
│   ├── frontend/src/
│   │   ├── app.js                           ← JS usuario (cache-buster v=YYYYMMDD-NNN)
│   │   ├── index.html                       ← UI captura
│   │   ├── admin-facturas.{html,js,css}     ← panel admin (Tabulator v6.3.0)
│   │   └── auth.js                          ← wrapper apiFetch + refresh JWT
│   └── docker-compose.yml                   ← REGLA 1 — NO TOCAR sin OK de Julio
├── scripts/
│   ├── lib/paths.sh                         ← FUENTE ÚNICA (autodetect prod/staging)
│   ├── watchdog.sh                          ← cron 5 min
│   ├── fix-permissions.sh                   ← cron :00 cada hora
│   ├── backup-postgres.sh                   ← cron 03:00 (GPG AES-256 + PIPESTATUS + MIN_BYTES)
│   ├── backup-offsite-replicate.sh          ← cron 05:00 (VPS 72.62.189.27)
│   ├── smoke-test-ocr.js                    ← cron 04:30 (OpenAI + Azure DI)
│   ├── health-check.sh                      ← manual
│   ├── manage-whitelist.sh                  ← manual (allowed_emails)
│   ├── list-invalid-cifs.js                 ← auditoría CIFs AEAT
│   ├── migrate-uploads.js                   ← migración puntual
│   ├── seed-staging.{sh,js}                 ← alta datos de prueba en staging
│   └── backup-db.sh                         ← ⚠️ DEPRECATED (usar backup-postgres.sh)
├── secrets/                                 ← jwt, postgres, openai, azure, redis, smtp, backup, offsite
├── config/crontab.txt                       ← template cron del entorno
├── docs/
│   ├── INFORME_SISTEMA_COMPLETO.md          ← bitácora viva del producto
│   ├── plans/MACROPLAN-SETEX-v2.0.md        ← plan maestro 19 áreas FASES 0-4
│   ├── plans/PLAN-FASE-4-DESCONGELADO-V3.md ← obsoleto post-LL-002 (ver §10.2)
│   ├── ROADMAP.md                           ← Q2/Q3/Q4 2026
│   ├── PLAYBOOK_EMERGENCIAS.md              ← runbook
│   ├── GUIA_USUARIO.md                      ← manual cliente
│   ├── DECISIONS.md                         ← 8 decisiones Fase 0 (regla 10)
│   ├── adr/000{1..5}-*.md                   ← 5 ADRs Nygard (regla 10)
│   ├── INFORME_SEGURIDAD.md                 ← auditoría (regla 10)
│   ├── INFORME_AUDITORIA_SEGURIDAD_2026.md  ← auditoría 2026 (regla 10)
│   ├── REVISION_*.md                        ← revisiones firmadas (regla 10)
│   ├── audits/AUDIT-YYYY-MM-DD.md           ← auditorías forenses (regla 10)
│   ├── INFORME_CAPACIDAD_Y_RENDIMIENTO.md   ← stress test
│   ├── INFORME_OCR_IVA_FACTURAS_ESPANOLAS.md ← informe OCR fiscal
│   ├── HISTORIAL.md                         ← historial de consolidaciones documentales
│   └── archive/                             ← documentos archivados (no borrados)
├── tests/
│   ├── stress-test.sh                       ← sourcea ../scripts/lib/paths.sh
│   └── e2e-tests.sh
└── .claude/
    ├── CLAUDE.md                            ← este documento (réplica idéntica en staging)
    ├── agents/*.md                          ← 6 subagentes específicos del proyecto
    └── commands/*.md                        ← 12 slash commands
```

### 6.2 Por qué `scripts/lib/paths.sh` existe

Tanto `/opt/setex/prod` como `/opt/setex/staging` ejecutan los mismos scripts con la misma lógica. La única diferencia entre entornos son los nombres de los contenedores Docker (`setex-prod-*` vs `setex-staging-*`) y el dominio. `paths.sh` autodetecta el entorno a partir del basename del directorio donde está el script (`prod` o `staging`) y exporta las variables `CONTAINER_BACKEND`, `CONTAINER_PG`, `CONTAINER_REDIS`, `BASE_DOMAIN`, etc. Un único script vive en disco; ambos entornos lo usan. **Regla 9**: cualquier script bash nuevo debe empezar con `source "${SCRIPT_DIR}/lib/paths.sh"`.

### 6.3 Directorios compartidos entre entornos

```
/opt/setex/shared/
├── backups/                                 ← snapshots offsite + tarballs históricos
├── cleanup-2026-04-{27,28}/                 ← restos de cleanups documentados
└── logs/                                    ← logs centralizados
```

---

## 7. SUBAGENTES CLAUDE CODE

Resumen del documento `INSTALL_AGENTS_v3.md` (archivado en `docs/archive/`). Los system prompts vivos están en `.claude/agents/*.md`; este §7 mantiene solo el inventario.

### 7.1 Subagentes específicos del proyecto (`/opt/setex/{prod,staging}/.claude/agents/`)

| Nombre | Modelo | Misión |
|---|---|---|
| `dual-pipeline-orchestrator` | opus | Mantiene el pipeline dual GPT-4.1 + Azure DI en `ocr/index.js`, consenso, salvaguarda aritmética IRPF |
| `setex-ocr-engineer` | sonnet | Especialista del pipeline OCR completo (sharp, Redis preview, validateCIF) |
| `invoice-validator-spanish` | sonnet | Validación estricta de facturas españolas (CIF AEAT, base+IVA=total, fechas, número factura) |
| `rgpd-spain-auditor` | opus | Auditoría RGPD/LOPDGDD: derechos ARCO+, bases jurídicas, retención, brechas |
| `setex-ops-deploy` | sonnet | Operador del flujo `rebuild → stop → up -d`, las 10 reglas, paths.sh, features.json en caliente, secretos, cache-busters, crons |
| `setex-tester` | sonnet | Testing del proyecto: stress-test.sh, e2e-tests.sh, smoke-test-ocr.js, list-invalid-cifs.js |

### 7.2 Subagentes globales del operador (`/home/devuser/.claude/agents/`)

| Nombre | Modelo | Misión |
|---|---|---|
| `ai-engineer` | opus | Diseño de pipelines IA, RAG, agentes, LLMs, función calling |
| `code-reviewer` | sonnet | Revisión de código tras commits/PRs (proactivo) |
| `debugger` | sonnet | Diagnóstico de errores, stack traces, fallos de tests |
| `docker-vps-ops` | sonnet | Docker, Compose, Traefik, hardening VPS Ubuntu |
| `docs-writer` | haiku | README, JSDoc, docstrings, OpenAPI, ADRs |
| `express-vanilla-pro` | sonnet | Backend Node.js + Express vanilla (multer, bcrypt, JWT, pg, Redis, sharp) |
| `postgres-optimizer` | sonnet | DBA PostgreSQL (queries lentas, índices, locks) |
| `security-auditor` | opus | Auditoría OWASP Top 10, secretos, configuraciones inseguras |
| `test-automator` | sonnet | Tests unit/integration/E2E con vitest/jest/pytest |

### 7.3 Slash commands del proyecto (`/opt/setex/{prod,staging}/.claude/commands/`)

`/backup`, `/db`, `/deploy`, `/feature`, `/fix-redis`, `/logs`, `/ocr`, `/optimize`, `/queue`, `/status`, `/test-factura`, `/whitelist` — invocables desde cualquier sesión de Claude Code en estos entornos.

### 7.4 Cómo añadir un nuevo subagente

1. Crear `.md` en `.claude/agents/<nombre>.md` con frontmatter YAML (`name`, `description`, `model`, `tools`).
2. Añadir entrada en este §7 con nombre, modelo y misión en una línea.
3. Si es global (no específico de SETEX), ubicar en `/home/devuser/.claude/agents/` (modificable solo por Julio).
4. NO incluir el system prompt completo en este documento — vive en su `.md`.

---

## 8. OPERACIÓN DIARIA

Todos los comandos asumen `cd /opt/setex/prod` o `cd /opt/setex/staging` previo. Los scripts resuelven contenedores y rutas automáticamente vía `scripts/lib/paths.sh` (regla 9).

### 8.1 Despliegue: rebuild → stop → up -d

```bash
# Cuando cambia código en app/backend/src/ o app/frontend/src/ → REBUILD obligatorio (regla 3)
cd app
docker compose build backend
docker compose stop backend
docker compose up -d backend

# Verificar que arrancó sano
docker compose logs -f backend   # Ctrl+C cuando se vea "Server listening on :3000"
./scripts/health-check.sh
```

### 8.2 features.json en caliente (regla 4)

```bash
# Editar app/backend/src/config/features.json directamente
# Es volume-mounted: cambio inmediato, sin rebuild
docker compose restart backend   # opcional, solo si quieres forzar relectura

# Verificar
docker exec setex-$(basename $PWD)-backend cat /app/src/config/features.json
```

Configuración activa típica:
```json
{
  "ocr_enabled": true,
  "ocr_mode": "dual",
  "ocr_primary_engine": "openai",
  "image_max_resolution": 1536,
  "image_jpeg_quality": 85
}
```

### 8.3 Cache-buster en HTML (regla 6)

Cuando cambias `app.js` o `admin-facturas.js`/`.css`, incrementa el query string `?v=YYYYMMDD-NNN` en `index.html` y `admin-facturas.html`. Sin esto los navegadores sirven la versión cacheada y los usuarios ven la app rota.

### 8.4 Cron jobs activos en producción

| Hora | Script | Función |
|---|---|---|
| `*/5 * * * *` | `scripts/watchdog.sh` | Vigila contenedores y los reinicia si caen |
| `0 * * * *`   | `scripts/fix-permissions.sh` | Corrige ownership root:root residual |
| `0 3 * * *`   | `scripts/backup-postgres.sh` | Dump + GPG AES-256 + verificación PIPESTATUS + MIN_BYTES |
| `30 4 * * *`  | `scripts/smoke-test-ocr.js` | Llamada real OpenAI + Azure DI con factura de control |
| `0 5 * * *`   | `scripts/backup-offsite-replicate.sh` | Réplica al VPS secundario `72.62.189.27` |

Staging no tiene crons por defecto (excepto si se activan manualmente para pruebas).

### 8.5 Whitelist de emails autorizados (`allowed_emails`)

Solo emails en esta lista pueden registrarse.

```bash
./scripts/manage-whitelist.sh list                              # ver lista
./scripts/manage-whitelist.sh add cliente@empresa.es "Notas"    # añadir
./scripts/manage-whitelist.sh remove cliente@empresa.es         # quitar
./scripts/manage-whitelist.sh check cliente@empresa.es          # comprobar
./scripts/manage-whitelist.sh help                              # ayuda completa
```

### 8.6 PostgreSQL — consultas operativas frecuentes

```bash
source scripts/lib/paths.sh

# Facturas procesadas
docker exec "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT COUNT(*), COUNT(procesado_en) AS procesadas FROM uploads;"

# Usuarios registrados
docker exec "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 20;"

# Tokens de recuperación de contraseña activos
docker exec "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT id, user_id, created_at, expires_at, used FROM password_reset_tokens WHERE expires_at > NOW();"
```

### 8.7 Redis — debug operativo

```bash
source scripts/lib/paths.sh
PASS=$(docker exec "$CONTAINER_REDIS" grep -m1 requirepass /etc/redis/redis.conf | awk '{print $2}')
docker exec "$CONTAINER_REDIS" redis-cli -a "$PASS" INFO memory
docker exec "$CONTAINER_REDIS" redis-cli -a "$PASS" KEYS 'preview:*' | head -20
```

### 8.8 Restauración desde backup GPG

```bash
# Listar backups disponibles
ls -lh /opt/setex/shared/backups/postgres/

# Descifrar y restaurar (procedimiento detallado en docs/PLAYBOOK_EMERGENCIAS.md)
gpg --decrypt /opt/setex/shared/backups/postgres/setex-YYYYMMDD.sql.gpg | \
  docker exec -i "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB"
```

Procedimiento completo (incluye recreación de contenedor y verificación) en `docs/PLAYBOOK_EMERGENCIAS.md`.

### 8.9 Health check rápido

```bash
./scripts/health-check.sh                    # detecta entorno y verifica 4/4 healthy
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep "setex-$(basename $PWD)-"
```

### 8.10 Cambios que requieren `stop` + `up -d` (regla 7)

Cuando cambian variables de entorno en `docker-compose.yml` o un secreto en `secrets/`, `docker compose restart` NO las recarga. Es obligatorio:

```bash
docker compose stop backend
docker compose up -d backend
```

---

## 9. FLUJO DE TRABAJO GIT

### 9.1 Esquema general — GitHub Flow + develop

```
feature/* ──► develop ──► main
              │           │
              │           └──► auto-deploy a producción (con aprobación manual)
              │
              └──► auto-deploy a staging (https://staging.setex-facturas.es)
```

Reglas duras:

- `main` siempre refleja lo que hay en producción. **Nunca se rompe.**
- `develop` es la rama de integración — staging apunta aquí.
- `feature/*`, `fix/*`, `chore/*`, `docs/*` son ramas cortas (vida útil: horas o pocos días).
- Toda promoción a `main` o `develop` pasa por **Pull Request**. Push directo bloqueado.

### 9.2 Convención de nombres de ramas

| Prefijo | Uso | Ejemplo |
|---|---|---|
| `feature/` | Funcionalidad nueva | `feature/cif-aeat-warning-perfil` |
| `fix/` | Corrección de bug | `fix/ux-captura-y-ocr-openai-schema` |
| `chore/` | Limpieza, dependencias, build | `chore/security-bumps-multer-nodemailer` |
| `docs/` | Solo documentación | `docs/contributing-and-templates` |
| `sync/` | Sincronización post-squash | `sync/main-into-develop` |
| `release/` | Lote de develop a main | `release/2026-04-19-lote` |

Sufijo recomendado: `YYYY-MM-DD` al final. Facilita auditoría posterior.

### 9.3 Convención de commits — Conventional Commits

```
<tipo>(<ámbito>): <descripción imperativa corta>

<cuerpo opcional con detalle del por qué>

<footer opcional con referencias o trailers>
```

Tipos válidos: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`, `style`, `security`.

Reglas:
- Asunto en imperativo («añadir», «corregir») no pasado.
- Máximo 72 caracteres en el asunto.
- En el cuerpo, explicar **por qué** se hace, no qué (el diff ya muestra el qué).
- Si el commit lo escribe Claude Code, añadir trailer `Co-Authored-By: Claude … <noreply@anthropic.com>`.

### 9.4 Flujo de feature (caso normal)

```bash
git checkout develop && git pull --ff-only
git checkout -b feature/<nombre-descriptivo>-YYYY-MM-DD
# trabajo, commits temáticos pequeños
git add <ficheros-relacionados>
git commit -m "feat(ámbito): descripción"
git push --set-upstream origin feature/<nombre>-YYYY-MM-DD
gh pr create --base develop --title "..." --body "..."
# tras merge → CI/CD despliega a staging automáticamente
# verificar en https://staging.setex-facturas.es
gh pr create --base main --head develop --title "release: <descripción>"   # cuando staging valide
```

### 9.5 Flujo de hotfix (urgencia en producción)

```bash
git checkout main && git pull --ff-only
git checkout -b fix/<descripcion-urgente>-YYYY-MM-DD
# corrección mínima necesaria
git add ...
git commit -m "fix(ámbito): corregir <X> en producción"
git push --set-upstream origin fix/<descripcion>-YYYY-MM-DD
gh pr create --base main --title "fix: <descripción>" --body "Hotfix urgente..."
# tras merge a main, propagar a develop
git checkout develop && git pull --ff-only
git merge origin/main --no-ff -m "sync: hotfix <descripción> de main"
git push
```

CI/CD tiene aprobación manual obligatoria antes de desplegar a producción (red de seguridad).

### 9.6 Resolución de conflictos

```bash
# Caso 1 — rebase de tu rama sobre develop actualizado
git fetch origin
git rebase origin/develop
# editar ficheros marcados con <<<<<<< / =======
git add <ficheros-resueltos>
git rebase --continue
git push --force-with-lease   # NUNCA --force a secas

# Caso 2 — merge de develop into tu rama
git merge origin/develop
git add <ficheros>
git commit
git push
```

Regla: si el conflicto es complejo, **paras y preguntas**. Nunca resuelvas adivinando.

### 9.7 Cheatsheet de comandos git esenciales

| Acción | Comando |
|---|---|
| Ver rama actual | `git branch --show-current` |
| Estado del working tree | `git status -sb` |
| Últimos 5 commits | `git log --oneline -5` |
| Diff sin stage | `git diff` |
| Diff staged | `git diff --cached` |
| Sincronizar con remoto | `git pull --ff-only` |
| Crear rama nueva | `git checkout -b nombre-rama` |
| Cambiar a rama existente | `git checkout nombre-rama` |
| Borrar rama local mergeada | `git branch -d nombre-rama` |
| Borrar rama remota | `git push origin --delete nombre-rama` |
| Listar ramas remotas | `git ls-remote --heads origin` |
| Force-push seguro | `git push --force-with-lease` |
| Stash con pathspec explícito | `git stash push <ruta>` |

### 9.8 CI/CD activo

- `.github/workflows/deploy-staging.yml` — push/dispatch a develop dispara deploy a staging.
- `.github/workflows/deploy-prod.yml` — push/dispatch a main dispara deploy a prod **con aprobación manual obligatoria** (input textual `DESPLEGAR`).
- Smoke HTTP post-deploy bloquea promoción si la superficie API se rompe.
- Healthcheck Docker apunta a la ruta crítica → `unhealthy` automático si falta.

Detalle completo en `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` (Etapas 0-5 cerradas, 6 ejecutada y revertida — ver §10.2).

---

## 10. ESTADO TÉCNICO Y DEUDA

### 10.1 Refactor strangler-fig en curso

| Round | Estado | Contenido |
|---|---|---|
| R1-R4 | ✅ Mergeados a develop (PR #46-#52) | Extracción de `services/audit/`, `services/auth/`, repositories, domain |
| R5-R15 | ✅ Mergeados | Continuación de la extracción modular |
| Hotfixes (5) | ✅ Mergeados | Correcciones detectadas durante refactor |
| **v3 SWAP runtime** | ⚠️ EJECUTADO 28-abr Y REVERTIDO (LL-002) | Etapa 6 del plan FASE 1B desplegada 09:36 UTC, bug en contrato `/api/admin/facturas` (`{items, total}` vs `{facturas, total}`). Rollback quirúrgico en disco 09:35-09:57 UTC: `server.js`=monolito 4308 líneas. Commit revert `508d7ae` en `hotfix/revert-v3-swap-2026-04-28` **NO mergeado a main** — ver REGLA 11 |

### 10.2 v3 swap intentado el 28-abr y revertido (LL-002): pendiente re-validación

Las Etapas 0-4 del plan FASE 1B están **mergeadas a `develop`** y siguen vigentes (paridad CI legacy↔v3 en PRs, healthcheck, smoke HTTP). Sin embargo, la **Etapa 6 (swap real)** se ejecutó el 2026-04-28 09:36 UTC y **rompió producción inmediatamente** por bug **LL-002**: el contrato de respuesta de `/api/admin/facturas` difería entre el monolito (`{facturas, total}`) y el módulo v3 (`{items, total}`). El frontend admin recibió `undefined` y devolvió 404 masivo.

Lección aprendida: la **paridad CI sólo verificaba superficie de URL** (status code 200), no la **forma del body de respuesta**. El bug atravesó los 3 blindajes: paridad CI ✅, healthcheck ✅, smoke HTTP ✅, todos pasaron porque ninguno comprobaba shape del JSON.

**Estado actual:**
- Producción runtime: monolito 4308 líneas (`server.js`), container Up >6 días healthy.
- Filesystem prod tiene el rollback aplicado quirúrgicamente (28-abr 09:35-09:57 UTC).
- Commit revert `508d7ae` en `hotfix/revert-v3-swap-2026-04-28` **NO mergeado a main** — `main` sigue declarando v2.0.0 desplegado (descalce documentado en REGLA 11).
- v3 mini en `server.next.js` (untracked, congelado).

**Pendiente para reintentar swap (NO ejecutar sin previo análisis):**
1. Análisis post-mortem de LL-002 (causa raíz documentada en INFORME §761-784).
2. Reforzar paridad CI con test de **shape de respuesta** (JSON keys + tipos), no solo status code.
3. Reforzar smoke HTTP post-deploy con validación de body shape en endpoints críticos (`/api/admin/facturas`, `/api/me/facturas`, `/api/auth/login`).
4. Mergear o aplicar formalmente el rollback `508d7ae` a `main` para sincronizar git con runtime.
5. Solo entonces: re-planificar Etapas 5-6 con la nueva infraestructura de paridad.

### 10.3 Top deudas pendientes (ROADMAP)

| # | Deuda | Impacto | Plazo |
|---|---|---|---|
| 1 | PaddleOCR instalado sin uso (~3 GB en disco) | Coste disco + ruido | Q3 2026: integrar o desinstalar |
| 2 | `chown -R deploy:deploy` automático en `fix-permissions.sh` filtrando `-user root -o -group root` | Evita rebrotes de la deuda root:root | Q2 2026 |
| 3 | Backups offsite a S3/B2 (además de VPS secundario) | Resilience si Hostinger cae globalmente | Q3 2026 |
| 4 | Mantenedor único (Julio) — bus factor 1 | Continuidad del proyecto | Mitigado por documentación; resolución estructural Q4 2026 |
| 5 | GitHub plan Free no permite required reviewers en environments | Fricción operativa, mitigado con `workflow_dispatch` | Sin plazo (decisión coste/beneficio) |
| 6 | Doble hop xanflatest.com HTTP→HTTPS | UX 1 hop extra, aceptado | Sin plazo |

Ver `docs/ROADMAP.md` para Q2/Q3/Q4 detallado.

### 10.4 Anomalía documental detectada (no resuelta)

ADR-0003 (`docs/adr/0003-typescript-gradual-migration.md`) acepta migración gradual a TypeScript; conversaciones recientes (2026-04-30) descartaron TypeScript. Posible ADR-0006 futuro «Supersede ADR-0003: TypeScript no aplicable a vanilla JS production stack» pendiente de revisión humana. Detalle en `docs/HISTORIAL.md` (sección 2026-05-03).

---

## 11. REFERENCIAS A DOCUMENTOS HISTÓRICOS Y VIVOS

### 11.1 Documentos vivos paralelos (cadencia propia, NO absorbidos)

| Documento | Propósito | Cadencia de actualización |
|---|---|---|
| `docs/INFORME_SISTEMA_COMPLETO.md` | Bitácora viva del producto (~2 700 líneas) | Por sesión de desarrollo (regla obligatoria §0) |
| `docs/plans/MACROPLAN-SETEX-v2.0.md` | Plan estratégico vivo (19 áreas, FASES 0-4, runbooks INC-01..10, templates) | Por tarea completada |
| `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` | Plan del descongelado v3, **obsoleto post-LL-002** (Etapas 0-5 ✅, 6 ⚠️ ejecutada y revertida) | Requiere refresco completo |
| `docs/ROADMAP.md` | Roadmap trimestral 2026 | Trimestral |
| `docs/PLAYBOOK_EMERGENCIAS.md` | Runbook operativo de emergencias | Por incidente nuevo |
| `docs/GUIA_USUARIO.md` | Manual del cliente final (RGPD, ventana 00-06, soporte) | Por release con cambios visibles |
| `docs/INFORME_CAPACIDAD_Y_RENDIMIENTO.md` | Resultados de stress test (2026-03-02) | Por re-test |
| `docs/INFORME_OCR_IVA_FACTURAS_ESPANOLAS.md` | Informe técnico OCR fiscal español | Por revisión técnica |

### 11.2 Decisiones arquitectónicas (todas inmutables, regla 10)

**Decisiones Fase 0 (formato propio, 2026-04-17):**
- `docs/DECISIONS.md` — 8 decisiones de arranque del proyecto (Git, CI/CD, staging, secretos, backup, …)

**ADRs formato Nygard (2026-04-27/28):**
- `docs/adr/0001-git-eslint-prettier-husky-commitlint.md`
- `docs/adr/0002-strangler-fig-target-structure.md`
- `docs/adr/0003-typescript-gradual-migration.md`
- `docs/adr/0004-modular-architecture-solid-patterns.md`
- `docs/adr/0005-dependency-injection-awilix.md`

**Política**: las decisiones futuras se documentan como ADR nuevo (`0006`, `0007`…) en `docs/adr/` siguiendo convención Nygard. Las 8 decisiones de `DECISIONS.md` NO se migran al formato Nygard (mover documentos firmados violaría regla 10).

### 11.3 Auditorías de seguridad inmutables (regla 10)

| Documento | Tamaño | Fecha |
|---|---|---|
| `docs/INFORME_SEGURIDAD.md` | 10.3 KB | 2026-04-27 |
| `docs/INFORME_AUDITORIA_SEGURIDAD_2026.md` | 36.7 KB | 2026-04-27 |
| `docs/audits/AUDIT-2026-04-20.md` | 7.6 KB | 2026-04-27 |
| `docs/REVISION_ACCESO_AISLAMIENTO_2026.md` | 32.1 KB | 2026-04-27 |
| `docs/REVISION_QUIRURGICA_SEGURIDAD_2026.md` | 36.1 KB | 2026-04-27 |

### 11.4 Documentos archivados (`docs/archive/`)

| Archivo | Origen | Motivo |
|---|---|---|
| `archive/INFORME-TECNICO-SETEX.md` | raíz `prod/` | Stack obsoleto (n8n, GPT-4o); partes vigentes ya en este §2/§3 |
| `archive/INSTALL_AGENTS_v3.md` | `/opt/setex/` | Cumplió misión de instalación inicial; system prompts vivos en `.claude/agents/` |
| `archive/INFORME_VERIFACTU.md` | `prod/docs/` | Verifactu descartado; queda como evidencia del análisis |
| `archive/HANDOVER-FASE-1B.md` | `prod/docs/` | Handover puntual histórico |
| `archive/REPLICA-A-STAGING-2026-04-27.md` | `prod/docs/` | Registro puntual de réplica histórica |

### 11.5 userPreferences globales de Claude Code (FUERA del repo SETEX)

Existen instrucciones globales del operador (Julio) en `/home/devuser/.claude/CLAUDE.md`. Estas instrucciones aplican a TODAS las sesiones de Claude Code en este servidor, no solo a SETEX. Son gestionadas por Julio directamente y no forman parte de la documentación del proyecto. **NO modificar desde sesiones de proyecto.** Existe también `/root/.claude/CLAUDE.md` (fuera de alcance de `devuser`, gestionado por Julio con sudo).

### 11.6 Historial de consolidaciones documentales

`docs/HISTORIAL.md` — registro de cada consolidación: qué se absorbió, qué se archivó, qué se eliminó, qué quedó intocado. Primera entrada: 2026-05-03 (esta consolidación).

---

## 12. HISTORIAL DE CONSOLIDACIÓN DOCUMENTAL

| Fecha | Acción | Detalle |
|---|---|---|
| 2026-05-03 | **Consolidación v1.0** | Absorbidos: README, CONTRIBUTING, GUIA_ADMINISTRACION, INFORME-TECNICO (parcial §1/§2), INSTALL_AGENTS_v3 (resumido §7). Archivados a `docs/archive/`: INFORME-TECNICO-SETEX, INSTALL_AGENTS_v3, INFORME_VERIFACTU, HANDOVER-FASE-1B, REPLICA-A-STAGING. Eliminados: ninguno. Inmutables (regla 10) verificados pre/post por MD5: idénticos. Detalle completo en `docs/HISTORIAL.md`. Rama: `chore/docs-consolidation-2026-04-29`. |

---

*SETEX Captura de Facturas · setex-facturas.es · CLAUDE.md maestro v1.0 · 2026-05-03 · Histórico: docs/HISTORIAL.md*
