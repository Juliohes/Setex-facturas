// src/ocr/index.js
// Orquestador OCR DUAL — ejecuta OpenAI GPT-4.1 + Azure Document Intelligence en PARALELO.
// Cuando ambos motores coinciden en NIF + fecha + total → dual_confirmed:true (máxima fiabilidad).
// Cuando discrepan → reconciliación con dígito de control + lectura enfocada CIF como árbitro.
//
// MOTORES:
//   "openai" — GPT-4.1 Vision (activo siempre)
//   "azure"  — Azure Document Intelligence prebuilt-invoice (sin alucinaciones, $0.0015/factura)
//
// MODO (features.json → ocr_mode):
//   "dual"    — ambos en paralelo (DEFECTO, máxima confianza)
//   "openai"  — solo OpenAI
//   "azure"   — solo Azure
'use strict';

const fs     = require('fs');
const openai = require('./openai');
const azure  = require('./azure');
const { mergeLineasIva } = require('./validateIVA');

function getSecret(name) {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return process.env[name.toUpperCase()] || null;
  }
}

function isPlaceholder(val) {
  if (!val) return true;
  return val.includes('INSERTAR') || val.includes('PLACEHOLDER') || val.length < 8;
}

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync('/app/src/config/features.json', 'utf8'));
  } catch {
    return {};
  }
}

// ─── Intentos individuales por motor ─────────────────────────────────────────

async function tryOpenAI(filePath, mimeType, context) {
  const apiKey = getSecret('openai_api_key');
  if (isPlaceholder(apiKey)) throw new Error('OpenAI: openai_api_key no configurada');
  return await openai.extractInvoice(filePath, mimeType, apiKey, context);
}

async function tryAzure(filePath, mimeType, context) {
  const apiKey   = getSecret('azure_di_key');
  const endpoint = getSecret('azure_di_endpoint');
  if (isPlaceholder(apiKey) || isPlaceholder(endpoint)) {
    throw new Error('Azure DI: secrets no configurados — añade azure_di_key y azure_di_endpoint en /opt/setex-captu-facture/secrets/');
  }
  return await azure.extractInvoice(filePath, mimeType, apiKey, endpoint, context);
}

// ─── Normalización para comparar ─────────────────────────────────────────────

function normalizeToFloat(str) {
  if (!str) return null;
  let s = String(str).trim().replace(/[€$\s]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    return s.lastIndexOf(',') > s.lastIndexOf('.')
      ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
      : parseFloat(s.replace(/,/g, ''));
  }
  if (s.includes(',')) {
    const after = s.split(',').pop();
    return after?.length === 3
      ? parseFloat(s.replace(/,/g, ''))
      : parseFloat(s.replace(',', '.'));
  }
  return parseFloat(s);
}

function amountsAgree(a, b) {
  const fa = normalizeToFloat(a);
  const fb = normalizeToFloat(b);
  if (fa == null || fb == null) return true;
  if (fa === 0 && fb === 0) return true;
  const max = Math.max(Math.abs(fa), Math.abs(fb));
  if (max === 0) return true;
  return Math.abs(fa - fb) / max < 0.02; // 2% tolerancia
}

function normNif(n) {
  return n ? n.toUpperCase().replace(/[\s\-\.]/g, '') : null;
}

// ─── Comparador y fusionador de resultados duales ─────────────────────────────

