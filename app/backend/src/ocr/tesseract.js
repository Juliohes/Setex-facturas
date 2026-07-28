// src/ocr/tesseract.js
// Tesseract OCR (tesseract.js v7, Apache-2.0) — reconocimiento de texto
// LOCAL, sin llamada a ninguna API externa ni coste por factura.
//
// A diferencia de openai/azure/gemini/mistral, Tesseract NO entiende la
// factura ni devuelve campos (NIF, fecha, importes...) — solo reconoce texto
// plano de los píxeles, sin ningún criterio de qué es qué. Por eso NO se usa
// aquí como un 5º candidato de extracción (eso exigiría una llamada de IA
// extra para mapear texto→campos, anulando la ventaja de ser gratuito).
//
// Uso real (gap "aprendizaje continuo", 2026-07-28): verificación cruzada
// anti-alucinación. Si un motor de IA propone un valor que no aparece en
// NINGÚN sitio del texto bruto reconocido aquí, es una señal fuerte de que
// el valor fue inventado, no leído del documento — la métrica más importante
// de todo el proyecto (ver CLAUDE.md regla 8).
//
// Coste: 0 USD (motor local). Coste de CPU: el contenedor backend está
// limitado a 0.5 vCPU en producción (docker-compose.yml) — por eso esto
// SIEMPRE corre en modo sombra (fire-and-forget), nunca en el camino
// síncrono que ve el usuario.
'use strict';

const Tesseract = require('tesseract.js');

// Bundleado en build time (Dockerfile) — el paquete de idioma español NUNCA
// se descarga en producción, evita depender de red en tiempo de ejecución.
const TESSERACT_CACHE_PATH = process.env.TESSERACT_CACHE_PATH || '/app/tesseract-data';

let workerPromise = null;
function obtenerWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('spa', 1, { cachePath: TESSERACT_CACHE_PATH });
  }
  return workerPromise;
}

/**
 * Reconoce el texto bruto de una imagen (JPEG/PNG — Tesseract no rasteriza
 * PDF; si hiciera falta un PDF habría que convertirlo antes). Nunca lanza:
 * cualquier fallo se captura y se devuelve como {ok:false, error}.
 *
 * @param {string} filePath
 * @returns {Promise<{ok:true, textoBruto:string, processing_time_s:number} | {ok:false, error:string}>}
 */
async function reconocerTextoBruto(filePath) {
  const inicio = Date.now();
  try {
    const worker = await obtenerWorker();
    const { data } = await worker.recognize(filePath);
    return {
      ok: true,
      textoBruto: data.text || '',
      processing_time_s: Math.round((Date.now() - inicio) / 100) / 10,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * ¿Aparece este valor (normalizado) en algún sitio del texto bruto?
 * Normalización deliberadamente laxa (sin espacios/guiones/puntos,
 * mayúsculas) para tolerar el ruido típico de Tesseract sobre fotos de
 * mala calidad — un "no aparece" debe significar de verdad "no está", no
 * un falso positivo por un espacio o un guión de más.
 *
 * @returns {boolean|null} null = no se pudo comprobar (valor o texto vacíos)
 */
function apareceEnTexto(valor, textoBruto) {
  if (!valor || !textoBruto) return null;
  const norm = (s) => String(s).toUpperCase().replace(/[\s\-.,]/g, '');
  const v = norm(valor);
  if (!v) return null;
  return norm(textoBruto).includes(v);
}

async function cerrarWorker() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

// Solo para tests: el worker es un singleton cacheado a propósito (evita
// recargar el modelo en cada factura) — esto permite resetear ese caché
// entre pruebas que mockean Tesseract.createWorker de forma distinta.
function _resetWorkerParaTests() {
  workerPromise = null;
}

module.exports = { reconocerTextoBruto, apareceEnTexto, cerrarWorker, _resetWorkerParaTests };
