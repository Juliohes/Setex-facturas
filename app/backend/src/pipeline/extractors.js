// src/pipeline/extractors.js
// Fase 4 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: capa de extracción
// multi-modelo (patrón adapter).
//
// Reutiliza LAS MISMAS llamadas HTTP que ya usa el pipeline v1
// (ocr/openai.js, azure.js, gemini.js, mistral.js) — no las duplica ni las
// modifica — añadiendo por fuera: reintentos con backoff (pipeline/retry.js),
// medición de latencia/tokens/coste, y normalización al esquema canónico
// (pipeline/schema.js).
//
// Azure + Gemini Flash se ejecutan en el paralelo inicial (mismo criterio
// que el modo "gemini_azure" de v1, ver docs/INFORME-AUDITORIA-OCR.md §8).
// OpenAI y Mistral quedan disponibles vía ejecutarExtractor() pero NO se
// invocan en el paralelo — quedan como árbitro de desempate para la Fase 5,
// evitando de paso el bug confirmado de OpenAI con PDFs en la llamada
// inicial (ver auditoría §7: HTTP 400 "Invalid MIME type").
'use strict';

const fs = require('fs');
const openai = require('../ocr/openai');
const azure = require('../ocr/azure');
const gemini = require('../ocr/gemini');
const mistral = require('../ocr/mistral');
const { conReintentos } = require('./retry');
const { FacturaCanonicaSchema } = require('./schema');

function getSecret(name) {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return process.env[name.toUpperCase()] || null;
  }
}

// Coste estimado por llamada, USD (misma fuente que eval/evaluate.js —
// cabeceras de ocr/index.js y CLAUDE.md §2.2).
const COSTE_ESTIMADO_USD = {
  openai: 0.007, azure: 0.0015, mistral: 0.004, gemini_flash: 0.006, gemini_pro: 0.01,
};

/** Traduce el shape libre de un motor v1 (campos.*) al esquema canónico Zod. */
function normalizarACanonico(resultadoMotor, nombreMotor) {
  const c = resultadoMotor.campos || {};
  return {
    emisor: { nombre: c.proveedor_nombre ?? null, nif: c.proveedor_nif ?? null },
    receptor: { nombre: c.receptor_nombre ?? null, nif: c.receptor_nif ?? null },
    numero_factura: c.numero_factura ?? null,
    fecha_emision: c.fecha_emision ?? null,
    lineas_iva: Array.isArray(c.lineas_iva)
      ? c.lineas_iva.map((l) => ({ base: l.base ?? null, tipo: l.porcentaje ?? null, cuota: l.cuota ?? null }))
      : [],
    retencion_irpf: c.cuota_irpf ?? null,
    total: c.total ?? null,
    moneda: c.moneda || 'EUR',
    es_factura_valida: resultadoMotor.es_factura_valida !== false,
    _fuente: nombreMotor,
    _confianza: resultadoMotor.confidence ?? null,
  };
}

/**
 * Ejecuta un motor con reintentos automáticos, midiendo latencia. NUNCA
 * lanza: un fallo irrecuperable (tras agotar reintentos, o no reintentable)
 * se devuelve como `{ ok: false, error }` — el orquestador decide qué hacer,
 * nunca se tumba el conjunto por un motor caído (regla Fase 4.3 del prompt).
 */
async function ejecutarExtractor(nombreMotor, llamada, logger) {
  const inicio = Date.now();
  try {
    const resultado = await conReintentos(llamada, { logger });
    const tiempoMs = Date.now() - inicio;
    const canonico = normalizarACanonico(resultado, nombreMotor);
    FacturaCanonicaSchema.parse(canonico);
    return {
      motor: nombreMotor, ok: true, campos: canonico,
      tiempo_ms: tiempoMs,
      tokens: resultado.tokens_used ?? null,
      coste_estimado_usd: COSTE_ESTIMADO_USD[nombreMotor] ?? null,
      // 2026-07-27 (Fase 10): se conserva tal cual si el motor lo aporta
      // (hoy solo azure.js, Fase 7) — el orquestador lo usa para la
      // re-extracción dirigida cuando un campo queda en disputa.
      bounding_boxes: resultado.bounding_boxes ?? null,
    };
  } catch (err) {
    return {
      motor: nombreMotor, ok: false, campos: null, error: err.message,
      tiempo_ms: Date.now() - inicio, coste_estimado_usd: null,
    };
  }
}

/**
 * Orquestador Fase 4: Azure + Gemini Flash en paralelo, con reintentos.
 * Nunca lanza — cada motor reporta su propio éxito/fallo de forma aislada.
 *
 * @param {string} filePath
 * @param {string} mimeType
 * @param {object} context  - { invoice_type, empresa_nif, empresa_nombre }
 * @param {object} cfg      - features.json ya parseado
 * @param {object} [logger]
 */
async function ejecutarExtraccionV2Paralelo(filePath, mimeType, context, cfg, logger) {
  const azureKey = getSecret('azure_di_key');
  const azureEndpoint = getSecret('azure_di_endpoint');
  const geminiKey = getSecret('gemini_api_key');
  const geminiModel = cfg.ocr_gemini_flash_model || gemini.DEFAULT_MODELS.flash;

  const [resAzure, resGemini] = await Promise.all([
    ejecutarExtractor('azure', () => azure.extractInvoice(filePath, mimeType, azureKey, azureEndpoint, context), logger),
    ejecutarExtractor('gemini_flash', () => gemini.extractInvoice(filePath, mimeType, geminiKey, context, geminiModel, 'flash'), logger),
  ]);

  return { azure: resAzure, gemini_flash: resGemini };
}

