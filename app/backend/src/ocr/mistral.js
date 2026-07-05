// src/ocr/mistral.js
// Mistral OCR 4 — extracción de datos fiscales de facturas españolas.
// Modelo específico de OCR (no chat-vision): markdown estructurado + bounding
// boxes + document annotations con JSON Schema (extracción estructurada nativa).
//
// Lanzado 2026-06-23. Contrato verificado contra el spec oficial:
//   POST https://api.mistral.ai/v1/ocr
//   model: "mistral-ocr-latest" (alias del último OCR; apunta a OCR 4)
//   document_annotation_format: { type: "json_schema", json_schema: {...} }
//   → respuesta en `document_annotation` (string JSON parseable)
// Docs: https://docs.mistral.ai/api/endpoint/ocr · https://mistral.ai/news/ocr-4/
// Precio API: ~$4/1000 páginas (~$0.004/factura).
'use strict';

const fs    = require('fs');
const sharp = require('sharp');

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
const MISTRAL_MODEL   = 'mistral-ocr-latest';

// ── Prompt de anotación: mismas reglas anti-alucinación que el resto de motores ──

const ANNOTATION_PROMPT = `Extrae los datos fiscales de esta factura española. LEE solo datos VISIBLES: si un dato no es claramente legible, su valor debe ser null — NUNCA inventes ni deduzcas CIFs, importes o fechas.

Reglas de formato:
- Importes en formato español "1.234,56". Porcentajes sin símbolo %: "21,0".
- fecha_emision en DD/MM/AAAA.
- proveedor = EMISOR (membrete superior); receptor = CLIENTE ("Facturar a:", "Cliente:").

Desglose de IVA:
- Si la factura tiene UN SOLO tipo de IVA → lineas_iva: null y rellena base_imponible/iva_porcentaje/cuota_iva agregados.
- Si tiene VARIOS tipos (21%, 10%, 4%, 0%) → lineas_iva con una entrada POR CADA tipo: {base, porcentaje, cuota, productos}. base_imponible = SUMA de bases; cuota_iva = SUMA de cuotas; iva_porcentaje = tipo del tramo de mayor importe.
- Verifica SIEMPRE: base × tipo ≈ cuota por tramo, y Total = base_imponible + cuota_iva − cuota_irpf (±0,05€). Si no cuadra, revisa tu lectura; si sigue sin cuadrar deja null los campos inciertos.

IRPF (retención): si Total < base + cuota_iva, la diferencia es la cuota IRPF (busca "Retención", "IRPF"). Si no hay IRPF: irpf_porcentaje "0,0" y cuota_irpf "0,00".`;

// ── JSON Schema — espejo del schema OpenAI para fusión uniforme de campos ──────

const INVOICE_ANNOTATION_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'invoice_extraction',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        numero_factura:    { type: ['string', 'null'], description: 'Número de factura. null si no visible.' },
        fecha_emision:     { type: ['string', 'null'], description: 'DD/MM/AAAA. null si no visible.' },
        proveedor_nombre:  { type: ['string', 'null'], description: 'Razón social emisor en MAYÚSCULAS. null si no legible.' },
        proveedor_nif:     { type: ['string', 'null'], description: 'CIF/NIF/NIE del emisor EXACTO como aparece. null si no visible. NUNCA inventar.' },
        receptor_nombre:   { type: ['string', 'null'], description: 'Nombre receptor en MAYÚSCULAS. null si no visible.' },
        receptor_nif:      { type: ['string', 'null'], description: 'CIF/NIF receptor EXACTO. null si no visible.' },
        base_imponible:    { type: ['string', 'null'], description: 'Formato español 1.000,00. Suma de bases si multi-IVA. null si no visible.' },
        iva_porcentaje:    { type: ['string', 'null'], description: 'Sin %, ej "21,0". null si no visible.' },
        cuota_iva:         { type: ['string', 'null'], description: 'Formato español. Suma de cuotas si multi-IVA. null si no visible.' },
        lineas_iva: {
          type: ['array', 'null'],
          description: 'Solo en facturas multi-IVA: un elemento por tramo. null si tramo único.',
          items: {
            type: 'object',
            properties: {
              base:       { type: 'string', description: 'Base imponible del tramo, formato español' },
              porcentaje: { type: 'string', description: 'Tipo IVA sin %, ej 21,0' },
              cuota:      { type: 'string', description: 'Cuota IVA del tramo, formato español' },
              productos: {
                type: ['array', 'null'],
                description: 'Productos del tramo. [] o null si no se distinguen.',
                items: {
                  type: 'object',
                  properties: {
                    descripcion: { type: 'string', description: 'Texto literal del producto (máx 120 chars)' },
                    importe:     { type: ['string', 'null'], description: 'Base del producto en formato español; null si solo consta PVP con IVA' }
                  },
                  required: ['descripcion', 'importe'],
                  additionalProperties: false
                }
              }
            },
            required: ['base', 'porcentaje', 'cuota', 'productos'],
            additionalProperties: false
          }
        },
        irpf_porcentaje:   { type: ['string', 'null'], description: 'Sin %. "0,0" si no hay IRPF.' },
        cuota_irpf:        { type: ['string', 'null'], description: '"0,00" si no hay IRPF.' },
        total:             { type: ['string', 'null'], description: 'Total final con IVA. null si no visible.' },
        moneda:            { type: 'string', description: 'EUR por defecto.' },
        es_factura_valida: { type: 'boolean', description: 'true si es una factura legible.' }
      },
      required: [
        'numero_factura', 'fecha_emision', 'proveedor_nombre', 'proveedor_nif',
        'receptor_nombre', 'receptor_nif', 'base_imponible', 'iva_porcentaje',
        'cuota_iva', 'lineas_iva', 'irpf_porcentaje', 'cuota_irpf', 'total',
        'moneda', 'es_factura_valida'
      ],
      additionalProperties: false
    }
  }
};

