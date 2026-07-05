#!/bin/bash
# scripts/purge-test-uploads.sh — purga periódica de actividad de usuarios de pruebas
#
# Ejecuta cada 5 minutos via cron. Para cada usuario con is_test=true:
#   1. Obtiene la lista de uploads (id, ruta de fichero) y los borra de BD.
#   2. Borra los ficheros físicos del volumen del backend.
#   3. Borra audit_logs asociados a esos user_id.
#   4. Borra refresh_tokens y password_reset_tokens (CASCADE no aplica con UPDATE, sí con DELETE).
#
# El usuario en sí NO se borra: queremos que pueda seguir usando la cuenta
# para hacer pruebas. Solo se purga el rastro de su actividad.
#
# Logs en /var/log/setex/purge-test.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

LOG_DIR="/var/log/setex"
LOG_FILE="${LOG_DIR}/purge-test.log"
mkdir -p "$LOG_DIR" 2>/dev/null || true

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE" >/dev/null 2>&1 || echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# 1. ¿Hay usuarios test? Si no, salir silenciosamente.
TEST_USER_COUNT=$(docker exec "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB" -tA -c "SELECT COUNT(*) FROM users WHERE is_test = true;" | tr -d '[:space:]')
if [ "${TEST_USER_COUNT:-0}" = "0" ]; then
  exit 0
fi

# 2. Borrar ficheros físicos del volumen del contenedor backend.
# Localizar primero los uploads que pertenecen a usuarios test antes de borrarlos de BD.
mapfile -t FILES_TO_REMOVE < <(docker exec "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB" -tA -c "
  SELECT COALESCE(file_path, filename)
  FROM uploads
  WHERE user_id IN (SELECT id FROM users WHERE is_test = true);
" | grep -v '^$' || true)

for f in "${FILES_TO_REMOVE[@]:-}"; do
  [ -z "$f" ] && continue
  # file_path puede ser absoluto (/app/uploads/...) o relativo (filename).
  case "$f" in
    /app/uploads/*) target="$f" ;;
    /*)             target="$f" ;;
    *)              target="/app/uploads/$f" ;;
  esac
  docker exec -u 0 "$CONTAINER_BE" rm -f -- "$target" 2>/dev/null || true
done

# 3. Borrar también las carpetas de email-prefix de los usuarios test (vacías tras borrar ficheros).
docker exec "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB" -tA -c "
  SELECT split_part(email, '@', 1) FROM users WHERE is_test = true;
" | grep -v '^$' | while read -r prefix; do
  prefix_clean=$(echo "$prefix" | tr -cd 'a-zA-Z0-9_.-')
  [ -z "$prefix_clean" ] && continue
  docker exec -u 0 "$CONTAINER_BE" sh -c "find /app/uploads/$prefix_clean -type d -empty -delete 2>/dev/null; rmdir /app/uploads/$prefix_clean 2>/dev/null" || true
done

# 4. DELETE en BD: uploads, audit_logs, refresh_tokens, password_reset_tokens.
DELETED=$(docker exec "$CONTAINER_PG" psql -U "$PG_USER" -d "$PG_DB" -tA -c "
WITH ids AS (SELECT id FROM users WHERE is_test = true),
     d_uploads AS (
       DELETE FROM uploads WHERE user_id IN (SELECT id FROM ids) RETURNING 1
     ),
     d_audit AS (
       DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM ids) RETURNING 1
     ),
     d_rt AS (
       DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM ids) RETURNING 1
     ),
     d_prt AS (
       DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM ids) RETURNING 1
     ),
     d_kc AS (
       DELETE FROM known_cifs WHERE user_id IN (SELECT id FROM ids) RETURNING 1
     )
SELECT
  (SELECT COUNT(*) FROM d_uploads)          AS uploads,
  (SELECT COUNT(*) FROM d_audit)            AS audit_logs,
  (SELECT COUNT(*) FROM d_rt)               AS refresh_tokens,
  (SELECT COUNT(*) FROM d_prt)              AS password_reset_tokens,
  (SELECT COUNT(*) FROM d_kc)               AS known_cifs;
" | tr -s '|' ' ')

if [ -n "${DELETED// /}" ] && [ "${DELETED// /0}" != "${DELETED// /0}" ] || ! echo "$DELETED" | grep -qE '^\s*0\s+0\s+0\s+0\s+0\s*$'; then
  log "purga test users (n=${TEST_USER_COUNT}): uploads/audit/rt/prt/kc = ${DELETED}"
fi

exit 0
