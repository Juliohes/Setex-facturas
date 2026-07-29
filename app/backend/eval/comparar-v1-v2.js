#!/usr/bin/env node
// eval/comparar-v1-v2.js
//
// Compara v1 (produccion) contra v2 (sombra/replay) midiendo AMBOS contra el
// mismo patron: el ground truth verificado a mano en eval/facturas/{id}/.
//
// Por que hace falta esto y no basta el informe del replay: el replay compara
// v2 contra "lo que v1 guardo en su dia", pero esas columnas ya han sido
// corregidas a mano despues (facturas #2, #21, #22...), asi que v1 pareceria
// perfecto por construccion. Aqui v1 se mide por lo que DE VERDAD produjo en
// su momento: uploads.ocr_result->'merged', que es inmutable.
//
// Reglas de la comparacion:
//   - Solo se puntuan campos con estado 'legible' en el ground truth. Un campo
//     que ni un humano puede leer con certeza no mide la calidad de nadie.
//   - Los importes se comparan por VALOR, no por texto ("303.33" == "303,33").
//   - Los NIF se comparan sin separadores y en mayusculas.
//   - Se reporta por separado el bloque "identidad" (nombre/NIF de emisor y
//     receptor), porque ahi ambos pipelines se apoyan en la BD (registro del
//     usuario, known_cifs) y no en la lectura de la imagen: mezclarlo con el
//     resto infla las cifras de los dos.
//
// Uso: docker exec -i setex-prod-backend node eval/comparar-v1-v2.js
'use strict';

const fs = require('fs');
const { Pool } = require('pg');

function readSecret(name) {
  try { return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim(); } catch { return null; }
}

const CAMPOS_IDENTIDAD = ['emisor.nombre', 'emisor.nif', 'receptor.nombre', 'receptor.nif'];
const CAMPOS_DOCUMENTO = ['numero_factura', 'fecha_emision', 'total'];
const CAMPOS = [...CAMPOS_IDENTIDAD, ...CAMPOS_DOCUMENTO];

