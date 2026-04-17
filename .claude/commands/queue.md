# Queue — Gestión de la Cola BullMQ

Monitorea y gestiona la cola de procesamiento de facturas (BullMQ + Redis).

## Qué hacer

$ARGUMENTS

Sin argumentos → muestra el estado completo de la cola.

## Estado completo de la cola

```bash
echo "=== ESTADO COLA BullMQ ==="

echo "--- Jobs por estado ---"
docker exec setex-redis redis-cli LLEN bull:n8n-send:wait 2>/dev/null | xargs echo "  Esperando:"
docker exec setex-redis redis-cli LLEN bull:n8n-send:active 2>/dev/null | xargs echo "  Activos:"
docker exec setex-redis redis-cli LLEN bull:n8n-send:delayed 2>/dev/null | xargs echo "  Retrasados:"
docker exec setex-redis redis-cli KEYS "bull:n8n-send:failed:*" 2>/dev/null | wc -l | xargs echo "  Fallidos:"
docker exec setex-redis redis-cli KEYS "bull:n8n-send:completed:*" 2>/dev/null | wc -l | xargs echo "  Completados (cache 1h):"

echo "--- Redis estado ---"
docker exec setex-redis redis-cli PING
docker exec setex-redis redis-cli INFO memory | grep used_memory_human

echo "--- Facturas pendientes en BD ---"
docker exec setex-postgres psql -U postgres -d facturas -c \
  "SELECT COUNT(*) as pendientes FROM uploads WHERE n8n_sent=false;" 2>/dev/null
```

## Acciones disponibles

### `failed` — Ver jobs fallidos en detalle
```bash
docker exec setex-redis redis-cli KEYS "bull:n8n-send:failed:*" 2>/dev/null | while read key; do
  echo "=== $key ==="
  docker exec setex-redis redis-cli HGET "$key" "failedReason" 2>/dev/null
  docker exec setex-redis redis-cli HGET "$key" "data" 2>/dev/null | python3 -m json.tool 2>/dev/null | head -10
done
```

### `retry` — Reintentar todos los jobs fallidos
⚠️ Confirmar con Julio antes de ejecutar en producción.
El worker de BullMQ reintenta automáticamente (3 intentos, backoff exponencial).
Para forzar reintento manual:
```bash
# Ver IDs de jobs fallidos
docker exec setex-redis redis-cli KEYS "bull:n8n-send:failed:*"
# El worker con attempts:3 ya los reintenta solo. Si están permanentemente fallidos,
# investigar la causa raíz antes de reintentar.
```

### `clear-completed` — Limpiar jobs completados
BullMQ limpia automáticamente los completados tras 1 hora (removeOnComplete: age 3600).
Si se acumulan demasiados:
```bash
docker exec setex-redis redis-cli KEYS "bull:n8n-send:completed:*" | wc -l
```

### `watch` — Monitorear en tiempo real
```bash
# Ver logs del worker en tiempo real
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs -f backend 2>&1 | \
  grep -iE --line-buffered "worker|job|queue|completed|failed|drive|sheets"
```

## Diagnóstico de jobs atascados

Si hay jobs en `active` que no avanzan (worker colgado):
1. Ver cuánto tiempo llevan activos
2. Si más de 5 minutos → el worker puede estar colgado
3. Fix: `docker compose -f /opt/setex-captu-facture/app/docker-compose.yml restart backend`
4. El job volverá a `wait` automáticamente tras el restart

## Facturas sin procesar en BD

Si `n8n_sent=false` tiene facturas y la cola está vacía → las facturas están en BD pero no en la cola (se perdió el job):
```bash
docker exec setex-postgres psql -U postgres -d facturas -c \
  "SELECT id, user_id, file_name, proveedor_nif, total_factura, created_at
   FROM uploads WHERE n8n_sent=false ORDER BY created_at ASC;"
```
En este caso → hay que re-encolar manualmente (requiere intervención en el código o endpoint admin).
Reporta el problema a Julio con la lista de facturas afectadas.
