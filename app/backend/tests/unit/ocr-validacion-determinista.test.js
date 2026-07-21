// Test de integración de la Fase 2 del pipeline v2: compareOCRResults debe
// adjuntar `validacion_determinista` (checksums NIF/CIF + cuadre aritmético)
// SIN alterar ningún campo existente de la fusión OCR (dual_confirmed, nif_status,
// confidence, campos...). Puramente aditivo — ver src/ocr/index.js Fase 2 (2026-07-21).
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { compareOCRResults } = require('../../src/ocr/index');

const logger = { info: () => {}, warn: () => {}, error: () => {} };

function campos(overrides = {}) {
  return {
    proveedor_nif: 'B72327000',
    proveedor_nombre: 'ACME SL',
    receptor_nif: '32654987R',
    receptor_nombre: 'Cliente SL',
    numero_factura: 'F-1',
    fecha_emision: '15/06/2026',
    base_imponible: '100,00',
    iva_porcentaje: '21',
    cuota_iva: '21,00',
    total: '121,00',
    irpf_porcentaje: '0,0',
    cuota_irpf: '0,00',
    moneda: 'EUR',
    lineas_iva: [],
    ...overrides,
  };
}

function motorRes(camposObj) {
  return {
    es_factura_valida: true,
    confidence: 0.9,
    processing_time_s: 1,
    ocr_engine: 'fake',
    tokens_used: 100,
    campos: camposObj,
  };
}

describe('compareOCRResults — validacion_determinista (aditivo)', () => {
  test('factura correcta: sin incidencias de error, sin romper dual_confirmed', () => {
    const r = compareOCRResults(motorRes(campos()), motorRes(campos()), [], logger);
    assert.equal(r.dual_confirmed, true);
    assert.ok(r.validacion_determinista);
    assert.deepEqual(
      r.validacion_determinista.incidencias.filter((i) => i.severidad === 'error'),
      []
    );
  });

  test('NIF de proveedor con checksum inválido: incidencia de error, campos existentes intactos', () => {
    const r = compareOCRResults(
      motorRes(campos({ proveedor_nif: 'B72327008' })),
      motorRes(campos({ proveedor_nif: 'B72327008' })),
      [],
      logger
    );
    assert.equal(r.campos.proveedor_nif, 'B72327008'); // no se pisa el campo real
    assert.ok(r.validacion_determinista.incidencias.some(
      (i) => i.regla === 'checksum_identificador' && i.campo === 'proveedor_nif'
    ));
  });

  test('cuota de IVA mal leída: sugerencia de valor despejado sin tocar el campo real', () => {
    const r = compareOCRResults(
      motorRes(campos({ cuota_iva: '27,00' })),
      motorRes(campos({ cuota_iva: '27,00' })),
      [],
      logger
    );
    assert.equal(r.campos.cuota_iva, '27,00'); // el fan-out sigue devolviendo lo leído
    assert.equal(r.validacion_determinista.sugerencias.cuota_iva, '21,00');
  });

  test('modo single-motor (solo un lado válido) no calcula validacion_determinista aquí (la calcula extractInvoiceOCR)', () => {
    const r = compareOCRResults(motorRes(campos()), { es_factura_valida: false }, [], logger);
    assert.equal(r.dual_confirmed, false);
    assert.equal(r.missing_engine, 'azure');
  });
});
