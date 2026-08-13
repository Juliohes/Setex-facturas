// tests/unit/pipeline-fusion-multipagina.test.js
// Fusión de factura multipágina (2026-08-13). Verifica el patrón recomendado
// (cabecera en 1ª hoja + importes en última), la unión de líneas de IVA, la
// elección del total real y la lista de campos faltantes para la foto extra.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { fusionarPaginas, CAMPOS_CRITICOS } = require('../../src/pipeline/fusion-multipagina');

const CIF_VALIDO = 'B72327000';   // dígito de control correcto
const CIF_INVALIDO = 'B72327008'; // mismo número, dígito roto

// Página canónica con solo los campos que interesan; el resto null.
function pagina(nº, campos) {
  return {
    pagina: nº,
    ok: true,
    campos: {
      emisor: { nombre: null, nif: null },
      receptor: { nombre: null, nif: null },
      numero_factura: null,
      fecha_emision: null,
      lineas_iva: [],
      retencion_irpf: null,
      total: null,
      moneda: 'EUR',
      es_factura_valida: true,
      ...campos,
    },
  };
}

describe('fusionarPaginas — patrón recomendado (cabecera + importes)', () => {
  test('1ª hoja fiscal + última hoja de importes → factura completa', () => {
    const p1 = pagina(1, {
      emisor: { nombre: 'ACME SL', nif: CIF_VALIDO },
      receptor: { nombre: 'Cliente SL', nif: 'B87654321' },
      numero_factura: 'F-2026/001',
      fecha_emision: '13/08/2026',
    });
    const p2 = pagina(2, {
      lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }],
      total: '121,00',
    });
    const r = fusionarPaginas([p1, p2]);
    assert.equal(r.campos.numero_factura, 'F-2026/001');
    assert.equal(r.campos.emisor.nif, CIF_VALIDO);
    assert.equal(r.campos.total, '121,00');
    assert.equal(r.campos.lineas_iva.length, 1);
    assert.equal(r.camposFaltantes.length, 0, 'no debe faltar ningún crítico');
    // Procedencia: cabecera de pág 1, total de pág 2.
    assert.equal(r.procedencia.numero_factura, 1);
    assert.equal(r.procedencia.total, 2);
  });

  test('orden de entrada desordenado → se respeta el nº de página', () => {
    const p2 = pagina(2, { total: '121,00', lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }] });
    const p1 = pagina(1, { numero_factura: 'A1', emisor: { nombre: 'X', nif: CIF_VALIDO } });
    const r = fusionarPaginas([p2, p1]); // llegan al revés
    assert.equal(r.campos.numero_factura, 'A1');
    assert.equal(r.procedencia.numero_factura, 1);
  });
});

describe('fusionarPaginas — líneas de IVA repartidas', () => {
  test('líneas de páginas distintas se unen sin duplicar', () => {
    const p1 = pagina(1, { numero_factura: 'A1', emisor: { nombre: 'X', nif: CIF_VALIDO }, fecha_emision: '01/01/2026', lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }] });
    const p2 = pagina(2, { lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }, { base: '50,00', tipo: '10,0', cuota: '5,00' }], total: '176,00' });
    const r = fusionarPaginas([p1, p2]);
    // La línea 21% aparece en ambas → una sola vez; la 10% se añade.
    assert.equal(r.campos.lineas_iva.length, 2);
  });
});

describe('fusionarPaginas — elección del total', () => {
  test('entre subtotal de página y total final, gana el coherente (mayor y que cuadra)', () => {
    // p1 muestra un subtotal 100,00; p2 el total real 121,00 con IVA.
    const p1 = pagina(1, { numero_factura: 'A1', emisor: { nombre: 'X', nif: CIF_VALIDO }, fecha_emision: '01/01/2026', total: '100,00' });
    const p2 = pagina(2, { lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }], total: '121,00' });
    const r = fusionarPaginas([p1, p2]);
    assert.equal(r.campos.total, '121,00');
    assert.equal(r.procedencia.total, 2);
  });
});

describe('fusionarPaginas — campos faltantes (foto extra)', () => {
  test('sin página de importes → falta el total, zona "importes"', () => {
    const p1 = pagina(1, { numero_factura: 'A1', emisor: { nombre: 'X', nif: CIF_VALIDO }, fecha_emision: '01/01/2026' });
    const r = fusionarPaginas([p1]);
    const faltaTotal = r.camposFaltantes.find((c) => c.clave === 'total');
    assert.ok(faltaTotal, 'debe reportar total como faltante');
    assert.equal(faltaTotal.zona, 'importes');
  });

  test('sin página fiscal → faltan número, fecha y NIF emisor, zona "fiscal"', () => {
    const p1 = pagina(1, { lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }], total: '121,00' });
    const r = fusionarPaginas([p1]);
    const claves = r.camposFaltantes.map((c) => c.clave).sort();
    assert.deepEqual(claves, ['emisor.nif', 'fecha_emision', 'numero_factura']);
    assert.ok(r.camposFaltantes.every((c) => c.zona === 'fiscal'));
  });
});

describe('fusionarPaginas — robustez', () => {
  test('todas las páginas inválidas → sin campos, todos los críticos faltantes', () => {
    const r = fusionarPaginas([{ pagina: 1, ok: false, campos: null }, null]);
    assert.equal(r.campos, null);
    assert.equal(r.paginasValidas, 0);
    assert.equal(r.camposFaltantes.length, CAMPOS_CRITICOS.length);
  });

  test('NIF sin checksum válido → se usa pero avisa', () => {
    const p1 = pagina(1, { numero_factura: 'A1', emisor: { nombre: 'X', nif: CIF_INVALIDO }, fecha_emision: '01/01/2026', total: '121,00', lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }] });
    const r = fusionarPaginas([p1]);
    assert.equal(r.campos.emisor.nif, CIF_INVALIDO);
    assert.ok(r.avisos.some((a) => a.includes('dígito de control')));
  });

  test('NIF válido en una página gana al inválido de otra', () => {
    const p1 = pagina(1, { numero_factura: 'A1', emisor: { nombre: 'X', nif: CIF_INVALIDO }, fecha_emision: '01/01/2026' });
    const p2 = pagina(2, { emisor: { nombre: 'X', nif: CIF_VALIDO }, total: '121,00', lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }] });
    const r = fusionarPaginas([p1, p2]);
    assert.equal(r.campos.emisor.nif, CIF_VALIDO);
    assert.equal(r.procedencia['emisor.nif'], 2);
  });
});
