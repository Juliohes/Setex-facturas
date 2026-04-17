# Logs — Ver Logs del Sistema SETEX

Muestra logs filtrados e interpretados del sistema.

## Qué logs mostrar

$ARGUMENTS

Si no se especifica nada, muestra un resumen de todos los servicios con errores destacados.

## Opciones disponibles

Interpreta el argumento y ejecuta el comando correspondiente:

- **`backend`** o **`b`** → logs del backend Node.js
- **`frontend`** o **`f`** → logs del contenedor nginx frontend
- **`redis`** o **`r`** → logs del contenedor Redis
- **`postgres`** o **`db`** → logs de PostgreSQL
- **`worker`** o **`w`** → filtra logs del backend buscando Worker/BullMQ/Queue
- **`ocr`** → filtra logs buscando OCR/GPT/Azure/extractInvoice
- **`errors`** o **`e`** → SOLO errores y warnings de todos los servicios
- **`upload`** o **`u`** → todo lo relacionado con subidas de facturas
- **`all`** o sin argumento → resumen de todos los servicios

## Comandos base

```bash
# Backend (general)
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=50 backend

# Backend (solo errores)
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=100 backend 2>&1 | grep -E "ERROR|Error|WARN|warn|❌|failed|Failed"

# Backend (OCR)
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=100 backend 2>&1 | grep -iE "ocr|gpt|openai|azure|extract|confidence"

# Backend (worker/queue)
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=100 backend 2>&1 | grep -iE "worker|queue|bull|job|redis|drive|sheets"

# Backend (uploads)
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=100 backend 2>&1 | grep -iE "upload|factura|duplicado|processed|n8n_sent"

# Frontend
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=30 frontend

# Redis
docker logs setex-redis --tail=30

# Todos (resumen)
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=20 2>&1
```

## Cómo interpretar

Tras mostrar los logs, analiza y reporta:

1. **Errores críticos**: cualquier `ERROR`, `ECONNREFUSED`, `MISCONF`, `Cannot find module`
2. **Warnings relevantes**: `WARN`, `deprecated`, `timeout`
3. **Estado del worker**: ¿está procesando jobs? ¿hay jobs fallidos?
4. **Rendimiento OCR**: tiempo de procesamiento promedio visible en los logs
5. **Duplicados rechazados**: son normales, no son errores
6. **Redis MISCONF**: si aparece → ejecuta `/fix-redis`

## Logs en tiempo real

Si el usuario quiere seguimiento en tiempo real:
```bash
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs -f backend
```
Indica que puede parar con Ctrl+C.
