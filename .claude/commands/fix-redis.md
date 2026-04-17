# Fix Redis — Diagnóstico y Reparación

Diagnostica y resuelve el problema de Redis en SETEX. El síntoma conocido es:
`MISCONF Redis is configured to save RDB snapshots, but it's currently unable to persist to disk`

Esto bloquea BullMQ → las facturas suben pero NO llegan a Google Drive ni Sheets.

## FASE 1 — Diagnóstico completo (no toques nada aún)

```bash
# 1. Estado actual de Redis
docker exec setex-redis redis-cli PING
docker exec setex-redis redis-cli CONFIG GET dir
docker exec setex-redis redis-cli CONFIG GET dbfilename
docker exec setex-redis redis-cli LASTSAVE

# 2. Espacio en disco del volumen Redis
docker exec setex-redis df -h /data
ls -lah /opt/setex-captu-facture/data/redis/ 2>/dev/null

# 3. Permisos del directorio Redis
stat /opt/setex-captu-facture/data/redis/ 2>/dev/null

# 4. Logs del contenedor Redis (últimos 30 líneas)
docker logs setex-redis --tail=30

# 5. Jobs atascados en cola
docker exec setex-redis redis-cli LLEN bull:n8n-send:wait
docker exec setex-redis redis-cli LLEN bull:n8n-send:active
docker exec setex-redis redis-cli KEYS "bull:n8n-send:failed:*" | wc -l
```

## FASE 2 — Identificar causa raíz

Analiza los resultados anteriores y determina cuál es el caso:

**Caso A: Disco lleno** → `df -h` muestra 100% o cerca
- Acción: `find /opt/setex-captu-facture/data -name "*.log" -size +100M`
- Acción: limpiar logs antiguos de backend/redis
- NO borrar datos sin confirmación de Julio

**Caso B: Permisos incorrectos** → directorio redis no pertenece a redis user
- Acción: `chown -R 999:999 /opt/setex-captu-facture/data/redis/`
- Luego: `docker compose -f /opt/setex-captu-facture/app/docker-compose.yml restart redis`

**Caso C: Archivo dump.rdb corrupto** → `docker logs setex-redis` muestra error de parse
- Acción (SOLO si confirmas con Julio): renombrar dump.rdb y dejar que Redis cree uno nuevo

**Caso D: Redis no puede escribir temporalmente** → restart resuelve
- Acción: `docker compose -f /opt/setex-captu-facture/app/docker-compose.yml restart redis`
- Verificar tras 10s: `docker exec setex-redis redis-cli PING`

## FASE 3 — Fix según causa identificada

Aplica SOLO el fix del caso identificado. Confirma ANTES de hacer nada destructivo (borrar datos, rm de archivos).

## FASE 4 — Verificación post-fix

```bash
# Redis responde
docker exec setex-redis redis-cli PING
# → debe devolver PONG

# Redis puede escribir
docker exec setex-redis redis-cli SET test_write "ok"
docker exec setex-redis redis-cli GET test_write
docker exec setex-redis redis-cli DEL test_write
# → debe devolver "ok"

# BullMQ puede encolar
# Verifica en logs del backend que el worker arrancó correctamente
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=20 backend | grep -E "Worker|Redis|Queue"

# Jobs pendientes (facturas que fallaron mientras Redis estaba roto)
docker exec setex-redis redis-cli KEYS "bull:n8n-send:failed:*"
```

## FASE 5 — Reintentar jobs fallidos (si hay facturas atascadas)

Si hay jobs en `failed`, significa que facturas reales no llegaron a Drive/Sheets:

```bash
# Ver cuántos hay
docker exec setex-redis redis-cli KEYS "bull:n8n-send:failed:*" | wc -l

# Para reintentarlos, el worker de BullMQ lo hace automáticamente si está configurado
# O desde el backend: POST /api/admin/retry-failed-jobs (si existe el endpoint)
```

Informa a Julio cuántas facturas estaban pendientes y si se reintentaron correctamente.

## Regla de oro
NUNCA `docker compose down -v` — destruiría los datos de Redis y los jobs pendientes. Solo `restart` o fix de permisos/disco.
