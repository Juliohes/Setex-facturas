// tests/unit/pipeline-confidence.test.js
// Fase 8 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: score global + estados.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { calcularScoreGlobal, decidirEstadoV2 } = require('../../src/pipeline/confidence');

describe('calcularScoreGlobal', () => {
  test('confianza alta + acuerdo total + todo resuelto → score cercano a 1', () => {
    const score = calcularScoreGlobal({ confianzaA: 0.95, confianzaB: 0.92, totalCampos: 10, disputasIniciales: 0, disputasFinales: 0 });
    assert.ok(score > 0.9, `score demasiado bajo: ${score}`);
  });

  test('muchas disputas finales sin resolver → score bajo (el peso más alto)', () => {
    const score = calcularScoreGlobal({ confianzaA: 0.9, confianzaB: 0.9, totalCampos: 10, disputasIniciales: 5, disputasFinales: 5 });
    assert.ok(score <= 0.6, `score demasiado alto con la mitad de campos en disputa: ${score}`);
  });

  test('disputas iniciales pero TODAS resueltas después → score alto (el árbitro funcionó)', () => {
    const scoreConDisputasResueltas = calcularScoreGlobal({ confianzaA: 0.9, confianzaB: 0.9, totalCampos: 10, disputasIniciales: 5, disputasFinales: 0 });
    const scoreSinDisputas = calcularScoreGlobal({ confianzaA: 0.9, confianzaB: 0.9, totalCampos: 10, disputasIniciales: 0, disputasFinales: 0 });
    assert.ok(scoreConDisputasResueltas < scoreSinDisputas, 'debe penalizar algo el haber tenido disputas, aunque se resolvieran');
    assert.ok(scoreConDisputasResueltas > 0.8, 'pero no debe penalizar mucho si al final se resolvieron todas');
  });

  test('sin confianza reportada por ningún motor → usa 0.5 neutro, no lanza', () => {
    const score = calcularScoreGlobal({ confianzaA: null, confianzaB: null, totalCampos: 10, disputasIniciales: 0, disputasFinales: 0 });
    assert.equal(typeof score, 'number');
    assert.ok(score >= 0 && score <= 1);
  });

  test('totalCampos=0 → no divide por cero, no lanza', () => {
    const score = calcularScoreGlobal({ confianzaA: 0.9, confianzaB: 0.9, totalCampos: 0, disputasIniciales: 0, disputasFinales: 0 });
    assert.ok(score >= 0 && score <= 1);
  });

  test('el score nunca sale de [0,1]', () => {
    const score = calcularScoreGlobal({ confianzaA: 1, confianzaB: 1, totalCampos: 10, disputasIniciales: 0, disputasFinales: 0 });
    assert.ok(score <= 1);
    const score2 = calcularScoreGlobal({ confianzaA: 0, confianzaB: 0, totalCampos: 10, disputasIniciales: 10, disputasFinales: 10 });
    assert.ok(score2 >= 0);
  });
});

describe('decidirEstadoV2', () => {
  const CFG = { ocr_extraccion_v2_umbral_auto: 0.9, ocr_extraccion_v2_umbral_revision: 0.6 };

  test('es_factura_valida=false → ilegible, pase lo que pase con el score', () => {
    const r = decidirEstadoV2({ scoreGlobal: 0.99, disputasFinales: 0, esFacturaValida: false }, CFG);
    assert.equal(r.estado, 'ilegible');
  });

  test('disputas finales > 0 → pendiente_revision, aunque el score sea alto', () => {
    const r = decidirEstadoV2({ scoreGlobal: 0.95, disputasFinales: 1, esFacturaValida: true }, CFG);
    assert.equal(r.estado, 'pendiente_revision');
  });

  test('sin disputas y score ≥ umbral_auto → auto_aprobada', () => {
    const r = decidirEstadoV2({ scoreGlobal: 0.92, disputasFinales: 0, esFacturaValida: true }, CFG);
    assert.equal(r.estado, 'auto_aprobada');
  });

  test('sin disputas pero score < umbral_revision → ilegible', () => {
    const r = decidirEstadoV2({ scoreGlobal: 0.4, disputasFinales: 0, esFacturaValida: true }, CFG);
    assert.equal(r.estado, 'ilegible');
  });

  test('sin disputas, score entre umbrales → pendiente_revision', () => {
    const r = decidirEstadoV2({ scoreGlobal: 0.75, disputasFinales: 0, esFacturaValida: true }, CFG);
    assert.equal(r.estado, 'pendiente_revision');
  });

  test('usa umbrales por defecto si no se pasa cfg', () => {
    const r = decidirEstadoV2({ scoreGlobal: 0.95, disputasFinales: 0, esFacturaValida: true });
    assert.equal(r.estado, 'auto_aprobada');
  });
});
