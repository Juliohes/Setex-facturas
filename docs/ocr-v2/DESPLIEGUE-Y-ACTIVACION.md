# Despliegue y activación — cierre de gaps del pipeline OCR v2 (2026-07-28)

> Bloque D.6 del plan de cierre. Pasos EXACTOS para Julio. Ni el despliegue
> ni la decisión de activar v2 de verdad los ejecuta Claude Code — son tuyos,
> siguiendo este documento.

## Contexto — qué cambia con este despliegue

El pipeline v2 (10 fases, `PROMPT-PIPELINE-OCR-FACTURAS-V2.md`) ya está en
producción desde el 2026-07-27 en modo sombra. Este despliegue cierra 3
gaps sobre lo ya construido, en vez de reconstruirlo desde cero:

1. `extracciones_v2.modo` — columna nueva (`shadow`/`replay`/`activo`).
2. El `PATCH /api/v2/facturas/:id/extraccion` ahora valida la corrección
   humana (checksum NIF/CIF, coherencia aritmética) antes de aceptarla.
3. Comando de replay (`eval/replay.js`) sobre facturas reales ya
   confirmadas + dataset de verdad verificado por humano (`eval/facturas/`).

`ocr_extraccion_v2_enabled` sigue en `false` — nada de esto cambia lo que
ve el usuario. Es 100% preparación para decidir la activación con datos.

## Paso 1 — Desplegar

```bash
cd /opt/setex/prod/app
docker compose build backend
docker compose stop backend
docker compose up -d backend
../scripts/health-check.sh
```

Verificaciones tras el despliegue:
- [ ] `health-check.sh` → 4/4 healthy.
- [ ] La app responde igual que antes (sube una factura de prueba con el
      botón "🧪 Probar flujo" del panel — no persiste nada).
- [ ] Logs limpios: `docker compose logs --tail=30 backend` sin errores de
      arranque.
- [ ] `GET /api/v2/metricas` responde (con tu token de tech-admin).

## Paso 2 — ⚠️ Volumen para `eval/facturas/` (decisión pendiente)

Durante esta fase se detectó que `/app/eval` **no está montado como
volumen** en `docker-compose.yml` — solo `uploads/`, `logs/` y
`features.json` lo están. El dataset de verdad ya generado (29 facturas
reales, `eval/facturas/{id}/`) se rescató a mano del contenedor al host,
pero **cualquier verificación manual que hagas sobre esos `ground_truth.json`
se perderá en el próximo rebuild** si no se añade un volumen dedicado.

Opción recomendada (requiere tu confirmación explícita — regla 1 del
proyecto, no se toca `docker-compose.yml` sin ella):

```yaml
# En el servicio backend de app/docker-compose.yml, junto a los volúmenes existentes:
- ${SETEX_DATA_DIR}/eval-facturas:/app/eval/facturas
```

Mientras no se añada, antes de cada rebuild:

```bash
docker cp setex-prod-backend:/app/eval/facturas/. /opt/setex/prod/app/backend/eval/facturas/
```

## Paso 3 — Verificar el ground truth (tu tarea, sin prisa)

```bash
docker exec -i setex-prod-backend node < eval/prepare_dataset.js   # ya ejecutado el 2026-07-28, re-ejecutar es seguro (no pisa lo verificado)
```

Abre cada `eval/facturas/{id}/documento.*` junto a su `ground_truth.json`,
compara campo a campo contra la imagen real, corrige lo que v1 leyó mal y
pon `verificado: true`. Cuantas más facturas verifiques, más fiable es el
siguiente paso — pero el replay funciona igualmente sin ninguna verificada
(compara contra v1-histórico como fallback).

## Paso 4 — Lanzar el replay

```bash
docker exec -i setex-prod-backend node < eval/replay.js
```

Coste real: hasta 2 llamadas OCR por factura reprocesada (gemini_flash +
azure) — con 29 facturas, del orden de 58 llamadas. Genera
`docs/ocr-v2/INFORME-REPLAY.md`. Léelo.

## Paso 5 — Los 3 criterios objetivos de activación

Actívalo (`ocr_extraccion_v2_enabled: true` en `features.json`, en caliente,
sin rebuild — regla 4) el mismo día del despliegue SOLO si los tres se
cumplen a la vez:

1. **Cero excepciones no controladas** en `INFORME-REPLAY.md` (columna
   Estado sin ninguna fila `⚠️ EXCEPCIÓN`).
