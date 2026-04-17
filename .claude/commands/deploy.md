# Deploy — SETEX Backend

Ejecuta el ciclo completo de deploy del backend. Sigue este orden EXACTO sin saltarte pasos.

## Contexto del proyecto
- Raíz: `/opt/setex-captu-facture/app`
- Backend: Node.js 20 en Docker (setex-backend)
- IMPORTANTE: `docker compose restart` NO recarga env vars ni código nuevo → usar SIEMPRE stop + up
- features.json es volume-mounted → cambios en él NO requieren rebuild

## Qué desplegar

$ARGUMENTS

Si no se especifica qué, pregunta: ¿backend, frontend, ambos, o rebuildeamos todo?

## Proceso obligatorio

### PASO 1 — Estado previo (antes de tocar nada)
```bash
cd /opt/setex-captu-facture/app
docker compose ps
docker compose logs --tail=5 backend
```
Anota el estado. Si hay errores activos, resuélvelos ANTES de continuar.

### PASO 2 — Verificar que no hay cambios peligrosos
Lee los archivos modificados. Si afectan a rutas de auth, DB schema o docker-compose → PARA y avisa a Julio.

### PASO 3 — Build
```bash
cd /opt/setex-captu-facture/app
docker compose build backend
```
Si hay errores de build → muéstralos completos y corrige antes de continuar.

### PASO 4 — Deploy con zero-downtime mínimo
```bash
docker compose stop backend
docker compose up -d backend
```
NO usar `docker compose restart` — no recarga el código nuevo del build.

### PASO 5 — Verificación de arranque (crítico)
```bash
# Esperar 5s y verificar que arrancó bien
sleep 5
docker compose ps backend
docker compose logs --tail=30 backend
```
Busca activamente:
- ✅ "Server running on port 3000"
- ✅ "Database initialized"
- ✅ "Worker started"
- ❌ "Error", "Cannot find module", "ENOENT", "port already in use"

### PASO 6 — Health check
```bash
curl -sf http://localhost:3000/api/health 2>/dev/null || \
  docker exec setex-backend wget -qO- http://localhost:3000/api/health 2>/dev/null || \
  echo "Health endpoint no responde — revisar logs"
```

### PASO 7 — Informe final
Reporta:
- Tiempo total del deploy
- Estado final de todos los contenedores
- Cualquier warning en los logs (aunque no sea error)
- Si Redis sigue con el MISCONF error → indicarlo explícitamente

## Si el deploy falla
NO hagas force-restart ni ignores errores. Analiza los logs completos, identifica la causa raíz y propón solución. Si es un error en el código → corrígelo, luego repite desde PASO 3.
