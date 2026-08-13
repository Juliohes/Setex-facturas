// tests/unit/pipeline-adaptador-v1.test.js
// Contrato del adaptador canónico→plano (2026-08-13): las claves y tipos del
// shape plano deben coincidir EXACTO con lo que espera el frontend/preview.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { canonicoAPlano } = require('../../src/pipeline/adaptador-v1');

const CLAVES_PLANO = [
  'proveedor_nombre', 'proveedor_nif', 'receptor_nombre', 'receptor_nif',
  'fecha_emision', 'total', 'numero_factura',
  'base_imponible', 'iva_porcentaje', 'cuota_iva', 'lineas_iva',
  'irpf_porcentaje', 'cuota_irpf',
];

describe('canonicoAPlano — contrato de claves', () => {
  test('null → todas las claves presentes, valores null (nunca undefined)', () => {
    const p = canonicoAPlano(null);
    for (const k of CLAVES_PLANO) assert.ok(k in p, `falta la clave ${k}`);
    assert.equal(p.proveedor_nif, null);
    assert.equal(p.irpf_porcentaje, '0,0');
  });

  test('factura de una línea → campos directos', () => {
    const p = canonicoAPlano({
      emisor: { nombre: 'ACME SL', nif: 'B72327000' },
      receptor: { nombre: 'Cliente', nif: 'B87654321' },
      numero_factura: 'F-1', fecha_emision: '13/08/2026',
      lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }],
      retencion_irpf: '0,00', total: '121,00', moneda: 'EUR',
    });
    assert.equal(p.proveedor_nif, 'B72327000');
    assert.equal(p.base_imponible, '100,00');
    assert.equal(p.iva_porcentaje, '21,0');
    assert.equal(p.cuota_iva, '21,00');
    assert.equal(p.total, '121,00');
    assert.equal(p.lineas_iva.length, 1);
    assert.equal(p.lineas_iva[0].porcentaje, '21,0'); // clave `porcentaje`, no `tipo`
    for (const k of CLAVES_PLANO) assert.ok(k in p);
  });

  test('varios tramos → base y cuota agregadas, tipo null', () => {
    const p = canonicoAPlano({
      emisor: { nombre: 'X', nif: null }, receptor: { nombre: null, nif: null },
      numero_factura: null, fecha_emision: null,
      lineas_iva: [
        { base: '100,00', tipo: '21,0', cuota: '21,00' },
        { base: '50,00', tipo: '10,0', cuota: '5,00' },
      ],
      retencion_irpf: null, total: '176,00', moneda: 'EUR',
    });
    assert.equal(p.base_imponible, '150,00'); // 100 + 50
    assert.equal(p.cuota_iva, '26,00');       // 21 + 5
    assert.equal(p.iva_porcentaje, null);     // no hay tipo único
    assert.equal(p.lineas_iva.length, 2);
  });

  test('sin líneas → base/cuota null, lineas_iva null', () => {
    const p = canonicoAPlano({
      emisor: { nombre: null, nif: null }, receptor: { nombre: null, nif: null },
      numero_factura: 'A', fecha_emision: null, lineas_iva: [],
      retencion_irpf: null, total: null, moneda: 'EUR',
    });
    assert.equal(p.base_imponible, null);
    assert.equal(p.cuota_iva, null);
    assert.equal(p.lineas_iva, null);
  });
});
