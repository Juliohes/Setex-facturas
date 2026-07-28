# eval/ — arnés de evaluación del pipeline OCR

Fase 1 de `PROMPT-PIPELINE-OCR-FACTURAS-V2.md`. Decisión documentada (regla 10
del prompt: "decisiones técnicas dentro de las reglas las toma el ingeniero"):

**No se construye un dataset dorado nuevo desde cero.** El proyecto ya tiene,
en producción real desde el 2026-07-23, un sistema de benchmark
(`src/ocr/benchmark.js`, tabla `ocr_benchmark_resultados`) que hace exactamente
lo que pide esta fase: ejecuta los 5 motores OCR sobre 3 variantes de imagen
de cada factura y puntúa el resultado campo a campo (CIF, nombre, fecha,
importes, tramos de IVA) contra el valor **ya confirmado por un humano** en la
tabla `uploads`. Construir un `eval/facturas/{id}/ground_truth.json` en
paralelo duplicaría esa infraestructura sin aportar nada — el "ground truth"
ya existe, son las facturas reales que el equipo contable ya revisó y
confirmó.

`evaluate.js` es un adaptador fino: lee lo que YA está en
`ocr_benchmark_resultados` (o dispara un lote nuevo reutilizando
`ocr/benchmark.js` si se le pide), y lo presenta en el formato que pide la
Fase 1.5 del prompt — tabla en consola + `eval/resultados/{timestamp}.json` —
con precisión por campo, latencia y coste estimado por factura.

## Uso

Dentro del contenedor backend (necesita conexión a Postgres):

```bash
# Leer y presentar lo que ya hay en ocr_benchmark_resultados (sin gastar IA)
docker exec -i setex-prod-backend node < eval/evaluate.js

# Con --baseline: además, marca el snapshot como "baseline" oficial de
# referencia (Fase 1.6) — todo cambio del pipeline debe igualar o mejorar
# esta cifra antes de mezclarse.
docker exec -i setex-prod-backend node < eval/evaluate.js -- --baseline
```

El script NUNCA llama a las APIs de IA por sí mismo — solo agrega datos ya
guardados por `ocr/benchmark.js` (disparado desde el panel admin "🧪
Benchmark IA" o los scripts `scripts/run-benchmark-*.js`). Si quieres ampliar
la muestra con casos límite reales (foto mala, PDF escaneado multipágina,
factura con recargo de equivalencia), añádelas como facturas normales de la
app y ejecuta el benchmark sobre ellas desde el panel — se incorporan solas
al siguiente `evaluate.js` sin tocar código.

## Salida

- Consola: tabla motor × variante con % de acierto global, desglose por
  grupo de campo, tiempo medio y coste estimado por factura.
- `eval/resultados/{timestamp}.json`: mismo contenido en JSON, para comparar
  snapshots entre fases (p. ej. antes/después de activar el árbitro de la
  Fase 5).

## `eval/facturas/` — ground truth verificado por humano (2026-07-28)

Añadido al cerrar los gaps del plan de reconstrucción propuesto el
2026-07-28 (ver commits `ocr-v2/gaps`) — **complementa** la decisión de
arriba, no la sustituye. Motivo: el benchmark compara contra el valor **ya
confirmado** en `uploads`, pero una factura con `auto_confirm_enabled`
activo y confianza alta se confirma SIN que ningún humano la haya mirado
nunca — para esas filas, comparar v2 contra "lo confirmado" es comparar v2
contra v1, no contra la verdad. `eval/facturas/` añade una capa explícita
donde CADA campo lleva su propio `verificado: true/false`.

### Generar el dataset

```bash
docker exec -i setex-prod-backend node < eval/prepare_dataset.js
```

Copia cada factura real confirmada (excluidas cuentas de prueba) a
`eval/facturas/{id}/documento.{jpg|png|pdf}` + `ground_truth.json`,
pre-rellenado con los valores que **v1** guardó. **Idempotente y no
destructivo**: si ya existe `ground_truth.json` para una factura, se salta
sin tocarlo — así no se pierde el trabajo de verificación ya hecho. Con
`--force` se regenera de todas formas (pierde lo verificado).

**REGLA CRÍTICA**: los valores precargados son los que v1 confirmó — v1
falla, por eso existe este proyecto. Ningún valor es la verdad hasta que un
humano abre `documento.*`, compara campo a campo contra la imagen real,
corrige lo que v1 leyó mal y pone `verificado: true`. El harness de replay
(`eval/replay.js`) IGNORA con aviso los campos con `verificado: false`.

### Esquema de `ground_truth.json`

```json
{
  "origen": "real",
  "tipo_documento": "foto_buena",
  "campos": {
    "emisor.nombre": { "valor": "ACME SL", "estado": "legible", "verificado": true },
    "emisor.nif": { "valor": "B72327000", "estado": "legible", "verificado": true },
    "receptor.nombre": { "valor": null, "estado": "ausente", "verificado": false },
    "numero_factura": { "valor": "0001", "estado": "ambiguo", "verificado": false },
    "desglose_iva": [
      { "base": { "valor": "100,00", "estado": "legible", "verificado": true },
        "tipo": { "valor": "21,0", "estado": "legible", "verificado": true },
        "cuota": { "valor": "21,00", "estado": "legible", "verificado": true } }
    ],
    "total": { "valor": "121,00", "estado": "legible", "verificado": true }
  }
}
```

`estado ∈ legible|ambiguo|ilegible|ausente` — describe lo que un HUMANO lee
de verdad en el documento, no lo que dijo la IA. Ejemplo completo y
ejecutable sin datos reales: `eval/facturas/sintetica-ejemplo/` (única
carpeta de `eval/facturas/` que SÍ está en git — el resto son facturas
reales de clientes, excluidas por `.gitignore`, RGPD). Se regenera con:

```bash
node scripts/generate-synthetic-example.js
```

### Cómo lo usa el replay

`eval/replay.js` lee `eval/facturas/{id}/ground_truth.json` si existe (best
effort — no lo exige) y lo añade al informe. Sin ground truth verificado,
sigue comparando v2 contra v1-histórico como hasta ahora — nunca bloquea.

### ⚠️ Persistencia — `/app/eval` NO está montado como volumen

`docker-compose.yml` solo monta `uploads/`, `logs/` y `features.json` para
el backend — `eval/` viaja horneado en la imagen (`COPY` del Dockerfile).
Cualquier factura generada por `prepare_dataset.js` (y el trabajo de
verificación manual de Julio sobre sus `ground_truth.json`) vive SOLO en la
capa efímera del contenedor y **se pierde en el próximo `docker compose
build && up -d backend`**, salvo que:

1. Se añada un volumen dedicado (recomendado, requiere confirmación
   explícita de Julio — regla 1 del proyecto: no tocar `docker-compose.yml`
   sin su OK): `${SETEX_DATA_DIR}/eval-facturas:/app/eval/facturas`.
2. O, mientras tanto, tras cada `prepare_dataset.js` y cada sesión de
   verificación manual, rescatar con:
   ```bash
   docker cp setex-prod-backend:/app/eval/facturas/. app/backend/eval/facturas/
   ```
   y volver a copiar DENTRO antes de cualquier rebuild:
   ```bash
   docker cp app/backend/eval/facturas/. setex-prod-backend:/app/eval/facturas/
   ```

La opción 1 es la única realmente segura a medio plazo — la 2 depende de no
olvidarlo nunca.
