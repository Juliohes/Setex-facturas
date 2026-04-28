// Adapter PaddleOCR STUB. PaddleOCR está instalado (~3 GB) pero no integrado
// al pipeline (pendiente ROADMAP Q3 — decidir integrar o desinstalar).
//
// El adapter cumple OcrPort para permitir su inclusión en el factory sin
// regresión, y sirve de hook de integración cuando llegue la decisión.
'use strict';

const { assertOcrPort } = require('../../ports/ocr.port');

function createPaddleOcrAdapter({ logger } = {}) {
  const adapter = {
    name: 'paddle',

    async healthcheck() {
      // Futuro: invocar binario paddle ocr --version con timeout 2s.
      logger?.debug?.('paddle.adapter: integración pendiente (ROADMAP Q3)');
      return false;
    },

    async extract() {
      throw new Error('paddle.adapter: integración pendiente — ROADMAP Q3');
    },
  };

  return assertOcrPort(adapter);
}

module.exports = { createPaddleOcrAdapter };