// ── Optimización de imagen (mismo perfil que openai.js) ───────────────────────

async function optimizeImage(filePath, mimeType) {
  if (!mimeType.startsWith('image/')) {
    return { buffer: fs.readFileSync(filePath), mime: mimeType };
  }
  const optimized = await sharp(filePath)
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { buffer: optimized, mime: 'image/jpeg' };
}

/** Parsea document_annotation (string JSON según spec; tolera objeto directo). */
function parseAnnotation(annotation) {
  if (annotation == null) return null;
  if (typeof annotation === 'object') return annotation;
  try {
    return JSON.parse(annotation);
  } catch {
    return null;
  }
}

// ── Extracción principal ───────────────────────────────────────────────────────

/**
 * Extrae los datos fiscales de una factura usando Mistral OCR 4.
 * Devuelve el MISMO shape que openai.extractInvoice / azure.extractInvoice
 * para que el orquestador fusione de forma uniforme.
 *
 * @param {string} filePath
 * @param {string} mimeType
 * @param {string} apiKey    - Mistral API key
 * @param {object} context   - { invoice_type, empresa_nif, empresa_nombre } (informativo)
 */
async function extractInvoice(filePath, mimeType, apiKey, context = {}) {
  const start = Date.now();

  const { buffer, mime } = await optimizeImage(filePath, mimeType);
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

  // Imagen → image_url · PDF → document_url (ambos aceptan data-URI base64)
  const document = mime.startsWith('image/')
    ? { type: 'image_url',    image_url: dataUrl }
    : { type: 'document_url', document_url: dataUrl };

  // Contexto de tipo de factura para desambiguar emisor/receptor
  let prompt = ANNOTATION_PROMPT;
  if (context.invoice_type === 'compra' && context.empresa_nif) {
    prompt += `\n\nCONTEXTO: factura RECIBIDA. Nuestro NIF es ${context.empresa_nif} → es el receptor_nif, NO el proveedor_nif.`;
  } else if (context.invoice_type === 'venta' && context.empresa_nif) {
    prompt += `\n\nCONTEXTO: factura EMITIDA. Nuestro NIF es ${context.empresa_nif} → es el proveedor_nif.`;
  }

  const body = {
    model: MISTRAL_MODEL,
    document,
    document_annotation_format: INVOICE_ANNOTATION_SCHEMA,
    document_annotation_prompt: prompt,
    include_image_base64: false
  };

  const res = await fetch(MISTRAL_OCR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Mistral OCR HTTP ${res.status}: ${errBody.substring(0, 300)}`);
  }

  const data    = await res.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  const campos = parseAnnotation(data.document_annotation);
  if (!campos) {
    throw new Error('Mistral OCR: document_annotation ausente o no parseable');
  }

  const esValida = campos.es_factura_valida !== false;

  return {
    success: true,
    es_factura_valida: esValida,
    campos,
    // OCR 4 no expone confidence agregado por documento en la anotación:
    // valor fijo conservador, por debajo del 0.95 de OpenAI para no dominar.
    confidence: esValida ? 0.93 : 0.0,
    processing_time_s: parseFloat(elapsed),
    ocr_engine: 'mistral_ocr4',
    tokens_used: 0,
    pages_processed: data.usage_info?.pages_processed ?? 1
  };
}

module.exports = { extractInvoice, parseAnnotation, INVOICE_ANNOTATION_SCHEMA };
