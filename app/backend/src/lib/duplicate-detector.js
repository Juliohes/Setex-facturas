// Detección de facturas duplicadas robusta a NIF mal leído por OCR.
//
// El check histórico (índice único user_id+proveedor_nif+fecha_emision+total_factura)
// no detecta duplicados cuando el NIF del proveedor es ilegible y dos subidas del
// mismo documento físico (fotos distintas, días distintos) obtienen lecturas OCR
// distintas del CIF. Este módulo añade una segunda señal que ignora el NIF y agrupa
// por (numero_factura, fecha_emision, total) — mucho más fiable cuando el número de
// factura coincide exactamente, que cuando el NIF (a menudo ilegible) coincide.
'use strict';

const { normalizeToFloat } = require('./normalize-amount');

function normalizarNumeroFactura(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase().replace(/\s+/g, '');
  return s || null;
}

function normalizarTotalClave(v) {
  const f = normalizeToFloat(v);
  if (f == null || Number.isNaN(f)) return null;
  return f.toFixed(2);
}

function normalizarFechaClave(v) {
  if (!v) return null;
  const s = String(v).trim();
  return s || null;
}

// facturas: array de objetos con al menos { id, user_id, numero_factura, fecha_emision, total_factura }
// Devuelve Map<id, number[]> — para cada factura con posible duplicado, los ids del resto del grupo.
function detectarGruposDuplicados(facturas) {
  const grupos = new Map(); // clave -> [ids]

  for (const f of facturas) {
    const numero = normalizarNumeroFactura(f.numero_factura);
    const total = normalizarTotalClave(f.total_factura);
    const fecha = normalizarFechaClave(f.fecha_emision);
    if (!numero || !total || !fecha) continue; // sin las 3 señales no arriesgamos falsos positivos

    const clave = `${f.user_id}::${fecha}::${total}::${numero}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(f.id);
  }

  const resultado = new Map();
  for (const ids of grupos.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      resultado.set(id, ids.filter((otroId) => otroId !== id));
    }
  }
  return resultado;
}

// Comprueba si una factura candidata (numero_factura, fecha_emision, total_factura, user_id)
// coincide con alguna ya existente. Devuelve la fila coincidente o null.
// `existentes` es el resultado de una query ya filtrada por user_id.
function encontrarDuplicadoPorNumero(candidata, existentes) {
  const numero = normalizarNumeroFactura(candidata.numero_factura);
  const total = normalizarTotalClave(candidata.total_factura);
  const fecha = normalizarFechaClave(candidata.fecha_emision);
  if (!numero || !total || !fecha) return null;

  return existentes.find((ex) => (
    normalizarNumeroFactura(ex.numero_factura) === numero &&
    normalizarTotalClave(ex.total_factura) === total &&
    normalizarFechaClave(ex.fecha_emision) === fecha
  )) || null;
}

module.exports = {
  normalizarNumeroFactura,
  normalizarTotalClave,
  normalizarFechaClave,
  detectarGruposDuplicados,
  encontrarDuplicadoPorNumero,
};
