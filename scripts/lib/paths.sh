# SETEX · paths.sh — fuente única de rutas, contenedores y dominio (entorno: PROD)
#
# Source desde cualquier script bash con:
#   source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib/paths.sh"
#
# ⚠️  MANTENER EN PARALELO con /opt/setex/staging/scripts/lib/paths.sh
#     Sólo deben diferir las 2 primeras variables (ENV y BASE_DIR) + DOMAIN.
#     Un próximo cutover debe requerir editar ÚNICAMENTE este fichero.

# ── Identidad del entorno ─────────────────────────────────────────────────────
export SETEX_ENV="prod"
export BASE_DIR="/opt/setex/prod"
export DOMAIN="setex-facturas.es"

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
export OFFSITE_DIR="/opt/setex-backups-offsite/postgres"

# ── Postgres ──────────────────────────────────────────────────────────────────
export PG_USER="setex_user"
export PG_DB="setex_db"
