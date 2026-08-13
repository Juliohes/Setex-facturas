// src/pipeline/fusion-multipagina.js
// Fusión de una factura repartida en VARIAS páginas (2026-08-13, petición de
// Julio: "subir una factura de más de una página").
//
// El backend recibe SIEMPRE N imágenes de página (las fotos, o las páginas de
// un PDF ya rasterizadas en el navegador con el pdfjs vendorizado — así no hace
// falta poppler ni canvas nativo en el servidor). Cada página se extrae por
// separado con el pipeline v2 y aquí se FUSIONAN en una única factura canónica.
//
// Regla de negocio (decisión de Julio): las N páginas son SIEMPRE la misma
// factura, no un lote. El patrón esperado y recomendado en la UI es:
//   - 1ª hoja  → datos fiscales de cabecera (nº factura, fecha, NIF emisor/receptor)
//   - última hoja → importes finales (base, IVA, total)
//   - fotos extra opcionales si falta algún dato concreto (máx. 2-4 fotos)
//
// Por eso esta fusión devuelve `camposFaltantes`: la lista de datos críticos que
// NO aparecen en ninguna página, para que el frontend le diga al usuario
// exactamente qué volver a fotografiar ("falta el total, haz una foto de la
// página de importes") en lugar de un error genérico.
//
// NO reinventa validación: reutiliza los validadores deterministas que ya usa el
// árbitro del pipeline v2 (checksum NIF/CIF, cuadre aritmético de IVA) y el
// comparador normalizado. La única lógica nueva es CÓMO se combinan las páginas.
'use strict';

const { coinciden } = require('./arbiter');
const { validateSpanishTaxId, checkDigitCIF, checkDigitNIF, checkDigitNIE } = require('../domain/validators/nif');
const { validateIVACoherencia } = require('../domain/validators/iva');
const { normalizeToFloat, amountsAgree } = require('../lib/normalize-amount');

// Datos sin los que una factura española no es registrable. Si tras fusionar
// alguno sigue vacío, se pide al usuario una foto adicional de la zona que lo
// contiene (fiscal → 1ª hoja; importes → última hoja).
const CAMPOS_CRITICOS = [
  { clave: 'numero_factura', etiqueta: 'número de factura', zona: 'fiscal' },
  { clave: 'fecha_emision', etiqueta: 'fecha de emisión', zona: 'fiscal' },
  { clave: 'emisor.nif', etiqueta: 'NIF del emisor', zona: 'fiscal' },
  { clave: 'total', etiqueta: 'importe total', zona: 'importes' },
];

function checkDigitGenerico(nif) {
  const formato = validateSpanishTaxId(nif);
  if (!formato.valid) return null;
  if (formato.type === 'NIF') return checkDigitNIF(nif);
  if (formato.type === 'NIE') return checkDigitNIE(nif);
  if (formato.type === 'CIF') return checkDigitCIF(nif);
  return null;
}

/** Primer valor no nulo recorriendo las páginas EN ORDEN (cabecera → suele estar en la 1ª). */
function primeroNoNulo(paginas, extractor) {
  for (const p of paginas) {
    const v = extractor(p.campos);
    if (v != null && String(v).trim() !== '') return { valor: v, pagina: p.pagina };
  }
  return { valor: null, pagina: null };
}

/**
 * Resuelve un NIF entre páginas: prioriza el que pase checksum; si ninguno pasa,
 * el primero no nulo. Mismo criterio que resolverIdentificador del árbitro, pero
 * aplicado a N páginas en vez de a 2 motores.
 */
function resolverNif(paginas, extractor) {
  let primero = null;
  for (const p of paginas) {
    const v = extractor(p.campos);
    if (v == null || String(v).trim() === '') continue;
    if (primero == null) primero = { valor: v, pagina: p.pagina };
    if (checkDigitGenerico(v) === true) return { valor: v, pagina: p.pagina, checksum: true };
  }
  return primero ? { ...primero, checksum: false } : { valor: null, pagina: null, checksum: false };
}

/** Clave de deduplicación de una línea de IVA (base|tipo|cuota normalizados). */
function claveLinea(l) {
  const n = (x) => (x == null ? '' : String(x).replace(/\s/g, '').replace(',', '.').toLowerCase());
  return `${n(l.base)}|${n(l.tipo)}|${n(l.cuota)}`;
}

/** Unión de las líneas de IVA de todas las páginas, sin duplicados exactos ni líneas vacías. */
function fusionarLineas(paginas) {
  const vistas = new Set();
  const out = [];
  const procedencia = [];
  for (const p of paginas) {
    for (const l of (p.campos.lineas_iva || [])) {
      if (l.base == null && l.tipo == null && l.cuota == null) continue; // línea vacía
      const k = claveLinea(l);
      if (vistas.has(k)) continue;
      vistas.add(k);
      out.push({ base: l.base ?? null, tipo: l.tipo ?? null, cuota: l.cuota ?? null });
      procedencia.push(p.pagina);
    }
  }
  return { lineas: out, procedencia };
}

/** Shape que espera validateIVACoherencia a partir de un canónico + líneas fusionadas. */
function aPlanoValidar(total, retencion, lineas) {
  const una = lineas.length === 1 ? lineas[0] : null;
  return {
    base_imponible: una ? una.base : null,
    iva_porcentaje: una ? una.tipo : null,
    cuota_iva: una ? una.cuota : null,
    total,
    cuota_irpf: retencion,
    lineas_iva: lineas.length > 1 ? lineas.map((l) => ({ base: l.base, cuota: l.cuota, porcentaje: l.tipo })) : [],
  };
}

