#!/bin/bash
# watchdog.sh — Vigilante automático de SETEX
# Ejecuta cada 5 minutos via cron.
# Verifica permisos, servicios y capacidad de escritura real.
# Si algo falla: lo repara automáticamente y registra el incidente.

set -uo pipefail

BASE=/opt/setex/prod
COMPOSE="docker compose -f $BASE/app/docker-compose.yml"
LOG="$BASE/logs/watchdog.log"
ALERT_LOG="$BASE/logs/watchdog-alerts.log"
MAX_LOG_MB=10

# Truncar log si supera 10 MB
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt $((MAX_LOG_MB * 1024 * 1024)) ]; then
  tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

log()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }
alert() {
  local msg="$*"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  ALERTA: $msg" >> "$ALERT_LOG"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  ALERTA: $msg" >> "$LOG"
}
ok()    { log "✅ $*"; }
fix()   { log "🔧 FIX: $*"; }

ISSUES=0

# ── 1. PERMISOS ──────────────────────────────────────────────────────────────
check_perm() {
  local dir="$1" uid="$2" label="$3"
  [ -d "$dir" ] || return
  local cur
  cur=$(stat -c '%u' "$dir" 2>/dev/null)
  if [ "$cur" != "$uid" ]; then
    alert "$label tiene UID $cur (esperado $uid) — corrigiendo"
    chown -R "$uid:$uid" "$dir"
    ISSUES=$((ISSUES + 1))
    fix "$label permisos restaurados a UID $uid"
  fi
}

check_perm "$BASE/data/redis"    "999"  "Redis data"
check_perm "$BASE/data/postgres" "70"   "PostgreSQL data"
check_perm "$BASE/data/uploads"  "1001" "Backend uploads"
check_perm "$BASE/logs"          "1001" "Logs dir"

# ── 2. REDIS: test de escritura real ─────────────────────────────────────────
if ! docker exec setex-redis redis-cli SET watchdog_check "ok" > /dev/null 2>&1; then
  alert "Redis NO puede escribir — MISCONF o caído"
  ISSUES=$((ISSUES + 1))
  # Intentar restart
  $COMPOSE restart redis >> "$LOG" 2>&1 && sleep 5
  fix "Redis reiniciado"
else
  docker exec setex-redis redis-cli DEL watchdog_check > /dev/null 2>&1
  ok "Redis escribe correctamente"
fi

# ── 3. POSTGRES: query real ───────────────────────────────────────────────────
if ! docker exec setex-postgres psql -U setex_user -d setex_db -c "SELECT 1;" > /dev/null 2>&1; then
  alert "PostgreSQL NO responde a queries — posible problema de permisos o crash"
  ISSUES=$((ISSUES + 1))
  $COMPOSE restart postgres >> "$LOG" 2>&1 && sleep 10
  fix "PostgreSQL reiniciado"
else
  ok "PostgreSQL responde"
fi

# ── 4. BACKEND: health check real ────────────────────────────────────────────
BACKEND_STATUS=$(docker inspect --format='{{.State.Health.Status}}' setex-backend 2>/dev/null || echo "unknown")
if [ "$BACKEND_STATUS" != "healthy" ]; then
  alert "Backend status: $BACKEND_STATUS — reiniciando"
  ISSUES=$((ISSUES + 1))
  $COMPOSE stop backend >> "$LOG" 2>&1
  sleep 3
  $COMPOSE up -d backend >> "$LOG" 2>&1
  sleep 10
  fix "Backend reiniciado"
else
  ok "Backend healthy"
fi

# ── 5. FRONTEND: acceso real ─────────────────────────────────────────────────
FRONTEND_STATUS=$(docker inspect --format='{{.State.Health.Status}}' setex-frontend 2>/dev/null || echo "unknown")
if [ "$FRONTEND_STATUS" != "healthy" ]; then
  # Verificar si nginx realmente sirve (puede ser falso positivo IPv6)
  if ! docker exec setex-frontend wget -qO- http://127.0.0.1/health > /dev/null 2>&1; then
    alert "Frontend no responde — reiniciando"
    ISSUES=$((ISSUES + 1))
    $COMPOSE restart frontend >> "$LOG" 2>&1
    fix "Frontend reiniciado"
  else
    ok "Frontend sirve (healthcheck tiene falso positivo IPv6 — ignorado)"
  fi
else
  ok "Frontend healthy"
fi

# ── 6. TRAEFIK: acceso HTTPS externo ─────────────────────────────────────────
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" https://xanflatest.com/ --max-time 10 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "000" ]; then
  alert "xanflatest.com no responde (timeout) — revisar Traefik"
  ISSUES=$((ISSUES + 1))
elif [ "$HTTP_CODE" -ge 500 ] 2>/dev/null; then
  alert "xanflatest.com devuelve HTTP $HTTP_CODE"
  ISSUES=$((ISSUES + 1))
else
  ok "xanflatest.com responde HTTP $HTTP_CODE"
fi

# ── 7. DISCO: alerta si > 80% ────────────────────────────────────────────────
DISK_USE=$(df / --output=pcent | tail -1 | tr -d ' %')
if [ "$DISK_USE" -gt 80 ]; then
  alert "Disco al ${DISK_USE}% — limpiar logs o uploads antiguos"
  ISSUES=$((ISSUES + 1))
else
  ok "Disco al ${DISK_USE}%"
fi

# ── 8. GOOGLE AUTH: detectar invalid_grant en logs recientes ────────────────
if docker compose -f "$BASE/app/docker-compose.yml" logs --tail=50 backend 2>/dev/null | grep -q "invalid_grant"; then
  alert "GOOGLE AUTH: invalid_grant detectado — token OAuth2 expirado o revocado"
  alert "ACCIÓN REQUERIDA: docker exec -it setex-backend node /app/renew-oauth2-interactive.js"
  ISSUES=$((ISSUES + 1))
else
  ok "Google Auth: sin errores invalid_grant"
fi

# ── 9. RAM: alerta si > 90% ──────────────────────────────────────────────────
RAM_AVAIL=$(free | awk '/^Mem:/ {printf "%.0f", $7/$2*100}')
if [ "$RAM_AVAIL" -lt 10 ]; then
  alert "RAM disponible < 10% (disponible: ${RAM_AVAIL}%) — riesgo de OOM"
  ISSUES=$((ISSUES + 1))
else
  ok "RAM disponible ${RAM_AVAIL}%"
fi

# ── RESUMEN ───────────────────────────────────────────────────────────────────
if [ "$ISSUES" -gt 0 ]; then
  alert "Ciclo completado con $ISSUES problema(s) detectado(s)/corregido(s)"
else
  log "✅ Sistema OK — sin problemas detectados"
fi
