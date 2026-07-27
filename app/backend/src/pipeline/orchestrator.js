// src/pipeline/orchestrator.js
// Fase 10 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: despliegue seguro en
// canario — SHADOW MODE. Conecta TODAS las piezas de las Fases 2-9 en un
// único flujo, pero SU RESULTADO NUNCA SE USA para la respuesta real al
// usuario — solo se calcula, se loguea y se guarda en `extracciones_v2`
// para comparar contra v1 antes de activar nada de verdad (Fase 10.2-10.4
// del prompt, requieren aprobación explícita de Julio en cada paso).
//
// Flujo: ingesta (Fase 2) → quality gate informativo (Fase 3) →
// extracción azure+gemini con reintentos (Fase 4) → árbitro por campo SIN
// invocar todavía a OpenAI (Fase 5, checksum/coherencia primero) →
// re-extracción DIRIGIDA con bounding boxes solo de lo que siga en disputa
// (Fase 7 — más barata y precisa que un "árbitro de imagen completa") →
// score + estado (Fase 8) → log estructurado con PII truncada (Fase 9).
'use strict';

const fs = require('fs');
// Sin desestructurar (propiedad accedida en cada llamada, no capturada al
// cargar el módulo) — necesario para que los tests puedan mockear cada
// pieza con mock.method(), mismo patrón que ocr/index.js.
const ingest = require('./ingest');
const preprocess = require('./preprocess');
const extractors = require('./extractors');
const arbiter = require('./arbiter');
const reextraction = require('./reextraction');
const confidence = require('./confidence');
const observabilidad = require('./observabilidad');

// Traduce el nombre de campo del árbitro a la ruta dentro del canónico,
// para poder aplicar el valor resuelto por re-extracción dirigida de vuelta.
function aplicarValorEnCanonico(canonico, campoArbitro, valor) {
  const copia = JSON.parse(JSON.stringify(canonico));
  if (campoArbitro === 'emisor.nif') copia.emisor.nif = valor;
  else if (campoArbitro === 'receptor.nif') copia.receptor.nif = valor;
  else if (campoArbitro === 'numero_factura') copia.numero_factura = valor;
  else if (campoArbitro === 'fecha_emision') copia.fecha_emision = valor;
  else if (campoArbitro === 'total') copia.total = valor;
  else if (campoArbitro === 'cuota_iva' || campoArbitro === 'base_imponible') {
    if (!copia.lineas_iva.length) copia.lineas_iva = [{ base: null, tipo: null, cuota: null }];
    copia.lineas_iva[0][campoArbitro === 'cuota_iva' ? 'cuota' : 'base'] = valor;
  }
  return copia;
}

/**
 * Ejecuta el pipeline v2 completo en modo SOMBRA sobre una factura real.
 * NUNCA lanza — cualquier fallo interno se captura y se registra, para que
 * un error del pipeline experimental jamás afecte el flujo real (fire-and-
 * forget, invocado desde server.js sin await sobre la respuesta al usuario).
 *
 * @param {object} datos
 * @param {number} datos.uploadId
 * @param {string} datos.filePath
 * @param {string} datos.mimeType
 * @param {object} datos.context   - { invoice_type, empresa_nif, empresa_nombre }
 * @param {object} datos.cfg       - features.json ya parseado
 * @param {object} datos.logger
 * @returns {Promise<object|null>} el registro listo para insertar en extracciones_v2, o null si no se pudo completar
 */
