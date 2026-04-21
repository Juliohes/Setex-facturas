#!/bin/bash
set -euo pipefail

# ============================================
# SETEX Facturas - Gestion de Whitelist
# ============================================
# Uso:
#   ./manage-whitelist.sh add email@ejemplo.com ["Nota opcional"]
#   ./manage-whitelist.sh remove email@ejemplo.com
#   ./manage-whitelist.sh list
#   ./manage-whitelist.sh check email@ejemplo.com
#   ./manage-whitelist.sh import-existing
# ============================================

# ── Fuente única de rutas, contenedores y dominio ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

CONTAINER="${CONTAINER_PG}"
DB="${PG_DB}"
USER="${PG_USER}"

run_sql() {
    docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -t -c "$1"
}

case "${1:-help}" in
    add)
        EMAIL="${2:?Error: Especifica un email}"
        NOTES="${3:-}"
        run_sql "INSERT INTO allowed_emails (email, notes) VALUES (LOWER('$EMAIL'), '$NOTES') ON CONFLICT (email) DO UPDATE SET notes = EXCLUDED.notes;"
        echo "Email anadido a la whitelist: $EMAIL"
        ;;
    remove)
        EMAIL="${2:?Error: Especifica un email}"
        run_sql "DELETE FROM allowed_emails WHERE LOWER(email) = LOWER('$EMAIL');"
        echo "Email eliminado de la whitelist: $EMAIL"
        ;;
    list)
        echo "=== Emails autorizados ==="
        run_sql "SELECT email, notes, added_at FROM allowed_emails ORDER BY added_at;"
        ;;
    check)
        EMAIL="${2:?Error: Especifica un email}"
        RESULT=$(run_sql "SELECT COUNT(*) FROM allowed_emails WHERE LOWER(email) = LOWER('$EMAIL');")
        if [ "$(echo $RESULT | tr -d ' ')" -gt 0 ]; then
            echo "El email $EMAIL SI esta en la whitelist"
        else
            echo "El email $EMAIL NO esta en la whitelist"
        fi
        ;;
    import-existing)
        echo "Importando usuarios ya registrados a la whitelist..."
        run_sql "INSERT INTO allowed_emails (email, notes) SELECT LOWER(email), 'Importado desde usuarios existentes' FROM users ON CONFLICT (email) DO NOTHING;"
        echo "Usuarios existentes importados. Lista actual:"
        run_sql "SELECT email, notes, added_at FROM allowed_emails ORDER BY added_at;"
        ;;
    help|*)
        echo "Uso: $0 {add|remove|list|check|import-existing} [email] [notas]"
        echo ""
        echo "Comandos:"
        echo "  add <email> [notas]  - Anadir email a la whitelist"
        echo "  remove <email>       - Eliminar email de la whitelist"
        echo "  list                 - Listar todos los emails autorizados"
        echo "  check <email>        - Verificar si un email esta autorizado"
        echo "  import-existing      - Importar todos los usuarios ya registrados"
        echo ""
        echo "Ejemplos:"
        echo "  $0 add juan@empresa.com 'Departamento contabilidad'"
        echo "  $0 remove ex-empleado@empresa.com"
        echo "  $0 list"
        echo "  $0 import-existing"
        ;;
esac
