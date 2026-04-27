#!/usr/bin/env bash
# SETEX · smoke-test-http.sh — verificación HTTP shape post-deploy
#
# Confirma que las rutas críticas del backend responden con status code esperado.
# NO hace OCR real (eso requiere fixture + tiempo). Solo verifica:
#   1. /health responde 200
#   2. /api/internal/check-access responde 200 ó 403 (NO 404 — eso es el incidente Round 16)
#   3. /api/auth/login responde 401 a credenciales inválidas (verifica que el endpoint
#      existe y el rate limiter no nos bloquea de entrada)
#
# Si las 3 pasan, el backend está vivo y la superficie API está intacta.
# Si /api/internal/check-access devuelve 404, el script retorna 1 inmediatamente
# — eso reproduciría el incidente del 22-Abr 2026.
#
# Uso (ejecutado en el VPS tras deploy, source paths.sh para env autodetect):
#   ./scripts/smoke-test-http.sh
#
# Exit codes:
#   0 = OK · todas las rutas responden el código esperado
#   1 = una o más rutas fallaron · ver mensajes en stderr
#
# Requisitos: curl, paths.sh sourceable, dominio resolvible.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

# Permitir override de la URL base (útil para tests locales contra localhost)
SMOKE_BASE_URL="${SMOKE_BASE_URL:-${BASE_URL}}"
TIMEOUT="${SMOKE_TIMEOUT:-10}"

fail() {
  echo "[smoke] FAIL: $1" >&2
  exit 1
}

ok() {
  echo "[smoke] OK   $1"
}

echo "── SETEX smoke-test-http (${SETEX_ENV} · ${SMOKE_BASE_URL}) ──"

# ── 1. /health responde 200 ────────────────────────────────────────────────
status_health=$(curl -sk -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" \
  "${SMOKE_BASE_URL}/health" || echo "000")
if [ "${status_health}" != "200" ]; then
  fail "/health devolvió ${status_health}, esperado 200"
fi
ok "/health -> 200"

# ── 2. /api/internal/check-access responde 200 ó 403 ───────────────────────
# Esta es la ruta más crítica: si responde 404, es el incidente Round 16.
status_check=$(curl -sk -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" \
  "${SMOKE_BASE_URL}/api/internal/check-access" || echo "000")
case "${status_check}" in
  200|403)
    ok "/api/internal/check-access -> ${status_check} (válido)"
    ;;
  404)
    fail "/api/internal/check-access -> 404 · INCIDENTE ROUND 16: la ruta auth_request no existe en el backend desplegado. nginx tirará 404 a TODA la app."
    ;;
  *)
    fail "/api/internal/check-access -> ${status_check}, esperado 200 ó 403"
    ;;
esac

# ── 3. /api/auth/login responde 401 con credenciales inválidas ─────────────
# Verifica que: (a) el endpoint existe y (b) la lógica de rate-limit no bloquea
# antes de validar password.
status_login=$(curl -sk -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" \
  -X POST "${SMOKE_BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-test-no-such-user@setex.local","password":"invalid"}' || echo "000")
if [ "${status_login}" != "401" ]; then
  # El rate limit puede devolver 429 si el smoke se ejecuta muy seguido — eso
  # también es señal de que el endpoint existe y la auth funciona.
  if [ "${status_login}" != "429" ]; then
    fail "/api/auth/login con creds inválidas -> ${status_login}, esperado 401 (o 429 si rate-limited)"
  fi
fi
ok "/api/auth/login -> ${status_login} (endpoint vivo)"

echo "[smoke] OK · 3/3 rutas críticas respondieron como se esperaba."
exit 0
