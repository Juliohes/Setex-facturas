# SETEX — Roadmap trimestral 2026

Última actualización: **2026-04-27 23:55 UTC** — tras cierre FASE 1B Etapas 0-4 (PRs #85, #86 + PR cierre pendiente squash).

---

## 🎯 Siguiente acción del proyecto · FASE 1B Etapas 5-6 (validación + swap)

**Estado**: el descongelado del refactor v3 está **listo para swap**. Plumbing completo en `develop`:
- 5 rutas `auth_request` portadas y testadas (PR #86 mergeado).
- Test de paridad legacy↔v3 corre en CI (cada PR a develop/main valida que no regresamos).
- Healthcheck container apunta a la ruta crítica → unhealthy automático si falta.
- Smoke HTTP post-deploy bloquea promoción si la superficie API se rompe.

**Acciones manuales que faltan** (no automatizables hoy):

1. **Etapa 5 — Validación staging 24-48h**:
   - Disparar `deploy-staging.yml` (push a develop o `workflow_dispatch`).
   - Staging arranca con monolito (server.js = 4308 líneas, NO el v3 todavía).
   - Smoke post-deploy debe pasar verde inmediato.
   - Dejar correr 24-48h vigilando: `docker logs setex-staging-backend`, watchdog, alertas.
   - Si todo verde → seguir a Etapa 6.

2. **Etapa 6 — Swap final del v3 a runtime + tag v2.0.0**:
   - Branch nuevo `refactor/v3-swap-runtime-2026-XX-XX` desde develop.
   - `mv src/server.js src/server.legacy.js` y `mv src/server.next.js src/server.js`.
   - Ajustar `package.json` (`start:next` → `start:legacy`) y `eslint.config.js` (excepción `max-lines` a `server.legacy.js`).
   - PR a develop, CI paridad seguirá pasando, merge.
   - Deploy a staging automático, smoke verde.
   - 24-48h adicionales en staging.
   - Si todo OK: PR develop → main + tag `v2.0.0` + `Deploy a producción (manual)` con `DESPLEGAR`.
   - Plan detallado: `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` sección 6.

---

## Q2 2026 (abril–junio)

### 🚨 Críticas para cerrar al 100% el plan de migración

- [x] **Verificar 2FA en GitHub Settings** ✅ (2026-04-27)
- [x] **Promocionar PR #18** (scripts paths) develop → main ✅
- [x] **Eliminar el symlink** `/opt/setex-captu-facture` ✅ (2026-04-27)
- [x] **Eliminar el YAML estático** `/docker/n8n/traefik-dynamic/setex.yml` ✅ (2026-04-27)
- [x] **PR #84 cleanup post-cutover mergeado a main + deploy a producción** ✅ (2026-04-27 11:21 UTC)
- [x] **FASE 1B Etapa 0 — Rollback en `develop`** ✅ (PR #85, squash `6c9f65b`, 2026-04-27 15:55 UTC)
- [x] **FASE 1B Etapa 1 — Portar 5 rutas `auth_request` faltantes al v3** ✅ (PR #86, squash `5513b5f`, 2026-04-27)
- [x] **FASE 1B Etapa 2 — Test paridad legacy↔v3 + integración CI** ✅ (PR cierre, 2026-04-27)
- [x] **FASE 1B Etapa 3 — Healthcheck container endurecido** ✅ (PR cierre, 2026-04-27)
- [x] **FASE 1B Etapa 4 — Smoke HTTP post-deploy en workflows staging+prod** ✅ (PR cierre, 2026-04-27)
- [ ] **FASE 1B Etapa 5 — Validación staging 24-48h** (acción manual de Julio)
- [ ] **FASE 1B Etapa 6 — Swap v3 a runtime + tag `v2.0.0` + promoción a prod** (acción manual de Julio, post-Etapa 5)

### 🔧 Tareas operacionales nuevas (detectadas durante el cleanup 2026-04-27)

- [ ] **Añadir chown automatizado al `scripts/fix-permissions.sh`** (cron 1h ya activo). Motivo: el deploy del 27-Abr falló porque 195 ficheros en `/opt/setex/prod` tenían `owner=root:root` (contaminación por `git pull` previos como root) y el user `deploy` no podía borrarlos durante `git reset --hard origin/main`. Añadir un step similar a:
  ```bash
  find /opt/setex/${ENV} \
    -not -path '*/data/postgres/*' \
    -not -path '*/secrets/*' \
    -not -path '*/logs/*' \
    -not -path '*/.git/*' \
    -not -path '*/node_modules/*' \
    \( -user root -o -group root \) \
    -exec chown deploy:deploy {} +
  ```
  Esto previene que vuelva a romper deploys futuros. Se puede integrar en la sesión FASE 1B etapa 0 o como tarea independiente (~30 min).
- [ ] **Housekeeping cleanup-2026-04-27** (vencimiento gracia: 2026-05-27, 30 días). Borrar:
  - `/opt/setex/shared/cleanup-2026-04-27/` (script + kkk.txt + fix-ownership.txt + setex-logrotate.new + README)
  - `/opt/setex/shared/backups/setex-captu-facture.OLD-2026-04-20.tar.gz` (33 MB)
  - `/docker/n8n/traefik-dynamic/setex.yml.removed-2026-04-27` (1418 B)
  - `/etc/logrotate.d/setex.bak-2026-04-27` (449 B)
- [ ] **Borrar rama local `hotfix/rollback-v3-swap-2026-04-23` en staging** (cuando ETAPA 0 de FASE 1B esté mergeada a develop). Comando: `git -C /opt/setex/staging branch -D hotfix/rollback-v3-swap-2026-04-23`.

### ⚠️ Importantes para mantener la salud del producto

- [ ] **Refactor `scripts/lib/paths.sh`**: extraer las variables `BASE_DIR`, `BACKUP_DIR`, `SECRETS_DIR`, `LOGS_DIR`, `CONTAINER_PG`, `CONTAINER_BE` a un sólo fichero que el resto sourcea. Hoy hay 9 scripts con paths/container hardcoded — un cutover futuro repetiría el mismo trabajo manual.
- [ ] **Subir el plan de GitHub a Team o Pro** ($4/mes) si quieres `required reviewers` reales en environments. Actualmente uso `workflow_dispatch` con confirmación textual como workaround.
- [ ] **Smoke test HTTP en CI** (no solo OCR cron del HOST). Ya cubierto parcialmente por FASE 1B etapa 4 (smoke post-deploy en `deploy-staging.yml`); añadir además job pre-merge a main.
- [ ] **Email proactivo a las 4 cuentas con CIF AEAT inválido** (B02790388, B42634044 ×3) explicando que su CIF no pasa AEAT y cómo corregirlo.
- [ ] **Tests automatizados** (jest o `node --test`) para al menos: `validateCIF.js`, `viesValidator.js`, `mergeLineasIva.js`. Hoy no hay tests unitarios — todo se valida ejecutando. (Ya hay `tests/architecture.test.js` y `tests/contracts/` en develop vía Refactor v3.)
- [ ] **Política de rotación de secrets** documentada en CONTRIBUTING — cada 6 meses para JWT/passwords, cada 12 meses para API keys de proveedores.

### 💡 Calidad / mantenibilidad

- [x] **ESLint + Prettier**: configuración base activa desde 2026-04-20 (P0-3). En el v3 hay tests de arquitectura adicionales (`tests/architecture.test.js`) que enforcing boundaries entre capas.
- [ ] **CI ejecuta ESLint + tests automáticamente** en cada PR. Lint sintaxis ya corre (cogió la vulnerabilidad uuid hoy); falta integrar tests de arquitectura/contratos.
- [ ] **TypeScript progresivo**: empezar por `app/backend/src/ocr/` (módulos puros, fácil) y `validateCIF.js`. JS plano sigue funcionando en paralelo. Reservado para post-FASE 1B (no mezclar dos refactors).
- [ ] **Migrar de Vanilla JS a una mini-stack frontend** (HTMX o Alpine.js) — pero sólo si Julio empieza a colaborar con alguien que no quiera tocar JS plano. Si el mantenedor sigue siendo único, NO se justifica.
- [ ] **Métricas de OCR**: instrumentar `extractInvoice` con counters por motor (success_total, failure_total, latency_p95) y exponer un endpoint `/api/admin/metrics` (protegido).

### 🔬 Investigación

- [ ] **¿Migrar de bind mount a docker volume nombrado?** Pros: mejor portabilidad, perms automáticos (resolvería el problema de ownership root encontrado hoy). Cons: rsync más complicado, menos visible en HOST.
- [ ] **¿Usar TensorRT / Donut / OCR local?** Eliminaría dependencia de OpenAI/Azure. Coste: ~$200 GPU one-time vs ~$15/mes actual.
- [ ] **¿Activar GitHub Container Registry y push de imágenes?** Hoy la build se hace en cada deploy en el VPS. Con images pre-built en registry, el deploy es 10x más rápido y consistente.

---

## Q3 2026 (julio–septiembre)

### Si el flujo Q2 + FASE 1B van bien

- [ ] **Tag `v2.0.0` publicado** (post FASE 1B etapa 6 · refactor v3 en runtime estable 7+ días)
- [ ] **Multi-empresa**: soporte para que un usuario gestione facturas de varias empresas (separadas por workspace). Implica cambios en `users` ↔ `companies` (many-to-many).
- [ ] **Notificaciones email** cuando se procesa una factura (ya hay infra SMTP).
- [ ] **Backups offsite a S3/Backblaze B2** (~$1/mes) además de la replicación VPS-secundario actual. Hoy el VPS secundario `72.62.189.27` está OK pero ambos son Hostinger → mismo proveedor = riesgo correlacionado.

### Refactor

- [ ] **Eliminar `gemini.js`** (266 líneas DESACTIVADO) y `paddleocr.js` (39 líneas sin uso). PR de limpieza tras FASE 1B.
- [ ] **Borrar `src/server.legacy.js`** (mantener 30 días tras tag v2.0.0 como rescate, después borrar).
- [ ] **Consolidar `validateCIF.js` + `viesValidator.js`** en un módulo `tax-id-validation/`.

---

## Q4 2026 (octubre–diciembre)

- [ ] **Auditoría LOPD/RGPD formal**: aunque ya hay `audit_logs` y secrets bien gestionados, una asesoría legal nos dirá qué falta.
- [ ] **Revisión Verifactu**: ya hay informe (`docs/INFORME_VERIFACTU.md`) — revisar si la regulación cambió y planificar implementación si toca.
- [ ] **Disaster Recovery drill**: ejercicio anual: simular pérdida total del VPS, restaurar desde backup en VPS limpio, medir RTO real.

---

## Plan de revisión trimestral

Cada 3 meses, Julio (o auditor externo) ejecuta:

1. Re-correr la auditoría forense con SUPERPROMPT de hoy
2. Comparar % por fase con esta sesión (53% → 95%)
3. Si bajan: investigar qué se rompió y por qué
4. Actualizar este ROADMAP con tareas hechas / nuevas / aplazadas
5. Archivar el nuevo informe en `docs/audits/AUDIT-YYYY-MM-DD.md`

---

## Indicadores que vigilar (KPIs)

| Indicador | Hoy (2026-04-27) | Objetivo Q3 |
|---|---|---|
| Vulnerabilidades Dependabot abiertas | 0 (cerrada GHSA-w5hq-g745-h8pq el 27-Abr vía override uuid@14) | 0 |
| Cobertura tests automatizados | 0% (a pesar de `tests/architecture.test.js` + contracts en develop, no se ejecutan en CI todavía) | 30% (validators, calculators, paridad legacy↔v3 vía FASE 1B etapa 2) |
| Tiempo despliegue staging | ~67s | <60s |
| Tiempo despliegue prod (manual) | ~3min (~5min con ownership fix manual hoy) | <2min |
| Smoke test diario falla rate (OCR cron) | 0/30 días | 0/30 días |
| Smoke HTTP post-deploy | No existe aún | Activo en `deploy-staging.yml` y `deploy-prod.yml` (FASE 1B etapa 4) |
| Usuarios con CIF AEAT inválido | 4/5 | 0/5 (tras email proactivo + correcciones) |

---

## Riesgos residuales conocidos

1. **Refactor v3 congelado en `develop`** (2026-04-27): mientras no se ejecute la Etapa 0 de FASE 1B, cualquier `deploy-staging.yml` desde develop reproduciría el incidente Round 16. **Mitigación inmediata**: hacer Etapa 0 antes de cualquier otro trabajo en develop.
2. **Deuda de ownership root:root** en `/opt/setex/{prod,staging}`: contamina a deploys futuros. Mitigación inmediata aplicada el 27-Abr; mitigación permanente pendiente (chown automatizado en `fix-permissions.sh`).
3. **Dependencia única de OpenAI + Azure DI**: si ambos caen el mismo día, OCR no funciona. Smoke test diario detecta, pero no resuelve.
4. **Backups solo locales + replicación VPS-secundario Hostinger**: si Hostinger cae globalmente (poco probable pero posible), perdemos ambos. Mitigación pendiente: S3/B2 (Q3).
5. **Mantenedor único**: si Julio no puede operar 1+ semanas, nadie sabe el sistema al detalle. Mitigación parcial: CONTRIBUTING + PLAYBOOK_EMERGENCIAS + CLAUDE.md + ahora también `MACROPLAN-SETEX-v2.0.md` y `PLAN-FASE-4-DESCONGELADO-V3.md` con instrucciones ejecutables.
6. **GitHub plan Free**: required reviewers no disponibles en environments. Mitigación actual: `workflow_dispatch` manual con confirmación textual `DESPLEGAR`.
7. **PaddleOCR en disco** (~3GB) sin uso. Decisión pendiente: integrarlo o desinstalar (Q3).
8. **Doble hop xanflatest.com HTTP→HTTPS**: causado por `--entrypoints.web.http.redirections.entryPoint.to=websecure` en `n8n-traefik-1` (config preexistente, no tocable desde labels Docker SETEX). Aceptado, impacto solo UX 1 hop extra.
