# Status — Estado Completo del Sistema SETEX

Muestra un diagnóstico completo y visual del sistema. Ejecuta TODOS los checks en paralelo y presenta un informe estructurado.

## Checks a ejecutar

### 1. Contenedores Docker
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}\t{{.Ports}}" 2>/dev/null
```

### 2. RAM y Swap
```bash
free -h
```

### 3. Disco
```bash
df -h /opt/setex-captu-facture
du -sh /opt/setex-captu-facture/data/uploads/ 2>/dev/null
du -sh /opt/setex-captu-facture/data/redis/ 2>/dev/null
```

### 4. Redis — estado y queue
```bash
docker exec setex-redis redis-cli PING 2>/dev/null
docker exec setex-redis redis-cli INFO memory 2>/dev/null | grep -E "used_memory_human|mem_fragmentation"
docker exec setex-redis redis-cli LLEN bull:n8n-send:wait 2>/dev/null
docker exec setex-redis redis-cli LLEN bull:n8n-send:active 2>/dev/null
docker exec setex-redis redis-cli KEYS "bull:n8n-send:failed:*" 2>/dev/null | wc -l
```

### 5. PostgreSQL — facturas
```bash
docker exec setex-postgres psql -U postgres -d facturas -c \
  "SELECT
    COUNT(*) as total,
    SUM(CASE WHEN n8n_sent=true THEN 1 ELSE 0 END) as procesadas,
    SUM(CASE WHEN n8n_sent=false THEN 1 ELSE 0 END) as pendientes,
    MAX(created_at) as ultima_subida
  FROM uploads;" 2>/dev/null
```

### 6. OCR engine activo
```bash
cat /opt/setex-captu-facture/app/backend/src/config/features.json 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('Motor OCR:', d.get('ocr_primary_engine','?'), '| n8n:', d.get('use_n8n','?'))"
```

### 7. Últimas 5 líneas de logs relevantes
```bash
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=5 backend 2>/dev/null | grep -E "ERROR|WARN|Worker|OCR|Redis|upload"
```

### 8. Archivos en uploads (orfandos potenciales)
```bash
find /opt/setex-captu-facture/data/uploads -type f 2>/dev/null | wc -l
find /opt/setex-captu-facture/data/uploads -type f -mmin +60 2>/dev/null | wc -l
```

### 9. Verificación de permisos (CRÍTICO — causa de caídas pasadas)
```bash
echo "redis:    UID=$(stat -c '%u' /opt/setex-captu-facture/data/redis/) esperado=999"
echo "postgres: UID=$(stat -c '%u' /opt/setex-captu-facture/data/postgres/) esperado=70"
echo "uploads:  UID=$(stat -c '%u' /opt/setex-captu-facture/data/uploads/) esperado=1001"
echo "logs:     UID=$(stat -c '%u' /opt/setex-captu-facture/logs/) esperado=1001"
```

### 10. Watchdog — últimas alertas
```bash
tail -20 /opt/setex-captu-facture/logs/watchdog-alerts.log 2>/dev/null || echo "sin alertas registradas"
```

## Formato del informe final

Presenta los resultados así:

```
═══════════════════════════════════════════════════
  SETEX — Estado del sistema  [FECHA Y HORA]
═══════════════════════════════════════════════════

CONTENEDORES
  setex-postgres   ✅/❌  [estado]
  setex-backend    ✅/❌  [estado]
  setex-redis      ✅/❌  [estado]
  setex-frontend   ✅/❌  [estado] ← ⚠️ si unhealthy, indicarlo

SISTEMA
  RAM: X.X GB usados / 8 GB total
  Disco: X GB usados / 96 GB total
  Swap: X MB usados / 4 GB total

REDIS
  Ping: PONG / ERROR
  Jobs en cola (wait): X
  Jobs activos: X
  Jobs fallidos: X
  ⚠️ MISCONF error: SÍ/NO

BASE DE DATOS
  Facturas totales: X
  Procesadas (Drive+Sheets): X
  Pendientes: X
  Última subida: FECHA

OCR
  Motor activo: openai/azure/gemini
  Modo envío: directo Google APIs / n8n webhook

ALERTAS ACTIVAS
  [lista de problemas encontrados con severidad]
═══════════════════════════════════════════════════
```

Si hay alertas críticas → propón el fix inmediato al final del informe.
