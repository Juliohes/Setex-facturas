#!/usr/bin/env node
// eval/evaluate.js — Fase 1.5 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md
// Adaptador fino sobre la infraestructura de benchmark YA existente
// (ver eval/README.md para la decisión de no duplicarla). Agrega
// ocr_benchmark_resultados por motor×variante: precisión global, precisión
// por grupo de campo, tiempo medio y coste estimado — y lo presenta en
// consola + eval/resultados/{timestamp}.json.
//
// NUNCA llama a ninguna IA: solo lee lo que ocr/benchmark.js ya guardó.
// Uso: docker exec -i setex-prod-backend node < eval/evaluate.js [-- --baseline]
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const { GRUPOS_CAMPOS } = require('/app/src/ocr/benchmark');

// Coste estimado por factura y por motor (fuente: comentarios de cabecera de
// ocr/index.js y CLAUDE.md §2.2 — aproximado, USD, una sola llamada).
const COSTE_ESTIMADO_USD = {
  openai: 0.007,
  azure: 0.0015,
  mistral: 0.004,
  gemini_flash: 0.006,
  gemini_pro: 0.01,
};

function readSecret(name) {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return process.env[name.toUpperCase()];
  }
}

async function run() {
  const esBaseline = process.argv.includes('--baseline') || process.env.EVAL_BASELINE === '1';

  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: 5432,
    database: 'setex_db',
    user: 'setex_user',
    password: readSecret('postgres_password'),
    max: 3,
  });

  const client = await pool.connect();
  let rows;
  try {
    ({ rows } = await client.query(
      `SELECT motor, variante, aciertos, comparables, detalle_campos, tiempo_ms, error
       FROM ocr_benchmark_resultados`
    ));
  } finally {
    client.release();
    await pool.end();
  }

  if (!rows.length) {
    console.log('Sin datos en ocr_benchmark_resultados todavía. Ejecuta el benchmark desde el panel admin primero.');
    return;
  }

  const combos = {};
  for (const r of rows) {
    const key = `${r.motor}__${r.variante}`;
    if (!combos[key]) {
      combos[key] = {
        motor: r.motor, variante: r.variante,
        ejecuciones: 0, errores: 0, tiempoTotalMs: 0, tiempoMuestras: 0,
        aciertos: 0, comparables: 0, grupos: {},
      };
    }
    const c = combos[key];
    c.ejecuciones++;
    if (r.error) c.errores++;
    if (r.tiempo_ms != null) { c.tiempoTotalMs += r.tiempo_ms; c.tiempoMuestras++; }
    c.aciertos += r.aciertos || 0;
    c.comparables += r.comparables || 0;
    for (const [campo, acierto] of Object.entries(r.detalle_campos || {})) {
      const grupo = GRUPOS_CAMPOS[campo] || campo;
      if (!c.grupos[grupo]) c.grupos[grupo] = { aciertos: 0, comparables: 0 };
      c.grupos[grupo].comparables++;
      if (acierto) c.grupos[grupo].aciertos++;
    }
  }

  const resumen = Object.values(combos).map((c) => ({
    motor: c.motor,
    variante: c.variante,
    '%_global': c.comparables ? +((c.aciertos / c.comparables) * 100).toFixed(1) : null,
    ejecuciones: c.ejecuciones,
    errores: c.errores,
    'tiempo_medio_s': c.tiempoMuestras ? +(c.tiempoTotalMs / c.tiempoMuestras / 1000).toFixed(2) : null,
    'coste_estimado_usd': COSTE_ESTIMADO_USD[c.motor] ?? null,
    por_grupo: Object.fromEntries(
      Object.entries(c.grupos).map(([g, v]) => [g, v.comparables ? +((v.aciertos / v.comparables) * 100).toFixed(1) : null])
    ),
  })).sort((a, b) => (b['%_global'] ?? -1) - (a['%_global'] ?? -1));

  console.log(`\n=== Evaluación OCR — ${rows.length} filas agregadas (${esBaseline ? 'BASELINE' : 'snapshot'}) ===\n`);
  console.table(resumen.map(({ por_grupo, ...resto }) => resto));
  console.log('\nDesglose por campo (grupo):');
  resumen.forEach((r) => console.log(`  ${r.motor}/${r.variante}:`, por_grupoLegible(r.por_grupo)));

  function por_grupoLegible(pg) {
    return Object.entries(pg).map(([g, v]) => `${g}=${v ?? '—'}%`).join(' · ');
  }

  const salida = {
    generado_en: new Date().toISOString(),
    es_baseline: esBaseline,
    total_filas_agregadas: rows.length,
    resumen,
  };
  const nombre = esBaseline ? 'baseline.json' : `${Date.now()}.json`;
  const ruta = `/app/eval/resultados/${nombre}`;
  fs.writeFileSync(ruta, JSON.stringify(salida, null, 2));
  console.log(`\nGuardado en ${ruta}`);
}

run().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
