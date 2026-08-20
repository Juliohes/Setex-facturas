# HISTORIAL DE CONSOLIDACIÓN DOCUMENTAL — SETEX

## 2026-05-03 — Unificación documental v1.0

### Objetivo

Consolidar toda la documentación operativa dispersa del proyecto SETEX en un único documento maestro, ubicado en `/opt/setex/prod/.claude/CLAUDE.md` (replicado a `/opt/setex/staging/.claude/CLAUDE.md`). El objetivo es eliminar duplicación, fijar una única fuente de verdad operativa para Claude Code y para los humanos que operen el sistema, y conservar como referencia los documentos vivos paralelos (planes, roadmap, bitácora) y los inmutables firmados (auditorías, ADRs).

### Documentos absorbidos en CLAUDE.md (su contenido vive ahora en el unificado)

| Origen | Sección destino del unificado | Notas |
|---|---|---|
| `prod/README.md` | §1 Contexto, §2 Stack, §6 Estructura | Reemplazado por apuntador mínimo (§10.3 prompt) |
| `prod/CONTRIBUTING.md` | §9 Flujo Git | Texto vigente, absorbido casi literal |
| `prod/GUIA_ADMINISTRACION.md` | §8 Operación diaria | Rutas legacy `/opt/setex-captu-facture/...` reescritas a relativas (`./scripts/...`); referencias a `xanflatest.com` reescritas a `setex-facturas.es` |
| `prod/INFORME-TECNICO-SETEX.md` | §2 Stack (parcial), §3 Arquitectura (parcial) | Solo §1/§2 del original (qué es OCR, comparativa motores). El resto descartado por contener referencias a stack obsoleto (n8n, Google Sheets, GPT-4o en lugar de GPT-4.1). Documento original archivado a `docs/archive/` |
| `INSTALL_AGENTS_v3.md` (en `/opt/setex/`) | §7 Subagentes Claude Code | Tablas resumen con nombre + descripción + modelo. Los system prompts completos viven en `.claude/agents/*.md`, no en CLAUDE.md. Documento original archivado a `docs/archive/` |

### Documentos archivados a `docs/archive/` (no eliminados — quedan como histórico)

| Origen | Destino | Motivo |
|---|---|---|
| `prod/INFORME-TECNICO-SETEX.md` | `prod/docs/archive/INFORME-TECNICO-SETEX.md` | Obsoleto al 2026-05-03; partes vigentes ya en CLAUDE.md §2/§3 |
| `/opt/setex/INSTALL_AGENTS_v3.md` | `prod/docs/archive/INSTALL_AGENTS_v3.md` | Cumplió su misión de instalación inicial de los 14 subagentes; los system prompts vivos están en `.claude/agents/` |
| `prod/docs/INFORME_VERIFACTU.md` | `prod/docs/archive/INFORME_VERIFACTU.md` | Verifactu descartado como aplicable a SETEX; informe queda como evidencia del análisis |
| `prod/docs/HANDOVER-FASE-1B.md` | `prod/docs/archive/HANDOVER-FASE-1B.md` | Handover puntual histórico |
| `prod/docs/REPLICA-A-STAGING-2026-04-27.md` | `prod/docs/archive/REPLICA-A-STAGING-2026-04-27.md` | Registro puntual de réplica histórica. Estaba untracked en git: añadido con `git add` y movido con `git mv` para mantener trazabilidad |

### Documentos NO tocados (regla 10 — auditorías firmadas)

Los siguientes documentos son inmutables. Solo se les añaden entradas nuevas al historial, nunca se reescribe contenido antiguo. La consolidación NO los modifica ni mueve. MD5 verificado pre y post (`/tmp/inmutables-md5-pre.txt` vs `/tmp/inmutables-md5-post.txt` — diff debe ser vacío).

| Documento | MD5 (pre) | Tamaño |
|---|---|---|
| `docs/DECISIONS.md` | `996e373142ed57041e003b35c5382187` | 17.8 KB |
| `docs/INFORME_SEGURIDAD.md` | `6fdaa39e5627424dc723e8e387504266` | 10.3 KB |
| `docs/INFORME_AUDITORIA_SEGURIDAD_2026.md` | `12a9e7ffe2013c63fd17ab35ac780def` | 36.7 KB |
| `docs/audits/AUDIT-2026-04-20.md` | `39b0973ebdec1c091d6cb18dae84fdfe` | 7.6 KB |
| `docs/REVISION_ACCESO_AISLAMIENTO_2026.md` | `70f0e1d95e4d8e2ffb0cfe91cfe32b13` | 32.1 KB |
| `docs/REVISION_QUIRURGICA_SEGURIDAD_2026.md` | `2a074094752800cb626c5e96d1a275ef` | 36.1 KB |
| `docs/adr/0001-git-eslint-prettier-husky-commitlint.md` | `1a251e1a455fc12f0530faf4558a64bd` | 3.6 KB |
| `docs/adr/0002-strangler-fig-target-structure.md` | `bc06720edf10112ccf13aa4863dd8679` | 4.4 KB |
| `docs/adr/0003-typescript-gradual-migration.md` | `45aa6e9ca7760fdecd51a109de7d2da9` | 4.7 KB |
| `docs/adr/0004-modular-architecture-solid-patterns.md` | `d7dfe70a3e825f44a47585ed307d93df` | 9.0 KB |
| `docs/adr/0005-dependency-injection-awilix.md` | `0ad747f82439396c8f4f6f53057bd158` | 7.0 KB |

