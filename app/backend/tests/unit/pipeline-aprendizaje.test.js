// tests/unit/pipeline-aprendizaje.test.js
// Gap "aprendizaje continuo" (2026-07-28): proveedor conocido (known_cifs /
// company_relationships) + ejemplos few-shot desde el dataset de verdad
// verificado. Ver cabecera de src/pipeline/aprendizaje.js para el diseño.
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buscarProveedorConocido,
  buscarEjemplosVerificados,
  construirPistaAprendizaje,
  normalizarNif,
} = require('../../src/pipeline/aprendizaje');

function poolFalso(respuestasPorSql) {
  return {
    query: async (sql) => {
      for (const [patron, filas] of respuestasPorSql) {
        if (patron.test(sql)) return { rows: filas };
      }
      return { rows: [] };
    },
  };
}

describe('normalizarNif', () => {
  test('quita espacios, guiones, puntos y pasa a mayúsculas', () => {
    assert.equal(normalizarNif(' b-723.27000 '), 'B72327000');
  });
  test('valor vacío o nulo -> string vacío', () => {
    assert.equal(normalizarNif(null), '');
    assert.equal(normalizarNif(undefined), '');
  });
});

describe('buscarProveedorConocido', () => {
  test('sin pool ni nif -> null, no lanza', async () => {
    assert.equal(await buscarProveedorConocido(null, 'B72327000'), null);
    assert.equal(await buscarProveedorConocido({ query: async () => ({ rows: [] }) }, null), null);
  });

  test('encuentra por known_cifs (ámbito usuario) si hay coincidencia', async () => {
    const pool = poolFalso([
      [/FROM known_cifs/, [{ proveedor_nombre: 'ACME DISTRIBUCIONES SL', confirmations: 5 }]],
    ]);
    const r = await buscarProveedorConocido(pool, 'B72327000', { userId: 42 });
    assert.deepEqual(r, { nombre: 'ACME DISTRIBUCIONES SL', fuente: 'known_cifs', confirmaciones: 5 });
  });

  test('sin coincidencia en known_cifs, cae a company_relationships (ámbito empresa)', async () => {
    const pool = poolFalso([
      [/FROM known_cifs/, []],
      [/FROM company_relationships/, [{ counterparty_nombre: 'HISPALAR NEW CENTURY SA', confirmations: 2 }]],
    ]);
    const r = await buscarProveedorConocido(pool, 'A87563888', { userId: 42, empresaNif: 'B56922321' });
    assert.deepEqual(r, { nombre: 'HISPALAR NEW CENTURY SA', fuente: 'company_relationships', confirmaciones: 2 });
  });

  test('sin ninguna coincidencia -> null', async () => {
    const pool = poolFalso([]);
    const r = await buscarProveedorConocido(pool, 'B99999999', { userId: 42, empresaNif: 'B56922321' });
    assert.equal(r, null);
  });

  test('fallo de BD (ej. tabla no disponible) -> null, nunca lanza (fail-safe)', async () => {
    const pool = { query: async () => { throw new Error('conexión perdida'); } };
    const r = await buscarProveedorConocido(pool, 'B72327000', { userId: 42 });
    assert.equal(r, null);
  });
});

