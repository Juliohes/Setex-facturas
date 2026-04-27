# SETEX — Roadmap trimestral 2026

Última actualización: 2026-04-20 — tras auditoría forense + cutover Fase 4.

## Q2 2026 (abril–junio)

### 🚨 Críticas para cerrar al 100% el plan de migración

- [x] **Verificar 2FA en GitHub Settings** ✅ (2026-04-27 · Authenticator app + GitHub Mobile activos)
- [x] **Promocionar PR #18** (scripts paths) develop → main ✅ (superseded por PR #51 "Deploy 2026-04-21" mergeado · `scripts/lib/paths.sh` ya idéntico en main/develop con md5 `c691ddc3...`)
- [x] **Eliminar el symlink** `/opt/setex-captu-facture` ✅ (2026-04-27 · 109 MB liberados, tarball en `shared/backups/`)
- [x] **Eliminar el YAML estático** `/docker/n8n/traefik-dynamic/setex.yml` y dejar todo el routing en labels Docker ✅ (2026-04-27 · HSTS subido a 10 años en nginx, xanflatest a labels en `setex-prod-frontend`)

### ⚠️ Importantes para mantener la salud del producto

- [ ] **Refactor `scripts/lib/paths.sh`**: extraer las variables `BASE_DIR`, `BACKUP_DIR`, `SECRETS_DIR`, `LOGS_DIR`, `CONTAINER_PG`, `CONTAINER_BE` a un sólo fichero que el resto sourcea. Hoy hay 9 scripts con paths/container hardcoded — un cutover futuro repetiría el mismo trabajo manual.
- [ ] **Subir el plan de GitHub a Team o Pro** ($4/mes) si quieres `required reviewers` reales en environments. Actualmente uso `workflow_dispatch` con confirmación textual como workaround.
- [ ] **Smoke test en CI**: el smoke test diario corre solo en cron del HOST. Añadir un job opcional al CI que lo ejecute en pre-merge a main (con secrets configurados) para coger regresiones de schema strict antes de mergear.
- [ ] **Email proactivo a las 4 cuentas con CIF AEAT inválido** (B02790388, B42634044 ×3) explicando que su CIF no pasa AEAT y cómo corregirlo.
- [ ] **Tests automatizados** (jest) para al menos: `validateCIF.js`, `viesValidator.js`, `mergeLineasIva.js`. Hoy no hay tests unitarios — todo se valida ejecutando.
- [ ] **Política de rotación de secrets** documentada en CONTRIBUTING — cada 6 meses para JWT/passwords, cada 12 meses para API keys de proveedores.

### 💡 Calidad / mantenibilidad

- [ ] **ESLint + Prettier**: añadir config base + corre en CI. Hoy las inconsistencias de estilo se cuelan (var/let mezclados, comillas).
- [ ] **TypeScript progresivo**: empezar por `app/backend/src/ocr/` (módulos puros, fácil) y `validateCIF.js`. JS plano sigue funcionando en paralelo.
- [ ] **Migrar de Vanilla JS a una mini-stack frontend** (HTMX o Alpine.js) — pero sólo si Julio empieza a colaborar con alguien que no quiera tocar JS plano. Si el mantenedor sigue siendo único, NO se justifica.
- [ ] **Métricas de OCR**: instrumentar `extractInvoice` con counters por motor (success_total, failure_total, latency_p95) y exponer un endpoint `/api/admin/metrics` (protegido).

### 🔬 Investigación

- [ ] **¿Migrar de bind mount a docker volume nombrado?** Pros: mejor portabilidad, perms automáticos. Cons: rsync más complicado, menos visible en HOST.
- [ ] **¿Usar ImagineAI / TensorRT para OCR local?** Eliminaría dependencia de OpenAI/Azure. Coste: ~$200 GPU one-time vs ~$15/mes actual.
- [ ] **¿Activar GitHub Container Registry y push de imágenes?** Hoy la build se hace en cada deploy en el VPS. Con images pre-built en registry, el deploy es 10x más rápido y consistente.

## Q3 2026 (julio–septiembre)

### Si el flujo Q2 va bien

- [ ] **Multi-empresa**: soporte para que un usuario gestione facturas de varias empresas (separadas por workspace). Implica cambios en `users` ↔ `companies` (many-to-many).
- [ ] **Notificaciones email** cuando se procesa una factura (ya hay infra SMTP).
- [ ] **Backups offsite**: replicar backups GPG a S3/Backblaze B2 (~$1/mes). Hoy si el VPS muere completamente perdemos backups locales.

### Refactor

- [ ] **Eliminar `gemini.js`** (266 líneas DESACTIVADO) y `paddleocr.js` (39 líneas sin uso). PR de limpieza.
- [ ] **Consolidar `validateCIF.js` + `viesValidator.js`** en un módulo `tax-id-validation/`.

## Q4 2026 (octubre–diciembre)

- [ ] **Auditoría LOPD/RGPD formal**: aunque ya hay `audit_logs` y secrets bien gestionados, una asesoría legal nos dirá qué falta.
- [ ] **Revisión Verifactu**: ya hay informe (`docs/INFORME_VERIFACTU.md`) — revisar si la regulación cambió y planificar implementación si toca.
- [ ] **Disaster Recovery drill**: ejercicio anual: simular pérdida total del VPS, restaurar desde backup en VPS limpio, medir RTO real.

## Plan de revisión trimestral

Cada 3 meses, Julio (o auditor externo) ejecuta:

1. Re-correr la auditoría forense con SUPERPROMPT de hoy
2. Comparar % por fase con esta sesión (53% → 95%)
3. Si bajan: investigar qué se rompió y por qué
4. Actualizar este ROADMAP con tareas hechas / nuevas / aplazadas
5. Archivar el nuevo informe en `docs/audits/AUDIT-YYYY-MM-DD.md`

## Indicadores que vigilar (KPIs)

| Indicador | Hoy | Objetivo Q3 |
|---|---|---|
| Vulnerabilidades Dependabot abiertas | 0 | 0 |
| Cobertura tests automatizados | 0% | 30% (ocr/, validators/) |
| Tiempo despliegue staging | 67s | <60s |
| Tiempo despliegue prod (manual) | ~3min | <2min |
| Smoke test diario falla rate | 0/30 días | 0/30 días |
| Usuarios con CIF AEAT inválido | 4/5 | 0/5 (tras email proactivo + correcciones) |

## Riesgos residuales conocidos

1. **Dependencia única de OpenAI + Azure DI**: si ambos caen el mismo día, OCR no funciona. Smoke test diario detecta, pero no resuelve.
2. **Backups solo locales**: si el VPS Hostinger muere completamente, perdemos backups. Mitigación pendiente: replicación offsite.
3. **Mantenedor único**: si Julio no puede operar 1+ semanas, nadie sabe el sistema al detalle. Mitigación parcial: CONTRIBUTING + PLAYBOOK_EMERGENCIAS + CLAUDE.md + memoria de Claude.
4. **GitHub plan Free**: required reviewers no disponibles en environments. Mitigación actual: `workflow_dispatch` manual.
5. **PaddleOCR en disco** (~3GB) sin uso. Decisión pendiente: integrarlo o desinstalar.