Política aprobada: las decisiones futuras se documentan como ADR nuevo (0006, 0007…) en `docs/adr/` siguiendo convención Nygard. Las 8 decisiones de `DECISIONS.md` (Fase 0, 2026-04-17) NO se migran al formato Nygard (mover documentos firmados violaría regla 10).

### Documentos vivos paralelos referenciados desde §11 del unificado (no absorbidos)

| Documento | Audiencia / propósito |
|---|---|
| `docs/INFORME_SISTEMA_COMPLETO.md` | Bitácora viva del producto (~2 700 líneas, actualizada por sesión). Fuente de verdad histórica |
| `docs/plans/MACROPLAN-SETEX-v2.0.md` | Plan estratégico vivo (19 áreas, FASES 0-4, runbooks INC-01..10, templates) |
| `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` | Plan en ejecución para el descongelado del refactor v3 |
| `docs/ROADMAP.md` | Roadmap trimestral 2026 |
| `docs/PLAYBOOK_EMERGENCIAS.md` | Runbook operativo de emergencias |
| `docs/GUIA_USUARIO.md` | Manual del cliente final (audiencia distinta del CLAUDE.md) |
| `docs/INFORME_CAPACIDAD_Y_RENDIMIENTO.md` | Resultados de stress test (2-Mar-2026) |
| `docs/INFORME_OCR_IVA_FACTURAS_ESPANOLAS.md` | Informe técnico OCR fiscal español |

### Notas de obsolescencia detectadas durante consolidación 2026-05-03

Documentos VIVOS PARALELOS que contienen referencias obsoletas no corregidas (la corrección queda fuera del scope de esta consolidación por respeto a la regla 10 ampliada — solo se modifican documentos absorbidos):

- `docs/INFORME_SISTEMA_COMPLETO.md` líneas 267-269: menciona envío a Google Drive/Sheets, eliminados según regla 8 del CLAUDE.md. Acción recomendada futura: corregir en próxima entrada del historial del propio documento (es bitácora viva, admite entradas nuevas que superseden secciones anteriores).

### Anomalía detectada (NO resuelta — para revisión humana)

- ADR-0003 (`docs/adr/0003-typescript-gradual-migration.md`) acepta migración gradual a TypeScript; conversaciones recientes (2026-04-30) descartaron TypeScript. Posible ADR-0006 futuro «Supersede ADR-0003: TypeScript no aplicable a vanilla JS production stack» pendiente de revisión humana. La consolidación documental NO resuelve esta anomalía: solo deja constancia de que existe.

### Decisiones tomadas durante la consolidación (escaladas a Julio y aprobadas)

| Conflicto | Resolución |
|---|---|
| C.1 — INFORME-TECNICO-SETEX stack obsoleto (n8n, GPT-4o) | Absorber solo §1/§2; archivar el resto |
| C.2 — Whitelist path obsoleto `/opt/setex-captu-facture/...` | Reescribir como ruta relativa `./scripts/manage-whitelist.sh` |
| C.3 — Dominio en INFORME-TECNICO (xanflatest) | Usar `setex-facturas.es` como principal; xanflatest.com una sola mención como alias en §1.3 |
| C.4 — INFORME_SISTEMA_COMPLETO menciona Google Drive/Sheets | No corregir el documento (vivo paralelo); dejar nota arriba |
| C.5 — DECISIONS.md + 5 ADRs coexisten | Referenciar ambos por separado en §11 como inmutables; política futura: ADRs nuevos en `docs/adr/` |
| C.6 — Ruta MACROPLAN incorrecta en plan | Aplicar ruta real `docs/plans/MACROPLAN-SETEX-v2.0.md` |

### Backups generados antes de modificar nada

