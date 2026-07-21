// src/ocr/index.js
// Orquestador OCR multi-motor — ejecuta los motores activos en PARALELO.
// Cuando dos motores coinciden en NIF + fecha + total → dual_confirmed:true (máxima fiabilidad).
// Cuando discrepan → reconciliación con dígito de control + lectura enfocada CIF como árbitro.
//
// MOTORES:
//   "openai"       — GPT-4.1 Vision (primario legacy)
//   "azure"        — Azure DI prebuilt-invoice (primario, sin alucinaciones, $0.0015/factura)
//   "mistral"      — Mistral OCR 4 (extra; annotations JSON, ~$0.004/factura)
//   "gemini_flash" — Google Gemini 3.5 Flash (primario RECOMENDADO o extra; ESTABLE, ~$0.006/fac.)
//   "gemini_pro"   — Google Gemini 3.1 Pro (extra; PREVIEW, ~$0.01/factura)
//
// MODO (features.json → ocr_mode):
//   "gemini_azure" — Gemini 3.5 Flash + Azure en paralelo (RECOMENDADO — bench 2026-07-07)
//   "dual"         — OpenAI + Azure en paralelo (legacy)
//   "triple"       — dual + Mistral (votación 2-de-3 en importes)
//   "multi"        — dual + extras de features.json ocr_multi_engines
//                    (default ["mistral","gemini_flash","gemini_pro"])
//   "openai" | "azure" | "mistral" | "gemini_flash" | "gemini_pro" — motor único
//
// Los IDs de modelo Gemini son configurables en caliente (features.json →
// ocr_gemini_flash_model / ocr_gemini_pro_model): el Pro solo existe en
// preview y Google rota esos IDs con poco preaviso (el Flash 3.5 es estable).
'use strict';

const fs      = require('fs');
const openai  = require('./openai');
const azure   = require('./azure');
const mistral = require('./mistral');
const gemini  = require('./gemini');
const { mergeLineasIva, fillDerivedBases, dropResumenArtifacts, normalizeConfirmedLineasIva, parseSpanishAmount } = require('./validateIVA');
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

async function tryGemini(filePath, mimeType, context, cfg, label) {
  const apiKey = getSecret('gemini_api_key');
  if (isPlaceholder(apiKey)) {
    throw new Error(`Gemini ${label}: gemini_api_key no configurada — añade el secret en secrets/ del entorno activo`);
  }
  const modelId = label === 'pro'
    ? (cfg.ocr_gemini_pro_model || gemini.DEFAULT_MODELS.pro)
    : (cfg.ocr_gemini_flash_model || gemini.DEFAULT_MODELS.flash);
  return await gemini.extractInvoice(filePath, mimeType, apiKey, context, modelId, label);
}

// Registro de motores EXTRA (todo lo que no es el dual primario openai+azure).
// Añadir un motor nuevo = módulo ocr/<motor>.js + una entrada aquí.
const EXTRA_ENGINES = {
  mistral:      (fp, mt, ctx, _cfg) => tryMistral(fp, mt, ctx),
  gemini_flash: (fp, mt, ctx, cfg) => tryGemini(fp, mt, ctx, cfg, 'flash'),
  gemini_pro:   (fp, mt, ctx, cfg) => tryGemini(fp, mt, ctx, cfg, 'pro'),
};
const DEFAULT_MULTI_ENGINES = ['mistral', 'gemini_flash', 'gemini_pro'];

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

