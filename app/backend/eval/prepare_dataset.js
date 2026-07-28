#!/usr/bin/env node
// eval/prepare_dataset.js — Gap 3 del plan de cierre sobre el pipeline v2
// existente (2026-07-28): no había ningún dataset de verdad VERIFICADO POR
// HUMANO sobre las facturas reales — eval/README.md documentaba (con razón,
// para la comparación continua motor×variante) reutilizar
// ocr_benchmark_resultados, pero esa infraestructura compara contra el valor
// YA CONFIRMADO en `uploads`, que en facturas con auto-confirm activado
// nunca pasó por revisión humana real. Este script añade una capa distinta
// y más estricta: un dataset explícito donde CADA campo se marca
// `verificado: false` hasta que un humano lo compare contra la imagen
// original y lo corrija si hace falta.
//
// NO sustituye la decisión de eval/README.md — la complementa. El harness
// de replay (eval/replay.js) usa este dataset SOLO si existe y tiene campos
// verificados; si no, sigue comparando contra v1-histórico como hasta ahora.
//
// REGLA CRÍTICA: los valores aquí precargados son los que v1 confirmó —
// v1 FALLA, por eso existe el pipeline v2. NINGÚN valor de este fichero es
// la verdad hasta que un humano abra el documento, lo compare campo a campo
// y ponga verificado: true.
//
// Idempotente y NO destructivo: si ya existe ground_truth.json para una
// factura, se SALTA sin tocarlo (para no perder verificaciones ya hechas).
// Usa --force para regenerar de todas formas (pierde lo ya verificado).
//
// Uso:
//   docker exec -i setex-prod-backend node < eval/prepare_dataset.js
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DEST_DIR = '/app/eval/facturas';

function readSecret(name) {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return process.env[name.toUpperCase()];
  }
}

function extensionPorMimetype(mimetype) {
  if (mimetype === 'image/jpeg') return 'jpg';
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'application/pdf') return 'pdf';
  return 'bin';
}

// v1 guarda importes con coma decimal española ("100,00") — el esquema
// canónico del pipeline v2 (pipeline/schema.js) también usa string, misma
// convención, sin reformatear.
function campoDesdeV1(valor, { critico = false } = {}) {
  const ausente = valor == null || valor === '';
  return {
    valor: ausente ? null : String(valor),
    // No sabemos de verdad si v1 lo leyó bien o mal — 'ambiguo' es el estado
    // de partida más honesto hasta que un humano lo revise. Los campos
    // ausentes en v1 se marcan 'ausente' (no hay nada que verificar salvo
    // que el humano encuentre el dato en el documento).
    estado: ausente ? 'ausente' : 'ambiguo',
    verificado: false,
  };
}

function construirGroundTruth(upload) {
  const lineas = Array.isArray(upload.lineas_iva) && upload.lineas_iva.length > 0
    ? upload.lineas_iva
    : [{ base: upload.base_imponible, tipo: upload.iva_porcentaje, cuota: upload.cuota_iva }];

  return {
    origen: 'real',
    // Clasificación de partida — AJUSTAR a mano si no es correcta: el script
    // solo puede inferir por mimetype, no sabe si el PDF es nativo o escaneado.
    tipo_documento: upload.mimetype === 'application/pdf' ? 'pdf_nativo' : 'foto_buena',
    upload_id_origen: upload.id,
    campos: {
      'emisor.nombre': campoDesdeV1(upload.proveedor_nombre, { critico: true }),
      'emisor.nif': campoDesdeV1(upload.proveedor_nif, { critico: true }),
      'receptor.nombre': campoDesdeV1(upload.receptor_nombre),
      'receptor.nif': campoDesdeV1(upload.receptor_nif, { critico: true }),
      numero_factura: campoDesdeV1(upload.numero_factura),
      fecha_emision: campoDesdeV1(upload.fecha_emision, { critico: true }),
      desglose_iva: lineas.map((l) => ({
        base: campoDesdeV1(l.base),
        tipo: campoDesdeV1(l.tipo ?? l.porcentaje),
        cuota: campoDesdeV1(l.cuota),
      })),
      retencion_irpf: campoDesdeV1(upload.cuota_irpf),
      total: campoDesdeV1(upload.total_factura, { critico: true }),
    },
  };
}

async function run() {
  const forzar = process.argv.includes('--force');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: 5432,
    database: 'setex_db',
    user: 'setex_user',
    password: readSecret('postgres_password'),
    max: 3,
  });

  const { rows: uploads } = await pool.query(`
    SELECT u.id, u.file_path, u.mimetype,
           u.proveedor_nif, u.proveedor_nombre, u.receptor_nif, u.receptor_nombre,
           u.numero_factura, u.fecha_emision, u.total_factura, u.base_imponible,
           u.iva_porcentaje, u.cuota_iva, u.cuota_irpf, u.lineas_iva
      FROM uploads u
      JOIN users us ON us.id = u.user_id
     WHERE u.procesado_en IS NOT NULL AND us.is_test = false
     ORDER BY u.id
  `);

  fs.mkdirSync(DEST_DIR, { recursive: true });

  let creadas = 0, saltadas = 0, sinFichero = 0;

  for (const upload of uploads) {
    const dir = path.join(DEST_DIR, String(upload.id));
    const rutaGT = path.join(dir, 'ground_truth.json');

    if (fs.existsSync(rutaGT) && !forzar) {
      saltadas++;
      continue;
    }

    if (!fs.existsSync(upload.file_path)) {
      console.log(`  #${upload.id}: SIN FICHERO en disco (${upload.file_path}) — omitida`);
      sinFichero++;
      continue;
    }

    fs.mkdirSync(dir, { recursive: true });
    const ext = extensionPorMimetype(upload.mimetype);
    fs.copyFileSync(upload.file_path, path.join(dir, `documento.${ext}`));
    fs.writeFileSync(rutaGT, JSON.stringify(construirGroundTruth(upload), null, 2));
    creadas++;
  }

  console.log(`\nDataset preparado en ${DEST_DIR}/`);
  console.log(`  ${creadas} factura(s) nueva(s) · ${saltadas} ya existían (sin tocar) · ${sinFichero} sin fichero en disco`);
  console.log(`\nSiguiente paso (Julio): abrir cada eval/facturas/{id}/documento.* junto a su`);
  console.log(`ground_truth.json, comparar campo a campo, corregir lo que v1 leyó mal y`);
  console.log(`poner verificado: true. El harness ignora (con aviso) los campos no verificados.`);

  await pool.end();
}

run().catch((err) => {
  console.error('Error fatal preparando el dataset:', err.message);
  process.exit(1);
});
