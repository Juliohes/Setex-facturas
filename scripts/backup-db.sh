#!/bin/bash
set -euo pipefail

BACKUP_DIR="/opt/setex-captu-facture/backups/postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/setex_db_$TIMESTAMP.sql.gz"

echo "[$(date)] Iniciando backup de PostgreSQL..."

# Crear backup
docker exec setex-postgres pg_dump -U setex_user setex_db | gzip > "$BACKUP_FILE"

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
