#!/usr/bin/env bash
#
# SETEX FACTURAS — STRESS TEST PROFESIONAL
# Simula un trimestral con muchas facturas simultáneas.
#
# Uso:
#   ./stress-test.sh <email> <password> [concurrencia] [total_facturas]
#
# Ejemplos:
#   ./stress-test.sh user@email.com pass123           # 5 secuenciales
#   ./stress-test.sh user@email.com pass123 5 20      # 20 facturas, 5 a la vez
#   ./stress-test.sh user@email.com pass123 10 50     # 50 facturas, 10 a la vez
#
set -euo pipefail

API_URL="https://xanflatest.com/api"
EMAIL="${1:?Uso: $0 <email> <password> [concurrencia] [total]}"
PASSWORD="${2:?Falta password}"
CONCURRENCY="${3:-1}"
TOTAL="${4:-5}"
INVOICE_DIR="$(dirname "$0")/invoices"
RESULTS_DIR="$(dirname "$0")/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="$RESULTS_DIR/stress_${TIMESTAMP}.csv"
SUMMARY_FILE="$RESULTS_DIR/summary_${TIMESTAMP}.txt"

mkdir -p "$RESULTS_DIR"

# ── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}"
echo "  =================================================================="
echo "    SETEX FACTURAS — STRESS TEST PROFESIONAL"
echo "  =================================================================="
echo -e "${NC}"
echo -e "  Facturas totales:   ${CYAN}${TOTAL}${NC}"
echo -e "  Concurrencia:       ${CYAN}${CONCURRENCY}${NC}"
echo -e "  API:                ${CYAN}${API_URL}${NC}"
echo ""

