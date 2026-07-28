# ROLLBACK — Pipeline OCR v2 (PROMPT-PIPELINE-OCR-FACTURAS-V2.md)

> Fase 10.4 del prompt de migración. Procedimiento de reversión para cada capa
> añadida durante la migración a `feature/ocr-pipeline-v2`. El pipeline v1
> (`ocr/index.js`) es la ruta real por defecto en TODO momento — nada de lo
> descrito aquí cambia el comportamiento de producción salvo que se active
> explícitamente el modo sombra.

## Rollback instantáneo (sin redeploy) — el caso normal

Todos los interruptores viven en `features.json`, que se lee en caliente
(sin rebuild ni restart, regla 4 del `CLAUDE.md` del proyecto):

```bash
# Apagar el modo sombra del pipeline v2 (deja de ejecutarse en cada factura)
# Editar app/backend/src/config/features.json:
"ocr_extraccion_v2_shadow_mode": false

# Apagar el pipeline v2 por completo (cualquier código que lo consulte deja de activarse)
"ocr_extraccion_v2_enabled": false

# Volver a bloqueo si se hubiera activado el quality gate de verdad (Fase 3)
"ocr_extraccion_v2_quality_gate_blocking": false
```

Efecto: inmediato, sin reiniciar contenedores. El pipeline v1 sigue siendo
la única ruta real — el modo sombra solo calcula y guarda en
`extracciones_v2`, nunca decide la respuesta al usuario.

## Rollback de código (si hiciera falta revertir el deploy del backend)

```bash
cd /opt/setex/prod/app
docker compose build backend    # con el commit anterior a la Fase X que se quiera revertir
docker compose stop backend
docker compose up -d backend
./scripts/health-check.sh
```

Como todo el código del pipeline v2 vive en `src/pipeline/*.js` (módulos
nuevos, aislados) y las únicas conexiones al flujo real son bloques
`try {} catch` fire-and-forget en `server.js`, revertir un commit de esta
rama nunca afecta rutas ni comportamiento de v1.

## Rollback de base de datos

La única migración de esquema de esta migración es la tabla
`extracciones_v2` (Fase 8), 100% aditiva. Script de rollback:

```bash
# REQUIERE confirmación explícita antes de ejecutar contra producción
docker exec -i <contenedor_postgres> psql -U <usuario> -d <bd> \
  < scripts/rollback/2026-07-27-extracciones-v2-down.sql
```

Elimina únicamente `extracciones_v2` y sus índices. Ninguna tabla existente
(`uploads`, `ocr_benchmark_resultados`, `ocr_shadow_validaciones`, etc.) se
toca.

## Inventario de lo que se puede revertir, capa por capa

| Fase | Qué revertir | Cómo |
|---|---|---|
| 1 | Flags `ocr_extraccion_v2_*` | Poner todos a `false`/`[]` en `features.json` |
| 2 | Clasificador PDF (`pipeline/ingest.js`) | No conectado al flujo real — nada que revertir en caliente |
| 3 | Quality gate sombra | `ocr_extraccion_v2_shadow_mode: false` (deja de calcularse) |
| 4 | Extractores + reintentos | No conectado salvo vía el orquestador (Fase 10) |
| 5 | Árbitro por campo | Igual — solo se ejecuta dentro del orquestador |
| 6 | Validadores fiscales | Ya existían antes de esta migración — no aplica |
| 7 | Bounding boxes en `ocr/azure.js` | Campo aditivo (`bounding_boxes`) — revertir requiere un commit de código (ver sección de rollback de código), no hay flag |
| 8 | Tabla + endpoints `/api/v2/facturas/:id/extraccion` | Endpoints nuevos, no interceptan nada — dejar de llamarlos basta; tabla con rollback SQL arriba |
| 9 | Logs + `/api/v2/metricas` | Mismo caso — endpoint nuevo, sin efecto en v1 |
| 10 | Orquestador + conexión en `upload-confirm` | `ocr_extraccion_v2_shadow_mode: false` — rollback instantáneo, es el ÚNICO punto de conexión real con el tráfico de facturas |
| Gaps 2026-07-28 | Columna `extracciones_v2.modo` + PATCH endurecido + replay | Columna: `scripts/rollback/2026-07-28-extracciones-v2-modo-down.sql`. PATCH/replay son código nuevo aislado, sin flag propio — ver `docs/ocr-v2/DESPLIEGUE-Y-ACTIVACION.md` |

## Qué NO requiere rollback nunca

- `ocr/index.js`, `ocr/openai.js`, `ocr/gemini.js`, `ocr/mistral.js`: sin
  cambios en toda la migración (excepto la línea aditiva de `bounding_boxes`
  en `azure.js`, Fase 7 — no afecta ningún valor de `campos`).
- `domain/routing.js`, `domain/validators/*`: sin cambios, siguen siendo la
  fuente de verdad de v1.
- Ningún endpoint existente (`/api/upload-preview`, `/api/upload-confirm`,
  `/api/admin/facturas/*`, etc.) cambió de firma, ruta ni contrato de
  respuesta.
