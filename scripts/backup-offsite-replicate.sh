#!/bin/bash
# Replicación offsite de backups al VPS secundario Hostinger (72.62.189.27).
# Estrategia 3-2-1:
#   3 copias: local /opt/setex/shared/backups + VPS principal + VPS secundario
#   2 medios: SSD VPS principal + SSD VPS secundario (geográficamente separados)
#   1 off-site: VPS secundario es el "off-site" para nosotros
#
# Cron: 0 5 * * * /opt/setex/prod/scripts/backup-offsite-replicate.sh
# (5:00 UTC = 7:00 Madrid verano / 6:00 Madrid invierno — 2h tras backup local 03:00)
#
# Requiere: SSH key root@72.62.189.27 ya autorizada en authorized_keys del VPS 2.

set -euo pipefail

# ── Fuente única de rutas, contenedores y dominio ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

LOCAL_DIR="${BACKUP_DIR}"
REMOTE_HOST="${OFFSITE_HOST}"
REMOTE_USER="root"
REMOTE_DIR="${OFFSITE_DIR}"
LOG_FILE="${LOGS_DIR}/backup-offsite.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Iniciando replicación offsite a $REMOTE_HOST ==="

if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "echo ok" >/dev/null 2>&1; then
  log "ERROR: No se puede conectar por SSH a $REMOTE_HOST. Abortando."
  exit 1
fi

REMOTE_FREE_GB=$(ssh "$REMOTE_USER@$REMOTE_HOST" "df --output=avail -BG / | tail -1 | tr -d ' G'")
if [ "$REMOTE_FREE_GB" -lt 5 ]; then
  log "ERROR: VPS secundario solo tiene ${REMOTE_FREE_GB}G libres (<5G). Abortando."
  exit 2
fi
log "VPS secundario: ${REMOTE_FREE_GB}G libres"

log "Sincronizando $LOCAL_DIR -> ${REMOTE_HOST}:${REMOTE_DIR}"
rsync -aHq --include='*.gpg' --exclude='*' \
  "$LOCAL_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/" 2>>"$LOG_FILE"

ssh "$REMOTE_USER@$REMOTE_HOST" "cd $REMOTE_DIR && ls -t *.gpg 2>/dev/null | tail -n +15 | xargs -r rm -f" 2>/dev/null || true

REMOTE_COUNT=$(ssh "$REMOTE_USER@$REMOTE_HOST" "ls $REMOTE_DIR/*.gpg 2>/dev/null | wc -l")
LATEST=$(ssh "$REMOTE_USER@$REMOTE_HOST" "ls -t $REMOTE_DIR/*.gpg 2>/dev/null | head -1")
log "Replicacion OK. Backups remotos: $REMOTE_COUNT. Ultimo: $(basename "$LATEST")"

REMOTE_SIZE=$(ssh "$REMOTE_USER@$REMOTE_HOST" "stat -c%s $LATEST 2>/dev/null")
LOCAL_LATEST=$(ls -t "$LOCAL_DIR"/*.gpg | head -1)
LOCAL_SIZE=$(stat -c%s "$LOCAL_LATEST" 2>/dev/null)
if [ "$REMOTE_SIZE" = "$LOCAL_SIZE" ]; then
  log "Integridad: tamanos coinciden ($REMOTE_SIZE bytes)"
else
  log "WARN: tamanos difieren - local=$LOCAL_SIZE remoto=$REMOTE_SIZE"
fi

log "=== Replicacion completada ==="
exit 0
