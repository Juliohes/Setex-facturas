// src/pipeline/ingest.js
// Fase 2 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: clasificación de documento
// ANTES de que llegue a ningún motor OCR.
//
// Módulo puro y aislado: no se invoca todavía desde ningún flujo real (queda
// listo para conectarse en una fase posterior, detrás de
// ocr_extraccion_v2_enabled). No sustituye la validación de magic bytes de
// server.js — esa sigue siendo la que protege /api/upload-preview hoy.
//
// Gap confirmado en la auditoría Fase 0 (docs/INFORME-AUDITORIA-OCR.md §7):
// hoy CUALQUIER PDF se manda entero y sin analizar a las 4 APIs de OCR — y
// OpenAI lo rechaza directamente (HTTP 400 "Invalid MIME type", visto con un
// PDF real en el benchmark del 2026-07-24). Muchas facturas en PDF (no
// escaneadas, generadas ya digitales) tienen el texto YA dentro del fichero
// — leerlo aquí es gratis e instantáneo, sin gastar ninguna llamada de IA.
//
// Motor: pdfjs-dist (Apache-2.0, cero dependencias runtime, el mismo motor
// que ya usa el frontend para previsualizar PDFs — vendorizado ahí en una
// versión más antigua como pdf.min.js). Se probó primero `pdf-parse@1.1.1`
// (dependencias más ligeras, sin canvas nativo) pero esa librería está
// abandonada y falla ("bad XRef entry") con PDFs perfectamente válidos
// generados por herramientas modernas — se descartó por poco fiable.
'use strict';

// pdfjs-dist solo publica build ESM — se importa dinámicamente desde este
// módulo CommonJS (soportado nativamente por Node 20).
let pdfjsLibPromise = null;
function cargarPdfjs() {
  if (!pdfjsLibPromise) pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsLibPromise;
}

// Heurística: por debajo de este nº de caracteres de texto TOTAL extraídos
// del documento, se asume que no hay capa de texto fiable (probable
// escaneo/foto dentro de un PDF) y debe tratarse como imagen, no como texto
// nativo. Deliberadamente NO se divide entre nº de páginas: un PDF real de
// una sola factura con contenido en la portada y páginas siguientes casi
// vacías (anexos, condiciones) seguiría siendo "nativo" — dividir por
// páginas diluye el conteo y puede dar un falso "escaneado".
const UMBRAL_CARACTERES_POR_PAGINA = 20;

/** Extrae el texto de un PDF página a página. No lanza si el PDF es válido pero está vacío. */
async function extraerTextoPDF(buffer) {
  const pdfjsLib = await cargarPdfjs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const textosPorPagina = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    textosPorPagina.push(content.items.map((it) => it.str).join(' ').trim());
  }
  return { texto: textosPorPagina.join('\n').trim(), paginas: doc.numPages, textosPorPagina };
}

/**
 * Clasifica un PDF en 'pdf_nativo' (texto ya extraíble, se puede saltar el
 * OCR) o 'pdf_escaneado' (sin capa de texto fiable, necesita ir por la vía
 * de imagen/OCR de siempre).
 */
async function clasificarPDF(buffer) {
  let resultado;
  try {
    resultado = await extraerTextoPDF(buffer);
  } catch (err) {
    // PDF corrupto o no parseable: no se puede decidir — cae a la vía actual
    // (tratarlo como si necesitara OCR/envío tal cual), nunca se bloquea.
    return { tipo: 'pdf_no_parseable', texto: null, paginas: null, motivo: err.message };
  }
  const { texto, paginas } = resultado;

  if (texto.length >= UMBRAL_CARACTERES_POR_PAGINA) {
    return { tipo: 'pdf_nativo', texto, paginas, caracteres_extraidos: texto.length };
  }
  return { tipo: 'pdf_escaneado', texto: texto || null, paginas, caracteres_extraidos: texto.length };
}

/**
 * Punto de entrada de la Fase 2: clasifica cualquier documento de entrada
 * (imagen o PDF) antes de decidir cómo procesarlo.
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
async function clasificarDocumento(buffer, mimeType) {
  if (mimeType === 'application/pdf') return clasificarPDF(buffer);
  if (typeof mimeType === 'string' && mimeType.startsWith('image/')) {
    return { tipo: 'imagen', texto: null, paginas: 1 };
  }
  return { tipo: 'desconocido', texto: null, paginas: null };
}

// Fase 2.3 del prompt (PDFs escaneados/multipágina → rasterizar cada página a
// imagen ~300dpi) queda DELIBERADAMENTE fuera de esta entrega. Requiere una
// dependencia de render con bindings nativos (@napi-rs/canvas, que sí tiene
// prebuild para Alpine/musl — verificado, ver auditoría §11) o instalar
// poppler-utils en el Dockerfile — cualquiera de las dos aumenta el tamaño/
// riesgo de build de la imagen y es una decisión de infraestructura, no solo
// de código. Pendiente de que Julio elija una antes de implementarla.

module.exports = { clasificarDocumento, clasificarPDF, extraerTextoPDF, UMBRAL_CARACTERES_POR_PAGINA };
