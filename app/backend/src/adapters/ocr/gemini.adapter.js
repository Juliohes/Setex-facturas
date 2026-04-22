// Adapter Gemini DESACTIVADO por decisión de producto (2026-04-16: se retiró
// integración Google junto con Drive y Sheets). Stub que cumple OcrPort pero
// devuelve healthcheck=false y rechaza extract().
//
// Se mantiene el fichero para documentar el patrón: añadir un motor = crear
// 1 fichero adapter + registrar en factory. Ver ADR-0004 sección OCP.
'use strict';

const { assertOcrPort } = require('../../ports/ocr.port');

function createGeminiOcrAdapter({ logger } = {}) {
  const adapter = {
    name: 'gemini',

    async healthcheck() {
      logger?.info?.('gemini.adapter: deshabilitado por decisión de producto');
      return false;
    },

    async extract() {
      throw new Error('gemini.adapter: deshabilitado — usar openai o azure');
    },
  };

  return assertOcrPort(adapter);
}

module.exports = { createGeminiOcrAdapter };