2. **v2 iguala o mejora a v1** en los campos críticos (`emisor.nif`,
   `receptor.nif`, `fecha_emision`, `total`) sobre las facturas con ground
   truth verificado, **y alucina igual o menos** que v1 (un valor donde el
   ground truth dice `ilegible`/`ausente` y v2 devuelve algo es una
   alucinación — la métrica más grave del proyecto, más que cualquier
   porcentaje de acierto).
3. **Coste y latencia dentro de lo estimado** — compara el coste total y la
   duración de `INFORME-REPLAY.md` contra lo esperado (Fase 8 del prompt
   original: coste medio por factura documentado en `ocr/index.js` y
   `CLAUDE.md` §2.2).

No cumplidos los tres → el flag queda como está (`false`), reporta en
`INFORME-REPLAY.md` qué diff concreto falló y decide con esa evidencia si
hace falta un ajuste antes de reintentar.

## Paso 6 (opcional, experimental) — variantes de imagen + Tesseract + aprendizaje

Añadido el mismo día a petición de Julio: 3 capacidades nuevas, cada una
tras su propio flag en `features.json`, **las tres en `false` por
defecto** — activarlas es una decisión aparte, no forma parte de los 3
criterios de activación del Paso 5.

| Flag | Qué hace | Coste real |
|---|---|---|
| `ocr_extraccion_v2_variantes_enabled` | Genera una 2ª imagen con contraste local (CLAHE, la misma función que ya usa el panel Benchmark IA) y compara el resultado contra la imagen estándar — gana la que tenga menos disputas. Queda registrado en la columna `variante` (`estandar`/`contraste`) de cada fila de `extracciones_v2`. | **Duplica** el nº de llamadas de extracción por factura (se intentan las dos, se guarda el coste de ambas aunque se descarte una). |
| `ocr_extraccion_v2_tesseract_enabled` | Reconoce el texto bruto de la imagen con Tesseract (motor local, sin API) y comprueba si cada valor crítico (NIF, nº factura, total, base) aparece literalmente en ese texto. Si NO aparece, se anota en `alucinaciones_sospechosas` — señal de posible invención. | 0 USD (motor local). Consume CPU del contenedor (límite real: 0.5 vCPU) — siempre en modo sombra, nunca bloquea al usuario. |
| `ocr_extraccion_v2_aprendizaje_enabled` | Si el NIF de la contraparte ya es un proveedor/cliente conocido (`known_cifs`/`company_relationships`, tablas de v1 sin tocar), sustituye el nombre leído por el ya confirmado. Queda registrado en `aprendizaje_aplicado`. | Sin coste de API — una consulta extra a Postgres por factura. Fail-safe: si la BD no responde, sigue sin aprendizaje. |

**Cómo usarlas para decidir** (el objetivo que pidió Julio: "ir evaluando
cuál funciona mejor"): actívalas una temporada sobre tráfico real (o vía
`eval/replay.js` sobre las facturas ya confirmadas), y consulta:

```sql
-- ¿Gana casi siempre la misma variante? Si sí, se puede desactivar la
-- comparación y quedarse solo con la ganadora (ahorra el coste x2).
SELECT variante, COUNT(*), AVG(score_global) FROM extracciones_v2 GROUP BY variante;

-- ¿Cuántas alucinaciones sospechosas detecta Tesseract, y en qué campos?
SELECT jsonb_array_elements_text(alucinaciones_sospechosas) AS campo, COUNT(*)
FROM extracciones_v2 WHERE alucinaciones_sospechosas != '[]' GROUP BY campo;

-- ¿Cuántas veces ha aplicado el aprendizaje de proveedor conocido?
SELECT COUNT(*) FILTER (WHERE aprendizaje_aplicado IS NOT NULL) AS con_aprendizaje, COUNT(*) FROM extracciones_v2;
```

No hay un plazo fijo — es exactamente el experimento que pidió Julio: dejarlo
correr, mirar los números, y quedarse con lo que de verdad funcione mejor.

## Rollback

Ver `docs/ROLLBACK.md` (ya cubre `extracciones_v2` completa) +
`scripts/rollback/2026-07-28-extracciones-v2-modo-down.sql` (solo la
columna `modo` añadida en esta fase) +
`scripts/rollback/2026-07-28-extracciones-v2-aprendizaje-down.sql` (columnas
`variante`/`alucinaciones_sospechosas`/`aprendizaje_aplicado`). Apagar
cualquier cosa de esta fase es siempre instantáneo vía `features.json`, sin
rebuild.
