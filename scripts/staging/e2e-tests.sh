#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# SETEX · Suite E2E reutilizable para staging
# ═══════════════════════════════════════════════════════════════
# Ejecuta un checklist de integración contra staging. Usa emails
# únicos por ejecución para el test de rate-limit, así no contamina
# los tests siguientes.
#
# Requisitos: staging arrancado + seed aplicado (seed-staging.sh).
#
# Salida: resumen de PASS/FAIL con código 0 (todo OK) o 1 (fallos).
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

BASE="${BASE_URL:-https://staging.setex-facturas.es}"
SECRETS_DIR="${SETEX_SECRETS_DIR:-/opt/setex/staging/secrets}"
BASIC_PASS=$(sudo cat "${SECRETS_DIR}/basicauth_password.txt" 2>/dev/null | tr -d '\n\r ' || echo "")
PASS="${STAGING_PASSWORD:-Staging2026!}"

# Email único para el test de rate-limit (evita contaminar otros)
RATE_EMAIL="ratelimit-$(date +%s)-$$@test.staging.local"

# Helpers de salida con color
if [[ -t 1 ]]; then
  C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_0=$'\033[0m'
else
  C_G=""; C_R=""; C_Y=""; C_0=""
fi

declare -i TOTAL=0 OK=0 FAIL=0
pass() { printf "  %s✓%s  %-55s %s\n" "$C_G" "$C_0" "$1" "${2:-}"; OK+=1; TOTAL+=1; }
fail() { printf "  %s✗%s  %-55s got=%s exp=%s\n" "$C_R" "$C_0" "$1" "$2" "$3"; FAIL+=1; TOTAL+=1; }
check() { [[ "$2" == "$3" ]] && pass "$1" "" || fail "$1" "$2" "$3"; }

curl_json() { curl -sS -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" "$@"; }
status_only() { curl -sS -o /dev/null -w "%{http_code}" "$@"; }

echo ""
echo "  Suite E2E · staging"
echo "  ─────────────────────────────────────────────────────────"
echo "  Base:      $BASE"
echo "  Rate-test: $RATE_EMAIL"
echo ""
echo "  [1/4] TLS + Traefik routing"

# ── 1. Cert Let's Encrypt ───────────────────────────────────────
ISS=$(echo | openssl s_client -servername "${BASE#https://}" -connect "${BASE#https://}:443" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null)
[[ "$ISS" == *"Let's Encrypt"* ]] && pass "Certificado Let's Encrypt emitido" || fail "Certificado Let's Encrypt emitido" "$ISS" "Let's Encrypt"

# ── 2. BasicAuth bloquea raíz ───────────────────────────────────
check "GET /  sin BasicAuth  → 401" "$(status_only "$BASE/")" "401"

# ── 3. BasicAuth permite raíz ───────────────────────────────────
check "GET /  con BasicAuth  → 200" "$(status_only -u "setex:$BASIC_PASS" "$BASE/")" "200"

# ── 4. /api/ no requiere BasicAuth ──────────────────────────────
check "POST /api/auth/login sin BasicAuth → 401 (val)" "$(status_only -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/login")" "401"

echo ""
echo "  [2/4] Auth + RBAC"

# ── Login admin + empresa1 ──────────────────────────────────────
ADM_RES=$(curl_json -X POST -d "{\"email\":\"admin@staging.setex.local\",\"password\":\"$PASS\"}" "$BASE/api/auth/login")
ADM_TOK=$(echo "$ADM_RES" | jq -r '.accessToken // empty')
[[ -n "$ADM_TOK" ]] && pass "Login admin → accessToken" || fail "Login admin → accessToken" "(vacío)" "token"