# ── Verificar que hay facturas generadas ─────────────────────────────────────
INVOICE_COUNT=$(ls "$INVOICE_DIR"/*.jpg 2>/dev/null | wc -l)
if [ "$INVOICE_COUNT" -eq 0 ]; then
    echo -e "${RED}  ERROR: No hay facturas de test en $INVOICE_DIR${NC}"
    echo "  Ejecuta primero: python3 tests/generate-invoices.py 50"
    exit 1
fi
echo -e "  Facturas disponibles: ${GREEN}${INVOICE_COUNT}${NC}"

# ── Autenticación ────────────────────────────────────────────────────────────
echo -e "\n  ${CYAN}Autenticando...${NC}"
LOGIN_RESPONSE=$(curl -sk -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
    --max-time 10 2>/dev/null)

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
    echo -e "${RED}  ERROR: Login fallido${NC}"
    echo "  Respuesta: $LOGIN_RESPONSE"
    exit 1
fi
echo -e "  ${GREEN}Login OK${NC} — Token obtenido"

# ── Preparar CSV de resultados ───────────────────────────────────────────────
echo "invoice,status,success,duplicate,missing_fields,time_ms,error" > "$RESULTS_FILE"

# ── Función para subir una factura ───────────────────────────────────────────
upload_invoice() {
    local file="$1"
    local basename=$(basename "$file")
    local start_ms=$(date +%s%N | cut -c1-13)

    local response
    response=$(curl -sk -X POST "$API_URL/upload" \
        -H "Authorization: Bearer $TOKEN" \
        -F "file=@$file" \
        --max-time 120 \
        -w "\n%{http_code}" 2>/dev/null)

    local end_ms=$(date +%s%N | cut -c1-13)
    local elapsed=$((end_ms - start_ms))
    local http_code=$(echo "$response" | tail -1)
    local body=$(echo "$response" | sed '$d')

    local success=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success',''))" 2>/dev/null || echo "")
    local duplicate=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('duplicate',''))" 2>/dev/null || echo "")
    local missing=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(d.get('missing_fields',[])))" 2>/dev/null || echo "")
    local error_msg=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','')[:80])" 2>/dev/null || echo "")

    # Status: ok, duplicate, missing, error
    local status="error"
    if [ "$success" = "True" ]; then
        status="ok"
    elif [ "$duplicate" = "True" ]; then
        status="duplicate"
    elif [ -n "$missing" ]; then
        status="missing_fields"
    fi

    echo "$basename,$status,$success,$duplicate,$missing,${elapsed},$error_msg" >> "$RESULTS_FILE"

    # Output visual
    local time_s=$(echo "scale=2; $elapsed / 1000" | bc 2>/dev/null || echo "${elapsed}ms")
    if [ "$status" = "ok" ]; then
        echo -e "    ${GREEN}OK${NC}  ${basename}  ${time_s}s"
    elif [ "$status" = "duplicate" ]; then
        echo -e "    ${YELLOW}DUP${NC} ${basename}  ${time_s}s"
    elif [ "$status" = "missing_fields" ]; then
        echo -e "    ${YELLOW}MIS${NC} ${basename}  ${time_s}s  (${missing})"
    else
        echo -e "    ${RED}ERR${NC} ${basename}  ${time_s}s  (${error_msg})"
    fi
}

export -f upload_invoice
export TOKEN API_URL RESULTS_FILE RED GREEN YELLOW CYAN NC

# ── Ejecutar test ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}  ── TEST: ${TOTAL} facturas, concurrencia ${CONCURRENCY} ──${NC}\n"

# Seleccionar N facturas (con repetición si hay menos que las pedidas)
SELECTED_FILES=$(ls "$INVOICE_DIR"/*.jpg | head -n "$TOTAL")
ACTUAL_COUNT=$(echo "$SELECTED_FILES" | wc -l)

if [ "$ACTUAL_COUNT" -lt "$TOTAL" ]; then
    # Repetir facturas si hay menos disponibles
    TEMP_LIST=""
    while [ $(echo "$TEMP_LIST" | grep -c . || echo 0) -lt "$TOTAL" ]; do
        TEMP_LIST="$TEMP_LIST
$SELECTED_FILES"
    done
    SELECTED_FILES=$(echo "$TEMP_LIST" | head -n "$TOTAL")
fi

START_TOTAL=$(date +%s%N | cut -c1-13)

if [ "$CONCURRENCY" -eq 1 ]; then
    # Secuencial
    echo "$SELECTED_FILES" | while read -r file; do
        [ -n "$file" ] && upload_invoice "$file"
    done
else
    # Concurrente con GNU parallel o xargs
    if command -v parallel &>/dev/null; then
        echo "$SELECTED_FILES" | parallel -j "$CONCURRENCY" upload_invoice {}
    else
        echo "$SELECTED_FILES" | xargs -P "$CONCURRENCY" -I {} bash -c 'upload_invoice "$@"' _ {}
    fi
fi

END_TOTAL=$(date +%s%N | cut -c1-13)
TOTAL_TIME=$((END_TOTAL - START_TOTAL))

# ── Generar resumen ──────────────────────────────────────────────────────────
echo -e "\n${BOLD}  ── RESULTADOS ──${NC}\n"

TOTAL_OK=$(grep -c ",ok," "$RESULTS_FILE" 2>/dev/null || echo 0)
TOTAL_DUP=$(grep -c ",duplicate," "$RESULTS_FILE" 2>/dev/null || echo 0)
TOTAL_MIS=$(grep -c ",missing_fields," "$RESULTS_FILE" 2>/dev/null || echo 0)
TOTAL_ERR=$(grep -c ",error," "$RESULTS_FILE" 2>/dev/null || echo 0)

# Calcular tiempos
TIMES=$(tail -n +2 "$RESULTS_FILE" | cut -d',' -f6 | sort -n)
if [ -n "$TIMES" ]; then
    AVG_MS=$(echo "$TIMES" | awk '{sum+=$1; n++} END {if(n>0) printf "%.0f", sum/n; else print 0}')
    MIN_MS=$(echo "$TIMES" | head -1)
    MAX_MS=$(echo "$TIMES" | tail -1)
    P95_LINE=$(echo "$TIMES" | awk 'END {printf "%.0f", NR*0.95}')
    P95_MS=$(echo "$TIMES" | sed -n "${P95_LINE}p")
    MEDIAN_LINE=$(echo "$TIMES" | awk 'END {printf "%.0f", NR/2}')
    MEDIAN_MS=$(echo "$TIMES" | sed -n "${MEDIAN_LINE}p")
else
    AVG_MS=0; MIN_MS=0; MAX_MS=0; P95_MS=0; MEDIAN_MS=0
fi

TOTAL_TIME_S=$(echo "scale=2; $TOTAL_TIME / 1000" | bc 2>/dev/null || echo "?")
AVG_S=$(echo "scale=2; $AVG_MS / 1000" | bc 2>/dev/null || echo "?")
MIN_S=$(echo "scale=2; $MIN_MS / 1000" | bc 2>/dev/null || echo "?")
MAX_S=$(echo "scale=2; $MAX_MS / 1000" | bc 2>/dev/null || echo "?")
P95_S=$(echo "scale=2; ${P95_MS:-0} / 1000" | bc 2>/dev/null || echo "?")
MEDIAN_S=$(echo "scale=2; ${MEDIAN_MS:-0} / 1000" | bc 2>/dev/null || echo "?")

# Throughput
if [ "$TOTAL_TIME" -gt 0 ]; then
    THROUGHPUT=$(echo "scale=1; $TOTAL_OK * 60000 / $TOTAL_TIME" | bc 2>/dev/null || echo "?")
else
    THROUGHPUT="?"
fi

# Resumen visual
cat << SUMMARY

  ╔═══════════════════════════════════════════════════════════════╗
  ║           SETEX FACTURAS — INFORME DE STRESS TEST            ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  ENTORNO:                                                     ║
  ║    Servidor:    KVM 2 (2 vCPU, 8 GB RAM)                     ║
  ║    OCR Engine:  OpenAI GPT-4.1 (json_schema strict)          ║
  ║    Backend:     Node.js 20 (Docker, 0.5 CPU, 512 MB)         ║
  ║    Concurrencia Worker:  2 (BullMQ)                          ║
  ║                                                               ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  CONFIGURACION DEL TEST:                                      ║
  ║    Facturas enviadas:    $TOTAL
  ║    Concurrencia:         $CONCURRENCY
  ║    Tiempo total:         ${TOTAL_TIME_S}s
  ║                                                               ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  RESULTADOS:                                                  ║
  ║    Exitosas (OK):        $TOTAL_OK
  ║    Duplicadas:           $TOTAL_DUP
  ║    Campos faltantes:     $TOTAL_MIS
  ║    Errores:              $TOTAL_ERR
  ║    Tasa de exito:        $(echo "scale=0; $TOTAL_OK * 100 / ($TOTAL_OK + $TOTAL_ERR + 1)" | bc 2>/dev/null || echo "?")%
  ║                                                               ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  LATENCIA (por factura):                                      ║
  ║    Minima:               ${MIN_S}s
  ║    Media:                ${AVG_S}s
  ║    Mediana:              ${MEDIAN_S}s
  ║    P95:                  ${P95_S}s
  ║    Maxima:               ${MAX_S}s
  ║                                                               ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  THROUGHPUT:                                                  ║
  ║    Facturas OK/minuto:   ${THROUGHPUT}
  ║                                                               ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  PROYECCION (basado en resultados):                           ║
  ║    50 facturas:          ~$(echo "scale=0; 50 * $AVG_MS / 1000 / $CONCURRENCY" | bc 2>/dev/null || echo "?")s
  ║    100 facturas:         ~$(echo "scale=0; 100 * $AVG_MS / 1000 / $CONCURRENCY" | bc 2>/dev/null || echo "?")s
  ║    500 facturas (trim):  ~$(echo "scale=0; 500 * $AVG_MS / 1000 / $CONCURRENCY / 60" | bc 2>/dev/null || echo "?") min
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝

SUMMARY

# Guardar resumen a archivo
cat << EOF > "$SUMMARY_FILE"
SETEX FACTURAS — STRESS TEST RESULTS
Date: $(date -Iseconds)
==============================================

Test Configuration:
  Total invoices:  $TOTAL
  Concurrency:     $CONCURRENCY
  Total time:      ${TOTAL_TIME_S}s

Results:
  OK:              $TOTAL_OK
  Duplicates:      $TOTAL_DUP
  Missing fields:  $TOTAL_MIS
  Errors:          $TOTAL_ERR

Latency (per invoice):
  Min:     ${MIN_S}s
  Avg:     ${AVG_S}s
  Median:  ${MEDIAN_S}s
  P95:     ${P95_S}s
  Max:     ${MAX_S}s

Throughput:
  OK invoices/min: ${THROUGHPUT}

Raw data: $RESULTS_FILE
EOF

echo -e "  ${GREEN}Datos guardados en:${NC}"
echo "    CSV:     $RESULTS_FILE"
echo "    Resumen: $SUMMARY_FILE"
echo ""

# ── Monitoreo de memoria ────────────────────────────────────────────────────
echo -e "  ${BOLD}── ESTADO DEL SERVIDOR POST-TEST ──${NC}\n"
free -h | head -3
echo ""
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" 2>/dev/null | grep -E "NAME|setex"
echo ""