async function ejecutarPipelineV2Sombra({ uploadId, filePath, mimeType, context, cfg, logger }) {
  const documentId = `upload-${uploadId}`;
  const inicio = Date.now();

  try {
    // ── Fase 2: ingesta / clasificación ──────────────────────────────────
    const buffer = fs.readFileSync(filePath);
    const clasificacion = await ingest.clasificarDocumento(buffer, mimeType);
    observabilidad.logEtapaV2(logger, 'info', 'ingesta', documentId, { tipo: clasificacion.tipo });

    // ── Fase 3: quality gate — SOLO informativo, nunca bloquea aquí ──────
    let calidad = null;
    if (mimeType.startsWith('image/')) {
      calidad = await preprocess.analizarCalidadImagen(filePath);
      observabilidad.logEtapaV2(logger, 'info', 'preprocesado', documentId, { passed: calidad.passed, issues: calidad.issues });
    }

    // ── Fase 4: extracción azure + gemini en paralelo, con reintentos ────
    const { azure: resAzure, gemini_flash: resGemini } = await extractors.ejecutarExtraccionV2Paralelo(filePath, mimeType, context, cfg, logger);
    observabilidad.logEtapaV2(logger, 'info', 'extraccion', documentId, { azure_ok: resAzure.ok, gemini_ok: resGemini.ok, azure_ms: resAzure.tiempo_ms, gemini_ms: resGemini.tiempo_ms });

    if (!resAzure.ok && !resGemini.ok) {
      observabilidad.logEtapaV2(logger, 'warn', 'extraccion', documentId, { motivo: 'ambos motores fallaron' });
      return null;
    }

    // ── Fase 5: árbitro por campo (checksum/coherencia — SIN invocar aún
    // a OpenAI: eso se reserva para la re-extracción dirigida de la Fase 7,
    // más barata y precisa por usar la zona exacta vía bounding boxes) ────
    const arbitraje = await arbiter.arbitrarFactura(resAzure, resGemini); // sin opts.filePath → no llama a ningún árbitro todavía
    const disputasIniciales = arbitraje.disputas.length;
    observabilidad.logEtapaV2(logger, 'info', 'arbitraje', documentId, { disputas_iniciales: disputasIniciales, motivo: arbitraje.motivo });

    if (arbitraje.sin_resultado) return null;

    // ── Fase 7: re-extracción dirigida SOLO de lo que siga en disputa ────
    let camposFinales = arbitraje.campos;
    let camposEnDisputaFinal = arbitraje.disputas.map((d) => d.campo);
    if (disputasIniciales > 0 && resAzure.ok && resAzure.bounding_boxes) {
      const resultadosReextraccion = await reextraction.reextraerCamposDirigidos(arbitraje.disputas, filePath, resAzure.bounding_boxes, cfg, logger);
      const resueltos = new Set();
      for (const r of resultadosReextraccion) {
        if (r.resuelto) {
          camposFinales = aplicarValorEnCanonico(camposFinales, r.campo, r.valor);
          resueltos.add(r.campo);
        }
      }
      camposEnDisputaFinal = camposEnDisputaFinal.filter((campo) => !resueltos.has(campo));
      observabilidad.logEtapaV2(logger, 'info', 'reextraccion', documentId, { intentados: resultadosReextraccion.length, resueltos: resueltos.size });
    }
    const disputasFinales = camposEnDisputaFinal.length;

    // ── Fase 8: score + estado ────────────────────────────────────────────
    const totalCampos = Object.keys(arbitraje.decisiones || {}).length || 1;
    const scoreGlobal = confidence.calcularScoreGlobal({
      confianzaA: resAzure.ok ? resAzure.campos._confianza : null,
      confianzaB: resGemini.ok ? resGemini.campos._confianza : null,
      totalCampos, disputasIniciales, disputasFinales,
    });
    const { estado, motivo: motivoEstado } = confidence.decidirEstadoV2({ scoreGlobal, disputasFinales, esFacturaValida: camposFinales.es_factura_valida }, cfg);
    observabilidad.logEtapaV2(logger, 'info', 'confianza', documentId, { score_global: scoreGlobal, estado, motivo: motivoEstado });

    const costeTotal = (resAzure.coste_estimado_usd || 0) + (resGemini.coste_estimado_usd || 0);

    return {
      upload_id: uploadId,
      campos_canonicos: camposFinales,
      confianzas: { azure: resAzure.campos?._confianza ?? null, gemini_flash: resGemini.campos?._confianza ?? null },
      disputas: camposEnDisputaFinal,
      score_global: scoreGlobal,
      estado,
      version_pipeline: 'v2',
      coste_estimado_usd: costeTotal,
      latencia_ms: Date.now() - inicio,
    };
  } catch (err) {
    observabilidad.logEtapaV2(logger, 'error', 'pipeline_v2', documentId, { error: err.message });
    return null;
  }
}

module.exports = { ejecutarPipelineV2Sombra, aplicarValorEnCanonico };
