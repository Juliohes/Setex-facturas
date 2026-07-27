// src/ocr/benchmark.js
// Banco de pruebas multi-imagen × multi-motor (2026-07-23, petición de Julio).
//
// Genera 3 variantes de la MISMA foto y las pasa por TODOS los motores OCR
// disponibles, para ver campo a campo qué combinación imagen+motor acierta
// más. Es puramente experimental/comparativo: NUNCA sustituye ni afecta al
// pipeline real de producción (ocr/index.js). Cuesta dinero real (hasta 3
// variantes × 5 motores = 15 llamadas por factura) — solo corre cuando se
// activa explícitamente (flag o botón del panel admin).
//
// Las 3 variantes:
//   - actual:    la misma optimización que usa hoy el pipeline real
//                (1536px máx, JPEG 85%) — para comparar motores en igualdad
//                de condiciones con lo que reciben normalmente.
//   - original:  el fichero tal cual se subió, SIN reducir píxeles.
//   - contraste: contraste local (CLAHE) + brillo/saturación mínimos,
//                generada a partir de la ORIGINAL (no de la ya reducida) —
//                mismo motivo que domina en ocr/image-variants.js: penaliza
//                mucho menos las sombras que un contraste global simple.
'use strict';

const fs = require('fs').promises;
const sharp = require('sharp');
const openai = require('./openai');
const azure = require('./azure');
const gemini = require('./gemini');
const mistral = require('./mistral');
const { generarVarianteContraste } = require('./image-variants');

function getSecret(name) {
  try {
    return require('fs').readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return process.env[name.toUpperCase()] || null;
  }
}

const VARIANTES = ['actual', 'original', 'contraste'];
const MOTORES = ['openai', 'azure', 'gemini_flash', 'gemini_pro', 'mistral'];

// Campos clave usados para puntuar cada combinación imagen+motor contra lo
// que el humano confirmó — el mismo criterio que ya usa el ranking del
// modal OCR y domain/routing.js, para mantener un único criterio de acierto
// en todo el proyecto.
const CAMPOS_PUNTUABLES = [
  'proveedor_nif', 'proveedor_nombre', 'receptor_nif', 'receptor_nombre',
  'numero_factura', 'fecha_emision', 'total', 'base_imponible',
  'iva_porcentaje', 'cuota_iva',
];

// 2026-07-24: agrupación de CAMPOS_PUNTUABLES para el ranking por campo del
// panel (Julio pidió saber si un motor falla más en CIF, nombre, fecha,
// importes o tramos de IVA — no solo un ratio agregado).
const GRUPOS_CAMPOS = {
  proveedor_nif:   'CIF/NIF',
  receptor_nif:    'CIF/NIF',
  proveedor_nombre:'Nombre',
  receptor_nombre: 'Nombre',
  numero_factura:  'Nº factura',
  fecha_emision:   'Fecha',
  total:           'Importes',
  base_imponible:  'Importes',
  cuota_iva:       'Importes',
  iva_porcentaje:  'Tramos IVA',
};

function normalizarParaComparar(v) {
  if (v == null) return null;
  return String(v).trim().toUpperCase().replace(/^(-?\d+)[,.](\d+)$/, '$1.$2');
}

/** Genera las 3 variantes de imagen a partir del fichero original en disco. */
async function prepararVariantes(filePath, mimeType) {
  if (!mimeType || !mimeType.startsWith('image/')) {
    // PDF u otro no-imagen: no tiene sentido CLAHE/resize — las 3 "variantes"
    // son el mismo fichero, así el benchmark sigue siendo comparable motor a
    // motor aunque no aporte nada en el eje de la imagen para este caso.
    const buf = await fs.readFile(filePath);
    const misma = { buffer: buf, mime: mimeType };
    return { actual: misma, original: misma, contraste: misma };
  }
  const originalBuffer = await fs.readFile(filePath);
  const actualBuffer = await sharp(originalBuffer)
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const contrasteBuffer = await generarVarianteContraste(originalBuffer);
  return {
    actual:     { buffer: actualBuffer,   mime: 'image/jpeg' },
    original:   { buffer: originalBuffer, mime: mimeType },
    contraste:  { buffer: contrasteBuffer, mime: 'image/jpeg' },
  };
}

