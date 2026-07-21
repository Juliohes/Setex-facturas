// Tests de validateIVACoherencia — domain/validators/iva.js
//
// Contexto (2026-07-21): esta función existía y se usaba en producción, pero
// no tenía ningún test dedicado (los tests existentes de iva-multi.test.js
// cubren mergeLineasIva/fillDerivedBases/dropResumenArtifacts, no esta
// función). Además se añade aquí cobertura del nuevo campo `sugerencias`
// (valor despejado por aritmética cuando una comprobación no cuadra).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateIVACoherencia } = require('../../src/domain/validators/iva');

function facturaBase(overrides = {}) {
  return {
    base_imponible: '100,00',
    iva_porcentaje: '21',
    cuota_iva: '21,00',
    total: '121,00',
    cuota_irpf: null,
    irpf_porcentaje: null,
    lineas_iva: [],
    ...overrides,
  };
}

describe('validateIVACoherencia — mono-IVA', () => {
  test('factura correcta: sin errores, sin avisos, sin sugerencias', () => {
    const r = validateIVACoherencia(facturaBase());
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.sugerencias, {});
  });

  test('cuota mal leída: error + sugerencia de la cuota despejada (base × tipo)', () => {
    const r = validateIVACoherencia(facturaBase({ cuota_iva: '27,00' }));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes('IVA inconsistente')));
    assert.equal(r.sugerencias.cuota_iva, '21,00');
  });

  test('total mal leído: error + sugerencia del total despejado (base + cuota - irpf)', () => {
    const r = validateIVACoherencia(facturaBase({ total: '999,00' }));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes('Total inconsistente')));
    assert.equal(r.sugerencias.total, '121,00');
  });

  test('total con IRPF: base + cuota - irpf ≈ total', () => {
    const r = validateIVACoherencia(facturaBase({
      cuota_irpf: '15,00',
      total: '106,00',
    }));
    assert.equal(r.valid, true);
    assert.deepEqual(r.sugerencias, {});
  });

  test('tolerancia de redondeo (±0,05€) no genera error', () => {
    const r = validateIVACoherencia(facturaBase({
      base_imponible: '33,33',
      cuota_iva: '7,00', // 33,33 × 21% = 6,9993 ≈ 7,00
      total: '40,33',
    }));
    assert.equal(r.valid, true);
  });

  test('tipo de IVA no legal en España genera aviso, no error', () => {
    const r = validateIVACoherencia(facturaBase({
      iva_porcentaje: '15',
      cuota_iva: '15,00',
      total: '115,00',
    }));
    assert.equal(r.valid, true); // aviso, no bloquea
    assert.ok(r.warnings.some((w) => w.includes('Tipo IVA inusual')));
  });

  test('campos ausentes no lanzan excepción y no generan falsos errores', () => {
    const r = validateIVACoherencia({});
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
  });
});

describe('validateIVACoherencia — multi-IVA', () => {
  test('tolerancia ampliada (±0,30€) para acumulación de redondeos', () => {
    const r = validateIVACoherencia(facturaBase({
      base_imponible: '150,00',
      cuota_iva: '26,20',
      total: '176,20',
      lineas_iva: [
        { base: '100,00', porcentaje: '21', cuota: '21,00' },
        { base: '50,00', porcentaje: '10', cuota: '5,00' },
      ],
    }));
    assert.equal(r.valid, true);
  });

  test('línea individual descuadrada genera aviso con el porcentaje señalado', () => {
    const r = validateIVACoherencia(facturaBase({
      base_imponible: '150,00',
      cuota_iva: '30,00',
      total: '180,00',
      lineas_iva: [
        { base: '100,00', porcentaje: '21', cuota: '25,00' }, // debería ser 21,00
        { base: '50,00', porcentaje: '10', cuota: '5,00' },
      ],
    }));
    assert.ok(r.warnings.some((w) => w.includes('Línea IVA 21%')));
  });
});
