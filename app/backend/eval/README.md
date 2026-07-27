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
