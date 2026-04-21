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

if [ "$CHANGED" -eq 0 ]; then
  log "OK: todos los permisos correctos — sin cambios"
else
  log "AVISO: se corrigieron permisos. Verificando servicios afectados..."
fi

log "=== Fin verificación ==="
