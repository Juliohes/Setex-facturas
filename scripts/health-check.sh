#!/bin/bash
set -euo pipefail

# ── Fuente única de rutas, contenedores y dominio ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

echo "=== Health Check ${SETEX_ENV} $(date) ==="

# Verificar contenedores
for container in "${CONTAINER_PG}" "${CONTAINER_BE}" "${CONTAINER_FE}" "${CONTAINER_REDIS}"; do
    if docker ps --format '{{.Names}}' | grep -qx "$container"; then
        echo "✓ $container: Running"
    else
        echo "✗ $container: NOT Running"
    fi
done

# Verificar HTTPS: servidor alive ⇔ código HTTP <500 (4xx como 401 en staging son OK)
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "${HEALTH_URL}" --max-time 10 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "000" ]; then
    echo "✗ HTTPS ${DOMAIN}: timeout/sin respuesta"
elif [ "$HTTP_CODE" -ge 500 ] 2>/dev/null; then
    echo "✗ HTTPS ${DOMAIN}: HTTP $HTTP_CODE"
else
    echo "✓ HTTPS ${DOMAIN}: HTTP $HTTP_CODE"
fi

echo "=== Fin Health Check ==="
