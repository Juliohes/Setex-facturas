// src/ocr/gemini.js
// Google Gemini 3 (Flash / Pro) — extracción de datos fiscales de facturas
// españolas vía generateContent (v1beta) con salida estructurada JSON Schema.
//
// UN solo módulo parametrizado por modelId → dos motores en el orquestador:
//   gemini_flash → cfg.ocr_gemini_flash_model (default "gemini-3.5-flash", ESTABLE)
//   gemini_pro   → cfg.ocr_gemini_pro_model   (default "gemini-3.1-pro-preview", PREVIEW)
//
// Verificado contra docs oficiales 2026-07-06 (decisión Julio: Flash estable):
//   https://ai.google.dev/gemini-api/docs/models · /docs/pricing · /docs/api-key
// - gemini-3.5-flash: STABLE · $1.50/$9.00 por 1M (~$0.006/factura)
// - gemini-3.1-pro-preview: PREVIEW (único Pro; "Gemini 3 Pro" no existe como
//   ID) · $2.00/$12.00 por 1M (~$0.01/factura) — Google puede rotar el ID con
//   poco preaviso; por eso los IDs viven en features.json (hot-swap sin rebuild).
// API key: Google AI Studio (https://aistudio.google.com/apikey), header
// x-goog-api-key — las keys nuevas van ligadas a un proyecto GCP (billing).
'use strict';

const fs    = require('fs');
const sharp = require('sharp');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_MODELS = {
  flash: 'gemini-3.5-flash',
  pro:   'gemini-3.1-pro-preview',
};

// ── Prompts: mismas reglas anti-alucinación y multi-IVA que el resto ──────────

const SYSTEM_PROMPT = `Eres un sistema experto en extracción de datos fiscales de facturas españolas.
Tu trabajo es LEER datos VISIBLES en la imagen. NUNCA inventas ni deduces.
Si un dato NO ES CLARAMENTE VISIBLE y LEGIBLE → su valor DEBE ser null.
PROHIBIDO inventar CIFs/NIFs, importes o fechas. null siempre es preferible a un dato inventado.
VERIFICACIÓN MATEMÁTICA OBLIGATORIA: Total = base_imponible + cuota_iva − cuota_irpf (±0,05€). Si no cuadra, revisa; si sigue sin cuadrar deja null los inciertos.`;

const USER_PROMPT = `Extrae los datos fiscales de esta factura española.

Formato: importes en español "1.234,56"; porcentajes sin % ("21,0"); fecha DD/MM/AAAA.
proveedor = EMISOR (membrete superior); receptor = CLIENTE ("Facturar a:", "Cliente:").

Desglose de IVA:
- UN SOLO tipo de IVA → lineas_iva: null y rellena base_imponible/iva_porcentaje/cuota_iva agregados.
- VARIOS tipos (21%, 10%, 4%, 0%) → lineas_iva con una entrada POR CADA tipo: {base, porcentaje, cuota, productos}. base_imponible = SUMA de bases; cuota_iva = SUMA de cuotas; iva_porcentaje = tipo del tramo de mayor importe.
- Verifica por tramo: base × tipo ≈ cuota.

IRPF (retención): si Total < base + cuota_iva, la diferencia es la cuota IRPF (busca "Retención", "IRPF"). Sin IRPF: irpf_porcentaje "0,0" y cuota_irpf "0,00".`;

// ── JSON Schema — espejo del contrato interno de 15 campos ────────────────────

