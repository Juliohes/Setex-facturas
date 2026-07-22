// Tests del fix multi-IVA 2026-07-03 — ocr/index.js
//   · reconcileMultiIvaAggregates: agregados = Σ tramos (con guard de cordura)
//   · integrateMistralResult: relleno de huecos + votación 2-de-3 (Mistral OCR 4)
//
// Escenario real que motivó el fix: Azure SubTotal ≠ Σ bases imponibles
// (descuentos/portes) + tramos duplicados por el cruce string → base agregada
// incorrecta → la salvaguarda IRPF inventaba retenciones fantasma.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileMultiIvaAggregates, integrateMistralResult } = require('../../src/ocr/index');
const { parseAnnotation, INVOICE_ANNOTATION_SCHEMA } = require('../../src/ocr/mistral');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

// ── reconcileMultiIvaAggregates ────────────────────────────────────────────────

test('reconcile: corrige base agregada errónea (SubTotal ≠ Σ bases) usando el desglose', () => {
  const campos = {
    base_imponible: '1.400,00', // SubTotal de Azure con descuento no aplicado
    iva_porcentaje: '21,0',
    cuota_iva: '260,00',
    total: '1.760,00',
    cuota_irpf: '0,00',
    lineas_iva: [
      { base: '1.000,00', porcentaje: '21,0', cuota: '210,00', productos: [] },
      { base: '500,00',   porcentaje: '10,0', cuota: '50,00',  productos: [] },
    ],
  };
  reconcileMultiIvaAggregates(campos, silentLogger);
  assert.equal(campos.base_imponible, '1500,00');
  assert.equal(campos.cuota_iva, '260,00');
  assert.equal(campos.iva_porcentaje, '21');
});

test('reconcile: deriva bases null de tramos (Azure) antes de sumar', () => {
  const campos = {
    base_imponible: null,
    iva_porcentaje: null,
    cuota_iva: null,
    total: '1.760,00',
    cuota_irpf: '0,00',
    lineas_iva: [
      { base: null, porcentaje: '21,0', cuota: '210,00', productos: [] },
      { base: null, porcentaje: '10,0', cuota: '50,00',  productos: [] },
    ],
  };
  reconcileMultiIvaAggregates(campos, silentLogger);
  assert.equal(campos.base_imponible, '1500,00');
  assert.equal(campos.cuota_iva, '260,00');
});

test('reconcile: mono-IVA (0 o 1 tramo) no se toca', () => {
  const campos = { base_imponible: '100,00', cuota_iva: '21,00', total: '121,00', lineas_iva: null };
  reconcileMultiIvaAggregates(campos, silentLogger);
  assert.equal(campos.base_imponible, '100,00');
});

test('reconcile: guard de cordura — desglose incoherente con total NO pisa agregados', () => {
  const campos = {
    base_imponible: '1500,00',
    iva_porcentaje: '21,0',
    cuota_iva: '260,00',
    total: '1.760,00',
    cuota_irpf: '0,00',
    // Tramos absurdos (suma 10× el total) → no deben sobrescribir
    lineas_iva: [
      { base: '10.000,00', porcentaje: '21,0', cuota: '2.100,00', productos: [] },
      { base: '5.000,00',  porcentaje: '10,0', cuota: '500,00',   productos: [] },
    ],
  };
  reconcileMultiIvaAggregates(campos, silentLogger);
  assert.equal(campos.base_imponible, '1500,00', 'agregado protegido por guard');
});

test('reconcile: admite gap positivo (IRPF aún no detectado) sin bloquear', () => {
  // Base 1.000 + IVA 210 − total 1.060 = 150 (IRPF 15% implícito) → debe reconciliar
  const campos = {
    base_imponible: null,
    iva_porcentaje: null,
    cuota_iva: null,
    total: '1.060,00',
    cuota_irpf: '0,00',
    lineas_iva: [
      { base: '600,00', porcentaje: '21,0', cuota: '126,00', productos: [] },
      { base: '400,00', porcentaje: '21,0', cuota: '84,00',  productos: [] },
    ],
  };
  reconcileMultiIvaAggregates(campos, silentLogger);
  assert.equal(campos.base_imponible, '1000,00');
});

// ── integrateMistralResult ─────────────────────────────────────────────────────

test('integrateMistral: rellena huecos sin pisar valores existentes', () => {
  const merged = { base_imponible: '100,00', cuota_iva: null, total: '121,00', numero_factura: null };
  const oF = { base_imponible: '100,00', total: '121,00' };
  const aF = {};
  const mF = { base_imponible: '999,99', cuota_iva: '21,00', total: '121,00', numero_factura: 'F-2026-001' };
  integrateMistralResult(merged, oF, aF, mF, silentLogger);
  assert.equal(merged.base_imponible, '100,00'); // no pisado (sin mayoría en contra)
  assert.equal(merged.cuota_iva, '21,00');       // hueco rellenado
  assert.equal(merged.numero_factura, 'F-2026-001');
});

test('integrateMistral: votación 2-de-3 corrige el importe en minoría', () => {
  // merged eligió el total de OpenAI ("1.760,00") pero Azure y Mistral
  // coinciden en "1.560,00" → mayoría corrige.
  const merged = { base_imponible: '1500,00', cuota_iva: '260,00', total: '1.760,00' };
  const oF = { total: '1.760,00' };
  const aF = { total: '1.560,00' };
  const mF = { total: '1.560,00' };
  integrateMistralResult(merged, oF, aF, mF, silentLogger);
  assert.equal(merged.total, '1.560,00');
});

test('integrateMistral: sin respaldo de otro motor, Mistral NO gana', () => {
  const merged = { base_imponible: '1500,00', cuota_iva: '260,00', total: '1.760,00' };
  const oF = { total: '1.760,00' };
  const aF = { total: '1.760,00' };
  const mF = { total: '9.999,99' };
  integrateMistralResult(merged, oF, aF, mF, silentLogger);
  assert.equal(merged.total, '1.760,00');
});

// ── mistral.js: parseo de annotation y schema ──────────────────────────────────

test('mistral.parseAnnotation: string JSON, objeto directo y basura', () => {
  assert.deepEqual(parseAnnotation('{"total":"1,00"}'), { total: '1,00' });
  assert.deepEqual(parseAnnotation({ total: '1,00' }), { total: '1,00' });
  assert.equal(parseAnnotation('esto no es json'), null);
  assert.equal(parseAnnotation(null), null);
});

test('mistral schema: json_schema válido con los 15 campos del contrato interno', () => {
  assert.equal(INVOICE_ANNOTATION_SCHEMA.type, 'json_schema');
  const props = INVOICE_ANNOTATION_SCHEMA.json_schema.schema.properties;
  const esperados = [
    'numero_factura', 'fecha_emision', 'proveedor_nombre', 'proveedor_nif',
    'receptor_nombre', 'receptor_nif', 'base_imponible', 'iva_porcentaje',
    'cuota_iva', 'lineas_iva', 'irpf_porcentaje', 'cuota_irpf', 'total',
    'moneda', 'es_factura_valida',
  ];
  for (const k of esperados) assert.ok(props[k], `falta campo ${k} en el schema`);
  assert.deepEqual(INVOICE_ANNOTATION_SCHEMA.json_schema.schema.required, esperados);
});
