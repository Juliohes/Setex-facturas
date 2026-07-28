#!/usr/bin/env node
// eval/replay.js — Gap 2 del plan de cierre sobre el pipeline v2 existente
// (2026-07-28). El modo sombra (Fase 10) solo procesa facturas NUEVAS desde
// que se activó — esto permite verificar v2 contra el HISTÓRICO real ya
// confirmado, sin esperar tráfico nuevo ni tocar los datos de v1.
//
// Solo-lectura respecto a v1: lee `uploads` (fichero + campos ya
// confirmados), nunca escribe en esa tabla. Cada factura reprocesada
// persiste en extracciones_v2 con modo='replay'. Cualquier excepción en una
// factura se captura y no interrumpe el lote (ver pipeline/replay.js).
//
// NUNCA se ejecuta automáticamente — es una herramienta de mantenimiento que
// EJECUTA JULIO cuando quiere verificar el estado de v2, tal como pide
// PROMPT-PIPELINE-OCR-FACTURAS-V2.md. Cada factura reprocesada cuesta hasta
// 2 llamadas OCR reales (gemini_flash + azure) — coste real, no gratuito.
//
// Uso:
//   docker exec -i setex-prod-backend node < eval/replay.js
//   docker exec -i setex-prod-backend node < eval/replay.js -- --ids=29,30
//   docker exec -i setex-prod-backend node < eval/replay.js -- --force   (reprocesa aunque ya tenga replay previo)
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const winston = require('winston');
const { replayFactura } = require('/app/src/pipeline/replay');

// Logger mínimo a consola — este script corre suelto (docker exec -i ... node
// < eval/replay.js), no dentro del proceso de server.js, así que no comparte
// su logger con rotación a fichero. ejecutarPipelineV2Sombra() solo necesita
// la interfaz {info,warn,error} para su observabilidad interna (Fase 9).
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

function readSecret(name) {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return process.env[name.toUpperCase()];
  }
}

function leerArg(nombre) {
  const arg = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.split('=')[1] : null;
}

// Lee eval/facturas/{id}/ground_truth.json si ya existe y tiene campos
// verificados (Fase D del plan de cierre) — enriquece el informe cuando esté
// disponible, sin depender de que exista todavía (orden tolerante).
function leerGroundTruthSiExiste(uploadId) {
  const ruta = `/app/eval/facturas/${uploadId}/ground_truth.json`;
  try {
    const gt = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return gt;
  } catch {
    return null;
  }
}

