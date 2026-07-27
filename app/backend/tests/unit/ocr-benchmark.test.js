// Tests del módulo de benchmarking multi-imagen × multi-motor (2026-07-23).
// La parte de red (llamar a los motores reales) no se testea aquí — se
// prueba end-to-end manualmente, igual que el resto del fan-out.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  puntuarContraConfirmado,
  normalizarParaComparar,
  VARIANTES,
  MOTORES,
  CAMPOS_PUNTUABLES,
} = require('../../src/ocr/benchmark');

describe('puntuarContraConfirmado', () => {
  const confirmado = {
    proveedor_nif: 'B72327000',
    proveedor_nombre: 'ACME SL',
    total: '121,00',
    iva_porcentaje: '21',
  };

  test('todos los campos comparables coinciden → aciertos = comparables', () => {
    const campos = { proveedor_nif: 'b72327000', proveedor_nombre: 'ACME SL', total: '121.00', iva_porcentaje: '21' };
    const r = puntuarContraConfirmado(campos, confirmado);
    assert.equal(r.comparables, 4);
    assert.equal(r.aciertos, 4);
  });

  test('un campo distinto no puntúa', () => {
    const campos = { proveedor_nif: 'B72327008', proveedor_nombre: 'ACME SL', total: '121,00', iva_porcentaje: '21' };
    const r = puntuarContraConfirmado(campos, confirmado);
    assert.equal(r.aciertos, 3);
    assert.equal(r.comparables, 4);
  });

  test('campo confirmado ausente no cuenta como comparable', () => {
    const r = puntuarContraConfirmado({ proveedor_nif: 'B72327000' }, { proveedor_nif: 'B72327000' });
    assert.equal(r.comparables, 1);
    assert.equal(r.aciertos, 1);
  });

  test('acepta "total" extraído bajo la clave total_factura', () => {
    const r = puntuarContraConfirmado({ total_factura: '121,00' }, { total: '121,00' });
    assert.equal(r.aciertos, 1);
  });

  test('sin ningún campo comparable → 0/0, no divide por cero ni lanza', () => {
    const r = puntuarContraConfirmado({}, {});
    assert.equal(r.comparables, 0);
    assert.equal(r.aciertos, 0);
  });

  test('detalle por campo: acierto/fallo booleano solo de los comparables', () => {
    const campos = { proveedor_nif: 'B72327008', proveedor_nombre: 'ACME SL', total: '121,00', iva_porcentaje: '21' };
    const r = puntuarContraConfirmado(campos, confirmado);
    assert.deepEqual(r.detalle, {
      proveedor_nif: false,
      proveedor_nombre: true,
      total: true,
      iva_porcentaje: true,
    });
  });
});

describe('normalizarParaComparar', () => {
  test('ignora mayúsculas/minúsculas y espacios', () => {
    assert.equal(normalizarParaComparar(' b72327000 '), normalizarParaComparar('B72327000'));
  });
  test('unifica separador decimal coma/punto', () => {
    assert.equal(normalizarParaComparar('121,00'), normalizarParaComparar('121.00'));
  });
});

describe('constantes del benchmark', () => {
  test('3 variantes de imagen definidas', () => {
    assert.deepEqual(VARIANTES, ['actual', 'original', 'contraste']);
  });
  test('5 motores definidos', () => {
    assert.equal(MOTORES.length, 5);
    for (const m of ['openai', 'azure', 'gemini_flash', 'gemini_pro', 'mistral']) {
      assert.ok(MOTORES.includes(m), `falta ${m}`);
    }
  });
  test('campos puntuables incluyen los fiscales críticos', () => {
    for (const c of ['proveedor_nif', 'total', 'iva_porcentaje']) {
      assert.ok(CAMPOS_PUNTUABLES.includes(c));
    }
  });
});
