#!/bin/bash
set -euo pipefail

echo "=== Health Check $(date) ==="

# Verificar contenedores
for container in setex-postgres setex-backend setex-frontend; do
    if docker ps | grep -q "$container"; then
        echo "✓ $container: Running"
    else
        echo "✗ $container: NOT Running"
    fi
done

# Verificar HTTPS
if curl -sf https://xanflatest.com/health > /dev/null 2>&1; then
    echo "✓ HTTPS: OK"
else
    echo "✗ HTTPS: FAIL"
fi

echo "=== Fin Health Check ==="