EMP_RES=$(curl_json -X POST -d "{\"email\":\"empresa1@staging.setex.local\",\"password\":\"$PASS\"}" "$BASE/api/auth/login")
EMP_TOK=$(echo "$EMP_RES" | jq -r '.accessToken // empty')
[[ -n "$EMP_TOK" ]] && pass "Login empresa1 → accessToken" || fail "Login empresa1 → accessToken" "(vacío)" "token"

# Password incorrecta
check "Login pass incorrecta → 401" "$(status_only -X POST -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' -d "{\"email\":\"admin@staging.setex.local\",\"password\":\"WRONG\"}" "$BASE/api/auth/login")" "401"

# RBAC: admin OK, empresa 403, sin token 401
check "Admin GET /api/admin/facturas → 200" "$(status_only -H "Authorization: Bearer $ADM_TOK" -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/admin/facturas")" "200"
check "Empresa1 GET /api/admin/facturas → 403" "$(status_only -H "Authorization: Bearer $EMP_TOK" -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/admin/facturas")" "403"
check "Sin token /api/admin/facturas → 401" "$(status_only -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/admin/facturas")" "401"

echo ""
echo "  [3/4] Datos del seed + aislamiento"

# Admin ve 15 uploads totales
N=$(curl -sS -H "Authorization: Bearer $ADM_TOK" -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/admin/facturas" | jq '.facturas | length // 0' 2>/dev/null)
check "Admin ve 15 facturas (seed)" "$N" "15"

# Empresa1 ve solo las suyas (5)
N=$(curl -sS -H "Authorization: Bearer $EMP_TOK" -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/mis-facturas" | jq '.facturas | length // (. | length) // 0' 2>/dev/null)
check "Empresa1 ve 5 facturas (aislamiento)" "$N" "5"

# Endpoint imagen funciona (file_path poblado por el seed)
FID=$(curl -sS -H "Authorization: Bearer $EMP_TOK" -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/mis-facturas" | jq -r '.facturas[0].id // .[0].id // empty' 2>/dev/null)
if [[ -n "$FID" ]]; then
  CT=$(curl -sS -o /dev/null -w "%{content_type}" -H "Authorization: Bearer $EMP_TOK" -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/facturas/$FID/imagen")
  [[ "$CT" == image/* ]] && pass "GET imagen factura #$FID → $CT" || fail "GET imagen factura #$FID" "$CT" "image/*"
else
  fail "GET imagen factura" "sin id disponible" "factura válida"
fi

# Admin OCR engine endpoint
check "Admin GET /api/admin/ocr-engine → 200" "$(status_only -H "Authorization: Bearer $ADM_TOK" -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/admin/ocr-engine")" "200"

# Empresas pendientes (admin)
P=$(curl -sS -H "Authorization: Bearer $ADM_TOK" -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/admin/client-companies" | jq '[.companies[]? | select(.pendiente==true)] | length' 2>/dev/null)
check "Admin ve 1 empresa pendiente" "$P" "1"

echo ""
echo "  [4/4] Rate-limit (email único para no contaminar)"

for i in 1 2 3 4 5 6 7 8 9 10 11; do
  curl -sS -o /dev/null -X POST -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
    -d "{\"email\":\"$RATE_EMAIL\",\"password\":\"x\"}" "$BASE/api/auth/login" >/dev/null
done
check "Rate-limit login tras 11 intentos → 429" "$(status_only -X POST -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' -d "{\"email\":\"$RATE_EMAIL\",\"password\":\"x\"}" "$BASE/api/auth/login")" "429"

# Smoke test prod (no debe verse afectado por staging)
echo ""
echo "  [extra] Prod smoke test"
check "Prod https://setex-facturas.es/ → 200" "$(status_only https://setex-facturas.es/)" "200"

# ── Resumen ─────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────────────────────────"
if (( FAIL == 0 )); then
  echo "  ${C_G}ALL PASS${C_0}  $OK/$TOTAL"
  exit 0
else
  echo "  ${C_R}${FAIL} FAIL${C_0} · $OK/$TOTAL"
  exit 1
fi
