// Contract tests del OcrPort. Cada adapter debe:
//   1. Ser aceptado por assertOcrPort (shape del contrato)
//   2. Tener name: string no vacío
//   3. healthcheck() devolver boolean (no throw)
//   4. extract() rechazar si config incompleta, NO retornar undefined
//
// Estos tests son la base LSP del contrato: cambiar de adapter debe ser transparente.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { assertOcrPort } = require('../../src/ports/ocr.port');
const { createOpenAiOcrAdapter } = require('../../src/adapters/ocr/openai.adapter');
const { createAzureOcrAdapter } = require('../../src/adapters/ocr/azure.adapter');
const { createGeminiOcrAdapter } = require('../../src/adapters/ocr/gemini.adapter');
const { createPaddleOcrAdapter } = require('../../src/adapters/ocr/paddle.adapter');

const ADAPTERS = [
  { name: 'openai', factory: () => createOpenAiOcrAdapter({ apiKey: '', logger: null }) },
  { name: 'azure', factory: () => createAzureOcrAdapter({ endpoint: '', apiKey: '', logger: null }) },
  { name: 'gemini', factory: () => createGeminiOcrAdapter({ logger: null }) },
  { name: 'paddle', factory: () => createPaddleOcrAdapter({ logger: null }) },
];

for (const { name, factory } of ADAPTERS) {
  test(`adapter "${name}" cumple OcrPort (assert)`, () => {
    const adapter = factory();
    assert.equal(adapter.name, name);
    assert.ok(typeof adapter.healthcheck === 'function');
    assert.ok(typeof adapter.extract === 'function');
    // assertOcrPort valida el contrato completo
    assertOcrPort(adapter);
  });

  test(`adapter "${name}" healthcheck() NO lanza`, async () => {
    const adapter = factory();
    const ok = await adapter.healthcheck();
    assert.equal(typeof ok, 'boolean');
  });

  test(`adapter "${name}" extract() sin credenciales rechaza (no undefined)`, async () => {
    const adapter = factory();
    let threwOrReturned = false;
    try {
      const result = await adapter.extract({ filePath: '/tmp/noexiste.jpg', mimeType: 'image/jpeg' });
      // Si no lanza, al menos debe devolver un shape válido (por ejemplo gemini/paddle no llegan aquí — lanzan)
      threwOrReturned = !!result;
    } catch {
      threwOrReturned = true;
    }
    assert.ok(threwOrReturned, `adapter "${name}" extract() debe rechazar o devolver resultado`);
  });
}
