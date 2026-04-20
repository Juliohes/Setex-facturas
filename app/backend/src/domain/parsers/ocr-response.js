// Parser/normalizer genérico de respuestas OCR.
// Toma el output crudo de un proveedor (OpenAI / Azure) y devuelve la estructura
// de campos normalizada que usa el resto del sistema.
//
// Función PURA — 0 side effects. Testeable con fixtures JSON.
'use strict';

const { normalizeToFloat, toSpanishAmount } = require('../../lib/normalize-amount');

/**
 * Normaliza un NIF/CIF limpiando espacios, guiones y pasando a mayúsculas.
 * @param {string|null} nif
 * @returns {string|null}
 */
function normalizeNif(nif) {
  if (!nif || typeof nif !== 'string') return null;
  const clean = nif.toUpperCase().replace(/[\s\-\.]/g, '');
  return clean || null;
}

/**
 * Asegura que un campo de importe esté en formato español "1.234,56".
 * Acepta número, string español o string inglés.
 */
function ensureSpanishAmount(value) {
  if (value == null) return null;
  const n = normalizeToFloat(value);
  return n == null ? null : toSpanishAmount(n);
}

/**
 * Estructura canónica de campos de factura. El resto del sistema espera esta forma.
 */
function buildEmptyInvoiceFields() {
  return {
    numero_factura: null,
    fecha_emision: null,
    proveedor_nombre: null,
    proveedor_nif: null,
    receptor_nombre: null,
    receptor_nif: null,
    base_imponible: null,
    iva_porcentaje: null,
    cuota_iva: null,
    lineas_iva: null,
    irpf_porcentaje: '0,0',
    cuota_irpf: '0,00',
    total: null,
    moneda: 'EUR',
  };
}

/**
 * Normaliza los campos de factura al formato canónico del sistema.
 * Útil para consumer del OCR dual: ambos providers devuelven ya normalizado,
 * pero esta función actúa como capa extra de defensa.
 */
function normalizeInvoiceFields(raw) {
  if (!raw || typeof raw !== 'object') return buildEmptyInvoiceFields();
  const empty = buildEmptyInvoiceFields();
  return {
    numero_factura: raw.numero_factura ? String(raw.numero_factura).trim().substring(0, 50) : empty.numero_factura,
    fecha_emision: raw.fecha_emision || empty.fecha_emision,
    proveedor_nombre: raw.proveedor_nombre ? String(raw.proveedor_nombre).toUpperCase() : empty.proveedor_nombre,
    proveedor_nif: normalizeNif(raw.proveedor_nif),
    receptor_nombre: raw.receptor_nombre ? String(raw.receptor_nombre).toUpperCase() : empty.receptor_nombre,
    receptor_nif: normalizeNif(raw.receptor_nif),
    base_imponible: ensureSpanishAmount(raw.base_imponible),
    iva_porcentaje: raw.iva_porcentaje || empty.iva_porcentaje,
    cuota_iva: ensureSpanishAmount(raw.cuota_iva),
    lineas_iva: Array.isArray(raw.lineas_iva) ? raw.lineas_iva : empty.lineas_iva,
    irpf_porcentaje: raw.irpf_porcentaje || empty.irpf_porcentaje,
    cuota_irpf: raw.cuota_irpf || empty.cuota_irpf,
    total: ensureSpanishAmount(raw.total),
    moneda: raw.moneda || empty.moneda,
  };
}

module.exports = {
  normalizeNif,
  ensureSpanishAmount,
  buildEmptyInvoiceFields,
  normalizeInvoiceFields,
};
