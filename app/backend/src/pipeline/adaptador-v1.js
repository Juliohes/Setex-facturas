// src/pipeline/adaptador-v1.js
// Adaptador del shape CANÓNICO del pipeline v2 (schema.js: emisor/receptor
// anidados, lineas_iva[{base,tipo,cuota}]) al shape PLANO que consume el
// frontend y el endpoint /api/upload-preview (proveedor_nif, base_imponible,
// iva_porcentaje…). 2026-08-13, necesario para la subida multipágina.
//
// Es el mismo contrato de respuesta que ya devuelve upload-preview (server.js
// ~2349): se replica EXACTO para que el frontend no distinga una factura de una
// página de una fusionada de varias. Cambiar una clave aquí rompería el modal
// de confirmación — por eso hay test de contrato (adaptador-v1.test.js).
'use strict';

/** Suma de las bases/cuotas de todas las líneas, en formato español "1.234,56". */
function sumarImporte(lineas, clave) {
  const total = (lineas || []).reduce((s, l) => {
    const n = l && l[clave] != null ? parseFloat(String(l[clave]).replace(/\./g, '').replace(',', '.')) : NaN;
    return Number.isFinite(n) ? s + n : s;
  }, 0);
  if (total === 0 && !(lineas || []).some((l) => l && l[clave] != null)) return null;
  return total.toFixed(2).replace('.', ',');
}

/**
 * Convierte una factura canónica (o la salida de fusionarPaginas) al shape plano
 * exacto que espera el frontend. Los campos ausentes quedan null (nunca
 * undefined), igual que el endpoint de una página.
 *
 * @param {object} canonico - shape de schema.js / fusion-multipagina.campos
 * @returns {object} shape plano (proveedor_*, receptor_*, base_imponible, …)
 */
function canonicoAPlano(canonico) {
  if (!canonico) {
    return {
      proveedor_nombre: null, proveedor_nif: null,
      receptor_nombre: null, receptor_nif: null,
      fecha_emision: null, total: null, numero_factura: null,
      base_imponible: null, iva_porcentaje: null, cuota_iva: null,
      lineas_iva: null, irpf_porcentaje: '0,0', cuota_irpf: '0,00',
    };
  }

  const lineas = Array.isArray(canonico.lineas_iva) ? canonico.lineas_iva : [];
  const unaLinea = lineas.length === 1 ? lineas[0] : null;

  // base/tipo/cuota agregados: si hay una sola línea se toman directos; con
  // varios tramos se agregan (base=Σbases, cuota=Σcuotas, tipo=null porque no
  // hay un único tipo) — mismo criterio que usa el pipeline de una página.
  const base = unaLinea ? (unaLinea.base ?? null) : sumarImporte(lineas, 'base');
  const cuota = unaLinea ? (unaLinea.cuota ?? null) : sumarImporte(lineas, 'cuota');
  const tipo = unaLinea ? (unaLinea.tipo ?? null) : null;

  return {
    proveedor_nombre: canonico.emisor?.nombre ?? null,
    proveedor_nif: canonico.emisor?.nif ?? null,
    receptor_nombre: canonico.receptor?.nombre ?? null,
    receptor_nif: canonico.receptor?.nif ?? null,
    fecha_emision: canonico.fecha_emision ?? null,
    total: canonico.total ?? null,
    numero_factura: canonico.numero_factura ?? null,
    base_imponible: base,
    iva_porcentaje: tipo,
    cuota_iva: cuota,
    // El frontend espera lineas_iva con clave `porcentaje` (no `tipo`).
    lineas_iva: lineas.length
      ? lineas.map((l) => ({ base: l.base ?? null, porcentaje: l.tipo ?? null, cuota: l.cuota ?? null }))
      : null,
    irpf_porcentaje: '0,0',
    cuota_irpf: canonico.retencion_irpf ?? '0,00',
  };
}

module.exports = { canonicoAPlano };
