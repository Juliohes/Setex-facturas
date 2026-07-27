// src/ocr/azure.js
// Azure Document Intelligence — prebuilt-invoice model.
// Motor especializado en facturas: sin alucinaciones (no generativo),
// devuelve confidence por campo, itera TaxDetails para IVA múltiple.
// ~$0.0015/factura. Usa fetch nativo (Node 20).
'use strict';

const fs    = require('fs');
const sharp = require('sharp');

const API_VERSION          = '2024-11-30';
const CONFIDENCE_THRESHOLD = 0.5;

// ── Helpers de conversión ──────────────────────────────────────────────────────

async function optimizeImage(filePath, mimeType) {
  if (!mimeType.startsWith('image/')) {
    return { buffer: fs.readFileSync(filePath), mime: mimeType };
  }
  const optimized = await sharp(filePath)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { buffer: optimized, mime: 'image/jpeg' };
}

function fieldValue(field, transform) {
  if (!field) return null;
  if ((field.confidence ?? 1) < CONFIDENCE_THRESHOLD) return null;
  const val = transform(field);
  return val ?? null;
}

// 2026-07-27 (Fase 7 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md, re-extracción
// dirigida): Azure Document Intelligence YA devuelve `boundingRegions` por
// campo (página + polígono de 4 puntos) — hasta ahora se descartaba al
// mapear a `campos`. Aditivo puro: nuevo campo `bounding_boxes` en el
// resultado, no cambia ni un valor de `campos`. Las coordenadas del
// polígono están en el espacio de la imagen realmente enviada a Azure
// (tras optimizeImage — ver `paginas` para las dimensiones de referencia
// y escalar correctamente al recortar sobre otra resolución).
function extraerBoundingBox(field) {
  const region = field?.boundingRegions?.[0];
  if (!region || !Array.isArray(region.polygon)) return null;
  return { pagina: region.pageNumber || 1, poligono: region.polygon };
}

function extraerPaginasInfo(analyzeResult) {
  return (analyzeResult?.pages || []).map((p) => ({
    pagina: p.pageNumber || 1, ancho: p.width, alto: p.height, unidad: p.unit || 'pixel',
  }));
}

function isoToSpanish(isoDate) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return null;
  return `${d}/${m}/${y}`;
}

