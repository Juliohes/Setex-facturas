#!/usr/bin/env bash
# SETEX · staging-watch.sh — vigilancia ligera de staging cada N min/horas.
#
# Objetivo: durante la ventana de validación FASE 1B Etapa 5 (24-48h tras swap
# o cambios de develop), detectar regresiones SIN ruido. Una sola línea de log
# por ejecución cuando todo va bien; alarma multi-línea cuando algo se rompe.
#
# Hace 4 verificaciones (~5s):
#   1. docker ps · todos los containers setex-staging-* están "Up ... (healthy)"
#   2. smoke-test-http.sh · 3/3 rutas críticas responden el código esperado
#   3. backend logs grep · sin nuevas líneas con `level":"error"` en últimos 5min
#   4. uptime backend container · si reinició recientemente (<10min) marca aviso
#
# Salida:
#   stdout: una línea de resumen estilo "[OK 17:42:13] up=1m smoke=3/3 errors=0"
#   stderr: solo cuando algo falla (cron envía mail de stderr no-vacío al deploy)
#   exit:   0 si todo OK, 1 si algún check rojo
#
# Uso:
#   ./scripts/staging-watch.sh                    (manual, vuelca a stdout)
#   * 0 * * * * deploy /opt/setex/staging/scripts/staging-watch.sh \
#       >> /opt/setex/staging/logs/staging-watch.log 2>&1   (cron horario)
#
# Pensado para ejecutarse desde el HOST (necesita acceso a docker socket).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/paths.sh
source "${SCRIPT_DIR}/lib/paths.sh"

# Forzar staging incluso si lo ejecutáramos accidentalmente desde prod.
if [ "${SETEX_ENV}" != "staging" ]; then
  echo "[staging-watch] solo para staging — actual: ${SETEX_ENV}" >&2
  exit 1
fi

TS="$(date '+%H:%M:%S')"
ALARMS=()

# ── 1. Containers healthy ──────────────────────────────────────────────────
unhealthy=$(docker ps --filter 'name=setex-staging-' --format '{{.Names}} {{.Status}}' \
  | grep -v 'healthy' | grep -v '^$' || true)
if [ -n "$unhealthy" ]; then
  ALARMS+=("containers no healthy:")
  while IFS= read -r line; do ALARMS+=("  $line"); done <<<"$unhealthy"
fi

# ── 2. Smoke HTTP shape ────────────────────────────────────────────────────
smoke_out=$("${SCRIPT_DIR}/smoke-test-http.sh" 2>&1) || true
smoke_pass=$(echo "$smoke_out" | grep -c '^\[smoke\] OK   ' || true)
smoke_fail=$(echo "$smoke_out" | grep -c '^\[smoke\] FAIL' || true)
if [ "$smoke_fail" -gt 0 ] || [ "$smoke_pass" -lt 3 ]; then
  ALARMS+=("smoke fallido (pass=${smoke_pass} fail=${smoke_fail}):")
  while IFS= read -r line; do ALARMS+=("  $line"); done <<<"$smoke_out"
fi

# ── 3. Backend errors recientes (últimos 5min) ─────────────────────────────
errors_5m=$(docker logs --since 5m "${CONTAINER_BE}" 2>&1 \
  | grep -c '"level":"error"' || true)

if [ "$errors_5m" -gt 0 ]; then
  ALARMS+=("backend reportó ${errors_5m} errores en últimos 5min:")
  while IFS= read -r line; do
    ALARMS+=("  $line")
  done < <(docker logs --since 5m "${CONTAINER_BE}" 2>&1 | grep '"level":"error"' | head -5)
fi

# ── 4. Backend uptime (aviso si <10min) ────────────────────────────────────
started_at=$(docker inspect "${CONTAINER_BE}" --format '{{.State.StartedAt}}' 2>/dev/null || echo "")
uptime_human="?"
if [ -n "$started_at" ]; then
  started_ts=$(date -d "$started_at" +%s 2>/dev/null || echo 0)
  now_ts=$(date +%s)
  if [ "$started_ts" -gt 0 ]; then
    diff=$((now_ts - started_ts))
    if [ "$diff" -lt 600 ]; then
      ALARMS+=("backend reinició hace ${diff}s — investigar")
      uptime_human="${diff}s"
    elif [ "$diff" -lt 3600 ]; then
      uptime_human="$((diff / 60))m"
    elif [ "$diff" -lt 86400 ]; then
      uptime_human="$((diff / 3600))h"
    else
      uptime_human="$((diff / 86400))d"
    fi
  fi
fi

# ── Resultado ──────────────────────────────────────────────────────────────
if [ "${#ALARMS[@]}" -eq 0 ]; then
  echo "[OK $TS] up=${uptime_human} smoke=${smoke_pass}/3 errors_5m=${errors_5m}"
  exit 0
fi

# Alarma: dump completo a stderr (cron lo manda por email)
{
  echo "[ALARM $TS] staging-watch detectó problemas:"
  for a in "${ALARMS[@]}"; do echo "  $a"; done
  echo
  echo "Estado actual:"
  docker ps --filter 'name=setex-staging-' --format '  {{.Names}}: {{.Status}}'
  echo
  echo "Últimas 20 líneas backend logs:"
  docker logs --tail 20 "${CONTAINER_BE}" 2>&1 | sed 's/^/  /'
} >&2
exit 1