function compareOCRResults(openaiRes, azureRes, logger) {
  if (!openaiRes && !azureRes) return null;

  if (!openaiRes || openaiRes.es_factura_valida === false) {
    logger.info('[DualOCR] Solo Azure produjo resultado válido');
    return { ...azureRes, dual_confirmed: false, missing_engine: 'openai', ocr_engine: 'dual_openai_azure' };
  }
  if (!azureRes || azureRes.es_factura_valida === false) {
    logger.info('[DualOCR] Solo OpenAI produjo resultado válido');
    return { ...openaiRes, dual_confirmed: false, missing_engine: 'azure', ocr_engine: 'dual_openai_azure' };
  }

  const oF = openaiRes.campos || {};
  const aF = azureRes.campos  || {};

  const oNif  = normNif(oF.proveedor_nif);
  const aNif  = normNif(aF.proveedor_nif);

  // OCR-001: distinguir escenarios de acuerdo NIF para evitar falso-positivo de dual_confirmed
  // - 'confirmed'    → ambos motores leyeron el mismo NIF (máxima confianza)
  // - 'both_missing' → ningún motor extrajo NIF (confianza baja)
  // - 'single_source'→ solo un motor leyó NIF (no es confirmación real)
  // - 'conflict'     → los dos motores leyeron NIFs distintos (requiere árbitro)
  const nifStatus = (!oNif && !aNif) ? 'both_missing'
                  : (!oNif || !aNif) ? 'single_source'
                  : (oNif === aNif)  ? 'confirmed'
                  : 'conflict';
  const nifAgree   = nifStatus !== 'conflict';
  const totalAgree = amountsAgree(oF.total, aF.total);
  const fechaAgree = !oF.fecha_emision || !aF.fecha_emision || oF.fecha_emision === aF.fecha_emision;
  // dual_confirmed solo es true cuando NIF está CONFIRMADO por ambos motores (not single_source ni both_missing)
  const dual_confirmed = nifStatus === 'confirmed' && totalAgree && fechaAgree;

  if (nifStatus === 'conflict')      logger.warn(`[DualOCR] NIF discrepancia: OpenAI="${oNif}" Azure="${aNif}"`);
  if (nifStatus === 'single_source') logger.info(`[DualOCR] NIF fuente única: OpenAI="${oNif || '—'}" Azure="${aNif || '—'}"`);
  if (nifStatus === 'both_missing')  logger.warn('[DualOCR] NIF no extraído por ningún motor');
  if (!totalAgree) logger.warn(`[DualOCR] Total discrepancia: OpenAI="${oF.total}" Azure="${aF.total}"`);
  if (!fechaAgree) logger.warn(`[DualOCR] Fecha discrepancia: OpenAI="${oF.fecha_emision}" Azure="${aF.fecha_emision}"`);

  // ── Fusión de campos ──────────────────────────────────────────────────────
  // Prioridades:
  //   NIF/Nombre:     OpenAI (mejor lectura de texto español) + Azure como árbitro si discrepan
  //   Fecha:          Azure si hay discrepancia (más preciso con estructuras de fecha)
  //   Importes (IVA): Azure primario para base/total (no alucina); OpenAI para formato español
  //   IRPF:           SOLO OpenAI (Azure no extrae IRPF)
  //   lineas_iva:     mergeLineasIva (Azure prioritario si tiene TaxDetails)
  //   numero_factura: OpenAI || Azure

  const merged = {
    numero_factura:   oF.numero_factura  || aF.numero_factura,
    proveedor_nif:    nifAgree ? (oNif || aNif) : (aNif || oNif),
    proveedor_nombre: oF.proveedor_nombre || aF.proveedor_nombre,
    receptor_nif:     normNif(oF.receptor_nif) || normNif(aF.receptor_nif),
    receptor_nombre:  oF.receptor_nombre  || aF.receptor_nombre,
    fecha_emision:    fechaAgree
      ? (oF.fecha_emision || aF.fecha_emision)
      : (aF.fecha_emision || oF.fecha_emision),
    // Importes: preferir Azure (sin alucinaciones), OpenAI como fallback
    base_imponible:   aF.base_imponible   || oF.base_imponible,
    iva_porcentaje:   aF.iva_porcentaje   || oF.iva_porcentaje,
    cuota_iva:        aF.cuota_iva        || oF.cuota_iva,
    // lineas_iva: fusión inteligente — tomar el más completo
    lineas_iva:       mergeLineasIva(oF.lineas_iva, aF.lineas_iva),
    // IRPF: solo OpenAI (Azure no extrae retenciones españolas)
    irpf_porcentaje:  oF.irpf_porcentaje || '0,0',
    cuota_irpf:       oF.cuota_irpf      || '0,00',
    total: totalAgree
      ? (oF.total || aF.total)
      : oF.total, // si discrepan → OpenAI (mejor formato español)
    moneda: oF.moneda || aF.moneda || 'EUR',
    es_factura_valida: openaiRes.es_factura_valida !== false || azureRes.es_factura_valida !== false,
  };

  const baseConf = Math.max(openaiRes.confidence || 0, azureRes.confidence || 0);
  // Q5: penalizar confianza según calidad del acuerdo de NIF:
  //   - dual_confirmed (ambos leen el mismo NIF): boost +15%
  //   - single_source (solo un motor leyó NIF): penalización -15%
  //   - both_missing (ningún motor leyó NIF): penalización -40% — señal de alerta
  const confidence = dual_confirmed
    ? Math.min(baseConf * 1.15, 1.0)
    : nifStatus === 'both_missing'
      ? baseConf * 0.60
      : baseConf * 0.85;

  logger.info(`[DualOCR] confirmed=${dual_confirmed} nif_status=${nifStatus} totalOK=${totalAgree} fechaOK=${fechaAgree} openaiTime=${openaiRes.processing_time_s}s azureTime=${azureRes.processing_time_s}s lineasIva=${merged.lineas_iva?.length || 0}`);

  return {
    success: true,
    es_factura_valida: merged.es_factura_valida,
    campos: merged,
    confidence,
    processing_time_s: Math.max(openaiRes.processing_time_s || 0, azureRes.processing_time_s || 0),
    ocr_engine: 'dual_openai_azure',
    tokens_used: openaiRes.tokens_used || 0,
    dual_confirmed,
    openai_result: {
      campos: oF,
      confidence: openaiRes.confidence,
      engine: openaiRes.ocr_engine,
      time_s: openaiRes.processing_time_s,
    },
    azure_result: {
      campos: aF,
      confidence: azureRes.confidence,
      engine: azureRes.ocr_engine,
      time_s: azureRes.processing_time_s,
    },
    nif_status: nifStatus,
    nif_discrepancy: nifStatus === 'conflict' ? { openai: oNif, azure: aNif } : null,
  };
}

