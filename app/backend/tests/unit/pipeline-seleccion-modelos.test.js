// tests/unit/pipeline-seleccion-modelos.test.js
// Selección configurable de motores del pipeline v2 (2026-07-29).
// Verifica el contrato de seguridad: sin flag → comportamiento de hoy;
// entradas inválidas → fail-safe con aviso; config de Julio → multi.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolverConfigModelos,
  esSeleccionPersonalizada,
  DEFAULT_BASE,
  DEFAULT_ARBITRO,
  CONFIG_RECOMENDADA,
  MAX_BASE,
} = require('../../src/pipeline/seleccion-modelos');

describe('resolverConfigModelos — default seguro (sin flags)', () => {
  test('cfg vacío → default azure+gemini, sin árbitro, no personalizada', () => {
    const s = resolverConfigModelos({});
    assert.deepEqual(s.base, DEFAULT_BASE);
    assert.equal(s.arbitro, DEFAULT_ARBITRO);
    assert.equal(s.arbitro, null);
    assert.equal(s.personalizada, false);
    assert.equal(esSeleccionPersonalizada(s), false);
  });

  test('cfg undefined → no lanza, devuelve default', () => {
    const s = resolverConfigModelos();
    assert.deepEqual(s.base, DEFAULT_BASE);
    assert.equal(esSeleccionPersonalizada(s), false);
  });
});

describe('resolverConfigModelos — config recomendada de Julio', () => {
  test('gemini_flash+mistral base, openai árbitro → multi', () => {
    const s = resolverConfigModelos(CONFIG_RECOMENDADA);
    assert.deepEqual(s.base, ['gemini_flash', 'mistral']);
    assert.equal(s.arbitro, 'openai');
    assert.equal(esSeleccionPersonalizada(s), true);
    assert.deepEqual(s.avisos, []);
  });

  test('4 motores base + árbitro → aceptados', () => {
    const s = resolverConfigModelos({
      ocr_extraccion_v2_modelos_base: ['gemini_flash', 'mistral', 'openai', 'gemini_pro'],
      ocr_extraccion_v2_modelo_arbitro: 'openai',
    });
    assert.equal(s.base.length, 4);
    assert.equal(esSeleccionPersonalizada(s), true);
  });
});

describe('resolverConfigModelos — fail-safe ante entradas inválidas', () => {
  test('motor desconocido se ignora con aviso', () => {
    const s = resolverConfigModelos({ ocr_extraccion_v2_modelos_base: ['gemini_flash', 'paddle', 'mistral'] });
    assert.deepEqual(s.base, ['gemini_flash', 'mistral']);
    assert.ok(s.avisos.some((a) => a.includes('paddle')));
  });

  test('duplicados se colapsan preservando orden', () => {
    const s = resolverConfigModelos({ ocr_extraccion_v2_modelos_base: ['mistral', 'mistral', 'gemini_flash'] });
    assert.deepEqual(s.base, ['mistral', 'gemini_flash']);
  });

  test('todos inválidos → cae al default seguro con aviso', () => {
    const s = resolverConfigModelos({ ocr_extraccion_v2_modelos_base: ['foo', 'bar'] });
    assert.deepEqual(s.base, DEFAULT_BASE);
    assert.ok(s.avisos.some((a) => a.includes('default')));
  });

  test('más de MAX_BASE motores → recorta a los primeros', () => {
    const s = resolverConfigModelos({ ocr_extraccion_v2_modelos_base: ['gemini_flash', 'mistral', 'openai', 'gemini_pro', 'azure'] });
    assert.equal(s.base.length, MAX_BASE);
    assert.ok(s.avisos.some((a) => a.includes('recortado')));
  });

  test('un solo motor base válido → se permite pero avisa', () => {
    const s = resolverConfigModelos({ ocr_extraccion_v2_modelos_base: ['gemini_flash'] });
    assert.deepEqual(s.base, ['gemini_flash']);
    assert.ok(s.avisos.some((a) => a.includes('1 motor')));
  });

  test('árbitro desconocido → se ignora, sin árbitro', () => {
    const s = resolverConfigModelos({
      ocr_extraccion_v2_modelos_base: ['gemini_flash', 'mistral'],
      ocr_extraccion_v2_modelo_arbitro: 'inexistente',
    });
    assert.equal(s.arbitro, null);
    assert.ok(s.avisos.some((a) => a.includes('inexistente')));
  });

  test('árbitro "ninguno"/""/null → sin árbitro, sin aviso de error', () => {
    for (const v of ['ninguno', '', null, 'none', 'off']) {
      const s = resolverConfigModelos({
        ocr_extraccion_v2_modelos_base: ['gemini_flash', 'mistral'],
        ocr_extraccion_v2_modelo_arbitro: v,
      });
      assert.equal(s.arbitro, null, `valor ${JSON.stringify(v)} debe dar sin árbitro`);
    }
  });
});

describe('esSeleccionPersonalizada', () => {
  test('solo cambiar el árbitro (misma base default) ya es personalizada', () => {
    const s = resolverConfigModelos({ ocr_extraccion_v2_modelo_arbitro: 'openai' });
    assert.equal(esSeleccionPersonalizada(s), true);
  });
  test('base igual al default y sin árbitro → NO personalizada (ruta legacy)', () => {
    const s = resolverConfigModelos({ ocr_extraccion_v2_modelos_base: ['azure', 'gemini_flash'] });
    assert.equal(esSeleccionPersonalizada(s), false);
  });
});