- `/opt/setex/shared/backups/docs-unification/snapshot-2026-05-03-HHMMSS.tar.gz` (snapshot de todos los `.md` absorbibles + `docs/` completo + INSTALL_AGENTS_v3.md)
- `/opt/setex/prod/.claude/CLAUDE.md.pre-unification-20260503` (copia byte-a-byte del CLAUDE.md anterior antes de promocionar el draft)

### Rama git

- **Rama**: `chore/docs-consolidation-2026-04-29` (reutilizada — opción A aprobada por Julio)
- **HEAD pre-unificación**: `9551127` (commit documental previo de Julio del 29-Abr: enlaces cruzados PLAN-FASE-4 ↔ ROADMAP + entrada historial)
- **Working tree sucio del swap v3 ignorado** durante toda la sesión: `app/backend/src/server.{js,legacy.js,next.js}`, `app/docker-compose.yml`, `app/docker-compose.yml.bak-2026-04-30`, `.claude/agents/`. Esos cambios pertenecen a otra línea de trabajo (Etapa 3 del descongelado v3) y no son asunto de esta consolidación.
- **Commits añadidos** durante la sesión: [se rellenará al hacer commit final en FASE 6]

### Replicación a staging

- `prod/.claude/CLAUDE.md` → `staging/.claude/CLAUDE.md` por `cp` directo + verificación con `diff -u` (debe quedar vacío).
- El resto de cambios documentales (HISTORIAL.md, README.md nuevo, archivado a `docs/archive/`, borrados) llegan a staging por `git pull` cuando se merge la rama a `develop`.

### Verificaciones de integridad ejecutadas (§8.3 del prompt)

1. Las 10 reglas críticas presentes literalmente en el unificado: ✅ verificado
2. Sin TODOs ni placeholders (`TODO|FIXME|XXX|[PENDIENTE]|[...]`): ✅ verificado
3. Sin duplicación de las reglas: ✅ verificado (cada regla aparece exactamente una vez)
4. Tamaño del unificado entre 8 y 50 KB: ✅ verificado
5. Estructura de secciones presente (`## 1.` a `## 12.`): ✅ verificado
6. UTF-8 sin BOM: ✅ verificado (`file -i` reporta `charset=utf-8`)
7. Line endings LF (no CRLF): ✅ verificado (`grep -c $'\r'` reporta `0`)
8. MD5 de inmutables idéntico pre/post: ✅ verificado (diff `/tmp/inmutables-md5-pre.txt` vs `/tmp/inmutables-md5-post.txt` vacío)

---

## 2026-08-20 — GitHub solo con la versión de producción (repo público)

- `docs/HISTORIAL.md`: nueva entrada de historial (esta).
- GitHub Juliohes/Setex-facturas alineado a producción: `main` = `9001d9e` (force-push autorizado temporalmente, protección de rama restaurada idéntica después).
- Borradas las ~36 ramas del remoto (develop, feature/*, fix/*, chore/*, docs/*, hotfix/*, recovery/*, dependabot/*) — staging y ramas de trabajo ya no existen en GitHub.
- Commit `9001d9e`: diagnóstico de errores de red vs JS (frontend, desplegado en prod 2026-08-13) + PWA cache v6 + `.claude/01-CLAUDE.md`.
- Repo hecho PÚBLICO para acceso externo desde el perfil de Julio; auditoría previa de secretos/datos correcta (solo fixtures sintéticas ACME y opencv.js).
- Backups locales: `/opt/setex/shared/backups/github-prod-sync-2026-08-20/` (bundle del repo completo + tar del working tree).
- AVISO: el repo de staging (`/opt/setex/staging`, mismo remote) no debe volver a hacer `git push` — volvería a crear ramas en GitHub.

---

## 2026-08-20 — Cierre de vulnerabilidades de dependencias (Dependabot 44 → 0)

- `app/backend/package.json` + lock: `pdfjs-dist` ^6.1.200 → ^6.2.108 (GHSA-hq66-cqwq-w95j, ejecución de JS arbitrario con PDF malicioso, high — usado por el pipeline OCR en backend).
- `app/backend/package-lock.json`: `body-parser` 1.20.5 → 1.20.6 (GHSA-v422-hmwv-36x6, DoS low), `brace-expansion` 1.1.14/2.1.0 → parcheadas (GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, DoS high), `fast-uri` 3.1.4 → 3.1.5 (GHSA-7p8r-x3mc-p8w7, high).
- `package-lock.json` root (tooling dev): `fast-uri` → 3.1.5 y `js-yaml` → 4.3.1 (GHSA-5p4m-2wfm-xmqj, DoS high, solo build-time).
- Tests backend 345/346 (el fallo único es api-surface-parity preexistente). `npm audit` = 0 en root y backend. Frontend no afectado (pdf.min.js estático v3.11.174 fuera de rango).
