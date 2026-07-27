// tests/unit/pipeline-extractors.test.js
// Fase 4 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: capa de extracción
// multi-modelo. Mockea los 4 motores (mismo patrón que
// ocr-dispatch-regresion.test.js de la Fase 1) — cero llamadas de red real.
'use strict';

const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const openai = require('../../src/ocr/openai');
const azure = require('../../src/ocr/azure');
const gemini = require('../../src/ocr/gemini');
const mistral = require('../../src/ocr/mistral');
const {
  ejecutarExtractor,
  ejecutarExtraccionV2Paralelo,
  ejecutarArbitro,
  normalizarACanonico,
} = require('../../src/pipeline/extractors');
const { FacturaCanonicaSchema } = require('../../src/pipeline/schema');

const RESULTADO_OK = {
  success: true,
  es_factura_valida: true,
  confidence: 0.92,
  tokens_used: 1200,
  campos: {
    numero_factura: '0001', fecha_emision: '01/01/2026',
    proveedor_nombre: 'ACME SL', proveedor_nif: 'B12345678',
    receptor_nombre: 'Cliente SL', receptor_nif: 'B87654321',
    base_imponible: '100,00', iva_porcentaje: '21,0', cuota_iva: '21,00',
    lineas_iva: [{ base: '100,00', porcentaje: '21,0', cuota: '21,00' }],
    irpf_porcentaje: '0,0', cuota_irpf: '0,00', total: '121,00', moneda: 'EUR',
  },
};

describe('normalizarACanonico', () => {
  test('traduce el shape libre v1 al esquema canónico, válido contra Zod', () => {
    const canonico = normalizarACanonico(RESULTADO_OK, 'azure');
    assert.doesNotThrow(() => FacturaCanonicaSchema.parse(canonico));
    assert.equal(canonico.emisor.nif, 'B12345678');
    assert.equal(canonico.lineas_iva[0].tipo, '21,0');
    assert.equal(canonico._fuente, 'azure');
  });

  test('campos ausentes → null, nunca undefined ni excepción', () => {
    const canonico = normalizarACanonico({ es_factura_valida: true, campos: {} }, 'gemini_flash');
    assert.equal(canonico.emisor.nif, null);
    assert.deepEqual(canonico.lineas_iva, []);
    assert.doesNotThrow(() => FacturaCanonicaSchema.parse(canonico));
  });
});

describe('ejecutarExtractor', () => {
  test('éxito → ok:true con campos canónicos y métricas', async () => {
    const r = await ejecutarExtractor('azure', async () => RESULTADO_OK);
    assert.equal(r.ok, true);
    assert.equal(r.motor, 'azure');
    assert.equal(r.campos.total, '121,00');
    assert.equal(r.coste_estimado_usd, 0.0015);
    assert.equal(typeof r.tiempo_ms, 'number');
  });

  test('fallo tras agotar reintentos → ok:false, NUNCA lanza', async () => {
    const r = await ejecutarExtractor('azure', async () => { throw new Error('HTTP 429'); }, null);
    assert.equal(r.ok, false);
    assert.match(r.error, /HTTP 429/);
    assert.equal(r.campos, null);
  });
});

describe('ejecutarExtraccionV2Paralelo (mocks, sin red real)', () => {
  let mAzure, mGemini;

  beforeEach(() => {
    mAzure = mock.method(azure, 'extractInvoice', async () => ({ ...RESULTADO_OK, ocr_engine: 'azure' }));
    mGemini = mock.method(gemini, 'extractInvoice', async () => ({ ...RESULTADO_OK, ocr_engine: 'gemini_flash' }));
    process.env.AZURE_DI_KEY = 'test-key-000000';
    process.env.AZURE_DI_ENDPOINT = 'https://fake.cognitiveservices.azure.com';
    process.env.GEMINI_API_KEY = 'test-key-000000';
  });
  afterEach(() => { mAzure.mock.restore(); mGemini.mock.restore(); });

  test('llama a azure + gemini_flash en paralelo, ambos ok', async () => {
    const r = await ejecutarExtraccionV2Paralelo('/tmp/fake.jpg', 'image/jpeg', {}, {}, null);
    assert.equal(r.azure.ok, true);
    assert.equal(r.gemini_flash.ok, true);
    assert.equal(azure.extractInvoice.mock.callCount(), 1);
    assert.equal(gemini.extractInvoice.mock.callCount(), 1);
    assert.equal(openai.extractInvoice.mock?.callCount?.() ?? 0, 0, 'OpenAI no debe llamarse en el paralelo inicial');
  });

  test('un motor falla, el otro sigue — nunca se tumba el conjunto', async () => {
    mAzure.mock.restore();
    mAzure = mock.method(azure, 'extractInvoice', async () => { throw new Error('HTTP 429'); });
    const r = await ejecutarExtraccionV2Paralelo('/tmp/fake.jpg', 'image/jpeg', {}, {}, null);
    assert.equal(r.azure.ok, false);
    assert.equal(r.gemini_flash.ok, true);
  });
});

describe('ejecutarArbitro', () => {
  test('openai como árbitro, disponible pero solo bajo demanda', async () => {
    const m = mock.method(openai, 'extractInvoice', async () => ({ ...RESULTADO_OK, ocr_engine: 'openai' }));
    process.env.OPENAI_API_KEY = 'test-key-000000';
    try {
      const r = await ejecutarArbitro('openai', '/tmp/fake.jpg', 'image/jpeg', {}, {}, null);
      assert.equal(r.ok, true);
      assert.equal(r.motor, 'openai');
    } finally {
      m.mock.restore();
    }
  });

  test('árbitro desconocido → lanza (error de programación, no de red)', async () => {
    await assert.rejects(() => ejecutarArbitro('desconocido', '/tmp/fake.jpg', 'image/jpeg', {}, {}, null), /Árbitro desconocido/);
  });
});
