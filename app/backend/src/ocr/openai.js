// src/ocr/openai.js
// GPT-4.1 Vision — extracción de datos fiscales de facturas españolas.
// Soporta: lineas_iva múltiple, numero_factura, context de tipo de factura
// para desambiguar proveedor/receptor con máxima precisión.
'use strict';

const fs    = require('fs');
const sharp = require('sharp');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// ── Prompt sistema: reglas absolutas anti-alucinación ─────────────────────────

const SYSTEM_PROMPT = `Eres un sistema experto en extracción de datos fiscales de facturas españolas.
Tu trabajo es LEER datos VISIBLES en la imagen. NUNCA inventas ni deduces.

REGLA ABSOLUTA E INQUEBRANTABLE:
Si un dato NO ES CLARAMENTE VISIBLE y LEGIBLE → su valor DEBE ser null.
Prefiero null a un dato inventado. Un dato inventado causa daños graves en contabilidad.
JAMÁS rellenes un campo con un valor que no puedas señalar exactamente en la imagen.

PROHIBIDO TERMINANTEMENTE:
- Inventar CIFs/NIFs como B12345678, A12345678 o cualquier secuencia obvia.
- Deducir o calcular un CIF que no está escrito en la imagen.
- Usar valores de ejemplo, placeholder o "típicos".
- Rellenar campos con valores "probables".

IDENTIFICACIÓN DEL TIPO DE IDENTIFICADOR FISCAL:
- CIF (empresa/sociedad): 1 letra entidad + 7 dígitos + 1 control. Ej: B83523741, A78456231, G12345678
- NIF (persona física / autónomo): 8 dígitos + 1 letra. Ej: 45678901B, 12987654T, 03456789H
- NIE (extranjero residente): X, Y o Z + 7 dígitos + 1 letra. Ej: X1234567B, Y8901234C
Todos son válidos como proveedor_nif. Léelos exactamente como aparecen, sin transformar.

VERIFICACIÓN MATEMÁTICA OBLIGATORIA ANTES DE RESPONDER:
  Total = base_imponible + cuota_iva − cuota_irpf  (tolerancia ±0,05€)
Si no cuadra con los valores que lees, revisa. Si siguen sin cuadrar → deja null en los inciertos.`;

// ── Prompt principal dinámico ──────────────────────────────────────────────────

