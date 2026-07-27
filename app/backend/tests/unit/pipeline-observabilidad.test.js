// tests/unit/pipeline-observabilidad.test.js
// Fase 9 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: logging estructurado + PII.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { truncarNIF, truncarNombre, truncarPII, logEtapaV2 } = require('../../src/pipeline/observabilidad');

describe('truncarNIF', () => {
  test('muestra 2 primeros + 2 últimos, oculta el resto', () => {
    assert.equal(truncarNIF('B12345678'), 'B1*****78');
  });
  test('valor null/no-string → se devuelve tal cual, no lanza', () => {
    assert.equal(truncarNIF(null), null);
    assert.equal(truncarNIF(undefined), undefined);
  });
  test('valor muy corto → todo enmascarado', () => {
    assert.equal(truncarNIF('AB'), '**');
  });
});

describe('truncarNombre', () => {
  test('nombre con varias palabras → solo la primera + …', () => {
    assert.equal(truncarNombre('ACME DISTRIBUCIONES SL'), 'ACME…');
  });
  test('nombre de una sola palabra → se queda igual, sin …', () => {
    assert.equal(truncarNombre('ACME'), 'ACME');
  });
  test('valor null → se devuelve tal cual', () => {
    assert.equal(truncarNombre(null), null);
  });
});

describe('truncarPII', () => {
  test('trunca solo los campos sensibles conocidos, deja el resto intacto', () => {
    const r = truncarPII({
      proveedor_nif: 'B12345678', proveedor_nombre: 'ACME DISTRIBUCIONES SL',
      total: '121,00', estado: 'auto_aprobada',
    });
    assert.equal(r.proveedor_nif, 'B1*****78');
    assert.equal(r.proveedor_nombre, 'ACME…');
    assert.equal(r.total, '121,00');
    assert.equal(r.estado, 'auto_aprobada');
  });
  test('objeto null/no-objeto → se devuelve tal cual, no lanza', () => {
    assert.equal(truncarPII(null), null);
  });
});

describe('logEtapaV2', () => {
  test('llama al nivel correcto del logger con document_id y PII truncada', () => {
    const llamadas = [];
    const logger = { info: (...args) => llamadas.push(args), warn: () => {}, error: () => {} };
    logEtapaV2(logger, 'info', 'arbitraje', 'doc-123', { proveedor_nif: 'B12345678', estado: 'pendiente_revision' });
    assert.equal(llamadas.length, 1);
    const [mensaje, payload] = llamadas[0];
    assert.match(mensaje, /PipelineV2:arbitraje/);
    assert.equal(payload.document_id, 'doc-123');
    assert.equal(payload.proveedor_nif, 'B1*****78');
    assert.equal(payload.estado, 'pendiente_revision');
  });

  test('logger sin el nivel pedido → no lanza (cae a info o no-op)', () => {
    assert.doesNotThrow(() => logEtapaV2({}, 'error', 'ingesta', 'doc-1', {}));
    assert.doesNotThrow(() => logEtapaV2(null, 'info', 'ingesta', 'doc-1', {}));
  });
});
