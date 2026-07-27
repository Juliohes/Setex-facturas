// tests/unit/ocr-dispatch-regresion.test.js
// Fase 1.3 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: "congela con tests los
// endpoints y respuestas existentes tal como son hoy (aunque sean
// imperfectos), para detectar cualquier rotura accidental".
//
// Congela el hallazgo más importante de docs/INFORME-AUDITORIA-OCR.md §8:
// en modo "gemini_azure" el fan-out llama a Gemini Flash + Azure y NUNCA a
// OpenAI ni Mistral — por diseño, no por bug. Si una futura Fase 4/5 de esta
// migración (o cualquier otro cambio) reintroduce OpenAI en ese modo sin
// querer, o dejara de llamar a Azure, este test rompe de inmediato.
//
// No hace ninguna llamada de red real: mockea `extractInvoice` de los 4
// adapters (mismos objetos que `ocr/index.js` requiere, ver `openai.js`
// etc. — el mock parchea el método en el objeto de módulo compartido) y
// controla `ocr_mode` interceptando la lectura de features.json.
'use strict';

const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const openai = require('../../src/ocr/openai');
const azure = require('../../src/ocr/azure');
const gemini = require('../../src/ocr/gemini');
const mistral = require('../../src/ocr/mistral');
const { extractInvoiceOCR } = require('../../src/ocr/index');

const FAKE_RESULT = {
  success: true,
  es_factura_valida: true,
  campos: { proveedor_nif: 'B12345678', total: '121,00' },
  confidence: 0.9,
  processing_time_s: 0.01,
};

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

// isPlaceholder() (index.js) exige longitud >=8 y que no contenga
// "INSERTAR"/"PLACEHOLDER" — cualquier cadena larga sirve, no son claves reales.
const FAKE_KEYS = {
  OPENAI_API_KEY: 'test-fake-openai-key-000',
  AZURE_DI_KEY: 'test-fake-azure-key-000',
  AZURE_DI_ENDPOINT: 'https://fake.cognitiveservices.azure.com',
  GEMINI_API_KEY: 'test-fake-gemini-key-000',
  MISTRAL_API_KEY: 'test-fake-mistral-key-000',
};

function conOcrMode(mode, extra = {}) {
  const original = fs.readFileSync;
  const restoreEnv = {};
  for (const [k, v] of Object.entries(FAKE_KEYS)) { restoreEnv[k] = process.env[k]; process.env[k] = v; }

  const readSync = mock.method(fs, 'readFileSync', function (path, ...args) {
    if (typeof path === 'string' && path.includes('features.json')) {
      return JSON.stringify({ ocr_mode: mode, ...extra });
    }
    return original.call(fs, path, ...args);
  });

  return {
    restore() {
      readSync.mock.restore();
      for (const [k, v] of Object.entries(restoreEnv)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    },
  };
}

describe('extractInvoiceOCR — dispatch por ocr_mode (regresión, sin red real)', () => {
  let handles;

  beforeEach(() => {
    handles = [
      mock.method(openai, 'extractInvoice', async () => ({ ...FAKE_RESULT, ocr_engine: 'openai' })),
      mock.method(azure, 'extractInvoice', async () => ({ ...FAKE_RESULT, ocr_engine: 'azure' })),
      mock.method(gemini, 'extractInvoice', async () => ({ ...FAKE_RESULT, ocr_engine: 'gemini_flash' })),
      mock.method(mistral, 'extractInvoice', async () => ({ ...FAKE_RESULT, ocr_engine: 'mistral' })),
    ];
  });

  afterEach(() => {
    handles.forEach((h) => h.mock.restore());
  });

  test('gemini_azure: llama a Gemini Flash + Azure, JAMÁS a OpenAI ni Mistral', async () => {
    const cfgMock = conOcrMode('gemini_azure');
    try {
      await extractInvoiceOCR('/tmp/fake.jpg', 'image/jpeg', 'fake.jpg', NOOP_LOGGER, {});
    } finally {
      cfgMock.restore();
    }
    assert.equal(gemini.extractInvoice.mock.callCount(), 1, 'Gemini Flash debe llamarse exactamente una vez');
    assert.equal(azure.extractInvoice.mock.callCount(), 1, 'Azure debe llamarse exactamente una vez');
    assert.equal(openai.extractInvoice.mock.callCount(), 0, 'OpenAI NO debe llamarse en modo gemini_azure');
    assert.equal(mistral.extractInvoice.mock.callCount(), 0, 'Mistral NO debe llamarse en modo gemini_azure');
  });

  test('dual (legacy): llama a OpenAI + Azure, no a Gemini ni Mistral', async () => {
    const cfgMock = conOcrMode('dual');
    try {
      await extractInvoiceOCR('/tmp/fake.jpg', 'image/jpeg', 'fake.jpg', NOOP_LOGGER, {});
    } finally {
      cfgMock.restore();
    }
    assert.equal(openai.extractInvoice.mock.callCount(), 1);
    assert.equal(azure.extractInvoice.mock.callCount(), 1);
    assert.equal(gemini.extractInvoice.mock.callCount(), 0);
    assert.equal(mistral.extractInvoice.mock.callCount(), 0);
  });

  test('multi con ocr_multi_engines completo: llama a los 5 motores', async () => {
    const cfgMock = conOcrMode('multi', { ocr_multi_engines: ['mistral', 'gemini_flash', 'gemini_pro'] });
    try {
      await extractInvoiceOCR('/tmp/fake.jpg', 'image/jpeg', 'fake.jpg', NOOP_LOGGER, {});
    } finally {
      cfgMock.restore();
    }
    assert.equal(openai.extractInvoice.mock.callCount(), 1);
    assert.equal(azure.extractInvoice.mock.callCount(), 1);
    assert.equal(mistral.extractInvoice.mock.callCount(), 1);
    // gemini_flash Y gemini_pro son 2 llamadas distintas al mismo extractInvoice
    assert.equal(gemini.extractInvoice.mock.callCount(), 2, 'gemini_flash + gemini_pro');
  });
});