/**
 * Elige el total de la factura entre los candidatos de todas las páginas. En una
 * factura multipágina cada hoja puede mostrar un subtotal; el total REAL es el de
 * la última hoja de importes. Criterio: entre los candidatos, gana el que menos
 * errores de cuadre (base+IVA) produce con las líneas fusionadas; a igualdad, el
 * MAYOR (el total final es ≥ que cualquier subtotal de página).
 */
function elegirTotal(paginas, lineas, retencion) {
  const candidatos = [];
  for (const p of paginas) {
    const t = p.campos.total;
    if (t == null || String(t).trim() === '') continue;
    if (candidatos.some((c) => amountsAgree(normalizeToFloat(c.valor), normalizeToFloat(t)))) continue;
    candidatos.push({ valor: t, pagina: p.pagina });
  }
  if (candidatos.length === 0) return { valor: null, pagina: null };
  if (candidatos.length === 1) return candidatos[0];

  let mejor = null;
  for (const c of candidatos) {
    const { errors } = validateIVACoherencia(aPlanoValidar(c.valor, retencion, lineas));
    const num = normalizeToFloat(c.valor) ?? -Infinity;
    if (!mejor
      || errors.length < mejor.errores
      || (errors.length === mejor.errores && num > mejor.num)) {
      mejor = { valor: c.valor, pagina: c.pagina, errores: errors.length, num };
    }
  }
  return { valor: mejor.valor, pagina: mejor.pagina };
}

/**
 * Fusiona las extracciones por página en UNA factura canónica.
 *
 * @param {Array<{pagina:number, ok:boolean, campos:object|null}>} paginas
 *        Resultado de extraer cada página (campos = shape canónico de schema.js).
 *        `pagina` es el orden 1..N tal como lo subió el usuario.
 * @returns {{
 *   campos: object,                 // factura canónica fusionada
 *   procedencia: object,            // { campo: nºpágina } — de dónde salió cada dato
 *   camposFaltantes: Array<{clave,etiqueta,zona}>, // críticos ausentes → pedir foto extra
 *   paginasValidas: number,
 *   avisos: string[]
 * }}
 */
function fusionarPaginas(paginas) {
  const avisos = [];
  const validas = (paginas || [])
    .filter((p) => p && p.ok && p.campos)
    .sort((a, b) => (a.pagina || 0) - (b.pagina || 0));

  if (validas.length === 0) {
    return {
      campos: null,
      procedencia: {},
      camposFaltantes: CAMPOS_CRITICOS.slice(),
      paginasValidas: 0,
      avisos: ['ninguna página produjo una extracción válida'],
    };
  }

  const procedencia = {};

  // Cabecera (texto simple): primer valor no nulo en orden de página.
  const numero = primeroNoNulo(validas, (c) => c.numero_factura);
  const fecha = primeroNoNulo(validas, (c) => c.fecha_emision);
  procedencia.numero_factura = numero.pagina;
  procedencia.fecha_emision = fecha.pagina;

  // Identidad: NIF con checksum preferente; nombre del mismo bloque o primero no nulo.
  const emisorNif = resolverNif(validas, (c) => c.emisor?.nif);
  const receptorNif = resolverNif(validas, (c) => c.receptor?.nif);
  const emisorNombre = primeroNoNulo(validas, (c) => c.emisor?.nombre);
  const receptorNombre = primeroNoNulo(validas, (c) => c.receptor?.nombre);
  procedencia['emisor.nif'] = emisorNif.pagina;
  procedencia['receptor.nif'] = receptorNif.pagina;
  if (emisorNif.valor && !emisorNif.checksum) avisos.push('el NIF del emisor no pasa el dígito de control');

  // Líneas de IVA: unión de todas las páginas.
  const { lineas, procedencia: procLineas } = fusionarLineas(validas);
  if (procLineas.length) procedencia.lineas_iva = [...new Set(procLineas)];

  // IRPF y total: de la zona de importes (última hoja típicamente).
  const retencion = primeroNoNulo(validas, (c) => c.retencion_irpf);
  const total = elegirTotal(validas, lineas, retencion.valor);
  procedencia.total = total.pagina;
  procedencia.retencion_irpf = retencion.pagina;

  const moneda = primeroNoNulo(validas, (c) => c.moneda);

  const campos = {
    emisor: { nombre: emisorNombre.valor, nif: emisorNif.valor },
    receptor: { nombre: receptorNombre.valor, nif: receptorNif.valor },
    numero_factura: numero.valor,
    fecha_emision: fecha.valor,
    lineas_iva: lineas,
    retencion_irpf: retencion.valor,
    total: total.valor,
    moneda: moneda.valor || 'EUR',
    es_factura_valida: validas.some((p) => p.campos.es_factura_valida !== false),
  };

  // Campos críticos ausentes → guían la foto extra que puede hacer el usuario.
  const valorDe = (clave) => (clave === 'emisor.nif' ? campos.emisor.nif : campos[clave]);
  const camposFaltantes = CAMPOS_CRITICOS.filter((c) => {
    const v = valorDe(c.clave);
    return v == null || String(v).trim() === '';
  });

  return { campos, procedencia, camposFaltantes, paginasValidas: validas.length, avisos };
}

module.exports = { fusionarPaginas, CAMPOS_CRITICOS };
