// Tests del fix multi-IVA 2026-07-03 — domain/validators/iva.js
//
// Bugs cubiertos (diagnóstico 2026-07-03):
//   1. mergeLineasIva cruzaba tramos por string literal: "21" (OpenAI) ≠ "21,0"
//      (Azure) duplicaba el mismo tramo y doblaba bases/cuotas.
//   2. Azure DI prebuilt-invoice NO devuelve BaseAmount por tramo (schema
//      2024-11-30-ga: TaxDetails solo trae Amount y Rate) → la base de cada
//      tramo llegaba siempre null. fillDerivedBases la deriva por aritmética.
//   3. El tramo exento (0%) se descartaba y degradaba multi→mono.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeLineasIva,
  fillDerivedBases,
  parseRateEntero,
  normalizeConfirmedLineasIva,
} = require('../../src/domain/validators/iva');

// ── parseRateEntero ────────────────────────────────────────────────────────────

test('parseRateEntero: normaliza formatos de porcentaje equivalentes', () => {
  assert.equal(parseRateEntero('21'), 21);
  assert.equal(parseRateEntero('21,0'), 21);
  assert.equal(parseRateEntero('21.0'), 21);
  assert.equal(parseRateEntero('21%'), 21);
  assert.equal(parseRateEntero(0.21), 21);
  assert.equal(parseRateEntero('0'), 0);      // exento
  assert.equal(parseRateEntero(null), null);
  assert.equal(parseRateEntero('abc'), null);
});

// ── mergeLineasIva: cruce numérico de tramos ───────────────────────────────────

test('mergeLineasIva: "21" (OpenAI) y "21,0" (Azure) son el MISMO tramo — no duplica', () => {
  const openaiLineas = [
    { base: '100,00', porcentaje: '21',   cuota: '21,00', productos: [] },
    { base: '50,00',  porcentaje: '10',   cuota: '5,00',  productos: [] },
  ];
  const azureLineas = [
    { base: null, porcentaje: '21,0', cuota: '21,00', productos: [] },
    { base: null, porcentaje: '10,0', cuota: '5,00',  productos: [] },
  ];
  const merged = mergeLineasIva(openaiLineas, azureLineas);
  assert.equal(merged.length, 2, `esperados 2 tramos, hay ${merged.length}: ${JSON.stringify(merged)}`);
  // Azure prioritario en cuota, OpenAI rellena base que Azure no tiene
  const t21 = merged.find(l => parseRateEntero(l.porcentaje) === 21);
  assert.equal(t21.base, '100,00');
  assert.equal(t21.cuota, '21,00');
});

test('mergeLineasIva: tramos distintos se preservan (10 vs 21)', () => {
  const merged = mergeLineasIva(
    [{ base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [] }],
    [{ base: '200,00', porcentaje: '10,0', cuota: '20,00', productos: [] }]
  );
  assert.equal(merged.length, 2);
});

test('mergeLineasIva: tramo exento "0" cruza con "0,0"', () => {
  const merged = mergeLineasIva(
    [{ base: '30,00', porcentaje: '0',   cuota: '0,00', productos: [] }],
    [{ base: null,    porcentaje: '0,0', cuota: '0,00', productos: [] },
     { base: null,    porcentaje: '21,0', cuota: '10,50', productos: [] }]
  );
  assert.equal(merged.length, 2);
  const t0 = merged.find(l => parseRateEntero(l.porcentaje) === 0);
  assert.equal(t0.base, '30,00'); // base de OpenAI rellena el null de Azure
});

// ── fillDerivedBases ───────────────────────────────────────────────────────────

test('fillDerivedBases: deriva base = cuota ÷ (%/100) cuando falta', () => {
  const lineas = [
    { base: null, porcentaje: '21,0', cuota: '21,00', productos: [] },
    { base: null, porcentaje: '10,0', cuota: '5,00',  productos: [] },
  ];
  fillDerivedBases(lineas);
  assert.equal(lineas[0].base, '100,00');
  assert.equal(lineas[1].base, '50,00');
});