function toSpanishAmount(amount) {
  if (amount == null || isNaN(amount)) return null;
  const fixed = Number(amount).toFixed(2);
  const [int, dec] = fixed.split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFormatted},${dec}`;
}

function toSpanishPercent(value) {
  if (value == null || isNaN(value)) return null;
  const num = Number(value);
  const pct = num < 1 ? num * 100 : num;
  // 2026-07-22: sin decimal superfluo para el % de IVA (21 en vez de 21,0);
  // se conserva la coma decimal si el valor tiene parte fraccionaria real.
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
}

// ── Polling de resultado asíncrono ────────────────────────────────────────────

async function pollResult(operationUrl, apiKey, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(operationUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Azure DI poll HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed') {
      const errMsg = data.error?.message || JSON.stringify(data.error);
      throw new Error(`Azure DI análisis fallido: ${errMsg}`);
    }
  }
  throw new Error('Azure DI timeout (>45s)');
}

// ── Extracción de lineas_iva desde TaxDetails + Items ─────────────────────────
// Azure DI devuelve:
//   - TaxDetails: array con una entrada por tipo de IVA (Amount, Rate, BaseAmount)
//   - Items: array con las líneas/productos de la factura (Description, Amount, TaxRate, Quantity, ProductCode)
//
// Estrategia multi-IVA (2026-04-21 super-tarea cliente):
//   1. Construir el array base de tramos desde TaxDetails (base/%/cuota).
//   2. Recorrer Items y asociar cada uno al tramo cuyo % coincida con su TaxRate.
//   3. Productos sin TaxRate identificable quedan fuera del desglose (OpenAI los
//      pillará en su array propio o el usuario los rellenará a mano).
//   4. Early-branch: si solo hay 1 tramo en TaxDetails, devolvemos null para que
//      el flujo simple lo maneje con iva_porcentaje/cuota_iva agregados.

function normalizeRate(rateValue) {
  // Azure reporta Rate a veces como 21, a veces 0.21, a veces "21%". Normalizamos
  // a número con 2 decimales max (ej. 21.0, 10.0, 4.0).
  if (rateValue == null) return null;
  let n = typeof rateValue === 'number' ? rateValue : parseFloat(String(rateValue).replace(',', '.').replace('%', ''));
  if (!Number.isFinite(n)) return null;
  if (n < 1) n = n * 100;               // 0.21 → 21
  return Math.round(n * 10) / 10;        // evita 21.00000001
}

function extractProductosFromItems(fields, tramoRate) {
  const items = fields.Items;
  if (!items || !Array.isArray(items.valueArray) || items.valueArray.length === 0) {
    return [];
  }
  const productos = [];
  for (const it of items.valueArray) {
    const obj = it.valueObject || {};
    const desc = obj.Description?.valueString || obj.ProductCode?.valueString;
    if (!desc) continue;
    const itemRateRaw = obj.TaxRate?.valueNumber ?? obj.TaxRate?.valueString ?? null;
    const itemRate = normalizeRate(itemRateRaw);
    if (itemRate == null || itemRate !== tramoRate) continue; // solo items de este tramo
    const amount = obj.Amount?.valueCurrency?.amount ?? obj.Amount?.valueNumber ?? null;
    productos.push({
      descripcion: String(desc).substring(0, 120),
      importe:     amount != null ? toSpanishAmount(amount) : null
    });
  }
  return productos;
}

function extractLineasIvaAzure(fields) {
  const taxDetails = fields.TaxDetails;
  if (!taxDetails || !Array.isArray(taxDetails.valueArray) || taxDetails.valueArray.length === 0) {
    return null;
  }

  const lineas = [];
  for (const item of taxDetails.valueArray) {
    const obj = item.valueObject || {};
    const amountField = obj.Amount || obj.TaxAmount;
    const rateField   = obj.Rate   || obj.TaxRate;
    // Fallback histórico: el schema oficial 2024-11-30-ga de prebuilt-invoice
    // NO incluye BaseAmount/TaxBase en TaxDetails (solo Amount y Rate) — se
    // mantienen las lecturas por si Microsoft los añade, pero la base real
    // se DERIVA por aritmética más abajo (fix multi-IVA 2026-07-03).
    const baseField   = obj.BaseAmount || obj.TaxBase;

    let cuota = amountField?.valueCurrency?.amount ?? amountField?.valueNumber ?? null;
    const rateRaw = rateField?.valueNumber ?? rateField?.valueString ?? null;
    let base  = baseField?.valueCurrency?.amount ?? baseField?.valueNumber ?? null;

    const rateNorm = normalizeRate(rateRaw);

    // Derivaciones aritméticas (fix 2026-07-03):
    //   - tramo exento (rate 0) sin cuota → cuota = 0 (antes se descartaba y
    //     la factura multi-IVA degradaba a mono-IVA perdiendo el desglose)
    //   - cuota presente y rate > 0 sin base → base = cuota ÷ (rate/100)
    if (cuota == null && rateNorm === 0) cuota = 0;
    if (cuota == null && base != null && rateNorm != null) {
      cuota = Math.round(base * rateNorm) / 100;
    }
    if (cuota == null) continue; // sin cuota ni forma de derivarla → línea no útil

    if (base == null && rateNorm != null && rateNorm > 0) {
      base = Math.round((cuota / (rateNorm / 100)) * 100) / 100;
    }

    const productos = rateNorm != null ? extractProductosFromItems(fields, rateNorm) : [];

    lineas.push({
      base:       base != null ? toSpanishAmount(base) : null,
      porcentaje: rateNorm != null ? toSpanishPercent(rateNorm) : null,
      cuota:      toSpanishAmount(cuota),
      productos
    });
  }

  // Early-branch: si solo hay un tramo, devolvemos null y el flujo simple se encarga
  // con iva_porcentaje/cuota_iva agregados. Multi-tramo solo cuando >=2.
  if (lineas.length < 2) return null;
  return lineas;
}

// ── Extracción del porcentaje de IVA principal ────────────────────────────────

function extractIvaPorcentaje(fields) {
  // 1. TaxRate directo
  if (fields.TaxRate) {
    const val = fieldValue(fields.TaxRate, d => {
      const v = d.valueString || d.valueNumber;
      if (v == null) return null;
      const n = parseFloat(String(v).replace(',', '.').replace('%', ''));
      return toSpanishPercent(n);
    });
    if (val) return val;
  }

  // 2. Calcular desde TaxDetails (tipo del tramo de mayor importe)
  // Fix 2026-07-04: Azure devuelve Rate como valueString ("21%") en facturas
  // españolas reales — antes solo se leía valueNumber y el rate se perdía,
  // cayendo al fallback TotalTax/SubTotal que produce tipos absurdos (14,6%).
  if (fields.TaxDetails && Array.isArray(fields.TaxDetails.valueArray) && fields.TaxDetails.valueArray.length > 0) {
    let maxRate = null;
    let maxCuota = -1;
    for (const item of fields.TaxDetails.valueArray) {
      const obj   = item.valueObject || {};
      const rate  = normalizeRate(obj.Rate?.valueNumber ?? obj.Rate?.valueString ?? null);
      const cuota = obj.Amount?.valueCurrency?.amount ?? obj.Amount?.valueNumber ?? 0;
      if (rate != null && cuota > maxCuota) { maxCuota = cuota; maxRate = rate; }
    }
    if (maxRate != null) return toSpanishPercent(maxRate);
  }

  // 3. Calcular desde SubTotal y TotalTax como fallback
  const base = fields.SubTotal?.valueCurrency?.amount;
  const tax  = fields.TotalTax?.valueCurrency?.amount;
  if (base && tax && base > 0) {
    const pct = (tax / base) * 100;
    if (pct >= 1 && pct <= 40) return toSpanishPercent(pct);
  }

  return null;
}

// ── Schema campos vacíos ──────────────────────────────────────────────────────

function buildEmptyCampos() {
  return {
    numero_factura:   null,
    fecha_emision:    null,
    proveedor_nombre: null,
    proveedor_nif:    null,
    receptor_nombre:  null,
    receptor_nif:     null,
    base_imponible:   null,
    iva_porcentaje:   null,
    cuota_iva:        null,
    lineas_iva:       null,
    irpf_porcentaje:  '0,0',
    cuota_irpf:       '0,00',
    total:            null,
    moneda:           'EUR'
  };
}

// ── Extracción principal ───────────────────────────────────────────────────────

/**
 * @param {string} filePath
 * @param {string} mimeType
 * @param {string} apiKey
 * @param {string} endpoint
 * @param {object} context  - { invoice_type, empresa_nif, empresa_nombre } (opcional)
 * @param {{buffer:Buffer, mime:string}|null} preparedImage - 2026-07-23 (benchmark
 *   multi-imagen): si se pasa, se usa TAL CUAL sin volver a redimensionar/comprimir.
 */
async function extractInvoice(filePath, mimeType, apiKey, endpoint, context = {}, preparedImage = null) {
  const start = Date.now();

  const { buffer, mime } = preparedImage || await optimizeImage(filePath, mimeType);
  const base64 = buffer.toString('base64');

  const cleanEndpoint = endpoint.replace(/\/$/, '');
  const analyzeUrl = `${cleanEndpoint}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=${API_VERSION}`;

  // locale: es-ES mejora un 10-15% la extracción en facturas españolas
  const submitRes = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      base64Source: base64,
      locale: 'es-ES'        // ← CLAVE: mejora fechas, importes y nombres en español
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '');
    throw new Error(`Azure DI HTTP ${submitRes.status}: ${body}`);
  }

  const operationUrl = submitRes.headers.get('Operation-Location') || submitRes.headers.get('operation-location');
  if (!operationUrl) throw new Error('Azure DI: no se recibió Operation-Location');

  const result  = await pollResult(operationUrl, apiKey);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  const docs = result.analyzeResult?.documents;
  if (!docs || docs.length === 0) {
    return {
      success: true,
      es_factura_valida: false,
      campos: buildEmptyCampos(),
      confidence: 0.0,
      processing_time_s: parseFloat(elapsed),
      ocr_engine: 'azure_document_intelligence',
      tokens_used: 0
    };
  }

  const doc           = docs[0];
  const docConfidence = doc.confidence ?? 0;
  const esValida      = doc.docType === 'invoice' && docConfidence > CONFIDENCE_THRESHOLD;
  const f             = doc.fields || {};

  // ── Extraer lineas_iva desde TaxDetails ──────────────────────────────────
  const lineasIva = extractLineasIvaAzure(f);

  // ── Mapeo de campos Azure DI → nuestro schema ──────────────────────────────
  const campos = {
    // Número de factura — campo InvoiceId en Azure DI
    numero_factura: fieldValue(f.InvoiceId, d => {
      const v = d.valueString;
      return v ? String(v).trim().substring(0, 50) : null;
    }),

    fecha_emision: fieldValue(f.InvoiceDate, d => isoToSpanish(d.valueDate)),

    proveedor_nombre: fieldValue(f.VendorName, d => d.valueString?.toUpperCase() || null),
    proveedor_nif:    fieldValue(f.VendorTaxId, d =>
      d.valueString?.toUpperCase().replace(/\s/g, '') || null
    ),

    receptor_nombre: fieldValue(f.CustomerName, d => d.valueString?.toUpperCase() || null),
    receptor_nif:    fieldValue(f.CustomerTaxId, d =>
      d.valueString?.toUpperCase().replace(/\s/g, '') || null
    ),

    base_imponible: fieldValue(f.SubTotal,   d => toSpanishAmount(d.valueCurrency?.amount)),
    iva_porcentaje: extractIvaPorcentaje(f),
    cuota_iva:      fieldValue(f.TotalTax,   d => toSpanishAmount(d.valueCurrency?.amount)),

    lineas_iva:     lineasIva,

    // Azure DI no extrae IRPF (impuesto específico español, no en el modelo universal)
    irpf_porcentaje: '0,0',
    cuota_irpf:      '0,00',

    total:  fieldValue(f.InvoiceTotal ?? f.AmountDue, d => toSpanishAmount(d.valueCurrency?.amount)),
    moneda: f.InvoiceTotal?.valueCurrency?.currencyCode || 'EUR'
  };

  // ── Desambiguación proveedor/receptor con context ──────────────────────────
  // Si conocemos el NIF de la empresa del usuario, verificar que no esté en el campo incorrecto
  const { empresa_nif, invoice_type } = context;
  if (empresa_nif && campos.proveedor_nif && campos.receptor_nif) {
    const pNif = campos.proveedor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rNif = campos.receptor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const eNif = empresa_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (invoice_type === 'compra' && pNif === eNif && rNif !== eNif) {
      // Azure puso nuestro NIF como proveedor → swap
      [campos.proveedor_nif, campos.receptor_nif]     = [campos.receptor_nif, campos.proveedor_nif];
      [campos.proveedor_nombre, campos.receptor_nombre] = [campos.receptor_nombre, campos.proveedor_nombre];
    } else if (invoice_type === 'venta' && rNif === eNif && pNif !== eNif) {
      // Azure puso nuestro NIF como receptor → swap
      [campos.proveedor_nif, campos.receptor_nif]     = [campos.receptor_nif, campos.proveedor_nif];
      [campos.proveedor_nombre, campos.receptor_nombre] = [campos.receptor_nombre, campos.proveedor_nombre];
    }
  }

  // Fase 7 (2026-07-27): bounding boxes por campo, aditivo — ver
  // extraerBoundingBox/extraerPaginasInfo arriba. `null` si el campo no se
  // extrajo o Azure no devolvió boundingRegions para él (nunca lanza).
  const bounding_boxes = {
    paginas: extraerPaginasInfo(result.analyzeResult),
    numero_factura: extraerBoundingBox(f.InvoiceId),
    fecha_emision: extraerBoundingBox(f.InvoiceDate),
    proveedor_nombre: extraerBoundingBox(f.VendorName),
    proveedor_nif: extraerBoundingBox(f.VendorTaxId),
    receptor_nombre: extraerBoundingBox(f.CustomerName),
    receptor_nif: extraerBoundingBox(f.CustomerTaxId),
    base_imponible: extraerBoundingBox(f.SubTotal),
    cuota_iva: extraerBoundingBox(f.TotalTax),
    total: extraerBoundingBox(f.InvoiceTotal ?? f.AmountDue),
  };

  return {
    success: true,
    es_factura_valida: esValida,
    campos,
    confidence: docConfidence,
    processing_time_s: parseFloat(elapsed),
    ocr_engine: 'azure_document_intelligence',
    tokens_used: 0,
    bounding_boxes,
  };
}

// extractLineasIvaAzure, normalizeRate, extraerBoundingBox y
// extraerPaginasInfo se exportan para tests unitarios (fixtures sin red) —
// no forman parte del contrato público.
module.exports = { extractInvoice, extractLineasIvaAzure, normalizeRate, extraerBoundingBox, extraerPaginasInfo };
