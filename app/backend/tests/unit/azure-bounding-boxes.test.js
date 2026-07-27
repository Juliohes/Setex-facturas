// tests/unit/azure-bounding-boxes.test.js
// Fase 7 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: captura de bounding boxes
// de Azure (aditivo, azure.js:extraerBoundingBox/extraerPaginasInfo).
// Fixtures = shape real de la respuesta de Azure Document Intelligence
// (boundingRegions), sin red.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extraerBoundingBox, extraerPaginasInfo } = require('../../src/ocr/azure');

describe('extraerBoundingBox', () => {
  test('campo con boundingRegions → { pagina, poligono }', () => {
    const field = {
      valueString: '121,00',
      boundingRegions: [{ pageNumber: 1, polygon: [1.2, 3.4, 2.1, 3.4, 2.1, 3.6, 1.2, 3.6] }],
    };
    const r = extraerBoundingBox(field);
    assert.deepEqual(r, { pagina: 1, poligono: [1.2, 3.4, 2.1, 3.4, 2.1, 3.6, 1.2, 3.6] });
  });

  test('campo sin boundingRegions → null, no lanza', () => {
    assert.equal(extraerBoundingBox({ valueString: 'x' }), null);
  });

  test('campo null/undefined → null, no lanza', () => {
    assert.equal(extraerBoundingBox(null), null);
    assert.equal(extraerBoundingBox(undefined), null);
  });

  test('boundingRegions presente pero sin polygon → null', () => {
    assert.equal(extraerBoundingBox({ boundingRegions: [{ pageNumber: 1 }] }), null);
  });
});

describe('extraerPaginasInfo', () => {
  test('extrae ancho/alto/unidad de cada página', () => {
    const analyzeResult = { pages: [{ pageNumber: 1, width: 2048, height: 1536, unit: 'pixel' }] };
    const r = extraerPaginasInfo(analyzeResult);
    assert.deepEqual(r, [{ pagina: 1, ancho: 2048, alto: 1536, unidad: 'pixel' }]);
  });

  test('sin pages → array vacío, no lanza', () => {
    assert.deepEqual(extraerPaginasInfo({}), []);
    assert.deepEqual(extraerPaginasInfo(null), []);
  });
});
