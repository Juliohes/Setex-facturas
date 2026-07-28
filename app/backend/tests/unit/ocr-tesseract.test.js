// tests/unit/ocr-tesseract.test.js
// Gap "aprendizaje continuo" (2026-07-28): Tesseract como verificador
// anti-alucinación, no como 5º extractor de campos (ver cabecera de
// src/ocr/tesseract.js). Mockea Tesseract.createWorker (no ejecuta OCR real
// — sería lento y necesita el paquete de idioma bundleado en Docker, que no
// existe en este entorno de test).
'use strict';

const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Tesseract = require('tesseract.js');
const tesseractAdapter = require('../../src/ocr/tesseract');

describe('apareceEnTexto', () => {
  test('encuentra un NIF aunque el texto tenga ruido alrededor', () => {
    const r = tesseractAdapter.apareceEnTexto('B72327000', 'Factura ALEX SL\nCIF: B72327000\nTotal: 121,00');
    assert.equal(r, true);
  });

  test('tolera espacios, guiones y mayúsculas/minúsculas distintas', () => {
    const r = tesseractAdapter.apareceEnTexto('b-723 27000', 'CIF:B72327000');
    assert.equal(r, true);
  });

  test('devuelve false si el valor no está en ningún sitio del texto', () => {
    const r = tesseractAdapter.apareceEnTexto('B99999999', 'CIF: B72327000, Total 121,00');
    assert.equal(r, false);
  });

  test('devuelve null (no comprobable) si el valor está vacío', () => {
    assert.equal(tesseractAdapter.apareceEnTexto(null, 'algún texto'), null);
    assert.equal(tesseractAdapter.apareceEnTexto('', 'algún texto'), null);
  });

  test('devuelve null (no comprobable) si no hay texto bruto (ej. Tesseract falló)', () => {
    assert.equal(tesseractAdapter.apareceEnTexto('B72327000', ''), null);
    assert.equal(tesseractAdapter.apareceEnTexto('B72327000', null), null);
  });

  test('importes: tolera coma/punto y espacios de miles', () => {
    const r = tesseractAdapter.apareceEnTexto('1.234,56', 'TOTAL 1234,56 EUR');
    assert.equal(r, true);
  });
});

describe('reconocerTextoBruto', () => {
  let mWorker;
  afterEach(() => {
    if (mWorker) mWorker.mock.restore();
    tesseractAdapter._resetWorkerParaTests(); // el worker es un singleton — sin esto, el 2º test reutilizaría el mock del 1º
  });

  test('camino feliz: devuelve el texto reconocido', async () => {
    mWorker = mock.method(Tesseract, 'createWorker', async () => ({
      recognize: async () => ({ data: { text: 'texto reconocido de prueba' } }),
    }));
    const r = await tesseractAdapter.reconocerTextoBruto('/tmp/fake.jpg');
    assert.equal(r.ok, true);
    assert.equal(r.textoBruto, 'texto reconocido de prueba');
    assert.equal(typeof r.processing_time_s, 'number');
  });

  test('nunca lanza: un fallo de Tesseract se captura como {ok:false}', async () => {
    mWorker = mock.method(Tesseract, 'createWorker', async () => { throw new Error('no se pudo cargar el modelo'); });
    const r = await tesseractAdapter.reconocerTextoBruto('/tmp/fake.jpg');
    assert.equal(r.ok, false);
    assert.match(r.error, /no se pudo cargar el modelo/);
  });
});
