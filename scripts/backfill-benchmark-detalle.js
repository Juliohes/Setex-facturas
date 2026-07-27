#!/usr/bin/env node
// scripts/backfill-benchmark-detalle.js
// Recalcula detalle_campos (acierto/fallo POR CAMPO: CIF, nombre, fecha,
// importes, tramos IVA) para las filas de ocr_benchmark_resultados que ya
// existen, SIN volver a llamar a ninguna IA — reutiliza los campos ya
// extraídos (columna `campos`, JSONB) contra lo confirmado en `uploads`,
// con la MISMA función puntuarContraConfirmado() que usa el pipeline real
// (single source of truth, evita divergencia entre backfill y ranking).
//
// Uso (dentro del contenedor backend, ya reconstruido con el fix del
// 2026-07-24 — requiere /app/src/ocr/benchmark ya desplegado):
//   docker exec -i setex-prod-backend node < scripts/backfill-benchmark-detalle.js
// Coste: CERO llamadas a IA — solo relee y recalcula datos ya existentes.
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const { puntuarContraConfirmado } = require('/app/src/ocr/benchmark');

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
    const { rows } = await client.query(`
      SELECT b.id, b.upload_id, b.campos,
             u.proveedor_nif, u.proveedor_nombre, u.receptor_nif, u.receptor_nombre,
             u.numero_factura, u.fecha_emision, u.total_factura, u.base_imponible,
             u.iva_porcentaje, u.cuota_iva
      FROM ocr_benchmark_resultados b
      JOIN uploads u ON u.id = b.upload_id
    `);

    console.log(`Recalculando detalle_campos para ${rows.length} filas...`);
    let actualizadas = 0;
    for (const r of rows) {
      const confirmado = {
        proveedor_nif: r.proveedor_nif, proveedor_nombre: r.proveedor_nombre,
        receptor_nif: r.receptor_nif, receptor_nombre: r.receptor_nombre,
        numero_factura: r.numero_factura, fecha_emision: r.fecha_emision,
        total: r.total_factura, base_imponible: r.base_imponible,
        iva_porcentaje: r.iva_porcentaje, cuota_iva: r.cuota_iva,
      };
      const { aciertos, comparables, detalle } = puntuarContraConfirmado(r.campos || {}, confirmado);
      await client.query(
        `UPDATE ocr_benchmark_resultados
         SET detalle_campos = $1::jsonb, aciertos = $2, comparables = $3
         WHERE id = $4`,
        [JSON.stringify(detalle), aciertos, comparables, r.id]
      );
      actualizadas++;
    }
    console.log(`Listo: ${actualizadas} filas actualizadas (0 llamadas a IA).`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