// ─── Atribución por campo: qué motor aportó cada dato ───────────────────────
// Compara el valor final de cada campo contra la salida de cada motor.
// Resultado: 'consensus' si ≥2 coinciden, nombre del motor si solo uno coincide,
// 'calculated' si fue calculado aritméticamente, null si el campo está vacío.
// labelA/labelB identifican a los motores primarios reales según el modo activo
// (ej. 'gemini_flash'/'azure' en modo gemini_azure) — sin esto, el nombre
// quedaba fijo en 'openai'/'azure' aunque el motor real fuera otro (bug
// detectado 2026-07-13: la vista OCR del panel admin mostraba siempre
// "OpenAI"/"consenso" pese a que el motor activo era Gemini Flash + Azure).
function buildCampoSources(merged, oF, aF, extras, labelA = 'openai', labelB = 'azure') {
  const TRACKABLE = [
    'proveedor_nif', 'proveedor_nombre', 'receptor_nif', 'receptor_nombre',
    'numero_factura', 'fecha_emision', 'total', 'base_imponible',
    'iva_porcentaje', 'cuota_iva', 'irpf_porcentaje', 'cuota_irpf',
  ];
  const engines = [
    { name: labelA, campos: oF },
    { name: labelB, campos: aF },
    ...(extras || []).map(e => ({ name: e.name, campos: e.res?.campos || {} })),
  ];
  const sources = {};
  for (const field of TRACKABLE) {
    const val = merged[field];
    if (val == null || val === '') { sources[field] = null; continue; }
    const matching = engines.filter(e => {
      const ev = e.campos[field];
      return ev != null && ev !== '' && String(ev).trim() === String(val).trim();
    });
    if (matching.length === 0) sources[field] = 'calculated';
    else if (matching.length >= 2) sources[field] = 'consensus';
    else sources[field] = matching[0].name;
  }
  return sources;
}

