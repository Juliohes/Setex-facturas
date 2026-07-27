// src/pipeline/reextraction.js
// Fase 7 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: re-extracción dirigida
// ("recuperación quirúrgica").
//
// Cuando un campo queda en_disputa (pipeline/arbiter.js, Fase 5) y Azure
// aportó su bounding box (ocr/azure.js, Fase 7 — antes se descartaba), en
// vez de repetir la extracción de TODA la factura: se recorta y amplía
// SOLO la zona de ese campo, y se pregunta por él en aislado — más barato,
// más rápido, y más preciso (un número pequeño se lee mejor ampliado).
//
// Límites explícitos del prompt: máximo 2 reintentos por campo (Gemini,
// luego OpenAI como fallback) y 4 por documento. Si no se resuelve → queda
// en disputa para revisión humana (Fase 8) — NUNCA se acepta un valor que
// no pasó ninguna validación solo por rellenar el hueco.
'use strict';

const fs = require('fs');
const sharp = require('sharp');
const { conReintentos } = require('./retry');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_INTENTOS_POR_CAMPO = 2;
const MAX_CAMPOS_POR_DOCUMENTO = 4;
const MARGEN_RECORTE = 0.15; // 15% de margen alrededor del polígono detectado

function getSecret(name) {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return process.env[name.toUpperCase()] || null;
  }
}

/**
 * Convierte el polígono de Azure (espacio de la página que Azure analizó)
 * a una región de recorte en píxeles de la imagen REAL que se vaya a
 * recortar (pueden diferir en resolución) — con margen y sin salirse de
 * los límites de la imagen.
 */
