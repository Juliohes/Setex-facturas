// src/pipeline/observabilidad.js
// Fase 9 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: log estructurado por etapa
// con document_id correlacionado + protección de datos personales en logs.
//
// Regla 9.4 del prompt: "Nada de datos personales completos en logs —
// trunca NIFs y nombres en niveles INFO; detalle completo solo en la BD."
// Los logs de INFO/WARN pasan por truncarPII(); el detalle sin truncar
// vive SOLO en la tabla extracciones_v2 (Fase 8), protegida por auth.
'use strict';

/** NIF/NIE/CIF: muestra los 2 primeros y 2 últimos caracteres, oculta el resto. */
function truncarNIF(valor) {
  if (!valor || typeof valor !== 'string') return valor;
  if (valor.length <= 4) return '*'.repeat(valor.length);
  return `${valor.slice(0, 2)}${'*'.repeat(valor.length - 4)}${valor.slice(-2)}`;
}

/** Nombre: solo la primera palabra + "…" si hay más contenido. */
function truncarNombre(valor) {
  if (!valor || typeof valor !== 'string') return valor;
  const primeraPalabra = valor.trim().split(/\s+/)[0];
  return valor.trim().length > primeraPalabra.length ? `${primeraPalabra}…` : primeraPalabra;
}

const CAMPOS_NIF = new Set(['nif', 'proveedor_nif', 'receptor_nif', 'emisor.nif', 'receptor.nif']);
const CAMPOS_NOMBRE = new Set(['nombre', 'proveedor_nombre', 'receptor_nombre', 'emisor.nombre', 'receptor.nombre']);

/** Aplica truncarNIF/truncarNombre a los campos sensibles conocidos de un objeto plano. */
function truncarPII(objeto) {
  if (!objeto || typeof objeto !== 'object') return objeto;
  const resultado = {};
  for (const [clave, valor] of Object.entries(objeto)) {
    if (CAMPOS_NIF.has(clave)) resultado[clave] = truncarNIF(valor);
    else if (CAMPOS_NOMBRE.has(clave)) resultado[clave] = truncarNombre(valor);
    else resultado[clave] = valor;
  }
  return resultado;
}

/**
 * Log estructurado uniforme por etapa del pipeline v2, con document_id
 * correlacionado (Fase 9.1: "calidad de imagen, ruta tomada, modelos
 * invocados, discrepancias del árbitro, issues, decisión final").
 *
 * @param {object} logger  - logger Winston (o cualquiera con .info/.warn/.error)
 * @param {string} nivel   - 'info' | 'warn' | 'error'
 * @param {string} etapa   - 'ingesta' | 'preprocesado' | 'extraccion' | 'arbitraje' | 'reextraccion' | 'confianza'
 * @param {string} documentId
 * @param {object} datos   - datos propios de la etapa; se trunca PII automáticamente
 */
function logEtapaV2(logger, nivel, etapa, documentId, datos = {}) {
  const fn = logger?.[nivel] || logger?.info;
  if (!fn) return;
  fn.call(logger, `[PipelineV2:${etapa}]`, { document_id: documentId, etapa, ...truncarPII(datos) });
}

module.exports = { truncarNIF, truncarNombre, truncarPII, logEtapaV2 };