/** Ejecuta un único motor sobre una imagen ya preparada. Nunca lanza. */
async function ejecutarMotor(motor, imagen, filePath, mimeType, context, cfg) {
  const start = Date.now();
  try {
    let resultado;
    if (motor === 'openai') {
      const apiKey = getSecret('openai_api_key');
      resultado = await openai.extractInvoice(filePath, mimeType, apiKey, context, imagen);
    } else if (motor === 'azure') {
      const apiKey = getSecret('azure_di_key');
      const endpoint = getSecret('azure_di_endpoint');
      resultado = await azure.extractInvoice(filePath, mimeType, apiKey, endpoint, context, imagen);
    } else if (motor === 'gemini_flash' || motor === 'gemini_pro') {
      const apiKey = getSecret('gemini_api_key');
      const label = motor === 'gemini_pro' ? 'pro' : 'flash';
      const modelId = label === 'pro' ? cfg.ocr_gemini_pro_model : cfg.ocr_gemini_flash_model;
      resultado = await gemini.extractInvoice(filePath, mimeType, apiKey, context, modelId, label, imagen);
    } else if (motor === 'mistral') {
      const apiKey = getSecret('mistral_api_key');
      resultado = await mistral.extractInvoice(filePath, mimeType, apiKey, context, imagen);
    } else {
      throw new Error(`Motor desconocido: ${motor}`);
    }
    return {
      motor,
      campos: resultado.campos || {},
      es_factura_valida: resultado.es_factura_valida ?? null,
      tiempo_ms: Date.now() - start,
      error: null,
    };
  } catch (err) {
    return {
      motor, campos: {}, es_factura_valida: null,
      tiempo_ms: Date.now() - start, error: err.message,
    };
  }
}

/**
 * Puntúa un resultado (campos extraídos) contra los valores confirmados por
 * el humano — nº de campos clave que coinciden. Sirve para declarar "quién
 * ganó" en cada factura sin depender de opinión subjetiva.
 *
 * `detalle` (2026-07-24): además del ratio agregado, guarda acierto/fallo
 * POR CAMPO (solo de los campos con valor confirmado, es decir comparables)
 * para poder construir después un ranking por campo (¿qué motor falla más
 * en CIF? ¿en fecha? ¿en tramos de IVA?) sin volver a llamar a ninguna IA.
 */
function puntuarContraConfirmado(campos, confirmado) {
  let aciertos = 0;
  let comparables = 0;
  const detalle = {};
  for (const campo of CAMPOS_PUNTUABLES) {
    const vConfirmado = confirmado[campo];
    if (vConfirmado == null || vConfirmado === '') continue; // sin referencia, no puntúa
    comparables++;
    const vExtraido = campo === 'total' ? (campos.total_factura ?? campos.total) : campos[campo];
    const acierto = normalizarParaComparar(vExtraido) === normalizarParaComparar(vConfirmado);
    if (acierto) aciertos++;
    detalle[campo] = acierto;
  }
  return { aciertos, comparables, detalle };
}

/**
 * Ejecuta el benchmark completo (3 variantes × todos los motores) para una
 * factura ya guardada. Devuelve un array plano de resultados, uno por
 * combinación variante+motor, con la puntuación ya calculada contra lo
 * confirmado por el humano.
 *
 * @param {string} filePath - ruta del fichero original en disco
 * @param {string} mimeType
 * @param {object} context  - { invoice_type, empresa_nif, empresa_nombre }
 * @param {object} cfg      - features.json ya parseado (modelos Gemini, etc.)
 * @param {object} confirmado - campos confirmados por el humano (para puntuar)
 * @param {object} logger
 * @returns {Promise<Array>}
 */
async function ejecutarBenchmarkCompleto(filePath, mimeType, context, cfg, confirmado, logger) {
  const variantesImg = await prepararVariantes(filePath, mimeType);
  const resultados = [];

  for (const variante of VARIANTES) {
    const imagen = variantesImg[variante];
    const settled = await Promise.allSettled(
      MOTORES.map((motor) => ejecutarMotor(motor, imagen, filePath, mimeType, context, cfg))
    );
    settled.forEach((s, i) => {
      const motor = MOTORES[i];
      const base = s.status === 'fulfilled'
        ? s.value
        : { motor, campos: {}, es_factura_valida: null, tiempo_ms: null, error: s.reason?.message || 'error desconocido' };
      const puntuacion = puntuarContraConfirmado(base.campos || {}, confirmado || {});
      resultados.push({ variante, ...base, ...puntuacion });
      if (logger) {
        logger.info(`[Benchmark] ${variante}/${motor}: ${puntuacion.aciertos}/${puntuacion.comparables} campos correctos${base.error ? ` (error: ${base.error})` : ''}`);
      }
    });
  }
  return resultados;
}

module.exports = {
  ejecutarBenchmarkCompleto,
  prepararVariantes,
  puntuarContraConfirmado,
  normalizarParaComparar,
  VARIANTES,
  MOTORES,
  CAMPOS_PUNTUABLES,
  GRUPOS_CAMPOS,
};
