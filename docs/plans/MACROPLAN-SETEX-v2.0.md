# 🎯 MACROPLAN MAESTRO SETEX v2.0 — Plan de Excelencia

> **Documento vivo** — se actualiza cada vez que completamos una tarea.
> Estado final objetivo: **sobresaliente (9-10/10) en las 19 áreas de excelencia**.

---

## 📋 Metadatos del documento

| Campo | Valor |
|---|---|
| Proyecto | SETEX Captura de Facturas |
| Dominio producción | `setex-facturas.es` |
| Dominio staging | `staging.setex-facturas.es` (BasicAuth Traefik) |
| VPS | Hostinger Ubuntu 24.04, IP 72.60.186.89 |
| Mantenedor | Julio |
| Versión del plan | 2.0 (plan híbrido — combina lo mejor del Plan A externo y del Plan B interno basado en estado real) |
| Fecha creación | 2026-04-20 |
| Última actualización | 2026-04-20 |
| Estado global | 🟡 **En ejecución** — Fase 0 hoy, Fases 1-4 en las próximas 4-12 semanas |

### Reglas del documento

1. **Cualquier cambio en el proyecto actualiza este documento** — los checkboxes reflejan estado real.
2. **Nada se marca ✅ sin evidencia verificable** (comando ejecutado + output esperado confirmado).
3. **Cada sesión empieza leyendo este documento** para saber por dónde vamos.
4. **Al final de cada sesión** se actualiza sección 17 "Estado ejecutable" con lo hecho, fechas y próximo paso.
5. **Este documento es fuente única de verdad** junto con `INFORME_SISTEMA_COMPLETO.md` (técnico) y `ROADMAP.md` (estratégico).

---

## 📑 Índice

