#!/bin/bash
# Backup automático de PostgreSQL — SETEX Captura Facturas
# Cifrado con GPG (AES-256). Retención: 7 backups.
# Cron: 0 3 * * * /opt/setex-captu-facture/scripts/backup-postgres.sh

set -euo pipefail

BACKUP_DIR="/opt/setex-captu-facture/backups/postgres"
PASSPHRASE_FILE="/opt/setex-captu-facture/secrets/backup_passphrase.txt"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="setex_db_${DATE}.sql.gz.gpg"
TMP_FILE=$(mktemp)

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando backup cifrado → $FILENAME"

# Verificar que la passphrase existe
if [ ! -f "$PASSPHRASE_FILE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: passphrase no encontrada en $PASSPHRASE_FILE" >&2
  exit 1
fi

# Dump → gzip → GPG cifrado simétrico (AES-256) — en pipeline sin archivo intermedio en claro
docker exec setex-postgres pg_dump -U setex_user setex_db \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_FILE" \
        --output "$BACKUP_DIR/$FILENAME" 2>/dev/null

if [ $? -eq 0 ] && [ -s "$BACKUP_DIR/$FILENAME" ]; then
  SIZE=$(du -sh "$BACKUP_DIR/$FILENAME" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup OK — $FILENAME ($SIZE)"

  # Verificar integridad: intentar descifrar sin extraer
  if gpg --batch --quiet --passphrase-file "$PASSPHRASE_FILE" \
         --decrypt "$BACKUP_DIR/$FILENAME" 2>/dev/null | gzip -t 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Integridad verificada OK"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: verificación de integridad falló — revisar manualmente" >&2
  fi
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: backup falló" >&2
  rm -f "$BACKUP_DIR/$FILENAME"
  exit 1
fi

# Mantener solo los últimos 7 backups
KEPT=$(ls -t "$BACKUP_DIR"/*.gpg 2>/dev/null | wc -l)
if [ "$KEPT" -gt 7 ]; then
  ls -t "$BACKUP_DIR"/*.gpg | tail -n +8 | xargs rm -f
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Limpieza: mantenidos 7 ultimos backups"
fi

# Limpiar backups antiguos sin cifrar (migración desde formato anterior)
OLD_UNENCRYPTED=$(ls "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)
if [ "$OLD_UNENCRYPTED" -gt 0 ]; then
  rm -f "$BACKUP_DIR"/*.sql.gz
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Limpieza: eliminados $OLD_UNENCRYPTED backups sin cifrar (migrados a GPG)"
fi
