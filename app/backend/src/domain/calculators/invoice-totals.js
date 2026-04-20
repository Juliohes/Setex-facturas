// Calculadora de totales de factura española.
// Fórmula: Total = Base imponible + Cuota IVA − Cuota IRPF
//
// Reglas:
//  - Tolerancia ±0.05€ en validación (redondeos OCR).
//  - Todos los parámetros pueden ser string ("1.234,56") o number.
//  - Devuelve siempre Number o null.
//
// Función PURA — 0 side effects, 0 deps externas. Testeable al 100%.
'use strict';

const { normalizeToFloat } = require('../../lib/normalize-amount');

/**
 * Calcula el total esperado de una factura.
 * @param {string|number} baseImponible
 * @param {string|number} cuotaIva
 * @param {string|number} cuotaIrpf
 * @returns {number|null}
 */
function calculateInvoiceTotal(baseImponible, cuotaIva, cuotaIrpf = 0) {
  const base = normalizeToFloat(baseImponible);
  const iva = normalizeToFloat(cuotaIva);
  const irpf = normalizeToFloat(cuotaIrpf) || 0;
  if (base == null || iva == null) return null;
  return Number((base + iva - irpf).toFixed(2));
}

/**
 * Valida si el total declarado cuadra con base + IVA − IRPF (tolerancia 0.05€).
 * @returns {object} { valid: boolean, calculated: number|null, declared: number|null, diff: number|null }
 */
function validateInvoiceTotal(baseImponible, cuotaIva, cuotaIrpf, totalDeclared, tolerance = 0.05) {
  const calculated = calculateInvoiceTotal(baseImponible, cuotaIva, cuotaIrpf);
  const declared = normalizeToFloat(totalDeclared);
  if (calculated == null || declared == null) {
    return { valid: false, calculated, declared, diff: null };
  }
  const diff = Math.abs(calculated - declared);
  return { valid: diff <= tolerance, calculated, declared, diff: Number(diff.toFixed(2)) };
}

/**
 * Calcula cuota IVA a partir de base y porcentaje.
 * @param {string|number} base
 * @param {string|number} porcentaje - 21, 10, 4, 0
 * @returns {number|null}
 */
function calculateIvaFromBase(base, porcentaje) {
  const b = normalizeToFloat(base);
  const p = normalizeToFloat(porcentaje);
  if (b == null || p == null) return null;
  return Number((b * p / 100).toFixed(2));
}

module.exports = {
  calculateInvoiceTotal,
  validateInvoiceTotal,
  calculateIvaFromBase,
};