function buildInvoicePrompt(context = {}) {
  const { invoice_type, empresa_nif, empresa_nombre } = context;

  // Bloque de contexto de tipo de factura — clave para desambiguar emisor/receptor
  let contextBlock = '';
  if (invoice_type === 'compra') {
    contextBlock = `
CONTEXTO CRÍTICO — FACTURA RECIBIDA (el usuario es el COMPRADOR/RECEPTOR):
- El EMISOR/PROVEEDOR es quien HA ENVIADO esta factura. Aparece en el MEMBRETE SUPERIOR (logo, razón social, dirección, CIF del emisor).
- El RECEPTOR/CLIENTE somos NOSOTROS. Aparece en el bloque "Facturar a:", "Cliente:", "Destinatario:", "A:".
${empresa_nif ? `- Nuestro NIF conocido es: ${empresa_nif}${empresa_nombre ? ` (${empresa_nombre})` : ''}. Si ves este NIF → es el receptor_nif, NO el proveedor_nif.` : ''}
- proveedor_nif = NIF/CIF del EMISOR (quien nos envía la factura). Puede ser CIF de empresa (B83523741) o NIF de autónomo (45678901B).
- receptor_nif  = Nuestro NIF (${empresa_nif || 'del comprador'}).
- Si solo ves UN nombre/NIF en la factura → es el proveedor (emisor). El receptor puede no aparecer.
- Si el proveedor_nif tiene formato NIF (8 dígitos + letra) → busca RETENCIÓN IRPF en la factura.`;
  } else if (invoice_type === 'venta') {
    contextBlock = `
CONTEXTO CRÍTICO — FACTURA EMITIDA (el usuario es el VENDEDOR/EMISOR):
- NOSOTROS somos el EMISOR/PROVEEDOR. Nuestros datos aparecen en el MEMBRETE SUPERIOR.
${empresa_nif ? `- Nuestro NIF conocido es: ${empresa_nif}${empresa_nombre ? ` (${empresa_nombre})` : ''}. Este NIF → proveedor_nif.` : ''}
- El RECEPTOR/CLIENTE es la empresa a quien facturamos. Aparece en "Facturar a:", "Cliente:", "Datos del cliente:".
- proveedor_nif = ${empresa_nif || 'nuestro NIF'} (el emisor — nosotros). Puede ser CIF de empresa o NIF de autónomo.
- receptor_nif  = NIF/CIF del cliente/receptor a quien facturamos.`;
  } else {
    contextBlock = `
IDENTIFICACIÓN DE EMISOR Y RECEPTOR:
- EMISOR/PROVEEDOR: aparece en el MEMBRETE SUPERIOR (logo, razón social, CIF del emisor).
- RECEPTOR/CLIENTE: aparece en el bloque "Facturar a:", "Cliente:", "Destinatario:".
- NUNCA pongas el mismo NIF en proveedor_nif y receptor_nif.
- Si hay ambigüedad, el emisor es quien aparece primero o tiene logo en cabecera.`;
  }

  return `Analiza esta imagen de factura española y extrae SOLO los datos VISIBLES.
${contextBlock}

DESGLOSE DE IVA — LEE CON MÁXIMA ATENCIÓN:

Una factura española puede tener UNO o VARIOS tipos de IVA (21%, 10%, 4%, 0%).
Busca la tabla/sección "IVA", "TIPO IMPOSITIVO", "BASE IMPONIBLE" en la factura.

━━━ DECISIÓN PREVIA (siempre primero) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Antes de rellenar nada, DECIDE si la factura tiene UN SOLO tipo de IVA o VARIOS.
- Mismo % de IVA en todas las líneas/productos → CASO 1 (tramo único)
- Distintos % en diferentes líneas/productos → CASO 2 (multi-tramo)
- Si NO puedes determinarlo con claridad → deja iva_porcentaje y cuota_iva en null
  y lineas_iva en null. NO inventes. El usuario rellenará a mano.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CASO 1 — UN SOLO TIPO DE IVA (la mayoría de facturas):
  - base_imponible: subtotal antes de IVA (ej: "1.000,00")
  - iva_porcentaje: tipo aplicado SIN % (ej: "21,0")
  - cuota_iva: importe del IVA (ej: "210,00")
  - lineas_iva: null  (NO rellenar array con 1 elemento — usar null directamente)

CASO 2 — MÚLTIPLES TIPOS DE IVA (hostelería, ferretería, servicios mixtos):
  - base_imponible: SUMA de todas las bases
  - iva_porcentaje: tipo del tramo de mayor importe (referencia; el desglose real en lineas_iva)
  - cuota_iva: SUMA de todas las cuotas
  - lineas_iva: una entrada POR CADA TIPO detectado. Para cada tramo:
      {
        "base":       "suma de bases de productos de ese tramo (ej: '100,00')",
        "porcentaje": "tipo sin % (ej: '10,0')",
        "cuota":      "suma de cuotas del tramo (ej: '10,00')",
        "productos":  [
          {"descripcion": "texto literal del producto o línea tal como aparece",
           "importe":     "importe del producto (base antes de IVA, formato español)"},
          ...
        ]
      }

    REGLAS para el array "productos" dentro de cada tramo:
    - Asocia cada línea/producto visible en la factura al tramo cuyo % de IVA
      coincide con el del producto. Mira columnas/tags tipo "21%", "10%", "IVA".
    - "descripcion": el texto literal (ej: "Cerveza 33cl x4", "Menú del día", "Tornillo M6").
      Recorta a máximo 120 caracteres, sin inventar contenido.
    - "importe": la base antes de IVA de ese producto, en formato español "1.234,56".
      Si la factura solo muestra precio con IVA incluido, NO intentes despejar
      → deja "importe": null y sigue. El sumatorio del tramo se apoyará en "base".
    - Si un producto tiene IVA ambiguo (no visible el %), NO lo incluyas en ningún
      tramo. Deja lineas_iva con solo los tramos claros y el usuario completará.
    - Array "productos" puede estar vacío [] si no distingues productos pero sí
      ves la tabla resumen de tramos. En ese caso sigue rellenando base/%/cuota.

━━━ IRPF — RETENCIÓN DE AUTÓNOMOS Y PROFESIONALES ━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUÁNDO APARECE: en facturas de AUTÓNOMOS, PROFESIONALES INDEPENDIENTES y TAMBIÉN
  en facturas B2B de empresas (SL/SA) que facturan servicios profesionales
  (agencias, consultoras, despachos, estudios, inmobiliarias, alquileres, etc.).
  ⚠️ NO descartes IRPF por el formato del NIF del emisor — hay CIF (empresas)
     que SÍ emiten con retención. La presencia de IRPF depende del TIPO DE
     SERVICIO facturado y del ACUERDO con el cliente, no del tipo de emisor.

REGLA ARITMÉTICA CRÍTICA — detección por balance:
  Si Total < Base imponible + Cuota IVA  →  HAY IRPF obligatoriamente.
  La diferencia exacta es la Cuota IRPF. Ejemplo:
    Base 1.000 + IVA 210 = 1.210. Si el total es 1.060 → IRPF = 150 (15%).
  Cuando veas esta discrepancia, BUSCA el IRPF en la factura. Si no localizas
  la etiqueta pero el balance lo exige, RELLENA los campos usando el cálculo:
    cuota_irpf = (base + cuota_iva) − total
    irpf_porcentaje = round(cuota_irpf / base × 100, 1) en formato "15,0"

CÓMO LOCALIZARLO VISUALMENTE — busca estas etiquetas:
  "Retención IRPF", "Ret. IRPF", "R.I.R.P.F.", "IRPF", "Retención", "Rte. IRPF"
  "% Retención", "% Ret.", "I.R.P.F.", "-IRPF", "(−15%)", "Ret. a cuenta"
  Aparece como DEDUCCIÓN con signo negativo o en columna de descuentos/retenciones.
  SIEMPRE se RESTA del subtotal para calcular el total a pagar.

TIPOS DE IRPF MÁS COMUNES EN FACTURAS ESPAÑOLAS:
  - 15,0% → autónomo general / profesional (el más habitual)
  - 7,0%  → autónomo nuevo (primeros 3 años desde alta en Hacienda)
  - 2,0%  → actividades agrícolas, ganaderas o forestales
  - 19,0% → alquiler de inmuebles a empresas / capital mobiliario
  - 24,0% → profesionales no residentes en España

FÓRMULA CON IRPF:
  Total = Base imponible + Cuota IVA − Cuota IRPF
  Ejemplo práctico:
    Base: 1.000,00€  |  IVA 21%: 210,00€  |  IRPF 15%: −150,00€  |  TOTAL: 1.060,00€

CAMPOS A RELLENAR SI HAY IRPF (sea por etiqueta o por balance aritmético):
  - irpf_porcentaje: solo el número sin % (ej: "15,0", "7,0", "2,0")
  - cuota_irpf: importe retenido en formato español (ej: "150,00")
  - Si NO hay IRPF en la factura Y el balance Total = Base + IVA cuadra exacto
    (±0,05€ tolerancia) → irpf_porcentaje: "0,0", cuota_irpf: "0,00"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Devuelve un JSON con EXACTAMENTE estos campos:

 1. numero_factura    — Número de factura (ej: "F2024-001"). null si no visible.
 2. fecha_emision     — Formato DD/MM/AAAA. null si no visible.
 3. proveedor_nombre  — Razón social del EMISOR en MAYÚSCULAS. null si no legible.
 4. proveedor_nif     — NIF/CIF del EMISOR exacto como aparece escrito. null si NO lo ves. NUNCA inventes.
 5. receptor_nombre   — Nombre del RECEPTOR/CLIENTE en MAYÚSCULAS. null si no visible.
 6. receptor_nif      — NIF/CIF del RECEPTOR exacto. null si NO lo ves. NUNCA inventes.
 7. base_imponible    — Formato español "1.000,00". null si no visible.
 8. iva_porcentaje    — Sin %, formato "21,0". null si no visible.
 9. cuota_iva         — Formato español. null si no visible.
10. lineas_iva        — Solo si MÚLTIPLES tipos de IVA. Array [{base, porcentaje, cuota, productos:[{descripcion, importe}]}]. null si tramo único.
11. irpf_porcentaje   — Sin %. "0,0" si no hay IRPF.
12. cuota_irpf        — Formato español. "0,00" si no hay IRPF.
13. total             — Total final con IVA incluido. null si no visible.
14. moneda            — "EUR" por defecto.
15. es_factura_valida — true si es factura legible, false si no.

RECUERDA: null siempre es preferible a un dato inventado.
Devuelve SOLO el JSON, sin explicaciones. Directamente parseable.`;
}

