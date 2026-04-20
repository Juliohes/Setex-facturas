#!/bin/bash
# Backup automático de PostgreSQL — SETEX Captura Facturas
# Cifrado con GPG (AES-256). Retención: 7 backups.
# Cron: 0 3 * * * /opt/setex/prod/scripts/backup-postgres.sh
#
# Endurecimientos 2026-04-20:
# - Pipe guardado con PIPESTATUS + tamaño mínimo (anti-86B "pipe roto silencioso")
# - Descifrado obligatorio + validación de header pg_dump antes de declarar OK
# - ls globs robustos (no fallan con set -euo pipefail si no hay matches)

set -euo pipefail

BACKUP_DIR="/opt/setex/shared/backups/postgres"
PASSPHRASE_FILE="/opt/setex/prod/secrets/backup_passphrase.txt"
MIN_BYTES=1024
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="setex_db_${DATE}.sql.gz.gpg"
OUTFILE="$BACKUP_DIR/$FILENAME"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
fail() { log "ERROR: $1" >&2; rm -f "$OUTFILE"; exit 1; }

mkdir -p "$BACKUP_DIR"

log "Iniciando backup cifrado → $FILENAME"

[ -f "$PASSPHRASE_FILE" ] || fail "passphrase no encontrada en $PASSPHRASE_FILE"

# Pipeline sin intermedio en claro
docker exec setex-prod-postgres pg_dump -U setex_user setex_db \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_FILE" \
        --output "$OUTFILE" 2>/dev/null

# PIPESTATUS: [0]=pg_dump [1]=gzip [2]=gpg. Cualquier non-zero → abortar.
PS=("${PIPESTATUS[@]}")
for i in 0 1 2; do
  [ "${PS[$i]}" -eq 0 ] || fail "pipe falló (pg_dump=${PS[0]} gzip=${PS[1]} gpg=${PS[2]})"
done

# Gate tamaño: 86B significa pipe trivial (DB vacía / container arrancando)
BYTES=$(stat -c%s "$OUTFILE" 2>/dev/null || echo 0)
[ "$BYTES" -ge "$MIN_BYTES" ] || fail "backup sospechosamente pequeño (${BYTES}B < ${MIN_BYTES}B)"

# Gate integridad REAL: descifrar + verificar gzip + confirmar header pg_dump
# set +o pipefail local: gunzip recibe SIGPIPE al cerrar grep/head tras match, eso
# no indica fallo. Validamos con el exit-code de grep.
set +o pipefail
if ! gpg --batch --quiet --passphrase-file "$PASSPHRASE_FILE" --decrypt "$OUTFILE" 2>/dev/null \
     | gunzip 2>/dev/null \
     | grep -q "PostgreSQL database dump"; then
  set -o pipefail
  fail "integridad: no se pudo descifrar o el contenido no es un dump PostgreSQL"
fi
set -o pipefail

SIZE=$(du -sh "$OUTFILE" | cut -f1)
log "Backup OK — $FILENAME ($SIZE) · integridad verificada"

# Retención: 7 más recientes. shopt nullglob para evitar fallo con set -e si no hay matches.
shopt -s nullglob
BACKUPS=("$BACKUP_DIR"/*.sql.gz.gpg)
shopt -u nullglob
if [ "${#BACKUPS[@]}" -gt 7 ]; then
  # shellcheck disable=SC2012
  ls -t "$BACKUP_DIR"/*.sql.gz.gpg | tail -n +8 | xargs -r rm -f
  log "Limpieza: mantenidos 7 últimos backups (eliminados $((${#BACKUPS[@]} - 7)))"
fi

# Limpiar residuos sin cifrar (migración formato anterior)
shopt -s nullglob
OLD=("$BACKUP_DIR"/*.sql.gz)
shopt -u nullglob
if [ "${#OLD[@]}" -gt 0 ]; then
  rm -f "${OLD[@]}"
  log "Limpieza: eliminados ${#OLD[@]} backups sin cifrar (migrados a GPG)"
fi

exit 0
