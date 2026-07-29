// tests/unit/lib-duplicate-detector.test.js
// Duplicado real no detectado 2026-07 (facturas #4/#15, Coca-Cola CIF ilegible):
// el índice único de BD compara por proveedor_nif y ese campo difirió entre las
// dos subidas porque el CIF era ilegible y cada OCR leyó algo distinto. Este
// detector agrupa por (numero_factura, fecha_emision, total) ignorando el NIF.
// Casos calibrados contra datos reales de producción (ver server.js uploads #3,#4,#5,#14,#15,#16,#24).
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarNumeroFactura,
  normalizarTotalClave,
  detectarGruposDuplicados,
  encontrarDuplicadoPorNumero,
} = require('../../src/lib/duplicate-detector');

describe('normalizarNumeroFactura', () => {
  test('trim, mayúsculas, sin espacios internos', () => {
    assert.equal(normalizarNumeroFactura('  01f / 8.086 '), '01F/8.086');
  });
  test('nulo o vacío -> null', () => {
    assert.equal(normalizarNumeroFactura(null), null);
    assert.equal(normalizarNumeroFactura(''), null);
  });
});

describe('normalizarTotalClave', () => {
  test('formato español con coma y formato con punto son equivalentes', () => {
    assert.equal(normalizarTotalClave('44,08'), normalizarTotalClave('44.08'));
    assert.equal(normalizarTotalClave('165,74'), normalizarTotalClave('165.74'));
  });
  test('valor no numérico -> null', () => {
    assert.equal(normalizarTotalClave('n/a'), null);
  });
});

describe('detectarGruposDuplicados — casos reales de producción', () => {
  test('facturas #3 y #14: mismo numero_factura/fecha/total, NIF idéntico -> duplicado detectado', () => {
    const facturas = [
      { id: 3, user_id: 36, proveedor_nif: 'B06695381', fecha_emision: '08/06/2026', total_factura: '165,74', numero_factura: '01F/6.809' },
      { id: 14, user_id: 36, proveedor_nif: 'B06695381', fecha_emision: '08/06/2026', total_factura: '165.74', numero_factura: '01F/6.809' },
    ];
    const grupos = detectarGruposDuplicados(facturas);
    assert.deepEqual(grupos.get(3), [14]);
    assert.deepEqual(grupos.get(14), [3]);
  });

  test('facturas #4 y #15: mismo numero_factura/fecha/total pero NIF DISTINTO (CIF ilegible) -> duplicado detectado igualmente', () => {
    const facturas = [
      { id: 4, user_id: 36, proveedor_nif: 'A28017895', fecha_emision: '03/06/2026', total_factura: '44.08', numero_factura: '4533514949' },
      { id: 15, user_id: 36, proveedor_nif: 'A08001851', fecha_emision: '03/06/2026', total_factura: '44.08', numero_factura: '4533514949' },
    ];
    const grupos = detectarGruposDuplicados(facturas);
    assert.deepEqual(grupos.get(4), [15]);
    assert.deepEqual(grupos.get(15), [4]);
  });

  test('factura #5: mismo proveedor que #4/#15 pero numero_factura y total distintos -> NO se marca como duplicado', () => {
    const facturas = [
      { id: 4, user_id: 36, proveedor_nif: 'A28017895', fecha_emision: '03/06/2026', total_factura: '44.08', numero_factura: '4533514949' },
      { id: 15, user_id: 36, proveedor_nif: 'A08001851', fecha_emision: '03/06/2026', total_factura: '44.08', numero_factura: '4533514949' },
      { id: 5, user_id: 36, proveedor_nif: 'A28017895', fecha_emision: '27/05/2026', total_factura: '163,99', numero_factura: '4533274561' },
    ];
    const grupos = detectarGruposDuplicados(facturas);
    assert.equal(grupos.has(5), false);
  });

  test('facturas #16 y #24: mismo total y proveedor pero fecha y numero_factura distintos -> NO son duplicados', () => {
    const facturas = [
      { id: 16, user_id: 36, proveedor_nif: 'B06755862', fecha_emision: '30/06/2026', total_factura: '290.20', numero_factura: '26#3854' },
      { id: 24, user_id: 36, proveedor_nif: 'B06755862', fecha_emision: '08/07/2026', total_factura: '290.20', numero_factura: '26#1754' },
    ];
    const grupos = detectarGruposDuplicados(facturas);
    assert.equal(grupos.size, 0);
  });

  test('usuarios distintos con mismos datos no se agrupan entre sí', () => {
    const facturas = [
      { id: 100, user_id: 1, fecha_emision: '01/01/2026', total_factura: '10,00', numero_factura: 'A1' },
      { id: 200, user_id: 2, fecha_emision: '01/01/2026', total_factura: '10,00', numero_factura: 'A1' },
    ];
    const grupos = detectarGruposDuplicados(facturas);
    assert.equal(grupos.size, 0);
  });

  test('sin numero_factura no se arriesga a falso positivo', () => {
    const facturas = [
      { id: 1, user_id: 1, fecha_emision: '01/01/2026', total_factura: '10,00', numero_factura: null },
      { id: 2, user_id: 1, fecha_emision: '01/01/2026', total_factura: '10,00', numero_factura: null },
    ];
    const grupos = detectarGruposDuplicados(facturas);
    assert.equal(grupos.size, 0);
  });

  test('grupo de 3+ facturas idénticas se agrupan todas entre sí', () => {
    const base = { user_id: 1, fecha_emision: '01/01/2026', total_factura: '10,00', numero_factura: 'X' };
    const facturas = [{ id: 1, ...base }, { id: 2, ...base }, { id: 3, ...base }];
    const grupos = detectarGruposDuplicados(facturas);
    assert.deepEqual(grupos.get(1).sort(), [2, 3]);
    assert.deepEqual(grupos.get(2).sort(), [1, 3]);
    assert.deepEqual(grupos.get(3).sort(), [1, 2]);
  });
});

describe('encontrarDuplicadoPorNumero', () => {
  test('detecta coincidencia contra una fila existente aunque el NIF difiera', () => {
    const candidata = { proveedor_nif: 'A08001851', fecha_emision: '03/06/2026', total_factura: '44,08', numero_factura: '4533514949' };
    const existentes = [
      { id: 4, proveedor_nif: 'A28017895', fecha_emision: '03/06/2026', total_factura: '44.08', numero_factura: '4533514949' },
    ];
    const encontrada = encontrarDuplicadoPorNumero(candidata, existentes);
    assert.equal(encontrada.id, 4);
  });

  test('no encuentra nada si numero_factura difiere', () => {
    const candidata = { proveedor_nif: 'A28017895', fecha_emision: '03/06/2026', total_factura: '44,08', numero_factura: '9999999999' };
    const existentes = [
      { id: 4, proveedor_nif: 'A28017895', fecha_emision: '03/06/2026', total_factura: '44.08', numero_factura: '4533514949' },
    ];
    assert.equal(encontrarDuplicadoPorNumero(candidata, existentes), null);
  });
});