describe('buscarEjemplosVerificados', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-facturas-test-'));
    process.env.EVAL_FACTURAS_DIR = dir;
  });
  afterEach(() => {
    delete process.env.EVAL_FACTURAS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function escribirFactura(id, groundTruth) {
    fs.mkdirSync(path.join(dir, id));
    fs.writeFileSync(path.join(dir, id, 'ground_truth.json'), JSON.stringify(groundTruth));
  }

  test('directorio no existe (dataset ausente en este entorno) -> [], no lanza', () => {
    delete require.cache[require.resolve('../../src/pipeline/aprendizaje')];
    process.env.EVAL_FACTURAS_DIR = '/no/existe/jamas/12345';
    const mod = require('../../src/pipeline/aprendizaje');
    assert.deepEqual(mod.buscarEjemplosVerificados('B72327000'), []);
  });

  test('encuentra un ejemplo verificado del mismo proveedor (por NIF)', () => {
    escribirFactura('10', {
      campos: {
        'emisor.nif': { valor: 'B72327000', estado: 'legible', verificado: true },
        'emisor.nombre': { valor: 'ACME SL', estado: 'legible', verificado: true },
        total: { valor: '121,00', estado: 'legible', verificado: false }, // no verificado -> se omite del ejemplo
      },
    });
    delete require.cache[require.resolve('../../src/pipeline/aprendizaje')];
    const mod = require('../../src/pipeline/aprendizaje');
    const r = mod.buscarEjemplosVerificados('B72327000');
    assert.equal(r.length, 1);
    assert.equal(r[0].factura_id, '10');
    assert.deepEqual(r[0].campos_verificados, { 'emisor.nif': 'B72327000', 'emisor.nombre': 'ACME SL' });
  });

  test('ignora facturas de OTRO proveedor', () => {
    escribirFactura('11', {
      campos: { 'emisor.nif': { valor: 'B99999999', estado: 'legible', verificado: true } },
    });
    delete require.cache[require.resolve('../../src/pipeline/aprendizaje')];
    const mod = require('../../src/pipeline/aprendizaje');
    assert.deepEqual(mod.buscarEjemplosVerificados('B72327000'), []);
  });

  test('ignora el NIF si NO está verificado (solo precargado por v1, aún sin revisar)', () => {
    escribirFactura('12', {
      campos: { 'emisor.nif': { valor: 'B72327000', estado: 'ambiguo', verificado: false } },
    });
    delete require.cache[require.resolve('../../src/pipeline/aprendizaje')];
    const mod = require('../../src/pipeline/aprendizaje');
    assert.deepEqual(mod.buscarEjemplosVerificados('B72327000'), []);
  });

  test('nunca supera el límite pedido', () => {
    for (const id of ['20', '21', '22']) {
      escribirFactura(id, {
        campos: {
          'emisor.nif': { valor: 'B72327000', estado: 'legible', verificado: true },
          total: { valor: '10,00', estado: 'legible', verificado: true },
        },
      });
    }
    delete require.cache[require.resolve('../../src/pipeline/aprendizaje')];
    const mod = require('../../src/pipeline/aprendizaje');
    assert.equal(mod.buscarEjemplosVerificados('B72327000', { limite: 2 }).length, 2);
  });

  test('ignora siempre la carpeta sintetica-ejemplo', () => {
    escribirFactura('sintetica-ejemplo', {
      campos: { 'emisor.nif': { valor: 'B72327000', estado: 'legible', verificado: true } },
    });
    delete require.cache[require.resolve('../../src/pipeline/aprendizaje')];
    const mod = require('../../src/pipeline/aprendizaje');
    assert.deepEqual(mod.buscarEjemplosVerificados('B72327000'), []);
  });
});

describe('construirPistaAprendizaje', () => {
  test('sin nada aprendido -> cadena vacía (no altera el prompt base)', () => {
    assert.equal(construirPistaAprendizaje({}), '');
    assert.equal(construirPistaAprendizaje(), '');
  });

  test('con proveedor conocido -> menciona el nombre exacto y las confirmaciones', () => {
    const texto = construirPistaAprendizaje({
      proveedorConocido: { nombre: 'ACME SL', fuente: 'known_cifs', confirmaciones: 5 },
    });
    assert.match(texto, /ACME SL/);
    assert.match(texto, /5/);
  });

  test('con ejemplos verificados -> los incluye como JSON', () => {
    const texto = construirPistaAprendizaje({
      ejemplosVerificados: [{ factura_id: '10', campos_verificados: { total: '121,00' } }],
    });
    assert.match(texto, /121,00/);
  });
});
