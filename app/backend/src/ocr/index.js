// src/ocr/index.js
// Orquestador OCR multi-motor — ejecuta los motores activos en PARALELO.
// Cuando dos motores coinciden en NIF + fecha + total → dual_confirmed:true (máxima fiabilidad).
// Cuando discrepan → reconciliación con dígito de control + lectura enfocada CIF como árbitro.
//
// MOTORES:
//   "openai"  — GPT-4.1 Vision (activo siempre)
//   "azure"   — Azure Document Intelligence prebuilt-invoice (sin alucinaciones, $0.0015/factura)
//   "mistral" — Mistral OCR 4 (modelo OCR específico, annotations JSON, ~$0.004/factura)
//
// MODO (features.json → ocr_mode):
//   "dual"    — OpenAI + Azure en paralelo (DEFECTO)
//   "triple"  — OpenAI + Azure + Mistral en paralelo (votación 2-de-3 en importes)
//   "openai"  — solo OpenAI
//   "azure"   — solo Azure
//   "mistral" — solo Mistral OCR 4
'use strict';

const fs      = require('fs');
const openai  = require('./openai');
const azure   = require('./azure');
const mistral = require('./mistral');
const { mergeLineasIva, fillDerivedBases, normalizeConfirmedLineasIva, parseSpanishAmount } = require('./validateIVA');
const { validateSpanishTaxId } = require('./validateCIF');

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
    throw new Error('Azure DI: secrets no configurados — añade azure_di_key y azure_di_endpoint en secrets/ del entorno activo');
  }
  return await azure.extractInvoice(filePath, mimeType, apiKey, endpoint, context);
}

async function tryMistral(filePath, mimeType, context) {
  const apiKey = getSecret('mistral_api_key');
  if (isPlaceholder(apiKey)) {
    throw new Error('Mistral OCR: mistral_api_key no configurada — añade el secret en secrets/ del entorno activo');
  }
  return await mistral.extractInvoice(filePath, mimeType, apiKey, context);
}

// ─── Normalización para comparar ─────────────────────────────────────────────

