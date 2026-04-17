#!/bin/bash
# startup.sh — Se ejecuta al arrancar el servidor ANTES de Docker
# Garantiza permisos correctos antes de que los contenedores arranquen
# Registrado como servicio systemd: setex-startup.service

set -uo pipefail
LOG=/opt/setex-captu-facture/logs/startup.log
BASE=/opt/setex-captu-facture

mkdir -p "$BASE/logs" "$BASE/data/redis" "$BASE/data/postgres" "$BASE/data/uploads"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === SETEX STARTUP ===" >> "$LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Corrigiendo permisos antes de iniciar Docker..." >> "$LOG"

chown -R 999:999  "$BASE/data/redis"
chown -R 70:70    "$BASE/data/postgres"
chown -R 1001:1001 "$BASE/data/uploads"
chown -R 1001:1001 "$BASE/logs"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Permisos OK" >> "$LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] === FIN STARTUP ===" >> "$LOG"
