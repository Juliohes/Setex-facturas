# Feature — Nueva Funcionalidad para SETEX

Protocolo completo para implementar una nueva feature en SETEX sin romper lo que ya funciona.

## Feature a implementar

$ARGUMENTS

## Regla de oro de SETEX

**La app está en producción. Cualquier cambio que rompa auth, uploads o el worker es inaceptable.**
Cada feature nueva debe ser aditiva, no destructiva.

## PASO 1 — Análisis de impacto

Lee estos archivos ANTES de escribir una sola línea:
- `/opt/setex-captu-facture/app/backend/src/server.js` (lógica principal)
- `/opt/setex-captu-facture/app/backend/src/config/features.json` (toggles)
- `/opt/setex-captu-facture/app/frontend/src/app.js` (frontend)
- `/opt/setex-captu-facture/app/docker-compose.yml` (si toca infraestructura)

Identifica:
- ¿Qué archivos hay que modificar?
- ¿Requiere nueva tabla en PostgreSQL?
- ¿Requiere nuevo secreto/env var?
- ¿Afecta al flujo de upload (el más crítico)?
- ¿Requiere rebuild del backend o solo cambio en features.json?

## PASO 2 — Plan detallado

Presenta el plan ANTES de implementar:
1. Lista de archivos a crear/modificar
2. Schema SQL si hay cambios en BD (con rollback)
3. Nuevas rutas de API (método, path, auth requerida)
4. Cambios en frontend
5. Toggle en features.json si la feature debe ser activable/desactivable

Espera aprobación de Julio antes de continuar.

## PASO 3 — Implementación

Sigue este orden:
1. Primero: migraciones de BD (si las hay)
2. Segundo: nuevos archivos de servicio (en `src/services/` o `src/routes/`)
3. Tercero: integración en `server.js` (mínimos cambios, solo `require` y rutas)
4. Cuarto: cambios en frontend (actualizar cache-buster en `index.html`)
5. Último: actualizar `features.json` si aplica

## PASO 4 — Seguridad

Para cualquier nueva ruta de API, verificar:
- ¿Requiere `authenticateToken` middleware?
- ¿Requiere validación de admin (ADMIN_EMAILS)?
- ¿Valida y sanitiza todos los inputs del usuario?
- ¿Expone datos sensibles en la respuesta?
- ¿Tiene rate limiting apropiado?

## PASO 5 — Testing

```bash
# Después de implementar:
# 1. Rebuild
cd /opt/setex-captu-facture/app && docker compose build backend

# 2. Deploy
docker compose stop backend && docker compose up -d backend

# 3. Verificar que no hay errores de arranque
sleep 5 && docker compose logs --tail=20 backend

# 4. Test de la nueva feature
# [comandos específicos de test según la feature]

# 5. Verificar que lo anterior sigue funcionando
# - Auth: login sigue funcionando
# - Upload: una factura sube y procesa correctamente
```

## Estándares de calidad no negociables

- Manejo de errores explícito (nunca try/catch vacío)
- Logs en operaciones importantes: `logger.info/warn/error`
- Código completo, nunca "..." ni partes omitidas
- Si hay cambio de BD → script de migración + script de rollback
- Cache-buster en `index.html` si hay cambios en JS/CSS frontend

## Contexto de arquitectura

- Backend: Express en Node.js 20, puerto 3000
- Auth: JWT en header `Authorization: Bearer TOKEN`
- Logger: `const logger = require('./logger')` o `console.log` si logger no existe
- Secrets: en `/run/secrets/nombre_secret`
- Uploads temporales: `/app/uploads/` (dentro del contenedor)
- BullMQ queue name: `n8n-send`
- features.json: volume-mounted, cambios en caliente sin rebuild