function normalizeToFloat(str) {
  if (!str) return null;
  const s = String(str).trim().replace(/[€$\s]/g, '');
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

/** amountsAgree estricto: exige ambos valores presentes (amountsAgree devuelve true con null). */
function amountsBothAgree(a, b) {
  const fa = normalizeToFloat(a);
  const fb = normalizeToFloat(b);
  if (fa == null || fb == null) return false;
  return amountsAgree(a, b);
}

// ─── Integración del tercer motor (Mistral OCR 4) ─────────────────────────────
// Solo se invoca en modo triple con los 3 motores vivos. Reglas:
//   1. Relleno: campos null del merge dual se completan con la lectura Mistral.
//   2. lineas_iva: fusión con el desglose Mistral (mismo mergeLineasIva).
//   3. Votación 2-de-3 en importes: si el valor fusionado discrepa de Mistral
//      pero Mistral coincide con el OTRO motor primario, gana la mayoría.
function integrateMistralResult(merged, oF, aF, mF, logger) {
  // 1. Relleno de huecos en campos simples
  const FILLABLE = [
    'numero_factura', 'proveedor_nombre', 'receptor_nombre', 'fecha_emision',
    'base_imponible', 'iva_porcentaje', 'cuota_iva', 'total',
  ];
  for (const k of FILLABLE) {
    if (merged[k] == null && mF[k] != null) {
      merged[k] = mF[k];
      logger.info(`[TripleOCR] Campo ${k} rellenado por Mistral: "${mF[k]}"`);
    }
  }
  if (!merged.proveedor_nif && mF.proveedor_nif) merged.proveedor_nif = normNif(mF.proveedor_nif);
  if (!merged.receptor_nif  && mF.receptor_nif)  merged.receptor_nif  = normNif(mF.receptor_nif);

  // 2. Desglose multi-IVA: fusionar tramos Mistral con los ya fusionados
  if (Array.isArray(mF.lineas_iva) && mF.lineas_iva.length > 0) {
    merged.lineas_iva = mergeLineasIva(merged.lineas_iva, mF.lineas_iva);
  }

  // 3. Votación 2-de-3 en importes agregados
  for (const k of ['base_imponible', 'cuota_iva', 'total']) {
    const m = mF[k];
    if (m == null) continue;
    const cur = merged[k];
    if (cur == null || amountsBothAgree(cur, m)) continue; // ya coincide o ya rellenado
    // cur ≠ Mistral: ¿algún motor primario cuyo valor difiera del elegido respalda a Mistral?
    const backed = [oF[k], aF[k]].some(v => v != null && !amountsBothAgree(v, cur) && amountsBothAgree(v, m));
    if (backed) {
      logger.warn(`[TripleOCR] Votación 2-de-3 en ${k}: "${cur}" → "${m}" (Mistral + un motor primario coinciden)`);
      merged[k] = m;
    }
  }
}

// ─── Reconciliación de agregados multi-IVA (fix 2026-07-03) ───────────────────
// Con 2+ tramos: deriva bases que falten (Azure DI no da BaseAmount por tramo),
// valida cada línea y fuerza base_imponible = Σ bases, cuota_iva = Σ cuotas,
// iva_porcentaje = tipo dominante. Guard de cordura contra líneas mal leídas:
// el balance con el total debe ser plausible (se admite gap positivo hasta el
// 30% de la base — IRPF implícito máximo razonable, aún sin detectar aquí).
function reconcileMultiIvaAggregates(campos, logger) {
  if (!Array.isArray(campos.lineas_iva) || campos.lineas_iva.length < 2) return;

  fillDerivedBases(campos.lineas_iva);
  const norm = normalizeConfirmedLineasIva(campos.lineas_iva);
  if (!norm.lineas || norm.errors.length > 0) {
    logger.warn(`[OCR] Reconciliación multi-IVA no aplicada: ${norm.errors.join('; ') || 'sin líneas válidas'}`);
    return;
  }

  const sumBase  = parseSpanishAmount(norm.base);
  const sumCuota = parseSpanishAmount(norm.cuota);
  const totN     = parseSpanishAmount(campos.total);
  const irpfN    = parseSpanishAmount(campos.cuota_irpf) || 0;

  if (totN != null && sumBase != null && sumCuota != null) {
    const gap = sumBase + sumCuota - irpfN - totN; // > 0 → posible IRPF implícito
    const tol = Math.max(0.30, totN * 0.02);
    if (gap < -tol || gap > sumBase * 0.30 + tol) {
      logger.warn(`[OCR] Reconciliación multi-IVA descartada por incoherencia con total: ΣB=${norm.base} ΣC=${norm.cuota} total=${campos.total} gap=${gap.toFixed(2)}€ — solo se rellenan huecos`);
      if (campos.base_imponible == null) campos.base_imponible = norm.base;
      if (campos.cuota_iva == null)      campos.cuota_iva      = norm.cuota;
      if (campos.iva_porcentaje == null) campos.iva_porcentaje = norm.porcentaje;
      campos.lineas_iva = norm.lineas;
      return;
    }
  }

  if (campos.base_imponible !== norm.base || campos.cuota_iva !== norm.cuota) {
    logger.info(`[OCR] Agregados reconciliados desde lineas_iva: base "${campos.base_imponible}"→"${norm.base}" cuota "${campos.cuota_iva}"→"${norm.cuota}" tipo dominante ${norm.porcentaje}%`);
  }
  campos.lineas_iva     = norm.lineas;
  campos.base_imponible = norm.base;
  campos.cuota_iva      = norm.cuota;
  campos.iva_porcentaje = norm.porcentaje;
}

// ─── Comparador y fusionador de resultados multi-motor ────────────────────────

function compareOCRResults(openaiRes, azureRes, mistralRes, logger) {
  // Si Mistral produjo resultado válido y uno de los dos motores primarios
  // falló, Mistral ocupa su hueco: el flujo dual sigue funcionando con dos
  // fuentes reales en lugar de degradar a motor único.
  const mistralValido = mistralRes && mistralRes.es_factura_valida !== false;
  if (mistralValido && (!openaiRes || openaiRes.es_factura_valida === false)) {
    logger.info('[DualOCR] OpenAI sin resultado — Mistral OCR 4 ocupa su hueco en la fusión');
    openaiRes = mistralRes;
    mistralRes = null;
  } else if (mistralValido && (!azureRes || azureRes.es_factura_valida === false)) {
    logger.info('[DualOCR] Azure sin resultado — Mistral OCR 4 ocupa su hueco en la fusión');
    azureRes = mistralRes;
    mistralRes = null;
  }

  if (!openaiRes && !azureRes) return null;

  if (!openaiRes || openaiRes.es_factura_valida === false) {
    logger.info('[DualOCR] Solo Azure produjo resultado válido');
    const single = { ...azureRes, dual_confirmed: false, missing_engine: 'openai', ocr_engine: 'dual_openai_azure' };
    if (single.campos) reconcileMultiIvaAggregates(single.campos, logger);
    return single;
  }
  if (!azureRes || azureRes.es_factura_valida === false) {
    logger.info('[DualOCR] Solo OpenAI produjo resultado válido');
    const single = { ...openaiRes, dual_confirmed: false, missing_engine: 'azure', ocr_engine: 'dual_openai_azure' };
    if (single.campos) reconcileMultiIvaAggregates(single.campos, logger);
    return single;
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

  // ── Integración Mistral OCR 4 (modo triple): relleno + votación 2-de-3 ──────
  if (mistralRes && mistralRes.es_factura_valida !== false) {
    integrateMistralResult(merged, oF, aF, mistralRes.campos || {}, logger);
  }

  // ── Reconciliación multi-IVA (fix 2026-07-03) ────────────────────────────────
  // Con 2+ tramos, los agregados DEBEN ser la suma del desglose. Antes la base
  // agregada venía del SubTotal de Azure (≠ Σ bases con descuentos/portes) y
  // nadie garantizaba coherencia entre columnas agregadas y lineas_iva.
  // Debe ejecutarse ANTES de la salvaguarda IRPF: una base mal sumada generaba
  // retenciones IRPF fantasma por el cálculo del balance.
  reconcileMultiIvaAggregates(merged, logger);

  // ── Salvaguarda aritmética IRPF ──────────────────────────────────────────────
  // Si el OCR no detectó IRPF pero Total < Base + Cuota_IVA (con tolerancia 0,05€),
  // la diferencia debe ser IRPF: rellenamos por cálculo. Cubre facturas donde el
  // prompt falla en detectar la etiqueta pero la aritmética lo demuestra.
  const _num = (s) => {
    if (s == null || s === '') return null;
    const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const _fmt = (n) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const _irpfActual = _num(merged.irpf_porcentaje);
  const _baseN = _num(merged.base_imponible);
  const _ivaN  = _num(merged.cuota_iva);
  const _totN  = _num(merged.total);
  if ((_irpfActual === null || _irpfActual === 0) && _baseN !== null && _ivaN !== null && _totN !== null) {
    const implicitIrpf = _baseN + _ivaN - _totN;
    // Solo activamos si la diferencia es claramente positiva (>0,05€) y razonable (<= base)
    if (implicitIrpf > 0.05 && implicitIrpf <= _baseN) {
      const pct = (implicitIrpf / _baseN) * 100;
      // Filtro: % plausible (0,5–30%) para evitar falsos positivos por base/iva mal leídos
      if (pct >= 0.5 && pct <= 30) {
        merged.irpf_porcentaje = _fmt(Math.round(pct * 10) / 10).replace(/,00$/, ',0');
        merged.cuota_irpf = _fmt(Math.round(implicitIrpf * 100) / 100);
        logger.warn(`[DualOCR] IRPF rellenado por cálculo aritmético: ${merged.irpf_porcentaje}% = ${merged.cuota_irpf}€ (base=${_baseN} iva=${_ivaN} total=${_totN})`);
      }
    }
  }

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
    mistral_result: mistralRes ? {
      campos: mistralRes.campos || {},
      confidence: mistralRes.confidence,
      engine: mistralRes.ocr_engine,
      time_s: mistralRes.processing_time_s,
    } : null,
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

  // ── Modo DUAL (defecto) / TRIPLE (con Mistral OCR 4) ──────────────────────
  if (mode === 'dual' || mode === 'triple') {
    const conMistral = mode === 'triple';
    logger.info(`[OCR] Modo ${mode}: lanzando OpenAI + Azure DI${conMistral ? ' + Mistral OCR 4' : ''} en paralelo para ${fileName} | tipo=${context.invoice_type || 'no_especificado'}`);

    const jobs = [
      tryOpenAI(filePath, mimeType, context),
      tryAzure(filePath, mimeType, context),
    ];
    if (conMistral) jobs.push(tryMistral(filePath, mimeType, context));

    const [openaiSettled, azureSettled, mistralSettled] = await Promise.allSettled(jobs);

    let openaiRes  = null;
    let azureRes   = null;
    let mistralRes = null;

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

    if (conMistral && mistralSettled) {
      if (mistralSettled.status === 'fulfilled') {
        mistralRes = mistralSettled.value;
        logger.info(`[OCR] Mistral OCR 4 OK: tiempo=${mistralRes.processing_time_s}s valida=${mistralRes.es_factura_valida} total=${mistralRes.campos?.total} nif=${mistralRes.campos?.proveedor_nif} lineasIva=${mistralRes.campos?.lineas_iva?.length || 0}`);
      } else {
        logger.warn(`[OCR] Mistral OCR 4 FALLÓ: ${mistralSettled.reason?.message}`);
      }
    }

    const result = compareOCRResults(openaiRes, azureRes, mistralRes, logger);
    if (result) {
      logger.info(`[OCR] Resultado ${mode}: dual_confirmed=${result.dual_confirmed} confidence=${result.confidence?.toFixed(2)} nif=${result.campos?.proveedor_nif} lineas_iva=${result.campos?.lineas_iva?.length || 0}`);
      await _secondPassReceptorIfNeeded(result, filePath, mimeType, context, logger);
    } else {
      logger.warn('[OCR] Todos los motores fallaron — no hay resultado');
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
    } else if (mode === 'mistral') {
      result = await tryMistral(filePath, mimeType, context);
    } else {
      logger.warn(`[OCR] Modo desconocido "${mode}" → usando OpenAI`);
      result = await tryOpenAI(filePath, mimeType, context);
    }
    logger.info(`[OCR] Motor ${mode}: tiempo=${result.processing_time_s}s valida=${result.es_factura_valida} total=${result.campos?.total}`);
    const wrapped = { ...result, dual_confirmed: false };
    // La coherencia agregados=Σtramos aplica también con un solo motor
    if (wrapped.campos) reconcileMultiIvaAggregates(wrapped.campos, logger);
    await _secondPassReceptorIfNeeded(wrapped, filePath, mimeType, context, logger);
    return wrapped;
  } catch (err) {
    logger.error(`[OCR] Motor ${mode} falló: ${err.message}`);
    return null;
  }
}

// ─── 2ª pasada OCR enfocada al receptor en facturas EMITIDAS ─────────────────
// Activa sólo cuando context.invoice_type === 'venta' y receptor_nif quedó null
// tras la 1ª pasada. Recorta el bloque inferior y pide a GPT-4.1 el CIF del
// cliente carácter a carácter. Si extrae un CIF/NIF con formato válido,
// completa el campo. Mutación in-place del result. Coste: ~2s extra y ~$0.005.
async function _secondPassReceptorIfNeeded(result, filePath, mimeType, context, logger) {
  if (!result || !result.campos) return;
  if (context?.invoice_type !== 'venta') return;
  if (result.campos.receptor_nif) return; // ya hay NIF, no hace falta

  const apiKey = getSecret('openai_api_key');
  if (isPlaceholder(apiKey)) return;

  logger.info('[OCR] 2ª pasada receptor — invoice_type=venta y receptor_nif=null');
  const t0 = Date.now();
  let cif;
  try {
    cif = await openai.extractReceptorCIFOnly(filePath, mimeType, apiKey);
  } catch (err) {
    logger.warn(`[OCR] 2ª pasada receptor falló: ${err.message}`);
    return;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  if (!cif) {
    logger.info(`[OCR] 2ª pasada receptor: no encontró CIF (${elapsed}s)`);
    return;
  }

  const check = validateSpanishTaxId(cif);
  if (!check.valid) {
    logger.warn(`[OCR] 2ª pasada receptor descartada — CIF "${cif}" inválido: ${check.reason}`);
    return;
  }

  result.campos.receptor_nif = cif;
  result.receptor_nif_source = 'second_pass_openai';
  logger.info(`[OCR] 2ª pasada receptor OK: receptor_nif="${cif}" (${elapsed}s)`);
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

// reconcileMultiIvaAggregates e integrateMistralResult se exportan para tests
// unitarios (sin red) — no forman parte del contrato público del orquestador.
module.exports = { extractInvoiceOCR, extractCIFOnlyOCR, reconcileMultiIvaAggregates, integrateMistralResult };
