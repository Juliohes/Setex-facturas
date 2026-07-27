#!/usr/bin/env node
// scripts/run-benchmark-pendientes.js
// Ejecuta el benchmark multi-imagen × multi-motor SOLO sobre facturas
// confirmadas que todavía no tienen ninguna fila en ocr_benchmark_resultados
// (evita recargar coste real de IA sobre facturas ya analizadas). Misma
// lógica que POST /api/admin/facturas/benchmark/ultimas, pero filtrada a
// pendientes en vez de "últimas N" (que reprocesaría también las ya hechas).
// Uso: docker exec -i setex-prod-backend node < scripts/run-benchmark-pendientes.js
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { ejecutarBenchmarkCompleto } = require('/app/src/ocr/benchmark');

function readSecret(name) {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return process.env[name.toUpperCase()];
  }
}

async function run() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: 5432,
    database: 'setex_db',
    user: 'setex_user',
    password: readSecret('postgres_password'),
    max: 3,
  });

  const client = await pool.connect();
  try {
    const { rows: facturas } = await client.query(`
      SELECT id, file_path, mimetype, invoice_type,
             proveedor_nif, proveedor_nombre, receptor_nif, receptor_nombre,
             numero_factura, fecha_emision, total_factura, base_imponible,
             iva_porcentaje, cuota_iva
      FROM uploads
      WHERE procesado_en IS NOT NULL
        AND file_path IS NOT NULL
        AND id NOT IN (SELECT DISTINCT upload_id FROM ocr_benchmark_resultados)
      ORDER BY uploaded_at ASC
    `);

    console.log(`Facturas pendientes de benchmark: ${facturas.length}`);
    const cfg = JSON.parse(fs.readFileSync('/app/src/config/features.json', 'utf8'));

    let ok = 0, error = 0;
    for (const f of facturas) {
      try {
        const safePath = path.resolve(f.file_path);
        if (!safePath.startsWith('/app/uploads/')) {
          console.warn(`  [SKIP] upload ${f.id}: file_path fuera de /app/uploads/`);
          continue;
        }
        await fs.promises.access(safePath);
        const confirmado = {
          proveedor_nif: f.proveedor_nif, proveedor_nombre: f.proveedor_nombre,
          receptor_nif: f.receptor_nif, receptor_nombre: f.receptor_nombre,
          numero_factura: f.numero_factura, fecha_emision: f.fecha_emision,
          total: f.total_factura, base_imponible: f.base_imponible,
          iva_porcentaje: f.iva_porcentaje, cuota_iva: f.cuota_iva,
        };
        const resultados = await ejecutarBenchmarkCompleto(
          safePath, f.mimetype, { invoice_type: f.invoice_type }, cfg, confirmado, console
        );
        for (const r of resultados) {
          await client.query(
            `INSERT INTO ocr_benchmark_resultados
               (upload_id, variante, motor, campos, es_factura_valida, tiempo_ms, error, aciertos, comparables, detalle_campos)
             VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb)
             ON CONFLICT (upload_id, variante, motor) DO UPDATE SET
               campos = EXCLUDED.campos, es_factura_valida = EXCLUDED.es_factura_valida,
               tiempo_ms = EXCLUDED.tiempo_ms, error = EXCLUDED.error,
               aciertos = EXCLUDED.aciertos, comparables = EXCLUDED.comparables,
               detalle_campos = EXCLUDED.detalle_campos, creado_en = NOW()`,
            [f.id, r.variante, r.motor, JSON.stringify(r.campos), r.es_factura_valida, r.tiempo_ms, r.error, r.aciertos, r.comparables, JSON.stringify(r.detalle || {})]
          );
        }
        console.log(`  [OK] upload ${f.id} (${resultados.length} combinaciones)`);
        ok++;
      } catch (err) {
        console.error(`  [ERROR] upload ${f.id}: ${err.message}`);
        error++;
      }
    }
    console.log(`\nCompletado: ${ok} facturas OK, ${error} con error.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