async function run() {
  const idsArg = leerArg('ids');
  const forzar = process.argv.includes('--force');
  const idsFiltro = idsArg ? idsArg.split(',').map((s) => parseInt(s.trim(), 10)) : null;

  const cfg = JSON.parse(fs.readFileSync('/app/src/config/features.json', 'utf8'));
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: 5432,
    database: 'setex_db',
    user: 'setex_user',
    password: readSecret('postgres_password'),
    max: 3,
  });

  const filtroIds = idsFiltro ? `AND u.id = ANY($1::int[])` : '';
  const filtroReplay = forzar ? '' : `AND NOT EXISTS (SELECT 1 FROM extracciones_v2 e WHERE e.upload_id = u.id AND e.modo = 'replay')`;
  const params = idsFiltro ? [idsFiltro] : [];

  const { rows: uploads } = await pool.query(
    `SELECT u.id, u.file_path, u.mimetype, u.invoice_type, u.user_id,
            u.proveedor_nif, u.proveedor_nombre, u.receptor_nif, u.receptor_nombre,
            u.numero_factura, u.fecha_emision, u.total_factura, u.base_imponible,
            u.iva_porcentaje, u.cuota_iva, u.irpf_porcentaje, u.cuota_irpf, u.lineas_iva
       FROM uploads u
       JOIN users us ON us.id = u.user_id
      WHERE u.procesado_en IS NOT NULL AND us.is_test = false
      ${filtroIds} ${filtroReplay}
      ORDER BY u.id`,
    params
  );

  if (uploads.length === 0) {
    console.log('Nada que reprocesar (0 facturas — ¿ya se replayó todo? usa --force para repetir).');
    await pool.end();
    return;
  }

  console.log(`Replay: ${uploads.length} factura(s) real(es) confirmada(s) a reprocesar con el pipeline v2 completo...\n`);

  const inicio = Date.now();
  const resultados = [];
  let excepciones = 0;

  for (const upload of uploads) {
    process.stdout.write(`  #${upload.id}... `);
    const r = await replayFactura(upload, { pool, logger, cfg });
    if (!r.ok) {
      excepciones++;
      console.log(`ERROR: ${r.error}`);
    } else {
      console.log(`OK (score ${r.registro.score_global}, estado ${r.registro.estado})`);
    }
    resultados.push({ upload, replay: r });
  }

  const duracionTotalMs = Date.now() - inicio;
  const costeTotal = resultados.reduce((acc, r) => acc + (r.replay.ok ? (r.replay.registro.coste_estimado_usd || 0) : 0), 0);

  // ── Informe: v2 vs v1-histórico (vs ground truth si ya existe) ───────────
  const filas = resultados.map(({ upload, replay }) => {
    const gt = leerGroundTruthSiExiste(upload.id);
    if (!replay.ok) {
      return { id: upload.id, estado: 'EXCEPCION', detalle: replay.error };
    }
    const v2 = replay.registro.campos_canonicos;
    const diffsV1 = [
      ['emisor.nif', upload.proveedor_nif, v2.emisor?.nif],
      ['receptor.nif', upload.receptor_nif, v2.receptor?.nif],
      ['numero_factura', upload.numero_factura, v2.numero_factura],
      ['fecha_emision', upload.fecha_emision, v2.fecha_emision],
      ['total', upload.total_factura, v2.total],
    ].filter(([, v1, v2v]) => String(v1 ?? '') !== String(v2v ?? ''));

    return {
      id: upload.id,
      estado: replay.registro.estado,
      score: replay.registro.score_global,
      disputas: replay.registro.disputas.length,
      diffs_vs_v1: diffsV1.length,
      diffs_detalle: diffsV1.map(([campo, v1, v2v]) => `${campo}: v1="${v1}" vs v2="${v2v}"`),
      ground_truth_disponible: !!gt,
    };
  });

  const md = [
    '# Informe de Replay — pipeline OCR v2 sobre facturas reales confirmadas',
    '',
    `Generado: ${new Date().toISOString()}`,
    `Facturas reprocesadas: ${uploads.length} · Excepciones: ${excepciones} · Coste estimado: $${costeTotal.toFixed(4)} · Duración total: ${(duracionTotalMs / 1000).toFixed(1)}s`,
    '',
    '## Resultado por factura',
    '',
    '| ID | Estado | Score | Disputas | Diffs vs v1-histórico | Ground truth verificado |',
    '|---|---|---|---|---|---|',
    ...filas.map((f) =>
      f.estado === 'EXCEPCION'
        ? `| ${f.id} | ⚠️ EXCEPCIÓN | — | — | ${f.detalle} | — |`
        : `| ${f.id} | ${f.estado} | ${f.score} | ${f.disputas} | ${f.diffs_vs_v1} | ${f.ground_truth_disponible ? 'sí' : 'no (pendiente Fase D)'} |`
    ),
    '',
    '## Diffs detallados (v2 vs valor confirmado en su día por v1)',
    '',
    ...filas.filter((f) => f.diffs_detalle?.length).flatMap((f) => [`**Factura #${f.id}**:`, ...f.diffs_detalle.map((d) => `- ${d}`), '']),
    '',
    '## Notas',
    '',
    '- Este replay es de SOLO LECTURA respecto a v1: ninguna fila de `uploads` se ha modificado.',
    '- Un "diff vs v1-histórico" NO implica que v2 esté equivocado — puede ser al revés. La comparación fiable es contra ground truth verificado por humano (columna derecha), disponible tras la Fase D del plan de cierre.',
    '- Vuelve a ejecutar este comando tras verificar el ground truth de `eval/facturas/` para una comparación completa v1 vs v2 vs verdad.',
    '',
  ].join('\n');

  fs.mkdirSync('/app/docs/ocr-v2', { recursive: true });
  fs.writeFileSync('/app/docs/ocr-v2/INFORME-REPLAY.md', md);

  console.log(`\n${excepciones} excepción(es) · coste total estimado $${costeTotal.toFixed(4)} · informe en docs/ocr-v2/INFORME-REPLAY.md`);
  await pool.end();
}

run().catch((err) => {
  console.error('Error fatal en replay:', err.message);
  process.exit(1);
});
