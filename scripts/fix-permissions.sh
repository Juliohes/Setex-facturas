#!/bin/bash
# fix-permissions.sh — Corrige permisos de todos los volúmenes de SETEX
# UIDs correctos: redis=999, postgres=70, backend(appuser)=1001
# Ejecutar como root. Seguro de repetir cuantas veces sea necesario.

set -euo pipefail

# ── Fuente única de rutas, contenedores y dominio ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

LOG="${LOGS_DIR}/permissions.log"
CHANGED=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

check_and_fix() {
  local dir="$1"
  local uid="$2"
  local label="$3"

  if [ ! -d "$dir" ]; then
    log "WARN: directorio no existe: $dir"
    return
  fi

  current_uid=$(stat -c '%u' "$dir")
  if [ "$current_uid" != "$uid" ]; then
    log "FIX: $label ($dir) → UID incorrecto ($current_uid), corrigiendo a $uid"
    chown -R "$uid:$uid" "$dir"
    CHANGED=1
    log "OK: $label corregido"
  fi
}

log "=== Verificación de permisos SETEX ==="

check_and_fix "${DATA_DIR}/redis"    "999"  "Redis data"
check_and_fix "${DATA_DIR}/postgres" "70"   "PostgreSQL data"
check_and_fix "${DATA_DIR}/uploads"  "1001" "Backend uploads"
check_and_fix "${LOGS_DIR}"          "1001" "Backend logs"

# ── LL-001: chown automatizado contra contaminación root:root ────────────────
# Detectada en PR #84 deploy a prod (2026-04-27): 195 ficheros del refactor v3
# tenían owner=root:root tras `git pull` ejecutados como root, y el user deploy
# no podía borrarlos durante `git reset --hard origin/main`. Misma deuda volvió
# a bloquear staging deploys el 2026-04-27 noche (PR #87 push, #85, #86, etc.)
# por `paths.sh` root-owned. Este step previene que vuelva a ocurrir.
#
# Excluye: data/postgres (uid 70), data/redis (uid 999), data/uploads (1001),
# secrets/, logs/, .git/, node_modules/. Solo toca código fuente + scripts +
# docs + config + workflows (deploy debe poder reescribirlos vía git reset).
log "── LL-001: re-claim de ownership a deploy:deploy en árbol git ──"
ROOT_OWNED=$(find "${BASE_DIR}" \
  -not -path '*/data/postgres/*' \
  -not -path '*/data/redis/*' \
  -not -path '*/data/uploads/*' \
  -not -path '*/secrets/*' \
  -not -path '*/logs/*' \
  -not -path '*/.git/*' \
  -not -path '*/node_modules/*' \
  \( -user root -o -group root \) 2>/dev/null | wc -l)

if [ "$ROOT_OWNED" -gt 0 ]; then
  log "FIX: encontrados ${ROOT_OWNED} ficheros root-owned en ${BASE_DIR} — chown a deploy:deploy"
  find "${BASE_DIR}" \
    -not -path '*/data/postgres/*' \
    -not -path '*/data/redis/*' \
    -not -path '*/data/uploads/*' \
    -not -path '*/secrets/*' \
    -not -path '*/logs/*' \
    -not -path '*/.git/*' \
    -not -path '*/node_modules/*' \
    \( -user root -o -group root \) \
    -exec chown deploy:deploy {} + 2>/dev/null || true
  CHANGED=1
  log "OK: LL-001 chown aplicado (${ROOT_OWNED} ficheros)"
else
  log "OK: LL-001 ningún fichero root-owned en árbol git"
fi

if [ "$CHANGED" -eq 0 ]; then
  log "OK: todos los permisos correctos — sin cambios"
else
  log "AVISO: se corrigieron permisos. Verificando servicios afectados..."
fi

log "=== Fin verificación ==="