/**
 * OpenAI/Mistral como árbitro de desempate (Fase 5 los invocará desde aquí,
 * pasando la imagen o un recorte). Expuesto ya en esta fase para que la
 * Fase 5 no tenga que reimplementar el wrapping de reintentos/normalización.
 */
async function ejecutarArbitro(nombreMotor, filePath, mimeType, context, cfg, logger) {
  if (nombreMotor === 'openai') {
    const apiKey = getSecret('openai_api_key');
    return ejecutarExtractor('openai', () => openai.extractInvoice(filePath, mimeType, apiKey, context), logger);
  }
  if (nombreMotor === 'mistral') {
    const apiKey = getSecret('mistral_api_key');
    return ejecutarExtractor('mistral', () => mistral.extractInvoice(filePath, mimeType, apiKey, context), logger);
  }
  throw new Error(`Árbitro desconocido: ${nombreMotor}`);
}

// ── Selección configurable de motores (2026-07-29) ────────────────────────
// Decisión de Julio: dejar de cablear azure+gemini y poder elegir en caliente
// entre 2-4 motores base + árbitro opcional. Azure se retira del default (plan
// gratuito F0 insuficiente para el volumen real, ver PLAN-ACTIVACION-OCR-V2
// §C.5) pero queda DISPONIBLE aquí para cuando se contrate S0. Cada entrada
// construye la MISMA llamada HTTP que ya usa v1 — no duplica ni modifica los
// adaptadores. Los nombres coinciden con las claves de COSTE_ESTIMADO_USD.
const CONSTRUCTORES_LLAMADA = {
  azure: (filePath, mimeType, context) => {
    const key = getSecret('azure_di_key');
    const endpoint = getSecret('azure_di_endpoint');
    return () => azure.extractInvoice(filePath, mimeType, key, endpoint, context);
  },
  gemini_flash: (filePath, mimeType, context, cfg) => {
    const key = getSecret('gemini_api_key');
    const model = cfg.ocr_gemini_flash_model || gemini.DEFAULT_MODELS.flash;
    return () => gemini.extractInvoice(filePath, mimeType, key, context, model, 'flash');
  },
  gemini_pro: (filePath, mimeType, context, cfg) => {
    const key = getSecret('gemini_api_key');
    const model = cfg.ocr_gemini_pro_model || gemini.DEFAULT_MODELS.pro;
    return () => gemini.extractInvoice(filePath, mimeType, key, context, model, 'pro');
  },
  openai: (filePath, mimeType, context) => {
    const key = getSecret('openai_api_key');
    return () => openai.extractInvoice(filePath, mimeType, key, context);
  },
  mistral: (filePath, mimeType, context) => {
    const key = getSecret('mistral_api_key');
    return () => mistral.extractInvoice(filePath, mimeType, key, context);
  },
};

/** Motores que pueden participar como base o árbitro. Fuente de verdad única. */
const MOTORES_SOPORTADOS = Object.keys(CONSTRUCTORES_LLAMADA);

/**
 * Ejecuta UN motor por su nombre, con reintentos y medición (vía
 * ejecutarExtractor). NUNCA lanza: un motor no soportado o caído se devuelve
 * como `{ ok: false, error }` — el orquestador decide, nunca se tumba el
 * conjunto (misma garantía que ejecutarExtractor).
 */
async function ejecutarExtractorPorNombre(nombreMotor, filePath, mimeType, context, cfg, logger) {
  const constructor = CONSTRUCTORES_LLAMADA[nombreMotor];
  if (!constructor) {
    return { motor: nombreMotor, ok: false, campos: null, error: `motor no soportado: ${nombreMotor}`, tiempo_ms: 0, coste_estimado_usd: null };
  }
  const llamada = constructor(filePath, mimeType, context, cfg || {});
  return ejecutarExtractor(nombreMotor, llamada, logger);
}

/**
 * Ejecuta EN PARALELO la lista de motores indicada (2-4), cada uno con sus
 * reintentos. Devuelve un mapa { [motor]: resultado } — el orquestador lo
 * pasa al árbitro N-modelos (arbiter.arbitrarFacturaMulti). Nunca lanza.
 *
 * @param {string[]} nombresMotores - p.ej. ['gemini_flash','mistral']
 */
async function ejecutarExtraccionV2Multi(nombresMotores, filePath, mimeType, context, cfg, logger) {
  const resultados = await Promise.all(
    (nombresMotores || []).map((nombre) => ejecutarExtractorPorNombre(nombre, filePath, mimeType, context, cfg, logger)),
  );
  const mapa = {};
  for (const r of resultados) mapa[r.motor] = r;
  return mapa;
}

module.exports = {
  ejecutarExtractor,
  ejecutarExtraccionV2Paralelo,
  ejecutarExtractorPorNombre,
  ejecutarExtraccionV2Multi,
  ejecutarArbitro,
  normalizarACanonico,
  COSTE_ESTIMADO_USD,
  MOTORES_SOPORTADOS,
};
