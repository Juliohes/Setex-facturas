#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# SETEX · Seed wrapper · Solo entorno STAGING
# ═══════════════════════════════════════════════════════════════
# Ejecuta seed-staging.js dentro del contenedor backend.
# Safe-guards:
#   1. El contenedor debe llamarse setex-staging-backend (evita ejecutar en prod).
#   2. El script JS verifica NODE_ENV=staging antes de tocar nada.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

CONTAINER="setex-staging-backend"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_JS="${SCRIPT_DIR}/seed-staging.js"

echo "→ Verificando contenedor '${CONTAINER}'..."
if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "ERROR: contenedor '${CONTAINER}' no está corriendo."
  echo "       docker compose up -d desde /opt/setex/staging/app/"
  exit 1
fi

echo "→ Verificando que es staging (no prod)..."
NODE_ENV_IN=$(docker exec "${CONTAINER}" printenv NODE_ENV || true)
if [[ "${NODE_ENV_IN}" != "staging" ]]; then
  echo "ERROR: NODE_ENV='${NODE_ENV_IN}' dentro del contenedor (se esperaba 'staging')."
  echo "       El contenedor '${CONTAINER}' parece no ser de staging. Abortando."
  exit 1
fi

echo "→ Ejecutando seed-staging.js en '${CONTAINER}'..."
docker exec -i "${CONTAINER}" node - < "${SEED_JS}"