// ─── Orquestador principal ─────────────────────────────────────────────────────

/**
 * Extrae datos de una factura.
 * Por defecto ejecuta OpenAI + Azure DI en PARALELO (modo dual).
 * Nunca lanza excepción — devuelve null si todos los motores fallan.
 *
 * @param {string} filePath
 * @param {string} mimeType
 * @param {string} fileName
 * @param {object} logger   - Winston logger
 * @param {object} context  - { invoice_type, empresa_nif, empresa_nombre }
 */
async function extractInvoiceOCR(filePath, mimeType, fileName, logger, context = {}) {
  const cfg  = getConfig();
  const mode = cfg.ocr_mode || 'dual';

  // ── Modo DUAL (defecto) ───────────────────────────────────────────────────
  if (mode === 'dual') {
    logger.info(`[OCR] Modo dual: lanzando OpenAI + Azure DI en paralelo para ${fileName} | tipo=${context.invoice_type || 'no_especificado'}`);

    const [openaiSettled, azureSettled] = await Promise.allSettled([
      tryOpenAI(filePath, mimeType, context),
      tryAzure(filePath, mimeType, context),
    ]);

    let openaiRes = null;
    let azureRes  = null;

    if (openaiSettled.status === 'fulfilled') {
      openaiRes = openaiSettled.value;
      logger.info(`[OCR] OpenAI OK: tiempo=${openaiRes.processing_time_s}s valida=${openaiRes.es_factura_valida} total=${openaiRes.campos?.total} nif=${openaiRes.campos?.proveedor_nif} lineasIva=${openaiRes.campos?.lineas_iva?.length || 0} tokens=${openaiRes.tokens_used}`);
    } else {
      logger.warn(`[OCR] OpenAI FALLÓ: ${openaiSettled.reason?.message}`);
    }

    if (azureSettled.status === 'fulfilled') {
      azureRes = azureSettled.value;
      logger.info(`[OCR] Azure DI OK: tiempo=${azureRes.processing_time_s}s valida=${azureRes.es_factura_valida} total=${azureRes.campos?.total} nif=${azureRes.campos?.proveedor_nif} lineasIva=${azureRes.campos?.lineas_iva?.length || 0}`);
    } else {
      logger.warn(`[OCR] Azure DI FALLÓ: ${azureSettled.reason?.message}`);
    }

    const result = compareOCRResults(openaiRes, azureRes, logger);
    if (result) {
      logger.info(`[OCR] Resultado dual: dual_confirmed=${result.dual_confirmed} confidence=${result.confidence?.toFixed(2)} nif=${result.campos?.proveedor_nif} lineas_iva=${result.campos?.lineas_iva?.length || 0}`);
    } else {
      logger.warn('[OCR] Ambos motores fallaron — no hay resultado');
    }
    return result;
  }

  // ── Modo SINGLE ───────────────────────────────────────────────────────────
  try {
    let result;
    if (mode === 'openai') {
      result = await tryOpenAI(filePath, mimeType, context);
    } else if (mode === 'azure') {
      result = await tryAzure(filePath, mimeType, context);
    } else {
      logger.warn(`[OCR] Modo desconocido "${mode}" → usando OpenAI`);
      result = await tryOpenAI(filePath, mimeType, context);
    }
    logger.info(`[OCR] Motor ${mode}: tiempo=${result.processing_time_s}s valida=${result.es_factura_valida} total=${result.campos?.total}`);
    return { ...result, dual_confirmed: false };
  } catch (err) {
    logger.error(`[OCR] Motor ${mode} falló: ${err.message}`);
    return null;
  }
}

/**
 * Extracción enfocada solo en CIF/NIF del emisor (árbitro cuando los motores discrepan).
 */
async function extractCIFOnlyOCR(filePath, mimeType) {
  const apiKey = getSecret('openai_api_key');
  if (isPlaceholder(apiKey)) return null;
  try {
    return await openai.extractCIFOnly(filePath, mimeType, apiKey);
  } catch {
    return null;
  }
}

module.exports = { extractInvoiceOCR, extractCIFOnlyOCR };
