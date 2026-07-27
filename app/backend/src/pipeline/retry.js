// src/pipeline/retry.js
// Fase 4 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: reintentos con backoff
// exponencial + jitter ante 429/5xx.
//
// Gap confirmado en la auditoría Fase 0 (docs/INFORME-AUDITORIA-OCR.md §4):
// ninguno de los 4 adaptadores OCR (openai/azure/gemini/mistral) reintenta
// nada hoy — causa directa de los errores 429 masivos vistos con Azure DI
// (tier gratuito F0) en el benchmark de esta semana (hasta 14/28 facturas
// con error en una sola pasada).
//
// Envuelve CUALQUIER función async por fuera, SIN tocar los adaptadores:
// los 4 lanzan Error con el patrón "... HTTP <código>: ..." (verificado en
// los 4 ficheros — azure.js:69, gemini.js:187, openai.js:309,
// mistral.js:174) — el código se detecta con una regex, no hace falta que
// los adaptadores expongan un objeto de error estructurado.
'use strict';

const CODIGOS_REINTENTABLES = new Set([408, 429, 500, 502, 503, 504]);

function extraerCodigoHTTP(mensaje) {
  const m = /HTTP (\d{3})/.exec(mensaje || '');
  return m ? parseInt(m[1], 10) : null;
}

/** Solo son reintentables los fallos TRANSITORIOS (rate limit, servidor
 *  caído/saturado). Un 400/401/403 o un JSON inválido son errores reales —
 *  reintentarlos solo gastaría dinero sin cambiar el resultado. */
function esReintentable(err) {
  const codigo = extraerCodigoHTTP(err.message);
  return codigo !== null && CODIGOS_REINTENTABLES.has(codigo);
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta `fn` con reintentos ante fallos reintentables, con backoff
 * exponencial + jitter (50-100% del valor calculado, evita que varias
 * facturas reintenten todas en el mismo instante exacto y se atasquen entre
 * sí — "efecto manada").
 *
 * @param {() => Promise<any>} fn
 * @param {object} [opts]
 * @param {number} [opts.maxIntentos=3]
 * @param {number} [opts.baseMs=500]      espera antes del 1er reintento
 * @param {number} [opts.maxMs=8000]      tope de espera entre reintentos
 * @param {(err: Error) => boolean} [opts.esReintentable]
 * @param {object} [opts.logger]          logger con .warn(msg) opcional
 */
async function conReintentos(fn, opts = {}) {
  const {
    maxIntentos = 3,
    baseMs = 500,
    maxMs = 8000,
    esReintentable: esReintentableFn = esReintentable,
    logger = null,
  } = opts;

  let ultimoError;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      const quedanIntentos = intento < maxIntentos;
      if (!quedanIntentos || !esReintentableFn(err)) throw err;

      const espera = Math.min(maxMs, baseMs * 2 ** (intento - 1)) * (0.5 + Math.random() * 0.5);
      if (logger) logger.warn(`[Retry] Intento ${intento}/${maxIntentos} falló (${err.message}) — reintentando en ${Math.round(espera)}ms`);
      await esperar(espera);
    }
  }
  throw ultimoError;
}

module.exports = { conReintentos, esReintentable, extraerCodigoHTTP, CODIGOS_REINTENTABLES };
