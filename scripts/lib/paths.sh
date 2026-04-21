# SETEX · paths.sh — fuente única de rutas, contenedores y dominio
#
# Autodetección de entorno: resuelve prod vs staging a partir del directorio
# de instalación del propio fichero. Un mismo paths.sh sirve para ambos
# entornos: solo hay que instalarlo en /opt/setex/prod/scripts/lib/ o en
# /opt/setex/staging/scripts/lib/ — el script decide el resto.
#
# Source desde cualquier script bash con:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "${SCRIPT_DIR}/lib/paths.sh"

# ── Detección de entorno ──────────────────────────────────────────────────────
# BASE_DIR se deriva de la ruta real del fichero: .../{prod|staging}/scripts/lib/paths.sh
_PATHS_SH_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export BASE_DIR="$(cd "${_PATHS_SH_PATH}/../.." && pwd)"
_ENV_NAME="$(basename "${BASE_DIR}")"

case "${_ENV_NAME}" in
  prod)
    export SETEX_ENV="prod"
    export DOMAIN="setex-facturas.es"
    ;;
  staging)
    export SETEX_ENV="staging"
    export DOMAIN="staging.setex-facturas.es"
    ;;
  *)
    echo "paths.sh: entorno no reconocido a partir de BASE_DIR=${BASE_DIR}" >&2
    echo "  esperado basename 'prod' o 'staging'" >&2
    return 1 2>/dev/null || exit 1
    ;;
esac

# ── Directorios derivados ─────────────────────────────────────────────────────
export SHARED_DIR="/opt/setex/shared"
export SCRIPTS_DIR="${BASE_DIR}/scripts"
export APP_DIR="${BASE_DIR}/app"
export DATA_DIR="${BASE_DIR}/data"
export LOGS_DIR="${BASE_DIR}/logs"
export SECRETS_DIR="${BASE_DIR}/secrets"
export DOCS_DIR="${BASE_DIR}/docs"
export CONFIG_DIR="${BASE_DIR}/config"
export BACKUP_DIR="${SHARED_DIR}/backups/postgres"

# ── Contenedores Docker (post-cutover Fase 4 · 2026-04-20) ────────────────────
export CONTAINER_PREFIX="setex-${SETEX_ENV}"
export CONTAINER_BE="${CONTAINER_PREFIX}-backend"
export CONTAINER_FE="${CONTAINER_PREFIX}-frontend"
export CONTAINER_PG="${CONTAINER_PREFIX}-postgres"
export CONTAINER_REDIS="${CONTAINER_PREFIX}-redis"

# ── Docker Compose ────────────────────────────────────────────────────────────
export COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
export COMPOSE="docker compose -f ${COMPOSE_FILE}"

# ── URLs ──────────────────────────────────────────────────────────────────────
export BASE_URL="https://${DOMAIN}"
export API_URL="${BASE_URL}/api"
export HEALTH_URL="${BASE_URL}/health"

# ── Backup offsite ────────────────────────────────────────────────────────────
export OFFSITE_HOST="72.62.189.27"
# Prod → /opt/setex-backups-offsite/postgres · staging → .../postgres-staging
if [ "${SETEX_ENV}" = "staging" ]; then
  export OFFSITE_DIR="/opt/setex-backups-offsite/postgres-staging"
else
  export OFFSITE_DIR="/opt/setex-backups-offsite/postgres"
fi

# ── Postgres ──────────────────────────────────────────────────────────────────
export PG_USER="setex_user"
export PG_DB="setex_db"
