// Tests de domain/routing.js — decisión determinista de 3 bandas
// (auto-aceptar / revisión humana / recaptura), Fase A del pipeline v2.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { DECISION, decidirRouting, validarFechaPlausible, parseFechaFactura } = require('../../src/domain/routing');

// NIF/CIF válidos y NO presentes en la lista negra de ocr/validateCIF.js
// (evita falsos "formato_identificador" por blacklist en los casos felices)
function facturaCorrecta(overrides = {}) {
  return {
    proveedor_nif: 'B72327000',
    proveedor_nombre: 'ACME SL',
    receptor_nif: '32654987R',
    receptor_nombre: 'Cliente SL',
    numero_factura: 'F-2026-001',
    fecha_emision: '15/06/2026',
    base_imponible: '100,00',
    iva_porcentaje: '21',
    cuota_iva: '21,00',
    total: '121,00',
    es_factura_valida: true,
    ...overrides,
  };
}

const AHORA_FIJA = new Date('2026-07-21T00:00:00Z');

describe('decidirRouting — banda RECAPTURA', () => {
  test('documento no procesable → recaptura con el motivo del extractor', () => {
    const r = decidirRouting({ es_factura_valida: false, motivo_no_procesable: 'Es un ticket, no una factura' });
    assert.equal(r.decision, DECISION.RECAPTURA);
    assert.equal(r.motivo, 'Es un ticket, no una factura');
  });

  test('campos null/vacío → recaptura con motivo genérico', () => {
    const r = decidirRouting(null);
    assert.equal(r.decision, DECISION.RECAPTURA);
  });
});

describe('decidirRouting — banda AUTO_ACEPTADA', () => {
  test('factura correcta sin incidencias → auto-aceptada', () => {
    const r = decidirRouting(facturaCorrecta());
    assert.equal(r.decision, DECISION.AUTO_ACEPTADA);
    assert.deepEqual(r.incidencias.filter((i) => i.severidad === 'error'), []);
  });

  test('un aviso (no error) no bloquea la auto-aceptación', () => {
    // Fecha con más de 6 años de antigüedad → aviso, no error
    const r = decidirRouting(facturaCorrecta({ fecha_emision: '01/01/2015' }));
    assert.equal(r.decision, DECISION.AUTO_ACEPTADA);
    assert.ok(r.incidencias.some((i) => i.regla === 'fecha_plausible' && i.severidad === 'aviso'));
  });
});

describe('decidirRouting — banda REVISION_HUMANA', () => {
  test('cuadre aritmético que no cuadra → revisión, con sugerencia adjunta', () => {
    const r = decidirRouting(facturaCorrecta({ cuota_iva: '27,00' }));
    assert.equal(r.decision, DECISION.REVISION_HUMANA);
    assert.ok(r.motivo.includes('iva_totales'));
    assert.equal(r.sugerencias.cuota_iva, '21,00');
  });

  test('NIF de proveedor con checksum inválido → revisión, campo señalado', () => {
    // B72327008: mismo cuerpo que el CIF válido de referencia, control alterado
    const r = decidirRouting(facturaCorrecta({ proveedor_nif: 'B72327008' }));
    assert.equal(r.decision, DECISION.REVISION_HUMANA);
    assert.ok(r.incidencias.some((i) => i.regla === 'checksum_identificador' && i.campo === 'proveedor_nif'));
  });

  test('campo obligatorio ausente (numero_factura) → revisión', () => {
    const r = decidirRouting(facturaCorrecta({ numero_factura: null }));
    assert.equal(r.decision, DECISION.REVISION_HUMANA);
    assert.ok(r.motivo.includes('numero_factura'));
  });

  test('fecha futura → error, no solo aviso → revisión', () => {
    const r = decidirRouting(facturaCorrecta({ fecha_emision: '01/01/2099' }));
    assert.equal(r.decision, DECISION.REVISION_HUMANA);
    assert.ok(r.incidencias.some((i) => i.regla === 'fecha_plausible' && i.severidad === 'error'));
  });

  test('confianza OCR baja en campo crítico fuerza revisión pese a validación correcta', () => {
    const r = decidirRouting(facturaCorrecta(), { confianzaCampos: { total: 0.5 } });
    assert.equal(r.decision, DECISION.REVISION_HUMANA);
    assert.ok(r.motivo.includes('Confianza OCR baja'));
  });
});

describe('validarFechaPlausible / parseFechaFactura', () => {
  test('parsea DD/MM/YYYY e ISO 8601', () => {
    assert.ok(parseFechaFactura('15/06/2026') instanceof Date);
    assert.ok(parseFechaFactura('2026-06-15') instanceof Date);
    assert.equal(parseFechaFactura('formato-raro'), null);
  });

  test('fecha no parseable genera aviso, no error', () => {
    const incidencias = validarFechaPlausible({ fecha_emision: '32/13/2026' }, AHORA_FIJA);
    assert.equal(incidencias.length, 1);
    assert.equal(incidencias[0].severidad, 'aviso');
  });

  test('fecha ausente no genera incidencia (la cubre campos_obligatorios)', () => {
    assert.deepEqual(validarFechaPlausible({}, AHORA_FIJA), []);
  });
});
