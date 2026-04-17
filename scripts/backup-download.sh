#!/bin/bash
# Descarga el último backup cifrado a tu máquina local
# Uso DESDE TU MÁQUINA LOCAL (no desde el servidor):
#
#   scp root@<IP_VPS>:/opt/setex-captu-facture/backups/postgres/latest.sql.gz.gpg ./
#
# Para descifrar localmente:
#   gpg --batch --passphrase-file backup_passphrase.txt --decrypt latest.sql.gz.gpg | gunzip > setex_db.sql
#
# Este script se ejecuta EN EL SERVIDOR para crear el symlink 'latest'
# y preparar un paquete con backup + passphrase para descarga inicial.

set -euo pipefail

BACKUP_DIR="/opt/setex-captu-facture/backups/postgres"
PASSPHRASE_FILE="/opt/setex-captu-facture/secrets/backup_passphrase.txt"

# Encontrar el backup más reciente
LATEST=$(ls -t "$BACKUP_DIR"/*.gpg 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "ERROR: no se encontraron backups cifrados en $BACKUP_DIR"
  exit 1
fi

# Crear symlink 'latest' para acceso fácil
ln -sf "$LATEST" "$BACKUP_DIR/latest.sql.gz.gpg"

echo "=== SETEX Backup Download ==="
echo ""
echo "Último backup: $(basename "$LATEST")"
echo "Tamaño:        $(du -sh "$LATEST" | cut -f1)"
echo "Fecha:         $(stat -c '%y' "$LATEST" | cut -d. -f1)"
echo ""
echo "── Comandos para ejecutar EN TU MÁQUINA LOCAL ──"
echo ""
echo "1. Descargar el backup cifrado:"
echo "   scp root@$(hostname -I | awk '{print $1}'):/opt/setex-captu-facture/backups/postgres/latest.sql.gz.gpg ./"
echo ""
echo "2. Descargar la passphrase (solo la primera vez — guárdala segura):"
echo "   scp root@$(hostname -I | awk '{print $1}'):/opt/setex-captu-facture/secrets/backup_passphrase.txt ./"
echo ""
echo "3. Descifrar y descomprimir:"
echo "   gpg --batch --passphrase-file backup_passphrase.txt --decrypt latest.sql.gz.gpg | gunzip > setex_db.sql"
echo ""
echo "4. Restaurar en PostgreSQL local (opcional):"
echo "   psql -U postgres -d setex_restore < setex_db.sql"
echo ""
