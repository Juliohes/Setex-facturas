#!/bin/bash
# ⚠️  DEPRECATED — este script NO está en cron activo.
# El cron de prod usa `backup-postgres.sh` (hardened: PIPESTATUS + MIN_BYTES + GPG + integridad header).
# Se mantiene sólo por si hay invocaciones ad-hoc manuales heredadas.
# Para nuevas invocaciones usar: /opt/setex/prod/scripts/backup-postgres.sh
set -euo pipefail

# ── Fuente única de rutas, contenedores y dominio ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/setex_db_${TIMESTAMP}.sql.gz"

echo "[$(date)] Iniciando backup de PostgreSQL..."

# Crear backup
docker exec "${CONTAINER_PG}" pg_dump -U "${PG_USER}" "${PG_DB}" | gzip > "$BACKUP_FILE"

# Verificar
if [ -f "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$(date)] ✓ Backup completado: $BACKUP_FILE ($SIZE)"
else
    echo "[$(date)] ✗ Error: Backup falló"
    exit 1
fi

# Limpiar backups antiguos (retención: 7 días)
find "$BACKUP_DIR" -name "setex_db_*.sql.gz" -mtime +7 -delete
echo "[$(date)] ✓ Backups antiguos eliminados (retención: 7 días)"
