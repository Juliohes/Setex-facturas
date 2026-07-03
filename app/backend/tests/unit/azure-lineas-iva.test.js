// Tests del fix multi-IVA 2026-07-03 — ocr/azure.js (extractLineasIvaAzure)
//
// Contexto verificado contra el schema oficial 2024-11-30-ga de prebuilt-invoice:
// TaxDetails.* solo trae Amount (currency) y Rate (string) — NO BaseAmount.
// Antes del fix, la base de cada tramo era siempre null y los tramos exentos
// sin Amount se descartaban (degradando multi-IVA → mono-IVA).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractLineasIvaAzure, normalizeRate } = require('../../src/ocr/azure');

// Fixture realista: shape del JSON de Azure DI para TaxDetails
function taxDetail(amount, rate) {
  return {
    valueObject: {
      Amount: amount != null ? { valueCurrency: { amount } } : undefined,
      Rate:   rate   != null ? { valueString: rate } : undefined,
    },
  };
}

test('normalizeRate: acepta 21, 0.21, "21%", "21,0"', () => {
  assert.equal(normalizeRate(21), 21);
  assert.equal(normalizeRate(0.21), 21);
  assert.equal(normalizeRate('21%'), 21);
  assert.equal(normalizeRate('21,0'), 21);
  assert.equal(normalizeRate(null), null);
});

test('extractLineasIvaAzure: deriva base por aritmética (schema sin BaseAmount)', () => {
  const fields = {
    TaxDetails: { valueArray: [taxDetail(21.0, '21'), taxDetail(5.0, '10')] },
  };
  const lineas = extractLineasIvaAzure(fields);
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].base, '100,00');  // 21 ÷ 0.21
  assert.equal(lineas[0].cuota, '21,00');
  assert.equal(lineas[1].base, '50,00');   // 5 ÷ 0.10
});

test('extractLineasIvaAzure: tramo exento (rate 0 sin Amount) ya NO se descarta', () => {
  const fields = {
    TaxDetails: { valueArray: [taxDetail(21.0, '21'), taxDetail(null, '0')] },
  };
  const lineas = extractLineasIvaAzure(fields);
  assert.equal(lineas.length, 2, 'el tramo exento debe conservarse');
  const exento = lineas.find(l => l.porcentaje === '0,0');
  assert.equal(exento.cuota, '0,00');
});

test('extractLineasIvaAzure: un solo tramo → null (contrato mono-IVA intacto)', () => {
  const fields = { TaxDetails: { valueArray: [taxDetail(21.0, '21')] } };
  assert.equal(extractLineasIvaAzure(fields), null);
});

test('extractLineasIvaAzure: sin TaxDetails → null', () => {
  assert.equal(extractLineasIvaAzure({}), null);
});
