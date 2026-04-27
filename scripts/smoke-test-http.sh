#!/usr/bin/env bash
# SETEX · smoke-test-http.sh — verificación HTTP shape post-deploy
#
# Confirma que las rutas críticas del backend responden con status code esperado.
# Ejecuta los checks DENTRO del container backend (vía `docker exec`) para
# bypasear Traefik (que tiene basic-auth en staging) y nginx (que protege).
# Así medimos el comportamiento real del backend, no del proxy.
#
# 3 verificaciones (~5s):
#   1. /health responde 200 (proceso vivo)
#   2. /api/internal/check-access responde 200 ó 403 (NO 404 = incidente Round 16)
#   3. /api/auth/login responde 401/429 a credenciales inválidas (endpoint vivo)
#
# Si /api/internal/check-access devuelve 404, el script retorna 1 inmediatamente
# con mensaje "INCIDENTE ROUND 16" — esa señal aborta el deploy en CI.
#
# Uso (ejecutado en el VPS tras deploy, sourcea paths.sh para env autodetect):
#   ./scripts/smoke-test-http.sh
#
# Exit codes:
#   0 = OK · 3/3 rutas responden el código esperado
#   1 = una o más rutas fallaron · ver mensajes en stderr
#
# Requisitos: docker, paths.sh sourceable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

TIMEOUT="${SMOKE_TIMEOUT:-10}"

fail() {
  echo "[smoke] FAIL: $1" >&2
  exit 1
}

ok() {
  echo "[smoke] OK   $1"
}

# Devuelve el status code HTTP de la request o "000" en error. Hace la request
# desde dentro del container backend (localhost:3000), bypaseando Traefik+nginx.
#
# Variables van por env via -e (no por interpolación bash); el body por stdin.
# Esto evita el quoting hell de heredocs node-en-bash con JSON.
#
# $1 = HTTP method (GET, POST, etc.)
# $2 = path (ej. "/health" o "/api/auth/login")
# $3 = body opcional (string JSON; pasado por stdin si presente)
http_status() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local js='
    let body = "";
    process.stdin.on("data", (c) => { body += c; });
    process.stdin.on("end", () => {
      const http = require("http");
      const headers = {};
      if (body) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(body);
      }
      const opts = {
        host: "localhost",
        port: 3000,
        path: process.env.SMOKE_PATH,
        method: process.env.SMOKE_METHOD,
        timeout: parseInt(process.env.SMOKE_TIMEOUT_S, 10) * 1000,
        headers,
      };
      const req = http.request(opts, (r) => { console.log(r.statusCode); process.exit(0); });
      req.on("error", () => { console.log("000"); process.exit(0); });
      req.on("timeout", () => { req.destroy(); console.log("000"); process.exit(0); });
      if (body) req.write(body);
      req.end();
    });
  '

  printf '%s' "$body" | docker exec -i \
    -e "SMOKE_METHOD=${method}" \
    -e "SMOKE_PATH=${path}" \
    -e "SMOKE_TIMEOUT_S=${TIMEOUT}" \
    "${CONTAINER_BE}" \
    node -e "$js" 2>/dev/null || echo "000"
}

echo "── SETEX smoke-test-http (${SETEX_ENV} · container=${CONTAINER_BE}) ──"

# ── 1. /health responde 200 ────────────────────────────────────────────────
status_health=$(http_status GET /health)
if [ "${status_health}" != "200" ]; then
  fail "/health devolvió ${status_health}, esperado 200"
fi
ok "/health -> 200"

# ── 2. /api/internal/check-access responde 200 ó 403 ───────────────────────
# Esta es la ruta más crítica: si responde 404, es el incidente Round 16.
status_check=$(http_status GET /api/internal/check-access)
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
status_login=$(http_status POST /api/auth/login \
  '{"email":"smoke-test-no-such-user@setex.local","password":"invalid"}')
case "${status_login}" in
  401|429)
    # 429 puede aparecer si el smoke corre muy seguido — también señal de que
    # el endpoint existe y la auth funciona.
    ok "/api/auth/login -> ${status_login} (endpoint vivo)"
    ;;
  *)
    fail "/api/auth/login con creds inválidas -> ${status_login}, esperado 401 (o 429 si rate-limited)"
    ;;
esac

echo "[smoke] OK · 3/3 rutas críticas respondieron como se esperaba."
exit 0
