// Tests del bloque 5 (2026-07-22): resolución de motor de referencia y
// normalización de la comparación original vs variante de contraste.
// La parte de red (generar la variante y llamar al motor real) no se testea
// aquí — se prueba end-to-end manualmente, igual que el resto del fan-out.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolverMotorPrincipal, normalizarParaComparar, CAMPOS_COMPARABLES } = require('../../src/ocr/index');

describe('resolverMotorPrincipal — mismo motor primario que el modo activo', () => {
  test('modo gemini_azure → gemini_flash', () => {
    const r = resolverMotorPrincipal({ ocr_mode: 'gemini_azure' }, '/tmp/x.jpg', 'image/jpeg', {});
    assert.equal(r.name, 'gemini_flash');
    assert.equal(typeof r.run, 'function');
  });

  test('modo dual/triple/multi (legacy) → openai', () => {
    for (const mode of ['dual', 'triple', 'multi']) {
      const r = resolverMotorPrincipal({ ocr_mode: mode }, '/tmp/x.jpg', 'image/jpeg', {});
      assert.equal(r.name, 'openai', `modo ${mode}`);
    }
  });

  test('motor único explícito (azure) → azure', () => {
    const r = resolverMotorPrincipal({ ocr_mode: 'azure' }, '/tmp/x.jpg', 'image/jpeg', {});
    assert.equal(r.name, 'azure');
  });

  test('motor único extra (mistral) → mistral', () => {
    const r = resolverMotorPrincipal({ ocr_mode: 'mistral' }, '/tmp/x.jpg', 'image/jpeg', {});
    assert.equal(r.name, 'mistral');
  });

  test('modo desconocido → fallback openai (mismo criterio que el resto del pipeline)', () => {
    const r = resolverMotorPrincipal({ ocr_mode: 'no-existe' }, '/tmp/x.jpg', 'image/jpeg', {});
    assert.equal(r.name, 'openai');
  });
});

describe('normalizarParaComparar', () => {
  test('ignora mayúsculas/minúsculas y espacios', () => {
    assert.equal(normalizarParaComparar('  b72327000 '), normalizarParaComparar('B72327000'));
  });

  test('unifica separador decimal coma/punto', () => {
    assert.equal(normalizarParaComparar('121,00'), normalizarParaComparar('121.00'));
  });

  test('null se mantiene null', () => {
    assert.equal(normalizarParaComparar(null), null);
  });
});

describe('CAMPOS_COMPARABLES', () => {
  test('incluye los campos fiscales críticos', () => {
    for (const c of ['proveedor_nif', 'total', 'iva_porcentaje', 'fecha_emision']) {
      assert.ok(CAMPOS_COMPARABLES.includes(c), `falta ${c}`);
    }
  });
});