// ─── Integración de motores EXTRA (Mistral, Gemini Flash/Pro…) ────────────────
// Se invoca una vez por motor extra vivo, en orden de configuración. Reglas:
//   1. Relleno: campos null del merge se completan con la lectura del extra.
//   2. lineas_iva: fusión de tramos (mismo mergeLineasIva, sin duplicar).
//   3. Votación en importes: si el valor fusionado discrepa del extra pero el
//      extra coincide con un motor PRIMARIO cuyo valor difiere del elegido,
//      gana la mayoría. Los extras no se respaldan entre sí (conservador:
//      los primarios openai+azure son el ancla de confianza).
function integrateExtraEngineResult(merged, oF, aF, xF, engineLabel, logger) {
  // 1. Relleno de huecos en campos simples
  const FILLABLE = [
    'numero_factura', 'proveedor_nombre', 'receptor_nombre', 'fecha_emision',
    'base_imponible', 'iva_porcentaje', 'cuota_iva', 'total',
  ];
  for (const k of FILLABLE) {
    if (merged[k] == null && xF[k] != null) {
      merged[k] = xF[k];
      logger.info(`[MultiOCR] Campo ${k} rellenado por ${engineLabel}: "${xF[k]}"`);
    }
  }
  if (!merged.proveedor_nif && xF.proveedor_nif) merged.proveedor_nif = normNif(xF.proveedor_nif);
  if (!merged.receptor_nif  && xF.receptor_nif)  merged.receptor_nif  = normNif(xF.receptor_nif);

  // 2. Desglose multi-IVA: fusionar tramos del extra con los ya fusionados
  if (Array.isArray(xF.lineas_iva) && xF.lineas_iva.length > 0) {
    merged.lineas_iva = mergeLineasIva(merged.lineas_iva, xF.lineas_iva);
  }

  // 3. Votación en importes agregados (respaldo de un primario obligatorio)
  for (const k of ['base_imponible', 'cuota_iva', 'total']) {
    const x = xF[k];
    if (x == null) continue;
    const cur = merged[k];
    if (cur == null || amountsBothAgree(cur, x)) continue; // ya coincide o ya rellenado
    const backed = [oF[k], aF[k]].some(v => v != null && !amountsBothAgree(v, cur) && amountsBothAgree(v, x));
    if (backed) {
      logger.warn(`[MultiOCR] Votación en ${k}: "${cur}" → "${x}" (${engineLabel} + un motor primario coinciden)`);
      merged[k] = x;
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

  // Filtrar la "fila resumen" que Azure emite a veces como TaxDetail extra
  // (sin tipo, cuota = Σ cuotas) — detectada en la validación E2E 2026-07-04.
  const filtradas = dropResumenArtifacts(campos.lineas_iva);
  if (filtradas.length !== campos.lineas_iva.length) {
    logger.info(`[OCR] Desglose IVA: descartada fila resumen espuria (${campos.lineas_iva.length}→${filtradas.length} tramos)`);
    campos.lineas_iva = filtradas;
    if (campos.lineas_iva.length < 2) return;
  }

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
      logger.warn(`[OCR] Reconciliación multi-IVA descartada por incoherencia con total: ΣB=${norm.base} ΣC=${norm.cuota} total=${campos.total} gap=${gap.toFixed(2)}€ — solo se rellenan huecos (desglose posiblemente incompleto, ej. tramo exento no emitido)`);
      if (campos.base_imponible == null) campos.base_imponible = norm.base;
      if (campos.cuota_iva == null)      campos.cuota_iva      = norm.cuota;
      // El tipo dominante SÍ se deriva del desglose incluso aquí: es
      // definicionalmente el tramo de mayor cuota (evita tipos absurdos tipo
      // "14,6" del fallback TotalTax/SubTotal de Azure).
      campos.iva_porcentaje = norm.porcentaje;
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

// labelA / labelB identifican los dos motores primarios en logs y en el campo
// ocr_engine del resultado. Por defecto 'openai'/'azure' (modo dual/triple/multi).
// En modo gemini_azure: labelA='gemini_flash', labelB='azure'.
function compareOCRResults(openaiRes, azureRes, extraResults, logger, labelA = 'openai', labelB = 'azure') {
  // extraResults: array [{ name, res }] de motores extra vivos (mistral,
  // gemini_flash, gemini_pro…), en orden de configuración.
  const extras = (extraResults || []).filter(x => x && x.res);
  const dualLabel = `dual_${labelA}_${labelB}`;

  // Si un motor primario falló y hay extras válidos, el PRIMER extra válido
  // ocupa su hueco: el flujo dual sigue funcionando con dos fuentes reales
  // en lugar de degradar a motor único.
  const promoteExtra = (slotName) => {
    const idx = extras.findIndex(x => x.res.es_factura_valida !== false);
    if (idx === -1) return null;
    const [promoted] = extras.splice(idx, 1);
    logger.info(`[DualOCR] ${slotName} sin resultado — ${promoted.name} ocupa su hueco en la fusión`);
    return promoted.res;
  };
  if (!openaiRes || openaiRes.es_factura_valida === false) {
    const p = promoteExtra(labelA);
    if (p) openaiRes = p;
  }
  if (!azureRes || azureRes.es_factura_valida === false) {
    const p = promoteExtra(labelB);
    if (p) azureRes = p;
  }

  if (!openaiRes && !azureRes) return null;

  if (!openaiRes || openaiRes.es_factura_valida === false) {
    logger.info(`[DualOCR] Solo ${labelB} produjo resultado válido`);
    const single = { ...azureRes, dual_confirmed: false, missing_engine: labelA, ocr_engine: dualLabel };
    if (single.campos) reconcileMultiIvaAggregates(single.campos, logger);
    return single;
  }
  if (!azureRes || azureRes.es_factura_valida === false) {
    logger.info(`[DualOCR] Solo ${labelA} produjo resultado válido`);
    const single = { ...openaiRes, dual_confirmed: false, missing_engine: labelB, ocr_engine: dualLabel };
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

  if (nifStatus === 'conflict')      logger.warn(`[DualOCR] NIF discrepancia: ${labelA}="${oNif}" ${labelB}="${aNif}"`);
  if (nifStatus === 'single_source') logger.info(`[DualOCR] NIF fuente única: ${labelA}="${oNif || '—'}" ${labelB}="${aNif || '—'}"`);
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

  // ── Integración de motores extra (triple/multi): relleno + votación ─────────
  for (const extra of extras) {
    if (extra.res.es_factura_valida !== false) {
      integrateExtraEngineResult(merged, oF, aF, extra.res.campos || {}, extra.name, logger);
    }
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

  logger.info(`[DualOCR] confirmed=${dual_confirmed} nif_status=${nifStatus} totalOK=${totalAgree} fechaOK=${fechaAgree} ${labelA}Time=${openaiRes.processing_time_s}s ${labelB}Time=${azureRes.processing_time_s}s lineasIva=${merged.lineas_iva?.length || 0}`);

  const campo_sources = buildCampoSources(merged, oF, aF, extras, labelA, labelB);

  return {
    success: true,
    es_factura_valida: merged.es_factura_valida,
    campos: merged,
    campo_sources,
    confidence,
    processing_time_s: Math.max(openaiRes.processing_time_s || 0, azureRes.processing_time_s || 0),
    ocr_engine: dualLabel,
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
    // Traza por motor extra (mistral, gemini_flash, gemini_pro…)
    extra_results: extras.map(x => ({
      name: x.name,
      campos: x.res.campos || {},
      confidence: x.res.confidence,
      engine: x.res.ocr_engine,
      time_s: x.res.processing_time_s,
    })),
    // Retrocompat #114: mistral_result se mantiene si Mistral participó como extra
    mistral_result: (() => {
      const m = extras.find(x => x.name === 'mistral');
      return m ? { campos: m.res.campos || {}, confidence: m.res.confidence, engine: m.res.ocr_engine, time_s: m.res.processing_time_s } : null;
    })(),
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

  // ── Modos duales: GEMINI_AZURE (rec.) / DUAL / TRIPLE / MULTI ────────────────
  // gemini_azure: Gemini 3.5 Flash (motorA) + Azure DI (motorB) — bench 2026-07-07
  // dual/triple/multi: OpenAI (motorA) + Azure DI (motorB) — modo legacy
  if (mode === 'gemini_azure' || mode === 'dual' || mode === 'triple' || mode === 'multi') {
    const isGeminiAzure = mode === 'gemini_azure';
    const labelA     = isGeminiAzure ? 'gemini_flash' : 'openai';
    const labelAName = isGeminiAzure ? 'Gemini Flash' : 'OpenAI';
    const motorAFn   = isGeminiAzure
      ? () => tryGemini(filePath, mimeType, context, cfg, 'flash')
      : () => tryOpenAI(filePath, mimeType, context);

    let extraNames = [];
    if (mode === 'triple') extraNames = ['mistral'];
    if (mode === 'multi') {
      const wanted = Array.isArray(cfg.ocr_multi_engines) && cfg.ocr_multi_engines.length > 0
        ? cfg.ocr_multi_engines
        : DEFAULT_MULTI_ENGINES;
      extraNames = wanted.filter(n => EXTRA_ENGINES[n]);
      const desconocidos = wanted.filter(n => !EXTRA_ENGINES[n]);
      if (desconocidos.length) logger.warn(`[OCR] ocr_multi_engines contiene motores desconocidos (ignorados): ${desconocidos.join(', ')}`);
    }

    logger.info(`[OCR] Modo ${mode}: lanzando ${labelAName} + Azure DI${extraNames.length ? ' + ' + extraNames.join(' + ') : ''} en paralelo para ${fileName} | tipo=${context.invoice_type || 'no_especificado'}`);

    const jobs = [
      motorAFn(),
      tryAzure(filePath, mimeType, context),
      ...extraNames.map(n => EXTRA_ENGINES[n](filePath, mimeType, context, cfg)),
    ];
    const settled = await Promise.allSettled(jobs);
    const [motorASettled, azureSettled] = settled;

    let motorARes = null;
    let azureRes  = null;

    if (motorASettled.status === 'fulfilled') {
      motorARes = motorASettled.value;
      logger.info(`[OCR] ${labelAName} OK: tiempo=${motorARes.processing_time_s}s valida=${motorARes.es_factura_valida} total=${motorARes.campos?.total} nif=${motorARes.campos?.proveedor_nif} lineasIva=${motorARes.campos?.lineas_iva?.length || 0} tokens=${motorARes.tokens_used}`);
    } else {
      logger.warn(`[OCR] ${labelAName} FALLÓ: ${motorASettled.reason?.message}`);
    }

    if (azureSettled.status === 'fulfilled') {
      azureRes = azureSettled.value;
      logger.info(`[OCR] Azure DI OK: tiempo=${azureRes.processing_time_s}s valida=${azureRes.es_factura_valida} total=${azureRes.campos?.total} nif=${azureRes.campos?.proveedor_nif} lineasIva=${azureRes.campos?.lineas_iva?.length || 0}`);
    } else {
      logger.warn(`[OCR] Azure DI FALLÓ: ${azureSettled.reason?.message}`);
    }

    const extraResults = [];
    extraNames.forEach((name, i) => {
      const s = settled[i + 2];
      if (s.status === 'fulfilled') {
        const r = s.value;
        extraResults.push({ name, res: r });
        logger.info(`[OCR] ${name} OK: tiempo=${r.processing_time_s}s valida=${r.es_factura_valida} total=${r.campos?.total} nif=${r.campos?.proveedor_nif} lineasIva=${r.campos?.lineas_iva?.length || 0}`);
      } else {
        logger.warn(`[OCR] ${name} FALLÓ: ${s.reason?.message}`);
      }
    });

    const result = compareOCRResults(motorARes, azureRes, extraResults, logger, labelA, 'azure');
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
    } else if (EXTRA_ENGINES[mode]) {
      result = await EXTRA_ENGINES[mode](filePath, mimeType, context, cfg);
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
// tras la 1ª pasada. Recorta el bloque inferior y pide al motor CIF el NIF del
// cliente. Motor preferido: Gemini Flash (bench 2026-07-07, 90.3% CIF accuracy);
// fallback a OpenAI si Gemini no está disponible. Coste: ~2s extra y ~$0.003.
async function _secondPassReceptorIfNeeded(result, filePath, mimeType, context, logger) {
  if (!result || !result.campos) return;
  if (context?.invoice_type !== 'venta') return;
  if (result.campos.receptor_nif) return; // ya hay NIF, no hace falta

  const cfg        = getConfig();
  const geminiKey  = getSecret('gemini_api_key');
  const useGemini  = !isPlaceholder(geminiKey);
  const openaiKey  = useGemini ? null : getSecret('openai_api_key');
  const motorLabel = useGemini ? 'Gemini Flash' : 'OpenAI';

  if (!useGemini && isPlaceholder(openaiKey)) return;

  logger.info(`[OCR] 2ª pasada receptor — invoice_type=venta receptor_nif=null motor=${motorLabel}`);
  const t0 = Date.now();
  let cif;
  try {
    cif = useGemini
      ? await gemini.extractReceptorCIFOnly(filePath, mimeType, geminiKey, cfg)
      : await openai.extractReceptorCIFOnly(filePath, mimeType, openaiKey);
  } catch (err) {
    logger.warn(`[OCR] 2ª pasada receptor falló (${motorLabel}): ${err.message}`);
    return;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  if (!cif) {
    logger.info(`[OCR] 2ª pasada receptor: no encontró CIF (${elapsed}s, ${motorLabel})`);
    return;
  }

  const check = validateSpanishTaxId(cif);
  if (!check.valid) {
    logger.warn(`[OCR] 2ª pasada receptor descartada — CIF "${cif}" inválido: ${check.reason} (${motorLabel})`);
    return;
  }

  result.campos.receptor_nif = cif;
  result.receptor_nif_source = `second_pass_${motorLabel.toLowerCase().replace(' ', '_')}`;
  logger.info(`[OCR] 2ª pasada receptor OK: receptor_nif="${cif}" (${elapsed}s, ${motorLabel})`);
}

/**
 * Extracción enfocada solo en CIF/NIF del emisor (árbitro cuando los motores discrepan).
 * Motor preferido: Gemini Flash; fallback a OpenAI.
 */
async function extractCIFOnlyOCR(filePath, mimeType) {
  const cfg       = getConfig();
  const geminiKey = getSecret('gemini_api_key');
  if (!isPlaceholder(geminiKey)) {
    try {
      return await gemini.extractCIFOnly(filePath, mimeType, geminiKey, cfg);
    } catch {
      return null;
    }
  }
  const apiKey = getSecret('openai_api_key');
  if (isPlaceholder(apiKey)) return null;
  try {
    return await openai.extractCIFOnly(filePath, mimeType, apiKey);
  } catch {
    return null;
  }
}

// reconcileMultiIvaAggregates e integrateExtraEngineResult se exportan para
// tests unitarios (sin red) — no forman parte del contrato público.
// integrateMistralResult: alias retrocompat (#114) del integrador genérico.
const integrateMistralResult = (merged, oF, aF, mF, logger) =>
  integrateExtraEngineResult(merged, oF, aF, mF, 'mistral', logger);

module.exports = { extractInvoiceOCR, extractCIFOnlyOCR, reconcileMultiIvaAggregates, integrateExtraEngineResult, integrateMistralResult };