function normalizar(campo, valor) {
  if (valor == null) return null;
  const s = String(valor).trim();
  if (s === '') return null;
  if (campo.endsWith('.nif')) return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (campo === 'total') {
    const f = parseFloat(s.replace(/[€\s]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    return Number.isNaN(f) ? s.toUpperCase() : f.toFixed(2);
  }
  return s.toUpperCase().replace(/\s+/g, ' ');
}

// v1 guarda su resultado con shape plano; v2 con shape canonico anidado.
function valorV1(merged, campo) {
  if (!merged) return null;
  const mapa = {
    'emisor.nombre': merged.proveedor_nombre,
    'emisor.nif': merged.proveedor_nif,
    'receptor.nombre': merged.receptor_nombre,
    'receptor.nif': merged.receptor_nif,
    numero_factura: merged.numero_factura,
    fecha_emision: merged.fecha_emision,
    total: merged.total ?? merged.total_factura,
  };
  return mapa[campo] ?? null;
}

function valorV2(canonico, campo) {
  if (!canonico) return null;
  const mapa = {
    'emisor.nombre': canonico.emisor?.nombre,
    'emisor.nif': canonico.emisor?.nif,
    'receptor.nombre': canonico.receptor?.nombre,
    'receptor.nif': canonico.receptor?.nif,
    numero_factura: canonico.numero_factura,
    fecha_emision: canonico.fecha_emision,
    total: canonico.total,
  };
  return mapa[campo] ?? null;
}

async function run() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: 5432, database: 'setex_db', user: 'setex_user',
    password: readSecret('postgres_password'), max: 3,
  });

  // v2: la fila de replay MAS RECIENTE por factura (hay varias si se relanzo).
  const { rows } = await pool.query(`
    SELECT u.id,
           u.ocr_result->'merged' AS v1_merged,
           e.campos_canonicos     AS v2_canonico,
           e.estado               AS v2_estado,
           e.score_global         AS v2_score,
           e.alucinaciones_sospechosas AS v2_alucinaciones
      FROM uploads u
      JOIN users us ON us.id = u.user_id
      LEFT JOIN LATERAL (
        SELECT * FROM extracciones_v2 e2
         WHERE e2.upload_id = u.id AND e2.modo = 'replay'
         ORDER BY e2.creado_en DESC LIMIT 1
      ) e ON TRUE
     WHERE u.procesado_en IS NOT NULL AND us.is_test = false
     ORDER BY u.id`);

  const tot = {
    v1: { ok: 0, n: 0 }, v2: { ok: 0, n: 0 },
    v1Doc: { ok: 0, n: 0 }, v2Doc: { ok: 0, n: 0 },
  };
  const detalle = [];
  let sinGroundTruth = 0, sinReplay = 0;

  for (const r of rows) {
    let gt;
    try { gt = JSON.parse(fs.readFileSync(`/app/eval/facturas/${r.id}/ground_truth.json`, 'utf8')); }
    catch { sinGroundTruth++; continue; }
    if (!r.v2_canonico) { sinReplay++; continue; }

    const fila = { id: r.id, v1: 0, v2: 0, n: 0, fallosV1: [], fallosV2: [] };
    for (const campo of CAMPOS) {
      const gtCampo = gt.campos?.[campo];
      if (!gtCampo || gtCampo.estado !== 'legible') continue; // solo lo verificable
      const esperado = normalizar(campo, gtCampo.valor);
      if (esperado == null) continue;

      const got1 = normalizar(campo, valorV1(r.v1_merged, campo));
      const got2 = normalizar(campo, valorV2(r.v2_canonico, campo));
      const ok1 = got1 === esperado;
      const ok2 = got2 === esperado;

      fila.n++;
      if (ok1) fila.v1++; else fila.fallosV1.push(`${campo}: "${got1}" != "${esperado}"`);
      if (ok2) fila.v2++; else fila.fallosV2.push(`${campo}: "${got2}" != "${esperado}"`);

      tot.v1.n++; tot.v2.n++;
      if (ok1) tot.v1.ok++;
      if (ok2) tot.v2.ok++;
      if (CAMPOS_DOCUMENTO.includes(campo)) {
        tot.v1Doc.n++; tot.v2Doc.n++;
        if (ok1) tot.v1Doc.ok++;
        if (ok2) tot.v2Doc.ok++;
      }
    }
    fila.estado = r.v2_estado;
    fila.score = r.v2_score;
    fila.alucinaciones = r.v2_alucinaciones || [];
    detalle.push(fila);
  }

  const pct = (o, n) => (n === 0 ? '—' : `${((o / n) * 100).toFixed(1)}%`);

  console.log('\n════════ COMPARATIVA v1 vs v2 CONTRA VERDAD VERIFICADA ════════\n');
  console.log(`Facturas comparadas: ${detalle.length}` +
    (sinGroundTruth ? ` · sin ground truth: ${sinGroundTruth}` : '') +
    (sinReplay ? ` · sin replay v2: ${sinReplay}` : ''));
  console.log('(solo campos marcados "legible" por revisión humana)\n');

  console.log('TODOS LOS CAMPOS');
  console.log(`  v1: ${tot.v1.ok}/${tot.v1.n}  ${pct(tot.v1.ok, tot.v1.n)}`);
  console.log(`  v2: ${tot.v2.ok}/${tot.v2.n}  ${pct(tot.v2.ok, tot.v2.n)}`);
  console.log('\nSOLO CAMPOS DEL DOCUMENTO (nº factura, fecha, total)');
  console.log('  — excluye identidad, que ambos toman de la BD y no de la imagen —');
  console.log(`  v1: ${tot.v1Doc.ok}/${tot.v1Doc.n}  ${pct(tot.v1Doc.ok, tot.v1Doc.n)}`);
  console.log(`  v2: ${tot.v2Doc.ok}/${tot.v2Doc.n}  ${pct(tot.v2Doc.ok, tot.v2Doc.n)}`);

  const peor = detalle.filter((f) => f.v2 < f.v1);
  const mejor = detalle.filter((f) => f.v2 > f.v1);
  console.log(`\nFacturas donde v2 MEJORA a v1: ${mejor.length}`);
  for (const f of mejor) console.log(`  #${f.id}: v1 ${f.v1}/${f.n} → v2 ${f.v2}/${f.n}  | v1 fallaba: ${f.fallosV1.join(' · ')}`);
  console.log(`\nFacturas donde v2 EMPEORA a v1: ${peor.length}`);
  for (const f of peor) console.log(`  #${f.id}: v1 ${f.v1}/${f.n} → v2 ${f.v2}/${f.n}  | v2 falla: ${f.fallosV2.join(' · ')}`);

  const conAlucinacion = detalle.filter((f) => (f.alucinaciones || []).length > 0);
  console.log(`\nFacturas con sospecha de alucinación marcada por v2: ${conAlucinacion.length}`);

  const revisables = detalle.filter((f) => f.estado !== 'auto_aprobada');
  const erroresEnAuto = detalle.filter((f) => f.estado === 'auto_aprobada' && f.v2 < f.n);
  console.log(`\nRouting de v2: ${detalle.length - revisables.length} auto-aprobadas · ${revisables.length} a revisión humana`);
  console.log(`  ⚠ Auto-aprobadas CON algún error: ${erroresEnAuto.length}` +
    (erroresEnAuto.length ? ` → ${erroresEnAuto.map((f) => '#' + f.id).join(', ')}` : ''));
  console.log('  (este es el número que decide si v2 puede activarse: un error auto-aprobado');
  console.log('   entra en contabilidad sin que nadie lo mire)\n');

  await pool.end();
}

run().catch((err) => { console.error('Error:', err.message); process.exit(1); });