// ── JSON Schema strict para response_format ────────────────────────────────────

const INVOICE_SCHEMA = {
  name: 'invoice_extraction',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      numero_factura:    { type: ['string', 'null'], description: 'Número de factura. null si no visible.' },
      fecha_emision:     { type: ['string', 'null'], description: 'DD/MM/AAAA. null si no visible.' },
      proveedor_nombre:  { type: ['string', 'null'], description: 'Razón social emisor. null si no legible.' },
      proveedor_nif:     { type: ['string', 'null'], description: 'CIF/NIF/NIE del emisor EXACTO como aparece en la imagen. CIF empresa (B83523741) o NIF autónomo (45678901B). null si no visible.' },
      receptor_nombre:   { type: ['string', 'null'], description: 'Nombre receptor. null si no visible.' },
      receptor_nif:      { type: ['string', 'null'], description: 'CIF/NIF receptor EXACTO. null si no visible.' },
      base_imponible:    { type: ['string', 'null'], description: 'Formato español 1.000,00. null si no visible.' },
      iva_porcentaje:    { type: ['string', 'null'], description: 'Sin %. null si no visible.' },
      cuota_iva:         { type: ['string', 'null'], description: 'Formato español. null si no visible.' },
      lineas_iva: {
        // OpenAI Structured Outputs (strict) NO admite oneOf/anyOf desde 2026-Q1.
        // Usamos type-array `['array','null']` que sí es soportado para opcionales.
        // Early-branch: null cuando la factura tiene UN SOLO tipo de IVA (tramo único).
        // Array solo cuando hay MÚLTIPLES tramos IVA detectados con claridad.
        type: ['array', 'null'],
        description: 'Solo en facturas multi-IVA. Un elemento por cada tramo detectado con sus productos asociados. null si la factura tiene un único tipo de IVA.',
        items: {
          type: 'object',
          properties: {
            base:       { type: 'string', description: 'Base imponible del tramo (suma de bases de productos con este %), formato español' },
            porcentaje: { type: 'string', description: 'Tipo IVA sin %, ej: 21,0' },
            cuota:      { type: 'string', description: 'Cuota IVA del tramo (suma de cuotas de productos con este %), formato español' },
            productos: {
              type: ['array', 'null'],
              description: 'Productos/líneas OCR agrupados dentro de este tramo. Array vacío [] o null si no se distinguen líneas individuales pero sí se ven los agregados del tramo.',
              items: {
                type: 'object',
                properties: {
                  descripcion: { type: 'string', description: 'Texto literal del producto tal como aparece en la factura (máx 120 chars)' },
                  importe:     { type: ['string', 'null'], description: 'Importe base del producto (antes de IVA) en formato español; null si solo consta el PVP con IVA incluido' }
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
      irpf_porcentaje:   { type: ['string', 'null'], description: 'Sin %. 0,0 si no hay IRPF.' },
      cuota_irpf:        { type: ['string', 'null'], description: '0,00 si no hay IRPF.' },
      total:             { type: ['string', 'null'], description: 'Total final con IVA. null si no visible.' },
      moneda:            { type: 'string', description: 'EUR por defecto.' },
      es_factura_valida: { type: 'boolean', description: 'true si es factura legible.' }
    },
    required: [
      'numero_factura', 'fecha_emision', 'proveedor_nombre', 'proveedor_nif',
      'receptor_nombre', 'receptor_nif', 'base_imponible', 'iva_porcentaje',
      'cuota_iva', 'lineas_iva', 'irpf_porcentaje', 'cuota_irpf', 'total',
      'moneda', 'es_factura_valida'
    ],
    additionalProperties: false
  }
};

// ── Optimización de imagen ─────────────────────────────────────────────────────

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

// ── Extracción principal ───────────────────────────────────────────────────────

/**
 * Extrae todos los datos fiscales de una factura usando GPT-4.1 Vision.
 *
 * @param {string} filePath   - Ruta al archivo en disco
 * @param {string} mimeType   - MIME type del archivo
 * @param {string} apiKey     - OpenAI API key
 * @param {object} context    - Contexto opcional: { invoice_type, empresa_nif, empresa_nombre }
 */
async function extractInvoice(filePath, mimeType, apiKey, context = {}) {
  const start = Date.now();

  const { buffer, mime } = await optimizeImage(filePath, mimeType);
  const base64  = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  const body = {
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          { type: 'text', text: buildInvoicePrompt(context) }
        ]
      }
    ],
    max_tokens: 1200,
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: INVOICE_SCHEMA }
  };

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${errBody}`);
  }

  const data    = await res.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  const content = data.choices?.[0]?.message?.content;

  if (!content) throw new Error('OpenAI no devolvió contenido');

  let campos;
  try {
    campos = JSON.parse(content);
  } catch (e) {
    throw new Error(`OpenAI devolvió JSON inválido: ${content.substring(0, 200)}`);
  }

  const esValida = campos.es_factura_valida !== false;

  return {
    success: true,
    es_factura_valida: esValida,
    campos,
    confidence: esValida ? 0.95 : 0.0,
    processing_time_s: parseFloat(elapsed),
    ocr_engine: 'openai_gpt41',
    tokens_used: data.usage?.total_tokens || 0
  };
}

// ── Extracción enfocada solo en CIF/NIF del emisor ────────────────────────────
// Segunda pasada independiente: recorta el 65% superior de la imagen
// (donde siempre está el emisor) y usa un prompt carácter a carácter.

const CIF_SYSTEM_PROMPT = `Eres un especialista en lectura de identificadores fiscales españoles (CIF/NIF).
Tu ÚNICA misión: encontrar y leer el CIF o NIF del EMISOR/PROVEEDOR en la imagen.

PROCESO MENTAL OBLIGATORIO:
1. Localiza el CIF/NIF en la imagen (busca "CIF", "NIF", "N.I.F.", "C.I.F.", "VAT")
2. Lee el PRIMER carácter (letra), luego el SEGUNDO, luego el TERCERO. Uno a uno.
3. El formato es SIEMPRE: 1 letra + 7 dígitos + 1 carácter final = 9 caracteres

ERRORES CRÍTICOS A EVITAR:
- NO intercambies el orden de dígitos adyacentes (el error más frecuente)
- 3 vs 8: el 3 tiene apertura a la derecha, el 8 es completamente cerrado
- 9 vs 3: el 9 es cerrado arriba con cola abajo, el 3 es abierto
- 7 vs 1: el 7 tiene trazo diagonal superior, el 1 es vertical recto`;

const CIF_USER_PROMPT = `Encuentra el CIF/NIF del EMISOR/PROVEEDOR (quien emite la factura — en el membrete superior).
Devuelve cada carácter en el array "chars", en orden estricto izquierda a derecha.
Ejemplo: CIF B39793294 → chars: ["B","3","9","7","9","3","2","9","4"]
Si no puedes leerlo con certeza → chars: null`;

// ── Petición compartida a GPT-4.1 con recorte + schema chars[] ────────────────
// Reutilizada por extractCIFOnly (emisor en cabecera) y extractReceptorCIFOnly
// (cliente en bloque inferior de facturas emitidas).

async function _extractCIFFromCrop(filePath, mimeType, apiKey, cropFn, systemPrompt, userPrompt, schemaName) {
  try {
    let buffer;
    if (mimeType.startsWith('image/')) {
      const img  = sharp(filePath);
      const meta = await img.metadata();
      const region = cropFn(meta);
      buffer = await img
        .extract(region)
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .sharpen({ sigma: 1.2, m1: 0.5, m2: 3 })
        .jpeg({ quality: 95 })
        .toBuffer();
    } else {
      buffer = fs.readFileSync(filePath);
    }

    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;

    const body = {
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            { type: 'text', text: userPrompt }
          ]
        }
      ],
      max_tokens: 128,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: {
            type: 'object',
            properties: {
              chars: {
                // strict mode: usar `type: ['array','null']` en vez de oneOf (no permitido)
                type: ['array', 'null'],
                description: 'Array con cada carácter del CIF en orden. null si no legible.',
                items: { type: 'string' }
              }
            },
            required: ['chars'],
            additionalProperties: false
          }
        }
      }
    };

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) return null;
    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed  = JSON.parse(content);
    if (!parsed.chars || !Array.isArray(parsed.chars) || parsed.chars.length !== 9) return null;
    return parsed.chars.join('').toUpperCase();
  } catch {
    return null;
  }
}

async function extractCIFOnly(filePath, mimeType, apiKey) {
  // Recorta el 65% SUPERIOR — donde siempre va el emisor en cabecera.
  return _extractCIFFromCrop(
    filePath, mimeType, apiKey,
    (meta) => ({ left: 0, top: 0, width: meta.width, height: Math.floor((meta.height || 2000) * 0.65) }),
    CIF_SYSTEM_PROMPT, CIF_USER_PROMPT, 'cif_char_extraction'
  );
}

// ── Extracción enfocada solo en CIF/NIF del CLIENTE/RECEPTOR ──────────────────
// Para facturas EMITIDAS (invoice_type='venta'). Recorta el 60% INFERIOR donde
// suele aparecer el bloque "Facturar a:" / "Cliente:" / "Datos del cliente:".
//
// Existe porque Azure DI a veces no extrae receptor_nif en plantillas atípicas
// y en facturas de venta ese dato es esencial para la contabilidad del usuario.

const RECEPTOR_CIF_SYSTEM_PROMPT = `Eres un especialista en lectura de identificadores fiscales españoles (CIF/NIF).
Tu ÚNICA misión: encontrar y leer el CIF o NIF del CLIENTE/RECEPTOR en la imagen.

PROCESO MENTAL OBLIGATORIO:
1. Localiza el bloque "Facturar a:", "Cliente:", "Destinatario:", "Datos del cliente:" o similar.
2. Dentro de ese bloque busca la etiqueta "CIF", "NIF", "N.I.F.", "C.I.F.", "VAT".
3. Lee el PRIMER carácter (letra), luego el SEGUNDO, luego el TERCERO. Uno a uno.
4. El formato es SIEMPRE: 1 letra + 7 dígitos + 1 carácter final = 9 caracteres.

IMPORTANTE — NO confundas con el emisor:
- El EMISOR está en la CABECERA SUPERIOR (logo, razón social del que factura).
- El RECEPTOR está en un bloque secundario, a menudo enmarcado, con "Facturar a:" o "Cliente:".
- Si sólo hay un único CIF visible y NO está en ningún bloque "Cliente:" → devuelve null.

ERRORES CRÍTICOS A EVITAR:
- NO intercambies el orden de dígitos adyacentes (el error más frecuente)
- 3 vs 8: el 3 tiene apertura a la derecha, el 8 es completamente cerrado
- 9 vs 3: el 9 es cerrado arriba con cola abajo, el 3 es abierto
- 7 vs 1: el 7 tiene trazo diagonal superior, el 1 es vertical recto`;

const RECEPTOR_CIF_USER_PROMPT = `Encuentra el CIF/NIF del CLIENTE/RECEPTOR (a quien va dirigida la factura — bloque "Facturar a:", "Cliente:", "Destinatario:").
Devuelve cada carácter en el array "chars", en orden estricto izquierda a derecha.
Ejemplo: CIF B39793294 → chars: ["B","3","9","7","9","3","2","9","4"]
Si no encuentras un bloque claramente identificado como cliente/receptor → chars: null
Si no puedes leerlo con certeza → chars: null`;

async function extractReceptorCIFOnly(filePath, mimeType, apiKey) {
  // Recorta el 60% INFERIOR — donde suele aparecer el bloque del cliente
  // en facturas emitidas españolas.
  return _extractCIFFromCrop(
    filePath, mimeType, apiKey,
    (meta) => {
      const h = meta.height || 2000;
      const top = Math.floor(h * 0.40); // empieza al 40% desde arriba
      return { left: 0, top, width: meta.width, height: h - top };
    },
    RECEPTOR_CIF_SYSTEM_PROMPT, RECEPTOR_CIF_USER_PROMPT, 'receptor_cif_char_extraction'
  );
}

module.exports = { extractInvoice, extractCIFOnly, extractReceptorCIFOnly };
