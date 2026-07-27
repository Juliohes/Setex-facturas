// tests/unit/pipeline-retry.test.js
// Fase 4 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: reintentos con backoff.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { conReintentos, esReintentable, extraerCodigoHTTP } = require('../../src/pipeline/retry');

describe('extraerCodigoHTTP', () => {
  test('extrae el código de los formatos reales usados por los 4 adaptadores', () => {
    assert.equal(extraerCodigoHTTP('Azure DI poll HTTP 429'), 429);
    assert.equal(extraerCodigoHTTP('Gemini(gemini-3.5-flash) HTTP 500: {...}'), 500);
    assert.equal(extraerCodigoHTTP('OpenAI HTTP 400: {...}'), 400);
    assert.equal(extraerCodigoHTTP('Mistral OCR HTTP 503: {...}'), 503);
  });
  test('sin código HTTP en el mensaje → null', () => {
    assert.equal(extraerCodigoHTTP('Mistral OCR: document_annotation ausente'), null);
  });
});

describe('esReintentable', () => {
  test('429/500/502/503/504/408 → reintentable', () => {
    for (const codigo of [408, 429, 500, 502, 503, 504]) {
      assert.equal(esReintentable(new Error(`HTTP ${codigo}`)), true, `${codigo} debería ser reintentable`);
    }
  });
  test('400/401/403 → NO reintentable (error real, no transitorio)', () => {
    for (const codigo of [400, 401, 403]) {
      assert.equal(esReintentable(new Error(`HTTP ${codigo}`)), false, `${codigo} NO debería reintentarse`);
    }
  });
  test('error sin código HTTP (p.ej. JSON inválido) → NO reintentable', () => {
    assert.equal(esReintentable(new Error('JSON inválido')), false);
  });
});

describe('conReintentos', () => {
  test('éxito al primer intento → no reintenta', async () => {
    let llamadas = 0;
    const resultado = await conReintentos(async () => { llamadas++; return 'ok'; });
    assert.equal(resultado, 'ok');
    assert.equal(llamadas, 1);
  });

  test('falla reintentable 2 veces, tercera vez OK → devuelve el resultado', async () => {
    let llamadas = 0;
    const resultado = await conReintentos(async () => {
      llamadas++;
      if (llamadas < 3) throw new Error('HTTP 429');
      return 'ok-al-tercer-intento';
    }, { baseMs: 1, maxMs: 5 });
    assert.equal(resultado, 'ok-al-tercer-intento');
    assert.equal(llamadas, 3);
  });

  test('error NO reintentable → lanza inmediatamente, sin reintentar', async () => {
    let llamadas = 0;
    await assert.rejects(
      () => conReintentos(async () => { llamadas++; throw new Error('HTTP 400: dato inválido'); }, { baseMs: 1 }),
      /HTTP 400/
    );
    assert.equal(llamadas, 1, 'no debe reintentar un 400');
  });

  test('agota maxIntentos → lanza el último error', async () => {
    let llamadas = 0;
    await assert.rejects(
      () => conReintentos(async () => { llamadas++; throw new Error('HTTP 503'); }, { maxIntentos: 3, baseMs: 1, maxMs: 2 }),
      /HTTP 503/
    );
    assert.equal(llamadas, 3);
  });

  test('respeta un esReintentable personalizado', async () => {
    let llamadas = 0;
    await assert.rejects(
      () => conReintentos(async () => { llamadas++; throw new Error('nunca reintentar esto'); }, {
        baseMs: 1, esReintentable: () => false,
      })
    );
    assert.equal(llamadas, 1);
  });
});