function calcularRecorte(poligono, paginaInfo, dimensionesReales) {
  const xs = poligono.filter((_, i) => i % 2 === 0);
  const ys = poligono.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const escalaX = dimensionesReales.width / paginaInfo.ancho;
  const escalaY = dimensionesReales.height / paginaInfo.alto;

  const anchoBox = (maxX - minX) * escalaX;
  const altoBox = (maxY - minY) * escalaY;
  const margenX = anchoBox * MARGEN_RECORTE;
  const margenY = altoBox * MARGEN_RECORTE;

  const left = Math.max(0, Math.round(minX * escalaX - margenX));
  const top = Math.max(0, Math.round(minY * escalaY - margenY));
  const right = Math.min(dimensionesReales.width, Math.round(maxX * escalaX + margenX));
  const bottom = Math.min(dimensionesReales.height, Math.round(maxY * escalaY + margenY));

  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Recorta y amplía la zona del campo (mínimo 400px de ancho, para que un número pequeño se lea bien). */
async function recortarZona(filePath, boundingBox, paginasInfo) {
  const paginaInfo = paginasInfo.find((p) => p.pagina === boundingBox.pagina) || paginasInfo[0];
  if (!paginaInfo) throw new Error('Sin información de página para escalar el recorte');

  const meta = await sharp(filePath).metadata();
  const recorte = calcularRecorte(boundingBox.poligono, paginaInfo, { width: meta.width, height: meta.height });

  const ANCHO_MINIMO_AMPLIADO = 500;
  const factorAmpliacion = recorte.width < ANCHO_MINIMO_AMPLIADO ? Math.ceil(ANCHO_MINIMO_AMPLIADO / recorte.width) : 1;

  return sharp(filePath)
    .extract(recorte)
    .resize({ width: recorte.width * factorAmpliacion })
    .sharpen()
    .jpeg({ quality: 95 })
    .toBuffer();
}

const PROMPTS_POR_CAMPO = {
  numero_factura: 'el número de factura',
  fecha_emision: 'la fecha de emisión (formato DD/MM/AAAA)',
  proveedor_nif: 'el CIF/NIF del proveedor/emisor (9 caracteres exactos)',
  receptor_nif: 'el CIF/NIF del cliente/receptor (9 caracteres exactos)',
  base_imponible: 'la base imponible (formato español "1.234,56")',
  cuota_iva: 'la cuota de IVA (formato español "1.234,56")',
  total: 'el importe total de la factura (formato español "1.234,56")',
};

const SCHEMA_VALOR_UNICO = {
  type: 'object',
  properties: { valor: { type: ['string', 'null'] } },
  required: ['valor'],
};

async function preguntarGemini(bufferRecorte, nombreCampo, apiKey, modelo) {
  const pregunta = PROMPTS_POR_CAMPO[nombreCampo];
  if (!pregunta) throw new Error(`Campo sin prompt de re-extracción definido: ${nombreCampo}`);

  const res = await fetch(`${GEMINI_BASE_URL}/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: 'Lees SOLO el dato pedido en este recorte de una factura española. Si no es legible con certeza, devuelve null. Nunca inventes.' }] },
      contents: [{ role: 'user', parts: [
        { inline_data: { mime_type: 'image/jpeg', data: bufferRecorte.toString('base64') } },
        { text: `Extrae ${pregunta} de este recorte. Devuelve SOLO el campo "valor".` },
      ] }],
      generationConfig: {
        temperature: 0, maxOutputTokens: 512,
        thinkingConfig: { thinkingLevel: 'low' },
        responseMimeType: 'application/json', responseJsonSchema: SCHEMA_VALOR_UNICO,
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text().catch(() => '')).substring(0, 200)}`);
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.find((p) => typeof p.text === 'string')?.text : null;
  if (!text) throw new Error('Gemini: respuesta sin texto JSON');
  return JSON.parse(text)?.valor ?? null;
}

async function preguntarOpenAI(bufferRecorte, nombreCampo, apiKey) {
  const pregunta = PROMPTS_POR_CAMPO[nombreCampo];
  if (!pregunta) throw new Error(`Campo sin prompt de re-extracción definido: ${nombreCampo}`);

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4.1',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Lees SOLO el dato pedido en este recorte de una factura española. Si no es legible con certeza, devuelve null en JSON {"valor": ...}. Nunca inventes.' },
        { role: 'user', content: [
          { type: 'text', text: `Extrae ${pregunta} de este recorte. Devuelve SOLO {"valor": "..."} o {"valor": null}.` },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${bufferRecorte.toString('base64')}` } },
        ] },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text().catch(() => '')).substring(0, 200)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI: respuesta sin contenido');
  return JSON.parse(content)?.valor ?? null;
}

/**
 * Re-extrae UN campo en disputa, dirigido a su zona exacta. Prueba Gemini
 * primero (con reintentos), y si falla del todo, OpenAI como fallback.
 * Nunca lanza — un fallo total se refleja en `resuelto:false`.
 */
async function reextraerCampoDirigido(nombreCampo, filePath, boundingBox, paginasInfo, cfg, logger) {
  if (!boundingBox) {
    return { campo: nombreCampo, resuelto: false, motivo: 'sin bounding box disponible para este campo' };
  }
  let bufferRecorte;
  try {
    bufferRecorte = await recortarZona(filePath, boundingBox, paginasInfo);
  } catch (err) {
    return { campo: nombreCampo, resuelto: false, motivo: `error recortando la zona: ${err.message}` };
  }

  const geminiKey = getSecret('gemini_api_key');
  const geminiModel = cfg?.ocr_gemini_flash_model || 'gemini-3.5-flash';
  try {
    const valor = await conReintentos(() => preguntarGemini(bufferRecorte, nombreCampo, geminiKey, geminiModel), { maxIntentos: MAX_INTENTOS_POR_CAMPO, baseMs: 300, logger });
    if (valor != null) return { campo: nombreCampo, resuelto: true, valor, fuente: 'gemini_flash_dirigido' };
  } catch (err) {
    if (logger) logger.warn(`[Reextraccion] Gemini falló para ${nombreCampo}: ${err.message}`);
  }

  const openaiKey = getSecret('openai_api_key');
  try {
    const valor = await conReintentos(() => preguntarOpenAI(bufferRecorte, nombreCampo, openaiKey), { maxIntentos: MAX_INTENTOS_POR_CAMPO, baseMs: 300, logger });
    if (valor != null) return { campo: nombreCampo, resuelto: true, valor, fuente: 'openai_dirigido' };
  } catch (err) {
    if (logger) logger.warn(`[Reextraccion] OpenAI falló para ${nombreCampo}: ${err.message}`);
  }

  return { campo: nombreCampo, resuelto: false, motivo: 'ambos motores agotaron reintentos sin devolver un valor legible' };
}

// Traduce los nombres de campo del árbitro (pipeline/arbiter.js, p.ej.
// "emisor.nif") a las claves que usa ocr/azure.js:bounding_boxes (p.ej.
// "proveedor_nif") — nomenclaturas distintas por origen histórico, ver
// docs/INFORME-AUDITORIA-OCR.md (arbiter usa emisor/receptor, azure.js usa
// proveedor/receptor). Campos sin bounding box posible (nombres, líneas de
// IVA multi-tramo) no aparecen aquí — reextraerCampoDirigido ya devuelve
// `resuelto:false` de forma explícita si no hay traducción.
const CAMPO_ARBITRO_A_AZURE = {
  'emisor.nif': 'proveedor_nif',
  'receptor.nif': 'receptor_nif',
  numero_factura: 'numero_factura',
  fecha_emision: 'fecha_emision',
  base_imponible: 'base_imponible',
  cuota_iva: 'cuota_iva',
  total: 'total',
};

/**
 * Re-extrae hasta MAX_CAMPOS_POR_DOCUMENTO campos en disputa. Recibe las
 * disputas del árbitro (Fase 5) + los bounding_boxes de Azure (Fase 7) del
 * MISMO documento. Devuelve un resultado por campo intentado; los campos
 * más allá del límite quedan sin intentar (motivo explícito, nunca
 * silencioso) — caen a revisión humana igual que si el reintento fallara.
 */
async function reextraerCamposDirigidos(disputas, filePath, boundingBoxesAzure, cfg, logger) {
  const paginasInfo = boundingBoxesAzure?.paginas || [];
  const aIntentar = disputas.slice(0, MAX_CAMPOS_POR_DOCUMENTO);
  const descartados = disputas.slice(MAX_CAMPOS_POR_DOCUMENTO);

  const resultados = [];
  for (const disputa of aIntentar) {
    const nombreCampoAzure = CAMPO_ARBITRO_A_AZURE[disputa.campo];
    if (!nombreCampoAzure) {
      resultados.push({ campo: disputa.campo, resuelto: false, motivo: 'campo sin bounding box posible (sin traducción a azure.js)' });
      continue;
    }
    const boundingBox = boundingBoxesAzure?.[nombreCampoAzure] || null;
    const r = await reextraerCampoDirigido(nombreCampoAzure, filePath, boundingBox, paginasInfo, cfg, logger);
    resultados.push({ ...r, campo: disputa.campo });
  }
  for (const disputa of descartados) {
    resultados.push({ campo: disputa.campo, resuelto: false, motivo: `límite de ${MAX_CAMPOS_POR_DOCUMENTO} campos por documento alcanzado` });
  }
  return resultados;
}

module.exports = {
  calcularRecorte,
  recortarZona,
  reextraerCampoDirigido,
  reextraerCamposDirigidos,
  MAX_INTENTOS_POR_CAMPO,
  MAX_CAMPOS_POR_DOCUMENTO,
};