const INVOICE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    numero_factura:    { type: ['string', 'null'] },
    fecha_emision:     { type: ['string', 'null'] },
    proveedor_nombre:  { type: ['string', 'null'] },
    proveedor_nif:     { type: ['string', 'null'] },
    receptor_nombre:   { type: ['string', 'null'] },
    receptor_nif:      { type: ['string', 'null'] },
    base_imponible:    { type: ['string', 'null'] },
    iva_porcentaje:    { type: ['string', 'null'] },
    cuota_iva:         { type: ['string', 'null'] },
    lineas_iva: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        properties: {
          base:       { type: 'string' },
          porcentaje: { type: 'string' },
          cuota:      { type: 'string' },
          productos: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              properties: {
                descripcion: { type: 'string' },
                importe:     { type: ['string', 'null'] },
              },
              required: ['descripcion'],
            },
          },
        },
        required: ['base', 'porcentaje', 'cuota'],
      },
    },
    irpf_porcentaje:   { type: ['string', 'null'] },
    cuota_irpf:        { type: ['string', 'null'] },
    total:             { type: ['string', 'null'] },
    moneda:            { type: 'string' },
    es_factura_valida: { type: 'boolean' },
  },
  required: [
    'numero_factura', 'fecha_emision', 'proveedor_nombre', 'proveedor_nif',
    'receptor_nombre', 'receptor_nif', 'base_imponible', 'iva_porcentaje',
    'cuota_iva', 'lineas_iva', 'irpf_porcentaje', 'cuota_irpf', 'total',
    'moneda', 'es_factura_valida',
  ],
};

// ── Optimización de imagen (mismo perfil que openai.js/mistral.js) ─────────────

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

/** Extrae el texto JSON de la respuesta generateContent (tolerante a variantes). */
function extractResponseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const textPart = parts.find(p => typeof p.text === 'string');
  return textPart ? textPart.text : null;
}

// ── Extracción principal ───────────────────────────────────────────────────────

/**
 * Extrae los datos fiscales usando Gemini 3 (Flash o Pro según modelId).
 * Devuelve el MISMO shape que openai/azure/mistral para fusión uniforme.
 *
 * @param {string} filePath
 * @param {string} mimeType
 * @param {string} apiKey   - Google AI Studio API key (compartida flash/pro)
 * @param {object} context  - { invoice_type, empresa_nif, empresa_nombre }
 * @param {string} modelId  - ej. "gemini-3-flash-preview" | "gemini-3.1-pro-preview"
 * @param {string} label    - "flash" | "pro" (para ocr_engine)
 */
async function extractInvoice(filePath, mimeType, apiKey, context = {}, modelId, label = 'flash') {
  const start = Date.now();
  const model = modelId || DEFAULT_MODELS[label] || DEFAULT_MODELS.flash;

  const { buffer, mime } = await optimizeImage(filePath, mimeType);

  let prompt = USER_PROMPT;
  if (context.invoice_type === 'compra' && context.empresa_nif) {
    prompt += `\n\nCONTEXTO: factura RECIBIDA. Nuestro NIF es ${context.empresa_nif} → es el receptor_nif, NO el proveedor_nif.`;
  } else if (context.invoice_type === 'venta' && context.empresa_nif) {
    prompt += `\n\nCONTEXTO: factura EMITIDA. Nuestro NIF es ${context.empresa_nif} → es el proveedor_nif.`;
  }

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mime, data: buffer.toString('base64') } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseJsonSchema: INVOICE_JSON_SCHEMA,
    },
  };

  const res = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Gemini(${model}) HTTP ${res.status}: ${errBody.substring(0, 300)}`);
  }

  const data    = await res.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  const text = extractResponseText(data);
  if (!text) throw new Error(`Gemini(${model}): respuesta sin texto JSON`);

  let campos;
  try {
    campos = JSON.parse(text);
  } catch {
    throw new Error(`Gemini(${model}) devolvió JSON inválido: ${text.substring(0, 200)}`);
  }

  const esValida = campos.es_factura_valida !== false;

  return {
    success: true,
    es_factura_valida: esValida,
    campos,
    // Conservador y por debajo del 0.95 de OpenAI: los Gemini 3.x están en
    // preview; el modo multi los usa para relleno + votación, no como líder.
    confidence: esValida ? 0.92 : 0.0,
    processing_time_s: parseFloat(elapsed),
    ocr_engine: `gemini_${label}`,
    gemini_model: model,
    tokens_used: data.usageMetadata?.totalTokenCount || 0,
  };
}

module.exports = { extractInvoice, extractResponseText, INVOICE_JSON_SCHEMA, DEFAULT_MODELS };