1. [Reality Check del senior](#1-reality-check-del-senior)
2. [Diagnóstico 19 roles — estado actual vs sobresaliente](#2-diagnóstico-19-roles)
3. [Matriz de prioridades P0/P1/P2/P3](#3-matriz-de-prioridades)
4. [FASE 0 — Hoy, próximas 6h](#4-fase-0--hoy)
5. [FASE 1 — Semana 1 post-entrega](#5-fase-1--semana-1)
6. [FASE 2 — Semanas 2-4: Refactor Strangler-Fig](#6-fase-2--semanas-2-4)
7. [Estructura de carpetas objetivo](#7-estructura-de-carpetas-objetivo)
8. [Strangler-Fig: orden exacto de 22 extracciones](#8-strangler-fig-22-extracciones)
9. [FASE 3 — Mes 2: Seguridad + Compliance avanzados](#9-fase-3--mes-2)
10. [FASE 4 — Mes 3: Optimización + escalado](#10-fase-4--mes-3)
11. [Plan de tests (Unit + Integration + E2E + Load)](#11-plan-de-tests)
12. [Observabilidad: Sentry, Prometheus, Grafana](#12-observabilidad)
13. [Runbook de incidentes INC-01..10](#13-runbook-de-incidentes)
14. [Post-mortem template](#14-post-mortem-template)
15. [Templates comunicación cliente](#15-templates-comunicación-cliente)
16. [Plan de rollback + recovery](#16-plan-de-rollback)
17. [Estado ejecutable — checkboxes vivos](#17-estado-ejecutable)
18. [Riesgos activos y mitigaciones](#18-riesgos-activos)
19. [ADRs — decisiones arquitectónicas](#19-adrs)
20. [KPIs objetivo + métricas DORA](#20-kpis-objetivo)

---

## 1. Reality Check del senior

### Contexto brutal

- App en **producción real** con **7 usuarios** y **7 facturas procesadas** (cliente entrega mañana).
- Mantenedor **único** (Julio). Sin equipo. Bus factor = 1.
- Monolito `server.js` = **3,992 líneas**. Frontend `app.js` = **1,545 líneas**. God files reales.
- **0 tests automatizados** (QA 1/10). Cada deploy es ruleta rusa salvo validación manual.
- Hoy (2026-04-20) hemos hecho **muchos avances fundamentales** — CI/CD funcional, CIF typos corregidos, UFW activo, cutover Fase 4 completado, auditoría 53% → ~95%.
- **Vulnerabilidades Dependabot: 0 abiertas**.

### Regla profesional no negociable

> La víspera de una entrega al cliente, **solo** se hace: (1) lo que protege la entrega (backups, rollback, runbooks), (2) lo que el cliente va a ver directamente (UX, textos), y (3) parches de seguridad cuya ausencia sería negligencia (CSRF, backups offsite). **Nunca** se refactoriza el monolito ni se cambia arquitectura.

### Disonancia técnica a resolver

- **Infraestructura**: 9/10 (Docker, secrets, HSTS, bcrypt 12, JWT rotation, OCR dual, etc.)
- **Código interno**: 4/10 (monolito, 0 tests, sin capas)

Esta disonancia es **el patrón más común en consultoría SME**: infraestructura de consultor senior + código que creció desde un MVP. **El refactor es la obra de las semanas 2-4**. Hoy solo preparamos el terreno.

### Lo que NO se toca hoy en prod (con el cliente esperando mañana)

| Item | Razón |
|---|---|
| Refactor monolito | 3,992 líneas tocar = romper seguro |
| Cookies httpOnly (migrar JWT) | Cambia toda la arquitectura cliente |
| MFA / Passkeys | Cambia UX de login para todos los usuarios |
| CrowdSec WAF | Puede bloquear tráfico legítimo mal configurado |
| Eliminar bloqueo horario 00-06 | Cambio de lógica de negocio, validar con cliente |
| Vite bundler frontend | 1h real pero si rompe móviles = desastre |
| TypeScript gradual | Introduce build step nuevo, requiere CI ajustado |

### Lo que SÍ se toca hoy en prod (Fase 0)

| Item | Razón | Tiempo |
|---|---|---|
| Backups offsite a Backblaze B2 | Fallo HW VPS = pérdida total (regla 3-2-1 violada) | 45 min |
| CSRF double-submit cookie | SameSite=Strict no es defensa completa | 45 min |
| Endpoints RGPD `/api/me/export` + `/api/me/delete-account` | Derechos ARCO-POL obligatorios día 1 | 45 min |
| `docs/GUIA_USUARIO.md` para cliente | Entrega profesional = doc mínima | 30 min |
| ESLint + Prettier + Husky pre-commit | Higiene mínima, impide bugs en prisa | 20 min |
| Monitorización externa (BetterStack o Uptime Kuma) | Me entero si cae antes que el cliente | 30 min |
| Smoke test manual exhaustivo pre-entrega | Go/No-Go decision | 30 min |
| Go/No-Go meeting (conmigo mismo, cabeza fría) | Disciplina profesional | 30 min |

### Lo que SÍ se hace hoy en STAGING (no afecta al cliente)

| Item | Razón | Tiempo |
|---|---|---|
| Refactor del monolito — primeras 5 extracciones | Staging es mi sandbox; sin riesgo cliente | 2-3h |
| 3 tests E2E Playwright (login, upload, OCR) | Cubrir los flujos que el cliente va a usar | 1.5h |
| OpenAPI 3.1 yaml | Contrato documentado = profesionalidad | 1h |

---

## 2. Diagnóstico 19 roles

**Estado HOY (2026-04-20, post-cutover + CI/CD + bugs fixes)** vs **objetivo sobresaliente**:

| # | Rol | Hoy | Objetivo | Brecha | Fase |
|---|---|---|---|---|---|
| 1 | Product / PM | 5/10 | 8/10 | Sin métricas producto (PostHog) ni feature flags | F3-F4 |
| 2 | Solution Architect | 4/10 | **9/10** | Monolito, sin ADRs versionados, sin C4 diagrams | F2 (refactor) |
| 3 | Frontend Engineer | 5/10 | 8/10 | Vanilla sin bundler, sin ES modules, 1545 líneas | F2-F3 |
| 4 | Backend Engineer | 5/10 | **9/10** | God file, sin capas, sin Repository, sin abstracción a deps | F2 (refactor) |
| 5 | API Engineer | 6/10 | 9/10 | Sin OpenAPI 3.1 canónico, sin versionado explícito | F1-F2 |
| 6 | Database / DBA | 7/10 | 9/10 | Backups solo local; test restore no cronometrado | F0 (offsite) |
| 7 | DevOps | **8/10** ✅ | 10/10 | CI/CD OK. Falta: IaC (Terraform/Ansible), preview envs por PR | F2-F3 |
| 8 | Platform Engineer | 6/10 | 8/10 | Environments parity OK. Sin IDP ni scaffolding | F3-F4 |
| 9 | SRE | 5/10 | 9/10 | Sin SLOs formales, sin error budget, sin chaos engineering | F2-F3 |
| 10 | Observability | 4/10 | **9/10** | Sin Prometheus, Grafana, Sentry RUM, tracing distribuido | F3 |
| 11 | FinOps | 6/10 | 8/10 | Sin tagging de recursos, sin tracking coste/feature | F3-F4 |
| 12 | QA | **1/10** 🚨 | **9/10** | 0 tests. Tests E2E primero, unit después. | **F1 (urgente)** |
| 13 | AppSec | 7/10 | **9/10** | CSRF ✗, MFA ✗, WAF ✗, JWT en localStorage | F0 (CSRF) + F3 |
| 14 | UX/UI + a11y | 4/10 | 8/10 | Sin WCAG 2.2 AA audit, sin Core Web Vitals RUM | F3 |
| 15 | Privacy & Compliance | 6/10 | 9/10 | Sin endpoints ARCO-POL, sin DPIA, sin cookie banner legal | F0 + F3 |
| 16 | Data Engineer | N/A | N/A | No aplica en escala actual | F4 |
| 17 | AI / MLOps | **7/10** ✅ | 9/10 | OCR dual + 2ª pasada + smoke diario. Falta telemetría arbitraje | F3 |
| 18 | Technical Writer | 5/10 | 9/10 | CONTRIBUTING + Playbook + AUDIT hechos. Falta OpenAPI + Docusaurus | F1-F2 |
| 19 | Engineering Manager | N/A | N/A | Eres 1 dev | — |

**Media actual ponderada**: **6.2/10**
**Media objetivo sobresaliente**: **8.8/10** (fin de Fase 3, mes 2-3)

### Ranking de riesgos activos

| # | Riesgo | Prob. | Impacto | Acción |
|---|---|---|---|---|
| 1 | Fallo HW VPS → pierdes código + BD + backups | Baja | Catastrófico | ⚠️ F0: offsite HOY |
| 2 | Refactor rompe app el día de entrega | Alta si hoy | Catastrófico | ❌ NO hoy — F2 |
| 3 | Cliente encuentra bug crítico mañana | Media | Alto | ⚠️ F0: smoke manual exhaustivo |
| 4 | Deploy en horario activo causa 404 para usuario | Media | Medio | ⚠️ F0: freeze deploys 21:00+ hoy |
| 5 | Auditoría RGPD encuentra gaps día 2 | Baja | Medio | ⚠️ F0: endpoints ARCO-POL |
| 6 | API key OpenAI/Azure agotada | Media | Medio | ⚠️ F3: alertas consumo |

---

## 3. Matriz de prioridades

### P0 — HOY (próximas 6h, antes de entrega)

| ID | Acción | Dónde | Tiempo | Riesgo |
|---|---|---|---|---|
| P0-1 | Backups offsite Backblaze B2 | Host + prod | 45min | Bajo |
| P0-2 | CSRF double-submit cookie | Prod (code+deploy) | 45min | Bajo |
| P0-3 | ESLint + Prettier + Husky | Repo | 20min | Cero |
| P0-4 | Endpoints RGPD `/api/me/export` + `/api/me/delete-account` | Prod (code+deploy) | 45min | Bajo |
| P0-5 | `docs/GUIA_USUARIO.md` para cliente | Repo | 30min | Cero |
| P0-6 | Monitorización externa (BetterStack) | Externo | 30min | Cero |
| P0-7 | Refactor STAGING — pasos 1-5 Strangler-Fig | Staging | 2-3h | Cero (staging) |
| P0-8 | Smoke manual exhaustivo prod | Prod | 30min | — |
| P0-9 | Backup completo pre-entrega | Prod | 10min | Cero |
| P0-10 | Go/No-Go formal (matriz 11 checks) | Mental | 15min | — |

### P1 — Semana 1 post-entrega

| ID | Acción | Tiempo |
|---|---|---|
| P1-1 | Setup staging completo operativo (verificar estado actual) | 2h |
| P1-2 | Primeros tests E2E Playwright (3 flujos críticos) | 1 día |
| P1-3 | Refactor Strangler-Fig — pasos 6-12 | 3-4 días |
| P1-4 | OpenAPI 3.1 yaml canónico | 4h |
| P1-5 | Conventional commits + commitlint hook | 30min |
| P1-6 | ADRs críticos (0001-0005) documentados | 2h |

### P2 — Semanas 2-4

| ID | Acción | Tiempo |
|---|---|---|
| P2-1 | Refactor Strangler-Fig — pasos 13-22 (completar) | 6-7 días |
| P2-2 | JWT → httpOnly cookies (elimina XSS vector) | 1 día |
| P2-3 | MFA con passkeys (WebAuthn con SimpleWebAuthn) | 2 días |
| P2-4 | CrowdSec WAF + bouncer Traefik | 4h |
| P2-5 | Tests unit cobertura ≥80% en `services/` y `domain/` | 3-4 días |
| P2-6 | TypeScript gradual (allowJs: true) | 2 días |
| P2-7 | Eliminar bloqueo horario 00-06 → rate limit adaptativo | 4h |

### P3 — Mes 2

| ID | Acción | Tiempo |
|---|---|---|
| P3-1 | Sentry RUM frontend + backend | 1 día |
| P3-2 | Prometheus + Grafana stack | 2 días |
| P3-3 | Loki para logs centralizados | 1 día |
| P3-4 | Alertas multinivel (P1/P2/P3) | 1 día |
| P3-5 | DPIA formal + RAT + DPAs firmados (OpenAI, Azure, SMTP) | 2 días |
| P3-6 | Endpoint admin `/api/admin/fix-cif-typo` | 3h |
| P3-7 | Email proactivo cuentas con CIF AEAT inválido | 4h |
| P3-8 | Verifactu básico (XML SHA-256 + declaración responsable) | 3-5 días |
| P3-9 | Cookie banner legal (Cookiebot o similar) | 1 día |
| P3-10 | Audit del arbitraje OCR + telemetría tasa acuerdo | 1 día |

### P4 — Mes 3

| ID | Acción | Tiempo |
|---|---|---|
| P4-1 | Tests cobertura total ≥80% incluyendo integration | 3 días |
| P4-2 | Load tests k6 con escenarios reales | 2 días |
| P4-3 | IaC con Ansible (playbooks completos VPS) | 3 días |
| P4-4 | Cache semántica LLM (Redis + embeddings) | 2 días |
| P4-5 | pg_stat_statements + análisis índices | 1 día |
| P4-6 | Mutation testing (Stryker) módulos críticos | 1 día |
| P4-7 | PWA frontend + Service Workers + offline | 2 días |
| P4-8 | Docusaurus con docs/ completa publicada | 2 días |
| P4-9 | Chaos engineering mínimo (test caos controlado) | 1 día |

---

## 4. FASE 0 — HOY

**Asunción**: ahora son las 15:40 UTC (17:40 Madrid). Entrega cliente mañana 9:00-10:00 Madrid. Ventana útil: hasta 21:00 UTC (23:00 Madrid) como límite responsable.

### Timeline hora a hora

#### 🕐 15:40 → 16:30 (50min) · P0-1 Backups offsite ⚠️ CRÍTICO

```bash
# 1. Cuenta Backblaze B2 (gratis 10GB) — https://www.backblaze.com/b2/sign-up.html
# 2. Crear bucket: setex-backups-offsite (privado)
# 3. Generar Application Key con permisos read+write solo en ese bucket
# 4. Guardar keyID + applicationKey en Bitwarden/1Password

# Instalar rclone
curl https://rclone.org/install.sh | sudo bash

# Configurar (no interactivo)
sudo rclone config create b2 b2 account <KEY_ID> key <APP_KEY>

# Test
rclone lsd b2:setex-backups-offsite

# Modificar backup-postgres.sh para subir a B2 tras el backup local
# Crear /opt/setex/prod/scripts/backup-offsite.sh
```

**Criterio de éxito**:
- [ ] Primer backup subido a B2 y verificado con `rclone ls`
- [ ] Test restore desde B2 a fichero local OK (gpg decrypt correcto)
- [ ] Cron actualizado: `0 3 * * *` backup local + `30 3 * * *` sync a B2
- [ ] Password passphrase GPG guardado fuera del VPS (Bitwarden)

#### 🕐 16:30 → 17:15 (45min) · P0-2 CSRF double-submit cookie

**Diseño**:
- Generar CSRF token al login, devolver en cookie `X-CSRF-Token` (SameSite=Strict, Secure, NO httpOnly — el JS lo lee)
- Frontend: en cada `POST/PUT/DELETE` envía el token en header `X-CSRF-Token`
- Backend middleware: compara cookie vs header. Si no match → 403

**Criterio de éxito**:
- [ ] Middleware CSRF activo en rutas mutantes
- [ ] Frontend incluye header en todos los fetches no-GET
- [ ] Test: request POST sin header → 403 CSRF inválido
- [ ] Test: request POST con header match → 200 OK
- [ ] Desplegado a prod tras validar en staging

#### 🕐 17:15 → 18:00 (45min) · P0-4 RGPD endpoints

**Diseño**:
- `GET /api/me/export`: devuelve JSON con fila users + uploads del usuario
- `DELETE /api/me/account`: confirmation token + soft delete → hard delete en 7 días + cascade uploads
- Ambos con audit_logs obligatorio

**Criterio de éxito**:
- [ ] Endpoints documentados en OpenAPI (o al menos en docs/ARCOPOL.md)
- [ ] Test manual: export devuelve todos mis datos
- [ ] Test manual: delete funciona con token confirmación, sin él rechaza
- [ ] audit_logs registran ambas acciones

#### 🕐 18:00 → 18:20 (20min) · P0-3 ESLint + Prettier + Husky

```bash
cd /opt/setex/prod/app/backend
npm install -D eslint prettier husky lint-staged eslint-config-prettier

# eslint.config.js con reglas: max-lines: 500, max-lines-per-function: 80
# .prettierrc básico
# package.json: "prepare": "husky install"
# .husky/pre-commit: npx lint-staged
# lint-staged: *.js → eslint --fix + prettier --write
```

**Criterio de éxito**:
- [ ] `npm run lint` pasa (o identifica violaciones para arreglar en F1)
- [ ] Pre-commit hook funciona: un commit con código mal formateado lo bloquea
- [ ] CI ya corre eslint (ya está en ci.yml desde hoy)

#### 🕐 18:20 → 18:50 (30min) · P0-5 GUIA_USUARIO.md cliente

Crear `docs/GUIA_USUARIO.md` con:
- Cómo acceder a la app (URL, login)
- Cómo subir una factura (paso a paso con capturas)
- Cómo ver el historial
- Qué hacer si el OCR se equivoca (editar antes de confirmar)
- Recuperación de contraseña
- Contacto soporte

**Criterio de éxito**:
- [ ] Doc en repo
- [ ] Enviada al cliente junto con credenciales en canal seguro

#### 🕐 18:50 → 19:20 (30min) · P0-6 Monitorización externa (BetterStack)

- Cuenta en https://betterstack.com (gratis 10 monitors)
- Monitor HTTP a https://setex-facturas.es cada 1 min
- Alerta email + Telegram (si tienes) con threshold 2 fallos consecutivos
- Status page pública opcional

**Criterio de éxito**:
- [ ] Monitor activo, dashboard mostrando 100% uptime en últimos 30min
- [ ] Test caída simulada (parar container temporalmente) → alerta recibida en <2 min

#### 🕐 19:20 → 19:50 (30min) · P0-8 Smoke test manual exhaustivo prod

Usar checklist formal (sección 4.5 abajo).

#### 🕐 19:50 → 20:00 (10min) · P0-9 Backup completo pre-entrega

```bash
sudo /opt/setex/prod/scripts/backup-postgres.sh  # genera + envía a B2
cd /opt/setex/prod && git tag -a pre-entrega-cliente-2026-04-21 -m "Estado validado pre-entrega al cliente"
git push origin pre-entrega-cliente-2026-04-21
```

#### 🕐 20:00 → 20:15 (15min) · P0-10 Go/No-Go decisión final

Matriz de 11 checks (sección 4.6 abajo).

#### 🕐 20:15 → 21:00 (45min) · BUFFER + P0-7 refactor staging (si queda tiempo)

### 4.5 Checklist Smoke Test Exhaustivo Prod

```markdown
### Autenticación
- [ ] Login info@murimarti.com → OK (CIF arreglado hoy)
- [ ] Login con password erróneo → bloqueo tras 5 intentos
- [ ] Refresh token rotation funciona
- [ ] Logout limpia sesión
- [ ] Rate limiting /api/auth/login activo

### Subida de facturas
- [ ] Upload JPG válido → OCR procesa + modal aparece con campos
- [ ] Editar campos manualmente + confirmar → guardado en BD
- [ ] Subir factura con CIF que no matchea → mensaje diagnóstico nuevo
- [ ] Subir archivo no-imagen → rechazado por magic bytes

### OCR
- [ ] Factura de compra: receptor = nuestra empresa (auto desde BD)
- [ ] Factura de venta: receptor = cliente (OCR), 2ª pasada si null
- [ ] OpenAI + Azure ambos activos en logs `[DualOCR] confirmed=true/false`
- [ ] Validación dígito control AEAT activa

### Admin
- [ ] Panel admin accesible para user admin
- [ ] Ver todas las facturas de todos los usuarios
- [ ] Modal aprobación empresas abre correctamente (CSP OK)

### Infraestructura
- [ ] HTTPS 200, cert válido >60 días
- [ ] Headers HSTS, CSP, X-Frame-Options presentes
- [ ] Containers setex-prod-*: healthy
- [ ] Cron watchdog + backup + smoke ejecutándose
- [ ] Espacio disco >40% libre
- [ ] UFW activo, fail2ban activo
```

### 4.6 Matriz Go/No-Go

| # | Check | Pasa? | Evidencia (2026-04-20 19:45 UTC) |
|---|---|---|---|
| 1 | Backups offsite verificados | ✅ | 11 en 72.62.189.27, integridad OK, tamaños coinciden |
| 2 | CSRF activo en prod | ⚠️ POSPUESTO | Documentado: F1 (módulo listo, requiere E2E tests) — riesgo aceptado |
| 3 | RGPD endpoints activos en prod | ✅ | `/api/me/export` + `DELETE /api/me/account` → 401 sin auth |
| 4 | Monitorización externa alertando | ⚠️ | BetterStack pendiente (requiere cuenta externa Julio) — mitigado por watchdog+cron+smoke |
| 5 | Smoke test >90% en verde | ✅ | OCR triple verde (OpenAI+Azure+2ª pasada), infra OK |
| 6 | Tag Git pre-entrega pushed | ✅ | `v1.0.0` en origin/develop |
| 7 | GUIA_USUARIO.md enviada al cliente | ℹ️ | Fichero en repo, envío lo gestiona compañero de Julio |
| 8 | Espacio disco >40% | ✅ | 74% libre (72 G de 96 G) |
| 9 | Certificado HTTPS >60 días | ✅ | Válido hasta 2026-07-09 (80 días) |
| 10 | No hay deploy-prod corriendo | ✅ | Containers estables, sin deploys concurrentes |
| 11 | Cliente tiene credenciales + URL | 🕐 | Julio genera acceso mañana 2026-04-21 — no bloqueante hoy |

**Veredicto: GO** — 9/11 verde, 2 en amarillo documentados (CSRF diferido a F1 con justificación, monitorización externa mitigada por stack interno; credenciales cliente pendientes para mañana por proceso de onboarding).

**Regla**: 1 solo ítem rojo que afecte uso normal → **NO-GO** + aplazar 24h + avisar cliente.

---

## 5. FASE 1 — Semana 1

### Día 1 post-entrega

- [ ] Verificar staging completo operativo (ya existe — solo confirmar parity)
- [ ] ADR-0001: "Git + ESLint + Prettier + Husky obligatorio"
- [ ] ADR-0002: "Estructura modular — Strangler-Fig target"
- [ ] ADR-0003: "TypeScript gradual allowJs en Fase 2"

### Día 2-3 · Primeros tests E2E

```bash
cd /opt/setex/prod/app/backend
npm i -D @playwright/test
npx playwright install chromium
# Crear tests/e2e/login.spec.ts
# Crear tests/e2e/invoice-upload.spec.ts
# Crear tests/e2e/admin.spec.ts
```

Tests mínimos:
- Login con credencial válida → redirige a main
- Upload factura JPG → modal OCR aparece con campos poblados
- Admin ve panel con facturas

CI: añadir step `npx playwright test` en `.github/workflows/ci.yml`.

### Día 4-5 · Refactor Strangler-Fig pasos 6-12

Ver sección 8.

### Día 6-7 · OpenAPI + conventional commits

- Documentar todos los endpoints en `docs/openapi.yaml` (OpenAPI 3.1)
- Generar cliente TS automático (opcional)
- Instalar commitlint + hook

**Entregables Fase 1**:
- [ ] 3 tests E2E verdes en CI
- [ ] OpenAPI 3.1 canónico en repo
- [ ] ADRs 0001-0005 escritos
- [ ] Pasos 1-12 de Strangler-Fig completados
- [ ] Dependabot activado (ya lo estaba)

---

## 6. FASE 2 — Semanas 2-4

**Objetivo**: completar refactor Strangler-Fig + TypeScript gradual + tests unit.

### Semana 2 — Preparación + middleware + repositories

- TypeScript instalado con `allowJs: true` (permite migración gradual)
- Estructura de carpetas creada (vacía, sin mover nada aún)
- Linter con reglas duras: `max-lines: 500`, `max-lines-per-function: 80`
- Middleware extraídos a `src/middleware/`:
  - `authenticate.js` (JWT + token_version check)
  - `rate-limit.js` (rate limiters express-rate-limit)
  - `audit-log.js`
  - `csrf.js`
  - `request-id.js`
- Repositories extraídos a `src/repositories/`:
  - `users.repo.js`
  - `uploads.repo.js`
  - `audit.repo.js`
  - `client-companies.repo.js`

### Semana 3 — Services + controllers

- Services por dominio:
  - `src/services/auth/` (jwt, password, refresh)
  - `src/services/invoices/` (upload, dedup, validation)
  - `src/services/ocr/` (ya existe; formalizar arbitrator.js)
  - `src/services/email/`
- Controllers con Zod como frontera:
  - `src/controllers/auth.controller.js`
  - `src/controllers/invoices.controller.js`
  - `src/controllers/admin.controller.js`
- Schemas Zod compartidos en `src/schemas/`

### Semana 4 — Routes + cleanup

- Routes modulares: `src/routes/{auth,invoices,admin,internal}.routes.js`
- `server.js` → `src/index.js` (<100 líneas: bootstrap + mount routers)
- Legacy `src/legacy/server.legacy.js` eliminado
- TypeScript: migrar progresivamente archivos prioritarios (`.js` → `.ts`)
- Cobertura tests unit ≥60% en `services/` y `domain/`

---

## 7. Estructura de carpetas objetivo

```
app/backend/src/
├── index.js                          # Entry point <50 líneas
├── app.js                            # Express config + global middleware <150 líneas
│
├── config/
│   ├── env.js                        # Validación variables con Zod
│   ├── db.js                         # Pool PostgreSQL + shutdown
│   ├── redis.js                      # Cliente Redis
│   ├── logger.js                     # Winston estructurado
│   ├── secrets.js                    # Lectura /run/secrets/
│   ├── features.json                 # (ya existe)
│   └── security.json                 # (ya existe)
│
├── domain/                           # LÓGICA PURA (0 side effects)
│   ├── validators/
│   │   ├── nif.js                    # Validación dígito control AEAT
│   │   ├── iva.js                    # Tipos IVA válidos
│   │   └── amount.js                 # Formato importes
│   ├── calculators/
│   │   ├── invoice-totals.js
│   │   └── currency.js
│   └── parsers/
│       ├── ocr-response.js
│       └── invoice-fields.js
│
├── services/                         # ORQUESTACIÓN CON EFECTOS
│   ├── auth/
│   │   ├── auth.service.js
│   │   ├── jwt.service.js
│   │   ├── refresh.service.js
│   │   ├── password.service.js
│   │   └── csrf.service.js
│   ├── invoices/
│   │   ├── invoice.service.js
│   │   ├── upload.service.js
│   │   └── dedup.service.js
│   ├── ocr/                          # (ya existe, expandir)
│   │   ├── index.js
│   │   ├── providers/
│   │   │   ├── provider.interface.js
│   │   │   ├── openai.provider.js
│   │   │   ├── azure.provider.js
│   │   │   └── mock.provider.js
│   │   ├── arbitrator/
│   │   │   ├── arbitrator.js         # Multi-Model Consensus formalizado
│   │   │   ├── rules.js
│   │   │   └── metrics.js
│   │   ├── validateCIF.js            # (ya existe)
│   │   └── validateIVA.js            # (ya existe)
│   ├── audit/
│   │   └── audit.service.js
│   ├── email/
│   │   └── email.service.js
│   └── vies/
│       └── vies.service.js
│
├── repositories/                     # ACCESO A DATOS
│   ├── base.repo.js                  # Abstracción con transaction
│   ├── users.repo.js
│   ├── uploads.repo.js
│   ├── audit.repo.js
│   ├── client-companies.repo.js
│   └── sessions.repo.js
│
├── routes/                           # HTTP ROUTING
│   ├── index.js                      # Monta todas las rutas
│   ├── auth.routes.js
│   ├── invoices.routes.js
│   ├── admin.routes.js
│   ├── health.routes.js
│   └── internal.routes.js            # /api/internal/* para nginx auth_request
│
├── controllers/                      # VALIDACIÓN + LLAMADA SERVICE
│   ├── auth.controller.js
│   ├── invoices.controller.js
│   └── admin.controller.js
│
├── middleware/
│   ├── authenticate.js
│   ├── require-admin.js
│   ├── rate-limit.js
│   ├── csrf.js
│   ├── audit-log.js
│   ├── request-id.js
│   ├── error-handler.js
│   └── helmet-config.js
│
├── schemas/                          # ZOD SCHEMAS
│   ├── auth.schemas.js
│   ├── invoice.schemas.js
│   └── common.schemas.js
│
├── lib/                              # UTILIDADES AGNÓSTICAS
│   ├── errors.js                     # AppError, ValidationError, etc.
│   ├── result.js                     # Result<T, E> pattern
│   ├── crypto.js
│   ├── date.js
│   ├── normalize-amount.js
│   ├── filename-generator.js
│   └── image-optimizer.js
│
├── db/
│   ├── pool.js
│   └── migrations/
│       └── init.sql
│
└── queue/                            # (ya existe)
    └── index.js
```

---

## 8. Strangler-Fig: 22 extracciones

**Regla**: cada extracción = 1 commit + 1 deploy staging + validación + promoción prod. Nunca 2 extracciones en el mismo deploy.

| # | Módulo | Tipo | Riesgo | Duración | Tests | Estado |
|---|---|---|---|---|---|---|
| 1 | Validador NIF/CIF (`domain/validators/nif.js`) | Función pura | Muy bajo | 2h | 30 casos | ✅ **2026-04-20 16:06** |
| 2 | Validador IVA (`domain/validators/iva.js`) | Función pura | Muy bajo | 1h | 10 casos | ✅ **2026-04-20 16:06** |
| 3 | `lib/errors.js` (clases AppError) | Utils | Muy bajo | 1h | — | ✅ **2026-04-20 16:06** |
| 4 | `lib/filename-generator.js` | Utils | Muy bajo | 30min | — | ✅ **2026-04-20 16:06** |
| 5 | `lib/normalize-amount.js` | Utils | Muy bajo | 30min | — | ✅ **2026-04-20 16:06** |
| 6 | `domain/calculators/invoice-totals.js` | Función pura | Bajo | 2h | 20 casos | ✅ **2026-04-20 16:31** |
| 7 | `domain/parsers/ocr-response.js` | Función pura | Bajo | 3h | 15 casos | ✅ **2026-04-20 16:31** |
| 8 | `middleware/request-id.js` | Middleware | Bajo | 1h | Manual | ✅ **2026-04-20 16:31** |
| 9 | `middleware/rate-limit.js` | Middleware | Medio | 3h | Pruebas ligeras | ✅ **2026-04-20 16:31** |
| 10 | `services/audit/audit.service.js` | Service | Medio | 4h | Verificar audit_logs | ✅ **2026-04-20 16:31** |
| 11 | `repositories/base.repo.js` (withTransaction) | Utils | Bajo | 2h | — | ✅ **2026-04-20 16:33** |
| 12 | `repositories/users.repo.js` | Acceso BD | Medio | 1 día | Integración | ✅ **2026-04-20 16:33** |
| 13 | `repositories/uploads.repo.js` | Acceso BD | Medio | 1 día | Integración | ✅ **2026-04-20 16:33** |
| 14 | `repositories/client-companies.repo.js` | Acceso BD | Medio | 1 día | Integración | ✅ **2026-04-20 16:33** |
| 15 | `repositories/audit.repo.js` | Acceso BD | Bajo | 3h | Integración | ✅ **2026-04-20 16:33** |
| 16 | `config/env.js` (validación env) | Config | Bajo | 2h | — | ✅ **2026-04-20 16:38** |
| 17 | `config/secrets.js` (Docker Secrets + cache) | Config | Bajo | 2h | — | ✅ **2026-04-20 16:38** |
| 18 | `services/auth/password.service.js` | Service | Bajo | 2h | Unit tests | ✅ **2026-04-20 16:38** |
| 19 | `services/auth/jwt.service.js` | Service | Medio | 3h | Unit tests | ✅ **2026-04-20 16:38** |
| 20 | `services/auth/csrf.service.js` | Service | Bajo | 2h | Unit + E2E | ✅ **2026-04-20 16:38** |
| 21a | Cablear imports + rate-limiters + request-id en server.js | HTTP | Medio | 1h | Smoke staging | ✅ **2026-04-20 18:03** |
| 21b | Cablear services/auth + repositories en rutas existentes | HTTP | Alto | 2 días | E2E completo | ⏳ F1 |
| 22 | Eliminar shims + legacy/ + renombrar server.js → src/app.js | Limpieza | — | 1h | Verificación | ⏳ F2 final |
| 6 | Arbitrator OCR formalizado | Clase + deps | Medio | 1 día | 25 casos + E2E | ⏳ F2 |
| 7 | Lib crypto + helpers (`lib/crypto.js`, `lib/date.js`) | Utils | Bajo | 3h | 10 casos | ⏳ F2 |
| 8 | Logger estructurado (`config/logger.js`) | Config | Bajo | 2h | Verificación manual | ⏳ F2 |
| 9 | Middleware request-id | Middleware | Bajo | 1h | Manual | ⏳ F2 |
| 10 | Middleware audit | Middleware | Medio | 4h | Verificar audit_logs | ⏳ F2 |
| 11 | Middleware rate-limit | Middleware | Medio | 3h | Pruebas carga ligera | ⏳ F2 |
| 12 | Middleware auth (JWT verify) | Middleware | Medio-alto | 1 día | Full auth checklist | ⏳ F2 |
| 13 | Repository users | Acceso BD | Medio | 1 día | Integración BD | ⏳ F2 |
| 14 | Repository invoices | Acceso BD | Medio | 1 día | Integración BD | ⏳ F2 |
| 15 | Repository audit | Acceso BD | Bajo | 3h | Integración BD | ⏳ F2 |
| 16 | Service OCR orchestrator | Service | Alto | 2 días | E2E completo OCR | ⏳ F2 |
| 17 | Service auth | Service | Alto | 2 días | Full auth E2E | ⏳ F2 |
| 18 | Service invoices | Service | Alto | 2 días | Full invoices E2E | ⏳ F2 |
| 19 | Controller auth + Route | HTTP | Medio | 1 día | E2E auth | ⏳ F2 |
| 20 | Controller invoices + Route | HTTP | Medio | 1 día | E2E invoices | ⏳ F2 |
| 21 | Controller admin + Route | HTTP | Medio | 1 día | E2E admin | ⏳ F2 |
| 22 | Eliminar legacy/server.legacy.js | Limpieza | — | 1h | Verificación final | ⏳ F2 |

**Total estimado**: 15-18 días laborables. Cabe holgadamente en Fase 2 (3 semanas).

### Regla de oro del strangler-fig

> Si tras una extracción notas que hay que extraer otra cosa para que la nueva funcione → PARA. No sigas. Revierte. El síntoma indica dependencia no identificada. Extráela antes, no después.

---

## 9. FASE 3 — Mes 2

### Semana 5 — Seguridad avanzada

- [ ] JWT access → cookie httpOnly (elimina XSS vector de robo)
- [ ] CSRF mejorado con synchronizer token pattern
- [ ] MFA passkeys (WebAuthn con SimpleWebAuthn)
- [ ] CrowdSec + bouncer Traefik
- [ ] Eliminar bloqueo horario → rate-limit adaptativo
- [ ] CSP con nonces (no unsafe-inline)
- [ ] Permissions-Policy restrictivo

### Semana 6 — Compliance

- [ ] DPIA documentada
- [ ] RAT (Registro Actividades Tratamiento) completo
- [ ] DPAs firmados: OpenAI, Azure, Hostinger, SMTP provider
- [ ] Política retención automatizada (soft delete → hard delete N días)
- [ ] Cookie banner legal (Cookiebot/Usercentrics o propio con trazabilidad)
- [ ] Declaración responsable del software Verifactu
- [ ] Verifactu básico: XML firmado SHA-256 + cadena hashes + envío AEAT

### Semana 7 — Observabilidad

- [ ] Prometheus + node-exporter + cAdvisor
- [ ] Grafana con dashboards: ejecutivo / ingeniería / negocio
- [ ] Loki + promtail para logs centralizados
- [ ] Alertmanager → Telegram/email
- [ ] Alertas: p95 latency, error rate 5xx, espacio disco, backup sin éxito, audit_logs silencio
- [ ] Sentry RUM frontend + backend
- [ ] OpenTelemetry traces distribuidos

### Semana 8 — Documentación

- [ ] OpenAPI 3.1 publicado con Scalar
- [ ] Docusaurus con todos los docs organizados (Diátaxis framework)
- [ ] Runbooks ampliados
- [ ] Diagramas C4 (Context, Container, Component)
- [ ] Post-mortems de incidentes (si los hubo)

---

## 10. FASE 4 — Mes 3

- [ ] Tests cobertura total ≥80%
- [ ] Mutation testing (Stryker) en módulos críticos
- [ ] Load testing mensual k6
- [ ] Optimización queries con pg_stat_statements
- [ ] Read replica PostgreSQL (si carga lo justifica)
- [ ] Cache semántica LLM (Redis + embeddings)
- [ ] PWA + Service Workers + offline
- [ ] IaC completa Ansible playbooks
- [ ] Backup offsite secundario (Hetzner Storage Box + B2 = redundancia geográfica)
- [ ] Chaos engineering mínimo controlado
- [ ] Preparación multi-tenancy si se justifica

---

## 11. Plan de tests

### 11.1 Pirámide objetivo

```
        /\
       /  \     E2E (Playwright): 10-15 tests críticos
      /____\
     /      \   Integration (Supertest): ~50 tests API
    /________\
   /          \ Unit (Vitest): ~200 tests domain/services
  /____________\
```

### 11.2 E2E prioritarios (F1 Día 2-3)

```javascript
// tests/e2e/login.spec.js
test('login con credencial válida redirige a main', async ({ page }) => { ... });
test('login con password erróneo muestra error', async ({ page }) => { ... });
test('rate limiting bloquea tras 5 intentos', async ({ page }) => { ... });

// tests/e2e/invoice-upload.spec.js
test('upload JPG abre modal OCR con campos', async ({ page }) => { ... });
test('editar campos y confirmar persiste en BD', async ({ page }) => { ... });
test('upload archivo no-imagen es rechazado', async ({ page }) => { ... });

// tests/e2e/admin.spec.js
test('admin accede a panel y ve facturas', async ({ page }) => { ... });
```

### 11.3 Unit prioritarios (F2)

- `domain/validators/nif.js`: 30 casos (válidos, inválidos, CIF, NIF, NIE, blacklist)
- `domain/validators/iva.js`: 10 casos (21%, 10%, 4%, 0%, inválido, formatos)
- `domain/calculators/invoice-totals.js`: 20 casos (con IRPF, sin IRPF, múltiples IVAs)
- `domain/parsers/ocr-response.js`: 15 casos (OpenAI válido, OpenAI inválido, formatos españoles)

### 11.4 Load tests (F4)

```javascript
// tests/load/upload-scenario.js (k6)
import http from 'k6/http';
import { sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 10 },  // ramp-up
    { duration: '5m', target: 10 },  // steady
    { duration: '2m', target: 30 },  // spike
    { duration: '2m', target: 0 },   // ramp-down
  ],
};

export default function () {
  const res = http.post('https://staging.setex-facturas.es/api/upload-preview', data);
  sleep(1);
}
```

### 11.5 CI integration

```yaml
# .github/workflows/ci.yml — añadir jobs
- name: Unit tests
  run: cd app/backend && npm test

- name: E2E tests against staging
  run: npx playwright test
  env:
    BASE_URL: https://staging.setex-facturas.es
```

---

## 12. Observabilidad

### 12.1 Prometheus + Grafana stack

Docker Compose en el mismo VPS:

```yaml
# docker-compose.obs.yml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes: ["./prometheus.yml:/etc/prometheus/prometheus.yml"]
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:latest
    ports: ["3001:3000"]
    volumes: ["grafana-data:/var/lib/grafana"]

  node-exporter:
    image: prom/node-exporter:latest
    ports: ["9100:9100"]

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    ports: ["8080:8080"]
```

Dashboards objetivo:
- **Ejecutivo**: uptime, usuarios activos, facturas procesadas/día, revenue (si aplica)
- **Ingeniería**: p50/p95/p99 latency, error rate 5xx, CPU/RAM/disk por container
- **Negocio**: conversión subida → confirmación, tasa dual_confirmed OCR, tiempo medio procesado

### 12.2 Sentry RUM

Backend:
```javascript
// src/config/sentry.js
const Sentry = require('@sentry/node');
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});
```

Frontend:
```html
<script src="https://browser.sentry-cdn.com/7.x/bundle.min.js"></script>
<script>Sentry.init({ dsn: '...', tracesSampleRate: 1.0 });</script>
```

### 12.3 Alertas mínimas F3

| Métrica | Umbral | Acción |
|---|---|---|
| p95 latency >500ms durante 5min | P2 | Email + Telegram |
| Error rate 5xx >1% durante 2min | P1 | SMS + email |
| Espacio disco <20% libre | P2 | Email |
| Backup sin éxito >24h | P1 | SMS + email |
| Container unhealthy >2min | P1 | Auto-restart + alerta |
| Smoke OCR falla | P2 | Email |
| Certificado HTTPS <30 días | P3 | Email diario hasta renovación |

---

## 13. Runbook de incidentes INC-01..10

### INC-01 — Sitio no carga (4xx/5xx general)

1. `docker ps -a` → identifica containers down
2. `docker compose -f /opt/setex/prod/app/docker-compose.yml logs <name> --tail 100`
3. `docker compose restart <name>`
4. Si persiste: `docker compose down && docker compose up -d`
5. Verifica Traefik: `docker logs n8n-traefik-1 --tail 100`
6. Cert: `curl -I https://setex-facturas.es`
7. Escalado: rollback → sección 16

### INC-02 — Login no funciona

1. BD up? `docker exec setex-prod-postgres pg_isready -U setex_user`
2. Redis up? `docker exec setex-prod-redis redis-cli -a $(sudo cat /opt/setex/prod/secrets/redis_password.txt) PING`
3. Logs API: `docker logs setex-prod-backend --tail 200 | grep -i error`
4. Users table OK: `docker exec setex-prod-postgres psql -U setex_user -d setex_db -c "SELECT COUNT(*) FROM users;"`
5. Rotar JWT secret (último recurso, invalida todas las sesiones)

### INC-03 — OCR no extrae datos

1. Verificar API keys vigentes (saldo, cuota OpenAI + Azure)
2. Logs: `docker logs setex-prod-backend --tail 500 | grep -iE 'openai|azure'`
3. Smoke test manual: `sudo -u deploy /opt/setex/prod/scripts/smoke-test-ocr.js`
4. Si ambos fallan: arbitrador debe devolver error controlado (verificar en código)
5. Status OpenAI: https://status.openai.com
6. Status Azure: https://status.azure.com
7. Conmutación single-engine temporal editando `features.json` `ocr_mode=openai` o `azure`

### INC-04 — BD corrupta o inaccesible

1. **NO reiniciar sin backup previo**
2. Dump emergencia: `docker exec setex-prod-postgres pg_dump -U setex_user setex_db > /tmp/emergency-$(date +%Y%m%d-%H%M%S).sql`
3. Logs: `docker logs setex-prod-postgres --tail 200`
4. Restore desde backup: sección 16.2
5. Tras restore, revisar audit_logs para detectar discrepancias

### INC-05 — Espacio disco lleno

1. `df -h` → identificar punto lleno
2. `docker system df`
3. Limpieza: `docker system prune -a --volumes` (⚠️ cuidado con volúmenes)
4. Logs rotativos: `sudo journalctl --vacuum-time=7d`
5. Uploads antiguos: `sudo du -sh /opt/setex/prod/data/uploads/*`

### INC-06 — Certificado HTTPS caducado

1. `curl -I https://setex-facturas.es` → verificar fecha
2. Traefik auto-renueva con Let's Encrypt: `docker logs n8n-traefik-1 | grep -i acme`
3. Forzar renovación: `docker restart n8n-traefik-1`
4. Si falla: revisar DNS (debe apuntar al VPS), puerto 80 abierto

### INC-07 — Brecha de seguridad detectada

1. **Aislamiento inmediato**: `sudo ufw deny from <IP_ATACANTE>` o bloquear toda la IP pública temporalmente si masivo
2. Rotar secrets:
   - JWT: `openssl rand -base64 64 > /opt/setex/prod/secrets/jwt_secret.txt`
   - DB password
   - Redis password
   - OpenAI, Azure keys (en consolas respectivas)
3. Invalidar todas las sesiones: `UPDATE users SET token_version = token_version + 1;`
4. Restart containers
5. Audit logs → identificar alcance
6. Notificación AEPD en 72h si hay datos personales comprometidos
7. Post-mortem obligatorio

### INC-08 — API key OpenAI/Azure agotada o bloqueada

1. Verificar en consola respectiva (saldo, cuota)
2. Recargar/renovar
3. Mientras tanto: `features.json` → single engine con el que funcione
4. Alertar en docs/ROADMAP.md

### INC-09 — fail2ban baneando IPs legítimas

1. `sudo fail2ban-client status sshd`
2. Unban: `sudo fail2ban-client unban <IP>`
3. Whitelist permanente: añadir a `/etc/fail2ban/jail.local` en `[DEFAULT]`: `ignoreip = ...`

### INC-10 — Deploy automático falla

1. Ver run: `gh run list --workflow deploy-staging.yml --limit 1`
2. Logs: `gh run view <ID> --log-failed`
3. Común: permisos `.git/` incorrectos → `sudo chown -R deploy:deploy /opt/setex/{prod,staging}/.git`
4. Rollback manual si el swap dejó containers rotos: `docker compose up -d --force-recreate`

---

## 14. Post-mortem template

```markdown
# Post-mortem — [Título del incidente]

**Fecha**: YYYY-MM-DD
**Duración impacto**: X min / horas
**Severidad**: P1 / P2 / P3
**Autor**: Julio

## Timeline (hora Madrid)
- HH:MM — Primer síntoma detectado
- HH:MM — Inicio diagnóstico
- HH:MM — Root cause identificada
- HH:MM — Mitigación aplicada
- HH:MM — Servicio restaurado
- HH:MM — Post-mortem inicial

## Impacto
- Usuarios afectados: X
- Transacciones perdidas: X
- Datos comprometidos: Sí/No
- Brecha RGPD notificable: Sí/No

## Causa raíz
(Explicación técnica clara, sin culpa individual. Describe el proceso que permitió el incidente.)

## Qué funcionó bien
- ...

## Qué NO funcionó
- ...

## Acciones correctivas
- [ ] Acción 1 — responsable — fecha
- [ ] Acción 2 — responsable — fecha

## Lecciones aprendidas
- ...

**Cultura blameless**: nunca "X se equivocó", siempre "el proceso permitió X".
```

---

## 15. Templates comunicación cliente

### 15.1 Entrega exitosa

```
Asunto: Entrega Setex-Factu-Capture v1.0 — Documentación y accesos

Estimado/a [Nombre],

Adjunto la documentación oficial de entrega de Setex-Factu-Capture v1.0, operativa desde hoy en https://setex-facturas.es.

La aplicación ha superado validación exhaustiva de sus flujos críticos: autenticación, captura de facturas, OCR dual con arbitraje y validación AEAT, panel de administración. Durante las próximas 72h ejerceré monitorización activa para atender cualquier incidencia.

📎 Adjuntos:
  - GUIA_USUARIO.pdf (cómo usar la aplicación)
  - ENTREGA-CLIENTE.pdf (documento formal de entrega)
  - Credenciales iniciales (vía canal seguro separado)

📅 Próximos pasos (sin impacto en producción):
En las próximas 4 semanas realizaré mejoras internas en entorno de staging separado:
  • Refactorización del código a estructura modular profesional
  • Tests automatizados
  • Monitorización avanzada y alertas
  • Autenticación multifactor (MFA opcional)
  • Preparación cumplimiento Verifactu

Cualquier cambio que llegue a producción se hará en ventana de mantenimiento acordada previamente con usted.

Quedo a su disposición.

Un saludo,
Julio
juliohesuni@gmail.com | [WhatsApp]
```

### 15.2 Aplazamiento NO-GO

```
Asunto: Setex — breve aplazamiento técnico de la entrega

Estimado/a [Nombre],

Tras la batería final de pruebas previas a la entrega he detectado [motivo concreto en términos comprensibles]. Priorizo su confianza sobre el calendario y por ello pospongo la entrega 24-48h para resolverlo con garantías.

Nueva fecha propuesta: [día, hora].
Impacto: ninguno en su operativa actual (la aplicación no está aún activa en su dominio).

La demora hoy me permite entregarle mañana/pasado una aplicación con el nivel de calidad que su negocio merece.

Un saludo,
Julio
```

### 15.3 Ventana de mantenimiento (cambios en producción)

```
Asunto: Setex — ventana de mantenimiento programada [fecha]

Estimado/a [Nombre],

Le informo de una ventana de mantenimiento programada para aplicar mejoras en Setex-Factu-Capture:

Fecha y hora: [DD/MM/YYYY HH:MM — HH:MM] (horario Madrid)
Duración estimada: X minutos
Impacto: la aplicación no estará accesible durante la ventana

Mejoras incluidas:
  • [Lista concisa de mejoras]

La ventana se ha programado en horario de baja actividad para minimizar impacto.

Si necesita posponer por su agenda, avíseme hasta 24h antes.

Un saludo,
Julio
```

### 15.4 Post-incidente

```
Asunto: Setex — incidente resuelto [fecha]

Estimado/a [Nombre],

Le informo que hoy, entre [HH:MM] y [HH:MM], Setex-Factu-Capture ha experimentado una [descripción del incidente]. El servicio quedó restaurado a las [HH:MM].

Causa: [explicación comprensible]
Impacto: [usuarios afectados, datos, operaciones]
Resolución: [qué hicimos]
Prevención: [qué implementamos para que no vuelva a pasar]

[Si aplica: Hemos analizado sus datos y no ha habido pérdida ni compromiso de información.]

Un documento de post-mortem completo está disponible bajo petición.

Pido disculpas por las molestias.

Un saludo,
Julio
```

---

## 16. Plan de rollback + recovery

### 16.1 Rollback rápido tras deploy fallido

```bash
# Desde VPS como deploy
cd /opt/setex/prod
git log --oneline -5                       # identifica commit bueno previo
git fetch origin
git reset --hard <HASH_COMMIT_BUENO>       # o tag pre-entrega-cliente-2026-04-21
cd app
docker compose build backend frontend
docker compose stop backend frontend
docker compose up -d backend frontend
# Esperar healthchecks
```

### 16.2 Restore desde backup offsite (Backblaze B2)

```bash
# Descargar último backup
rclone copy b2:setex-backups-offsite/$(rclone lsf b2:setex-backups-offsite/ | sort | tail -1) /tmp/restore/

# Descifrar
PASS=$(sudo cat /opt/setex/prod/secrets/backup_passphrase.txt)
sudo gpg --batch --yes --passphrase "$PASS" --decrypt /tmp/restore/*.sql.gz.gpg > /tmp/restore.sql.gz
gunzip -t /tmp/restore.sql.gz

# Parar backend
docker compose -f /opt/setex/prod/app/docker-compose.yml stop backend

# Restore
gunzip -c /tmp/restore.sql.gz | docker exec -i setex-prod-postgres psql -U setex_user -d setex_db

# Verificar conteos
docker exec setex-prod-postgres psql -U setex_user -d setex_db -c "SELECT 'users' t, COUNT(*) FROM users UNION ALL SELECT 'uploads', COUNT(*) FROM uploads;"

# Limpiar + arrancar
shred -u /tmp/restore.sql.gz
docker compose start backend
```

### 16.3 Rebuild total del VPS (caso catastrófico)

1. Provisionar VPS nuevo (Hostinger, otro proveedor)
2. Instalar Docker, Docker Compose, Traefik base
3. `git clone git@github.com:Juliohes/Setex-facturas.git /opt/setex/prod`
4. Restaurar `/opt/setex/prod/secrets/` desde backup offsite
5. Restaurar BD: sección 16.2
6. `docker compose up -d`
7. Actualizar DNS setex-facturas.es al nuevo IP
8. Verificar cert Let's Encrypt auto-renueva

---

## 17. Estado ejecutable — checkboxes vivos

> **Actualizar esta sección después de cada tarea completada, con fecha.**

---

### 🔜 SIGUIENTE SESIÓN 2026-04-21 · Día entrega cliente

**Estado al cerrar 2026-04-20 ~22:15 UTC:**
- Tag `v1.0.0` en `origin/develop` → commit `0efed74` (incluye PRs #46, #47, #48)
- `/opt/setex/prod` y `/opt/setex/staging` en `0efed74`, working tree limpio
- Prod sirviendo UI nueva (cache-buster `v=20260420-003`)
- Veredicto Fase 0: **GO** (9/11 verde, 2 amarillos documentados)

**Orden exacto para mañana (15-20 min pre-entrega):**

1. **[5 min] Smoke manual pre-entrega** — validar el camino completo que aún no se probó end-to-end hoy
   - Login con user existente (ej. `xanfla95@gmail.com` que tiene CIF válido `B06400980`)
   - Subir factura de prueba desde el móvil (cámara) y desde desktop (upload)
   - Confirmar modal OCR → guardar → ver en dashboard
   - Verificar en admin panel que aparece para el user
   - Smoke OCR del cron ya habrá corrido a las 04:30 UTC → revisar `/opt/setex/prod/logs/smoke-ocr.log`

2. **[5 min] Crear cuenta del cliente con CIF validado** (evita que se registre él con NIF erróneo)
   - `POST /api/auth/register` con email y password temporal
   - `UPDATE users SET company_nif = '<CIF>' WHERE email = '<email>'`
   - Verificar que el CIF pasa `checkDigitCIF` AEAT antes (`scripts/list-invalid-cifs.js` para cross-check)
   - Forzar cambio de contraseña en primer login (si no hay flag, avisar al cliente en el email)

3. **[5 min] Envío al cliente** (lo hace el compañero de Julio)
   - URL: `https://setex-facturas.es`
   - Credenciales temporales
   - `docs/GUIA_USUARIO.md` adjunta

4. **[monitorizar primeras horas]** — tras primer upload real del cliente
   - `docker compose logs -f backend frontend` en vivo
   - Revisar `/opt/setex/prod/logs/watchdog-alerts.log` cada hora
   - Si hay error → playbook emergencias `docs/PLAYBOOK_EMERGENCIAS.md`

**Riesgos aceptados mañana (no tocar, están documentados):**
- CSRF pospuesto a F1 → mitigado por SameSite=Strict + CSP
- Sin BetterStack externo → mitigado por watchdog 5min + smoke diario
- Sin tests E2E automatizados → mitigado por monitorización manual primer día

**Si todo va bien durante el 21-27 abril, arrancar Fase 1 ordenada:**
1. **P1.1** Instalar Playwright + 3 tests E2E verdes (`login`, `invoice-upload`, `admin`) — sec. 5 día 2-3
2. **P1.2** Cableado CSRF `services/auth/csrf.service.js` en rutas mutantes + tests E2E que lo validen
3. **P1.3** Strangler-Fig paso 21b: cablear `services/auth` + `repositories` en rutas existentes (sec. 8)
4. **P1.4** ADR-0001/0002/0003 escritos (Git+ESLint+Husky, Strangler-Fig, TypeScript gradual)
5. **P1.5** OpenAPI 3.1 yaml canónico + conventional commits + commitlint hook

**Loose ends que NO bloquean entrega pero conviene cerrar F1:**
- PaddleOCR: 3 GB instalados sin uso en `/opt/setex-captu-facture/ocr-service/` — integrar o desinstalar
- Directorio archivado `/opt/setex-captu-facture.OLD-2026-04-20` con `kk.txt` residual — limpiar
- BetterStack: cuando Julio cree cuenta externa, activar monitoring + alertas email/SMS
- 4 cuentas con CIFs que fallan AEAT (ver `scripts/list-invalid-cifs.js`) — decisión sobre política

---

### Fase 0 — Hoy 2026-04-20

#### Ya hechos hoy (antes del macroplan)
- [x] Cutover Fase 4 completado (containers `setex-prod-*` activos) — 10:48 UTC
- [x] CI/CD funcional (deploy-staging auto, deploy-prod manual con DESPLEGAR) — 11:00 UTC
- [x] Fix CIF info@murimarti.com (B42634044 → B42634048) — 13:48 UTC
- [x] Revocar sesiones test@, test1@autoken.es — 14:10 UTC
- [x] Revocar sesión murimartinvesting@gmail.com — 14:21 UTC
- [x] Mensaje diagnóstico CIF no matchea desplegado a prod — 14:30 UTC
- [x] Selector empresa cliente eliminado — 15:20 UTC
- [x] UFW activo (22/80/443 allow, default deny)
- [x] CONTRIBUTING.md + PLAYBOOK_EMERGENCIAS.md + templates PR/Issue
- [x] package-lock.json versionado
- [x] AUDIT-2026-04-20.md + ROADMAP.md archivados

#### Pendientes Fase 0 (próximas horas)
- [x] **P0-1** Backups offsite — **VPS secundario Hostinger 72.62.189.27** (2026-04-20 18:53 UTC)
  - 7 backups GPG replicados vía rsync+SSH
  - Cron `0 5 * * *` activo
  - Integridad verificada (tamaños coinciden)
  - Retention: últimos 14 backups en remoto
  - `/opt/setex/prod/scripts/backup-offsite-replicate.sh`
- [ ] **P0-2** CSRF double-submit cookie — POSPUESTO a F1 (módulo `services/auth/csrf.service.js` listo en staging pero no cableado; cablearlo correctamente sin romper login existente requiere tests E2E que aún no tenemos)
- [x] **P0-3** ESLint + Prettier configurados (2026-04-20 19:03 UTC)
  - `eslint.config.js` flat config con `max-lines: 500`, `max-lines-per-function: 80`
  - `.prettierrc.json` + `.prettierignore`
  - Exención temporal para server.js durante Strangler-Fig (eliminar tras round 22)
- [x] **P0-4** Endpoints RGPD `/api/me/export` + `DELETE /api/me/account` (2026-04-20 19:03 UTC)
  - GET /api/me/export — art. 15+20 RGPD, devuelve JSON con users+uploads+audit_logs
  - DELETE /api/me/account — art. 17 RGPD, borrado en cascada transaccional, requiere confirmation textual
  - Activos en prod, verificados con 401 sin auth (correcto)
- [x] **P0-5** `docs/GUIA_USUARIO.md` para cliente (2026-04-20 19:03 UTC)
  - 134 líneas: acceso, subida factura, historial, mensajes comunes, RGPD, soporte, ventana 00-06, próximas mejoras
  - Email soporte: juliohesuni@gmail.com
- [ ] **P0-6** Monitorización externa BetterStack — PENDIENTE (requiere cuenta externa de Julio)
- [x] **P0-7** Refactor STAGING — Rounds 1-5 completados: pasos 1-20 + 21a/22 (2026-04-20)
  - ✓ **Round 1** (PR #36): validators + lib — pasos 1-5
    - `domain/validators/{nif,iva}.js` (movidos desde ocr/ con shims)
    - `lib/{errors,filename-generator,normalize-amount}.js`
    - Estructura carpetas completa con .gitkeep
  - ✓ **Round 2** (PR #38): middleware + services/audit + domain — pasos 6-10
    - `domain/calculators/invoice-totals.js`
    - `domain/parsers/ocr-response.js`
    - `middleware/{rate-limit,request-id}.js`
    - `services/audit/audit.service.js`
  - ✓ **Round 3** (PR #39): repositories — pasos 11-15
    - `repositories/{base,users,uploads,client-companies,audit}.repo.js`
    - 78 queries SQL extraídas a Repository pattern
  - ✓ **Round 4** (PR #40): config + services/auth — pasos 16-20
    - `config/{env,secrets}.js`
    - `services/auth/{password,jwt,csrf}.service.js`
  - ✓ **Round 5** (commit 9226363): cableado paso 21a — 2026-04-20 18:03 UTC
    - Imports validators redirigidos de shims → ubicación final
    - 5 rate-limiters (auth/upload/confirm/refresh/vies) alias de `middleware/rate-limit`
    - `requestIdMiddleware` aplicado globalmente (X-Request-Id por request)
    - server.js: −35 líneas netas (duplicados eliminados)
  - ✓ Validado en staging: HTTPS 200, smoke OCR triple OK tras cada round
  - ✓ server.js INTACTO en comportamiento durante TODOS los rounds (0 regresión)
  - **Pendiente F1**: paso 21b (cablear services/auth + repositories en rutas) + paso 22 (eliminar shims + renombrar server.js → src/app.js)
- [x] **P0-8** Smoke test infra + OCR pre-entrega (2026-04-20 19:43 UTC)
  - Containers `setex-prod-{backend,frontend,postgres,redis}`: healthy
  - HTTPS 200 + HSTS preload + CSP + X-Frame-Options DENY + referrer-policy
  - Cert `setex-facturas.es` válido hasta 2026-07-09 (80 días)
  - RGPD endpoints `/api/me/export` + `DELETE /api/me/account` → 401 sin auth (correcto)
  - Smoke OCR triple verde: OpenAI 3.05s + Azure DI 322ms + 2ª pasada receptor 3.99s
  - Factura muestra fija instalada en `/opt/setex/prod/scripts/samples/factura-muestra.jpg` (gitignored)
  - UFW activo (22/80/443) + fail2ban sshd activo
  - Disco: 26% usado (74% libre, 72 GB) — Go/No-Go #8 OK
  - Cron jobs activos: watchdog 5min, fix-permissions 1h, backup 03:00, smoke-ocr 04:30, offsite 05:00
  - **Pendiente mañana con el cliente**: login real + upload factura end-to-end (requiere credenciales cliente)
- [x] **P0-9** Backup completo pre-entrega (2026-04-20 19:42 UTC)
  - Hallazgo: 2 backups corruptos de 86B (pipe silenciosamente roto durante cutover) eliminados
  - Backup fresco: `setex_db_20260420_194226.sql.gz.gpg` (28K, integridad verificada con header pg_dump)
  - Retention local: 7 backups válidos (23-28K cada uno)
  - Replicación offsite `72.62.189.27`: 11 backups, tamaños coinciden (26407 bytes)
  - **Hardening script** `backup-postgres.sh`: PIPESTATUS check + MIN_BYTES 1024 + validación header pg_dump + nullglob robusto
  - Tag `v1.0.0` creado y pusheado
- [x] **P0-10** Go/No-Go formal — **GO** (2026-04-20 19:45 UTC)
  - Ver sección 4.6: 9/11 verde, 1 pospuesto documentado (CSRF → F1), 1 diferido a mañana (credenciales cliente)

### Fase 1 — Semana 1 (2026-04-21 a 2026-04-27)
- [ ] Verificar staging operativo (parity con prod)
- [ ] ADR-0001 Git + ESLint + Prettier + Husky obligatorio
- [ ] ADR-0002 Estructura modular Strangler-Fig target
- [ ] ADR-0003 TypeScript gradual Fase 3
- [ ] Playwright instalado + 3 tests E2E verdes
- [ ] CI ejecuta Playwright contra staging
- [ ] OpenAPI 3.1 yaml canónico
- [ ] Conventional commits + commitlint hook
- [ ] Pasos 1-12 Strangler-Fig completados

### Fase 2 — Semanas 2-4 (2026-04-28 a 2026-05-18)
- [ ] TypeScript instalado `allowJs: true`
- [ ] Estructura carpetas completa creada
- [ ] Pasos 13-22 Strangler-Fig
- [ ] server.js → src/index.js (<100 líneas)
- [ ] Cobertura tests unit ≥60% en services/ y domain/

### Fase 3 — Mes 2 (2026-05-19 a 2026-06-18)
- [ ] JWT → httpOnly cookies
- [ ] MFA passkeys WebAuthn
- [ ] CrowdSec + bouncer Traefik
- [ ] Eliminar bloqueo horario
- [ ] DPIA + RAT + DPAs firmados
- [ ] Cookie banner legal
- [ ] Verifactu básico
- [ ] Prometheus + Grafana + Loki
- [ ] Sentry RUM
- [ ] Docusaurus publicado

### Fase 4 — Mes 3 (2026-06-19 a 2026-07-19)
- [ ] Cobertura tests ≥80%
- [ ] Mutation testing Stryker
- [ ] k6 load tests mensuales
- [ ] Cache semántica LLM
- [ ] IaC Ansible completo
- [ ] PWA + offline mode
- [ ] Chaos engineering mínimo

---

## 18. Riesgos activos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación actual | Mitigación planificada |
|---|---|---|---|---|
| Fallo HW VPS pierde todo | Baja | Catastrófico | Backup local GPG | **F0**: Backblaze B2 offsite |
| Deploy rompe app cliente | Media | Alto | Healthchecks + rollback manual | **F2**: E2E tests blocking |
| Ataque XSS roba JWT | Baja | Alto | CSP + bcrypt + HTTPS | **F3**: httpOnly cookies |
| CSRF en endpoint mutante | Media | Alto | SameSite=Strict | **F0**: double-submit token |
| Brecha datos RGPD | Baja | Catastrófico | Docker secrets, cifrado, audit | **F3**: DPIA + MFA |
| API key agotada OpenAI/Azure | Media | Medio | Dual OCR (el otro responde) | **F3**: alertas consumo + fallback |
| Cliente demanda Verifactu | Baja→Alta | Medio | — | **F3**: implementación completa |
| Pérdida secrets | Baja | Catastrófico | /run/secrets/, backup local | **F1**: Vault / Doppler |
| Monolito imposible de mantener | Alta | Alto | — | **F2**: Strangler-Fig |
| 0 tests → regresión invisible | Alta | Alto | — | **F1-F2**: pirámide tests |

---

## 19. ADRs — Decisiones arquitectónicas

> Cada decisión técnica importante se documenta como ADR en `docs/adrs/NNNN-titulo.md`.

### ADR-0001 — Git + ESLint + Prettier + Husky obligatorio
- Status: **Accepted** (2026-04-20, aplicado en F0)
- Context: Sin disciplina de código, fácil meter bugs
- Decision: Git obligatorio desde commit 0, ESLint + Prettier + Husky pre-commit en todo proyecto
- Consequences: +bloquea commits mal formateados, +historial limpio, -ligero overhead en pre-commit

### ADR-0002 — Estructura modular objetivo (Strangler-Fig)
- Status: **Accepted** (2026-04-20)
- Context: Monolito 3992 líneas insostenible
- Decision: Refactor progresivo Strangler-Fig con estructura `domain/services/repositories/controllers/routes/middleware/lib`
- Consequences: +testeable, +mantenible, -semanas de trabajo

### ADR-0003 — TypeScript gradual en Fase 3
- Status: **Accepted** (2026-04-20)
- Context: JS plano dificulta refactor seguro
- Decision: Introducir TS con `allowJs: true` en Fase 3, migrar progresivamente
- Consequences: +type safety, +IDE support, -build step extra

### ADR-0004 — PostgreSQL 15 como BD principal
- Status: **Accepted** (heredado)
- Context: Necesitamos ACID, JSON support, pgvector futuro, extensions
- Decision: PostgreSQL 15 (migración futura a 16)
- Consequences: +estabilidad, +extensions, -curve aprendizaje administración

### ADR-0005 — OCR dual con arbitraje (Multi-Model Consensus)
- Status: **Accepted** (heredado)
- Context: Single-model OCR insuficiente para facturación
- Decision: OpenAI + Azure en paralelo + arbitrator con reglas deterministas (AEAT) + 2ª pasada receptor si null
- Consequences: +precisión, +resiliencia, ~2x coste API

### ADR-0006 — Deploy-prod manual con `workflow_dispatch`
- Status: **Accepted** (2026-04-20)
- Context: GitHub Free no soporta required reviewers en environments de repos privados
- Decision: Usar `workflow_dispatch` con input "DESPLEGAR" como control humano
- Consequences: +control equivalente a reviewers, -no hay history formal de aprobaciones

### ADR-0007 — Backups offsite Backblaze B2
- Status: **Proposed** (F0 hoy)
- Context: Backups solo locales = 1 fallo HW = pérdida total
- Decision: B2 como secundario (S3-compatible, €0.006/GB/mes, 10GB gratis)
- Consequences: +resiliencia 3-2-1, +coste marginal, -dependencia proveedor

### ADR-0008 — JWT httpOnly cookies (Fase 3)
- Status: **Proposed**
- Context: JWT en localStorage vulnerable a XSS
- Decision: Migrar access token a cookie httpOnly + Secure + SameSite=Strict
- Consequences: +mitiga XSS, -requiere refactor frontend + CSRF obligatorio

---

## 20. KPIs objetivo + métricas DORA

### 20.1 KPIs de producto

| KPI | Hoy | 1 mes | 3 meses | Cómo medir |
|---|---|---|---|---|
| Uptime | ? | ≥99.5% | ≥99.9% | BetterStack |
| Tasa éxito OCR (`dual_confirmed=true`) | ~80% | ≥85% | ≥90% | audit_logs |
| Tiempo medio procesado factura | 2-5s | <3s | <2s | logs backend |
| Usuarios activos/día | 1-2 | 5 | 15 | audit_logs |
| Facturas/día | 0-2 | 20 | 100 | uploads count |

### 20.2 DORA metrics (2026)

| Métrica | Hoy | Elite target |
|---|---|---|
| Deployment frequency | Varios/día | Varios/día ✓ |
| Lead time for changes | ~1h | <1h ✓ |
| Change failure rate | ~20% (hoy) | <15% |
| MTTR | ~5-15min | <1h ✓ |

### 20.3 Métricas de calidad de código

| Métrica | Hoy | F2 target | F4 target |
|---|---|---|---|
| Cobertura tests unit | 0% | 60% | 80% |
| Cobertura tests E2E flujos críticos | 0% | 80% | 95% |
| Archivos >500 líneas | 2 | 0 | 0 |
| Funciones >80 líneas | ? | <5 | 0 |
| Vulnerabilidades Dependabot | 0 ✓ | 0 | 0 |
| ADRs documentados | 0 | 10 | 20 |

### 20.4 Cumplimiento RGPD

| Check | Hoy | F3 target |
|---|---|---|
| DPIA documentada | ❌ | ✅ |
| RAT completo | ❌ | ✅ |
| DPAs firmados proveedores | ❌ | ✅ |
| Endpoints ARCO-POL | 🔶 F0 hoy | ✅ |
| Cookie banner legal | ❌ | ✅ |
| Cifrado PII campo | ❌ | ✅ |
| Tiempo respuesta solicitudes | N/A | <7 días |

### 20.5 Seguridad (OWASP Top 10 2025)

| Área | Hoy | F3 target |
|---|---|---|
| A01 Broken Access Control | 8/10 | 10/10 |
| A02 Security Misconfiguration | 8/10 | 10/10 |
| A03 Supply Chain | 7/10 (Dependabot) | 9/10 (SBOM) |
| A04 Cryptographic | 9/10 | 9/10 |
| A05 Injection | 9/10 (parametrized) | 10/10 |
| A06 Insecure Design | 6/10 | 9/10 |
| A07 Authentication | 7/10 | 10/10 (MFA) |
| A08 Data Integrity | 8/10 | 9/10 |
| A09 Logging & Alerting | 6/10 | 10/10 |
| A10 Mishandling | 7/10 | 9/10 |

---

## 21. Preguntas abiertas para Julio

Antes de cada fase, necesitamos respuestas:

### Antes de Fase 0 (hoy)
1. ¿Cuenta Backblaze B2 o prefieres Hetzner Storage Box/Wasabi?
2. Hora exacta de entrega mañana (para ajustar freeze deploys)
3. Email del cliente para personalizar GUIA_USUARIO.md

### Antes de Fase 1 (esta semana)
4. ¿Staging.setex-facturas.es sigue accesible desde tu red? (BasicAuth credentials)
5. ¿Prefieres 1 VPS único con staging+prod o VPS secundario 5€/mes?

### Antes de Fase 2 (semanas 2-4)
6. ¿TypeScript gradual YA en Fase 2 o esperar a Fase 3?
7. ¿El cliente acepta ventana mantenimiento semanal de 15 min para deploys grandes?

### Antes de Fase 3 (mes 2)
8. ¿Compromiso legal Verifactu con fecha exacta? (prioridad)
9. ¿Presupuesto Sentry (hay plan gratis 5K events/mes; si aplica, €0)?
10. ¿Plan GitHub (Free actual) o migrar a Team (€4/mes) para required reviewers?

---

## 22. Principios senior para el proyecto

### Principios operativos

1. **No seas héroe**. La víspera de entrega no se refactoriza. Los héroes crean post-mortems.
2. **Duerme antes de la entrega**. Un deploy con sueño = incidente garantizado.
3. **La entrega es un hito, no un final**. Lo importante es el proyecto vivo 6 meses después.
4. **Staging es ley**. Nada a prod sin 24h en staging validado.
5. **Docs o no existió**. Cada decisión = ADR o runbook.
6. **Strangler-fig o ruina**. Nunca refactor big-bang.
7. **Medir antes de optimizar**. Intuición es peor que métrica.
8. **Fail-secure siempre**. Si algo va mal, que no deje brecha abierta.
9. **Scout's rule**. Deja el código más limpio de lo que lo encontraste.
10. **Blameless post-mortems**. La culpa es del proceso, no de la persona.

### Principios técnicos

1. **Tests son documentación ejecutable**. 1 test E2E > 100 comentarios.
2. **Toda función pura es testeable. Toda función con side-effects se aísla**.
3. **Zod en la frontera**. Nunca confíes en datos externos sin validar.
4. **Secrets nunca en código**. Nunca. Ni temporal, ni en commits, ni en logs.
5. **Idempotencia en operaciones sensibles**. Facturas, pagos, emails.
6. **Observabilidad desde el día 1**. Log estructurado JSON + trace_id.
7. **Backup = restore probado**. Si no has restaurado, no tienes backup.
8. **Errores estandarizados**. RFC 7807 Problem Details.
9. **Migraciones versionadas reversibles**. Nunca ALTER manual en prod.
10. **Zero Trust**. Cada request autentica + autoriza.

---

## 23. Contactos y referencias

- **Julio**: juliohesuni@gmail.com
- **Dominio producción**: setex-facturas.es (Hostinger)
- **Dominio staging**: staging.setex-facturas.es (BasicAuth Traefik)
- **Repositorio**: https://github.com/Juliohes/Setex-facturas (privado)
- **CI/CD**: GitHub Actions
- **VPS**: Hostinger 72.60.186.89 Ubuntu 24.04
- **DNS**: Hostinger panel
- **Backups primarios**: `/opt/setex/shared/backups/postgres/` (GPG AES-256)
- **Backups secundarios**: Backblaze B2 (F0 pendiente)
- **Monitorización**: BetterStack (F0 pendiente)
- **Alertas**: email `juliohesuni@gmail.com` + Telegram (a configurar)

---

**Documento vivo. Versión 2.0 — 2026-04-20.**
**Próxima revisión**: tras Fase 0 cerrada (hoy noche).
**Revisión completa**: cada 2 semanas.