test('fillDerivedBases: deriva cuota "0,00" en tramo exento sin cuota', () => {
  const lineas = [{ base: '30,00', porcentaje: '0,0', cuota: null, productos: [] }];
  fillDerivedBases(lineas);
  assert.equal(lineas[0].cuota, '0,00');
});

test('fillDerivedBases: deriva cuota = base × % cuando falta la cuota', () => {
  const lineas = [{ base: '200,00', porcentaje: '10,0', cuota: null, productos: [] }];
  fillDerivedBases(lineas);
  assert.equal(lineas[0].cuota, '20,00');
});

test('fillDerivedBases: no toca líneas completas ni sin % parseable', () => {
  const lineas = [
    { base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [] },
    { base: null, porcentaje: null, cuota: '5,00', productos: [] },
  ];
  fillDerivedBases(lineas);
  assert.equal(lineas[0].base, '100,00');
  assert.equal(lineas[1].base, null); // sin % no se puede derivar
});

// ── normalizeConfirmedLineasIva: reconstrucción de agregados ───────────────────

test('normalizeConfirmedLineasIva: base agregada = Σ bases de tramos', () => {
  const norm = normalizeConfirmedLineasIva([
    { base: '1.000,00', porcentaje: '21,0', cuota: '210,00', productos: [] },
    { base: '500,00',   porcentaje: '10,0', cuota: '50,00',  productos: [] },
  ]);
  assert.equal(norm.errors.length, 0);
  assert.equal(norm.base, '1500,00');
  assert.equal(norm.cuota, '260,00');
  assert.equal(norm.porcentaje, '21,0'); // tramo dominante por cuota
});

test('normalizeConfirmedLineasIva: tramo exento cuenta en la base', () => {
  const norm = normalizeConfirmedLineasIva([
    { base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [] },
    { base: '30,00',  porcentaje: '0,0',  cuota: '0,00',  productos: [] },
  ]);
  assert.equal(norm.errors.length, 0);
  assert.equal(norm.base, '130,00');
  assert.equal(norm.cuota, '21,00');
});

// ── dropResumenArtifacts (fix 2026-07-04, detectado en E2E staging) ────────────

const { dropResumenArtifacts } = require('../../src/domain/validators/iva');

test('dropResumenArtifacts: elimina la fila resumen de Azure (sin tipo, cuota = Σ cuotas)', () => {
  const lineas = [
    { base: '600,00', porcentaje: '21,0', cuota: '126,00', productos: [] },
    { base: '450,00', porcentaje: '10,0', cuota: '45,00',  productos: [] },
    { base: null,     porcentaje: null,   cuota: '171,00', productos: [] }, // "Total IVA" del pie
  ];
  const out = dropResumenArtifacts(lineas);
  assert.equal(out.length, 2);
  assert.ok(out.every(l => l.porcentaje != null));
});

test('dropResumenArtifacts: conserva líneas sin tipo que NO son resumen', () => {
  const lineas = [
    { base: '600,00', porcentaje: '21,0', cuota: '126,00', productos: [] },
    { base: '450,00', porcentaje: '10,0', cuota: '45,00',  productos: [] },
    { base: '80,00',  porcentaje: null,   cuota: '8,00',   productos: [] }, // tramo real sin tipo legible
  ];
  const out = dropResumenArtifacts(lineas);
  assert.equal(out.length, 3);
});

test('dropResumenArtifacts: no toca desgloses sin líneas sin tipo', () => {
  const lineas = [
    { base: '600,00', porcentaje: '21,0', cuota: '126,00', productos: [] },
    { base: '450,00', porcentaje: '10,0', cuota: '45,00',  productos: [] },
  ];
  assert.equal(dropResumenArtifacts(lineas).length, 2);
});
