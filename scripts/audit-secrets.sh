#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# SETEX — Auditoría de secretos pre-commit
# Escanea el código buscando secretos hardcodeados ANTES de commitear.
# Uso: bash scripts/audit-secrets.sh [directorio]
# Retorna: exit 0 = LIMPIO | exit 1 = SOSPECHOSO
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

PROJECT_DIR="${1:-/opt/setex-captu-facture}"
FOUND=0
REPORT=""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "════════════════════════════════════════════════════"
echo "  SETEX — Auditoría de secretos pre-commit"
echo "  Directorio: ${PROJECT_DIR}"
echo "  Fecha: $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════"
echo ""

# Directorios a excluir de la búsqueda
EXCLUDE_DIRS=(
    "secrets"
    "secrets-staging"
    "node_modules"
    "data"
    "backups"
    "logs"
    "ocr-service"
    ".git"
    ".playwright-mcp"
    "tests/invoices"
    "tests/results"
)

# Construir argumentos de exclusión para grep
EXCLUDE_ARGS=""
for dir in "${EXCLUDE_DIRS[@]}"; do
    EXCLUDE_ARGS="${EXCLUDE_ARGS} --exclude-dir=${dir}"
done

# Extensiones a escanear
INCLUDE_ARGS="--include=*.js --include=*.ts --include=*.json --include=*.yml --include=*.yaml --include=*.md --include=*.html --include=*.css --include=*.sh --include=*.py --include=*.env* --include=*.conf --include=*.cfg --include=*.toml"

scan_pattern() {
    local pattern="$1"
    local description="$2"
    local severity="$3"

    # shellcheck disable=SC2086
    local results
    results=$(grep -rnI ${EXCLUDE_ARGS} ${INCLUDE_ARGS} -E "${pattern}" "${PROJECT_DIR}" 2>/dev/null || true)

    if [ -n "$results" ]; then
        FOUND=$((FOUND + 1))
        REPORT="${REPORT}\n${RED}[${severity}]${NC} ${description}\n"
        REPORT="${REPORT}    Patrón: ${pattern}\n"
        while IFS= read -r line; do
            REPORT="${REPORT}    ${YELLOW}→${NC} ${line}\n"
        done <<< "$results"
        REPORT="${REPORT}\n"
    fi
}

echo "Escaneando patrones sospechosos..."
echo ""

# ── PATRONES DE ALTA SEVERIDAD ────────────────────────────────

# API keys hardcoded (valores reales, no variables/placeholders)
scan_pattern \
    '(api[_-]?key|apikey)\s*[:=]\s*["\x27][A-Za-z0-9_\-]{20,}["\x27]' \
    "API key hardcoded con valor real" \
    "CRÍTICO"

# Contraseñas hardcoded
scan_pattern \
    '(password|passwd|pwd)\s*[:=]\s*["\x27][^"\x27]{6,}["\x27]' \
    "Contraseña hardcoded" \
    "ALTO"

# JWT tokens hardcoded (formato eyJ...)
scan_pattern \
    'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' \
    "JWT token hardcoded" \
    "CRÍTICO"

# Secretos en formato clave=valor
scan_pattern \
    '(secret|SECRET)\s*[:=]\s*["\x27][A-Za-z0-9_\-]{10,}["\x27]' \
    "Secret hardcoded con valor real" \
    "CRÍTICO"

# URLs con credenciales embebidas
scan_pattern \
    '(https?|ftp)://[^:]+:[^@]+@[^\s"]+' \
    "URL con credenciales embebidas" \
    "CRÍTICO"

# Claves privadas SSH/PGP
scan_pattern \
    'BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY' \
    "Clave privada embebida" \
    "CRÍTICO"

# OpenAI API keys (sk-...)
scan_pattern \
    'sk-[A-Za-z0-9]{20,}' \
    "OpenAI API key hardcoded (sk-...)" \
    "CRÍTICO"

# ── PATRONES DE SEVERIDAD MEDIA ──────────────────────────────

# Bearer tokens hardcoded (no en comentarios de docs)
scan_pattern \
    'Authorization.*Bearer\s+[A-Za-z0-9_\-\.]{20,}' \
    "Bearer token hardcoded" \
    "MEDIO"

# Strings que parecen tokens/keys (32+ caracteres alfanuméricos)
scan_pattern \
    '(token|TOKEN)\s*[:=]\s*["\x27][A-Za-z0-9_\-]{32,}["\x27]' \
    "Token sospechoso (32+ caracteres)" \
    "MEDIO"

# Archivos .env con valores reales (no .env.example)
if [ -f "${PROJECT_DIR}/app/.env" ]; then
    # Verificar que .env no se va a commitear (debe estar en .gitignore)
    if ! grep -q "^\.env$" "${PROJECT_DIR}/.gitignore" 2>/dev/null; then
        FOUND=$((FOUND + 1))
        REPORT="${REPORT}\n${RED}[CRÍTICO]${NC} Archivo .env existe y NO está en .gitignore\n"
        REPORT="${REPORT}    ${YELLOW}→${NC} ${PROJECT_DIR}/app/.env\n\n"
    fi
fi

# ── VERIFICACIÓN DE .gitignore ────────────────────────────────

echo "Verificando .gitignore..."
echo ""

GITIGNORE="${PROJECT_DIR}/.gitignore"
MISSING_RULES=()

required_rules=("secrets/" ".env" "data/" "backups/" "logs/" "node_modules/" "ocr-service/")

if [ -f "$GITIGNORE" ]; then
    for rule in "${required_rules[@]}"; do
        if ! grep -q "^${rule}" "$GITIGNORE" 2>/dev/null; then
            MISSING_RULES+=("$rule")
        fi
    done

    if [ ${#MISSING_RULES[@]} -gt 0 ]; then
        FOUND=$((FOUND + 1))
        REPORT="${REPORT}\n${RED}[CRÍTICO]${NC} .gitignore no contiene reglas obligatorias:\n"
        for rule in "${MISSING_RULES[@]}"; do
            REPORT="${REPORT}    ${YELLOW}→${NC} Falta: ${rule}\n"
        done
        REPORT="${REPORT}\n"
    fi
else
    FOUND=$((FOUND + 1))
    REPORT="${REPORT}\n${RED}[CRÍTICO]${NC} NO EXISTE .gitignore — todo se commitearía\n\n"
fi

# ── RESULTADO FINAL ───────────────────────────────────────────

echo "════════════════════════════════════════════════════"

if [ "$FOUND" -eq 0 ]; then
    echo -e "${GREEN}  ✓ LIMPIO — No se encontraron secretos expuestos${NC}"
    echo "════════════════════════════════════════════════════"
    exit 0
else
    echo -e "${RED}  ✗ SOSPECHOSO — ${FOUND} hallazgo(s) encontrado(s)${NC}"
    echo "════════════════════════════════════════════════════"
    echo ""
    echo -e "$REPORT"
    echo "════════════════════════════════════════════════════"
    echo -e "${RED}  NO HACER COMMIT hasta resolver todos los hallazgos${NC}"
    echo "════════════════════════════════════════════════════"
    exit 1
fi
