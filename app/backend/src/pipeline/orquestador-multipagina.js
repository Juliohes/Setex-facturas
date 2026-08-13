// src/pipeline/orquestador-multipagina.js
// Orquesta la extracción de una factura repartida en N imágenes de página
// (2026-08-13). Reutiliza el pipeline v2 ya desplegado para extraer CADA página
// y el módulo de fusión (fusion-multipagina.js) para combinarlas en una sola
// factura. No añade dependencias ni modifica el flujo de una sola página.
//
// Coste (decisión de Julio "todas las páginas + fusión"): se ejecuta la
// extracción base (motores configurados en features.json) UNA vez por página.
// Para acotar el coste con documentos largos, el llamador debe respetar el tope
// de páginas (ocr_multipagina_max_paginas) ANTES de invocar esto.
//
// Por página NO se ejecutan variantes de imagen ni re-extracción dirigida: son
// palancas de coste/latencia que ya multiplican por página y aportan poco frente
// a tener varias páginas. El árbitro externo se respeta según la config global.
'use strict';

const seleccionModelos = require('./seleccion-modelos');
const extractors = require('./extractors');
const arbiter = require('./arbiter');
const confidence = require('./confidence');
const observabilidad = require('./observabilidad');
const { fusionarPaginas } = require('./fusion-multipagina');

/**
 * Extrae una página y devuelve su canónico (o null si falla). Reutiliza la misma
 * selección de motores y arbitraje que el pipeline de una sola página.
 */
async function extraerPagina({ pagina, filePath, mimeType }, context, cfg, logger) {
  const seleccion = seleccionModelos.resolverConfigModelos(cfg);
  const usaMulti = seleccionModelos.esSeleccionPersonalizada(seleccion);
  const documentId = `pagina-${pagina}`;

  let resultados;
  if (usaMulti) {
    const mapa = await extractors.ejecutarExtraccionV2Multi(seleccion.base, filePath, mimeType, context, cfg, logger);
    resultados = seleccion.base.map((m) => mapa[m]).filter(Boolean);
  } else {
    const { azure: rA, gemini_flash: rG } = await extractors.ejecutarExtraccionV2Paralelo(filePath, mimeType, context, cfg, logger);
    resultados = [rA, rG];
  }

  if (resultados.every((r) => !r || !r.ok)) {
    observabilidad.logEtapaV2(logger, 'warn', 'multipagina_extraccion', documentId, { motivo: 'todos los motores fallaron en esta página' });
    return { pagina, ok: false, campos: null };
  }

  let arbitraje;
  if (usaMulti) {
    const arbitroActivo = Boolean(seleccion.arbitro) && cfg.ocr_extraccion_v2_arbitro_bloqueante !== false;
    const arbOpts = arbitroActivo ? { filePath, mimeType, context, cfg, logger, motorArbitro: seleccion.arbitro } : {};
    arbitraje = await arbiter.arbitrarFacturaMulti(resultados, arbOpts);
  } else {
    arbitraje = await arbiter.arbitrarFactura(resultados[0], resultados[1]);
  }

  if (arbitraje.sin_resultado || !arbitraje.campos) return { pagina, ok: false, campos: null };
  observabilidad.logEtapaV2(logger, 'info', 'multipagina_extraccion', documentId, { disputas: arbitraje.disputas.length });
  return { pagina, ok: true, campos: arbitraje.campos, disputas: arbitraje.disputas.length };
}

/**
 * Extrae y fusiona una factura de N páginas.
 *
 * @param {Array<{pagina:number, filePath:string, mimeType:string}>} paginas
 *        Orden 1..N tal como lo subió el usuario (fotos o páginas de PDF ya
 *        rasterizadas en el cliente).
 * @param {object} context  - { invoice_type, empresa_nif, userId }
 * @param {object} cfg       - features.json parseado
 * @param {object} [logger]
 * @returns {Promise<{
 *   campos: object|null,
 *   procedencia: object,
 *   camposFaltantes: Array<{clave,etiqueta,zona}>,
 *   estado: string,
 *   score_global: number,
 *   paginas_total: number,
 *   paginas_validas: number,
 *   avisos: string[]
 * }>}
 */
async function ejecutarPipelineMultipagina(paginas, context, cfg, logger) {
  const inicio = Date.now();
  // Las páginas se extraen en PARALELO (independientes entre sí). El tope de
  // páginas lo garantiza el llamador; aquí no se limita para no ocultar errores.
  const extraidas = await Promise.all(
    (paginas || []).map((p) => extraerPagina(p, context, cfg, logger)
      .catch((err) => {
        observabilidad.logEtapaV2(logger, 'error', 'multipagina_extraccion', `pagina-${p.pagina}`, { error: err.message });
        return { pagina: p.pagina, ok: false, campos: null };
      })),
  );

  const fusion = fusionarPaginas(extraidas);

  if (!fusion.campos) {
    return { ...fusion, estado: 'ilegible', score_global: 0, paginas_total: (paginas || []).length, paginas_validas: 0, latencia_ms: Date.now() - inicio };
  }

  // Estado/score con los mismos umbrales del pipeline de una página. Un campo
  // crítico faltante fuerza revisión (no puede auto-aprobarse una factura a la
  // que le falta el total o el número).
  const scoreGlobal = confidence.calcularScoreGlobal({
    confianzaA: null, confianzaB: null,
    totalCampos: 11, disputasIniciales: 0, disputasFinales: fusion.camposFaltantes.length,
  });
  let { estado, motivo } = confidence.decidirEstadoV2({ scoreGlobal, disputasFinales: fusion.camposFaltantes.length, esFacturaValida: fusion.campos.es_factura_valida }, cfg);
  if (fusion.camposFaltantes.length > 0 && estado === 'auto_aprobada') {
    estado = 'pendiente_revision';
    motivo = `faltan campos críticos: ${fusion.camposFaltantes.map((c) => c.clave).join(', ')}`;
  }

  observabilidad.logEtapaV2(logger, 'info', 'multipagina_fusion', 'factura', {
    paginas: fusion.paginasValidas, faltantes: fusion.camposFaltantes.map((c) => c.clave), estado,
  });

  return {
    ...fusion,
    estado,
    motivo,
    score_global: scoreGlobal,
    paginas_total: (paginas || []).length,
    paginas_validas: fusion.paginasValidas,
    latencia_ms: Date.now() - inicio,
  };
}

module.exports = { ejecutarPipelineMultipagina, extraerPagina };
