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
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
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
const aprendizaje = require('./aprendizaje');
const tesseractAdapter = require('../ocr/tesseract');

// Campos críticos que se comprueban contra Tesseract para detectar
// alucinaciones (gap "aprendizaje continuo", 2026-07-28) — los mismos que
// el resto del proyecto ya considera "críticos" (ver docs/ocr-v2/*.md).
function extraerValoresCriticos(canonico) {
  const primeraLinea = (canonico.lineas_iva || [])[0] || {};
  return {
    'emisor.nif': canonico.emisor?.nif,
    'receptor.nif': canonico.receptor?.nif,
    numero_factura: canonico.numero_factura,
    // 2026-07-29: la fecha faltaba aquí y por eso pasó desapercibida una
    // alucinación real de v2 (factura #22: leyó "10/07/2023" cuando el papel
    // pone "10/07/2026" — se inventó el año). Un año equivocado manda la
    // factura a otro ejercicio fiscal: es de los errores más caros que hay.
    fecha_emision: canonico.fecha_emision,
    total: canonico.total,
    'desglose_iva.base': primeraLinea.base,
  };
}

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
 * @param {object} datos.context   - { invoice_type, empresa_nif, empresa_nombre, userId }
 * @param {object} datos.cfg       - features.json ya parseado
 * @param {object} datos.logger
 * @param {import('pg').Pool} [datos.pool] - requerido solo si ocr_extraccion_v2_aprendizaje_enabled
 * @returns {Promise<object|null>} el registro listo para insertar en extracciones_v2, o null si no se pudo completar
 */
async function ejecutarPipelineV2Sombra({ uploadId, filePath, mimeType, context, cfg, logger, pool }) {
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

    // ── Gap "variantes de imagen en v2" (2026-07-28): comparar el resultado
    // sobre la imagen ESTÁNDAR contra el mismo flujo sobre una variante con
    // contraste local (CLAHE, ya usada en el panel Benchmark IA — Fase 5.4
    // de PROMPT-PIPELINE-OCR-FACTURAS-V2.md la conecta aquí). Gana la que
    // tenga MENOS disputas (empate → mayor confianza media). Solo tras
    // ocr_extraccion_v2_variantes_enabled (default false): duplica el nº de
    // llamadas de extracción — coste real, decisión explícita de Julio.
    let variante = 'estandar';
    let arbitrajeGanador = arbitraje;
    let resAzureGanador = resAzure;
    let resGeminiGanador = resGemini;
    if (cfg.ocr_extraccion_v2_variantes_enabled && mimeType.startsWith('image/')) {
      let rutaVariante = null;
      try {
        const bufferContraste = await preprocess.generarVarianteContrasteParaExtraccion(filePath);
        rutaVariante = path.join(os.tmpdir(), `v2-contraste-${documentId}-${Date.now()}.jpg`);
        await fsp.writeFile(rutaVariante, bufferContraste);

        const { azure: resAzureV, gemini_flash: resGeminiV } = await extractors.ejecutarExtraccionV2Paralelo(rutaVariante, mimeType, context, cfg, logger);
        if (resAzureV.ok || resGeminiV.ok) {
          const arbitrajeV = await arbiter.arbitrarFactura(resAzureV, resGeminiV);
          observabilidad.logEtapaV2(logger, 'info', 'variante_contraste', documentId, { disputas: arbitrajeV.disputas.length, disputas_estandar: disputasIniciales });

          if (!arbitrajeV.sin_resultado && arbitrajeV.disputas.length < arbitrajeGanador.disputas.length) {
            variante = 'contraste';
            arbitrajeGanador = arbitrajeV;
            resAzureGanador = resAzureV;
            resGeminiGanador = resGeminiV;
          }
        }
      } catch (err) {
        observabilidad.logEtapaV2(logger, 'warn', 'variante_contraste', documentId, { error: err.message });
      } finally {
        if (rutaVariante) await fsp.unlink(rutaVariante).catch(() => {});
      }
    }

    // ── Fase 7: re-extracción dirigida SOLO de lo que siga en disputa ────
    // (sobre la variante GANADORA de arriba — nunca sobre las dos, para no
    // duplicar también el coste de la re-extracción).
    const disputasInicialesGanador = arbitrajeGanador.disputas.length;
    let camposFinales = arbitrajeGanador.campos;
    let camposEnDisputaFinal = arbitrajeGanador.disputas.map((d) => d.campo);
    if (disputasInicialesGanador > 0 && resAzureGanador.ok && resAzureGanador.bounding_boxes) {
      const resultadosReextraccion = await reextraction.reextraerCamposDirigidos(arbitrajeGanador.disputas, filePath, resAzureGanador.bounding_boxes, cfg, logger);
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

    // ── Gap "aprendizaje continuo" (2026-07-28): si el NIF de la contraparte
    // ya es un proveedor/cliente conocido (known_cifs / company_relationships,
    // tablas de v1 sin cambios), preferir su nombre YA CONFIRMADO sobre lo
    // que haya leído la IA esta vez. Solo tras
    // ocr_extraccion_v2_aprendizaje_enabled (default false). Fail-safe: un
    // fallo de BD deja camposFinales tal cual, nunca rompe el pipeline.
    let aprendizajeAplicado = null;
    if (cfg.ocr_extraccion_v2_aprendizaje_enabled && pool) {
      try {
        const esCompra = context?.invoice_type !== 'venta';
        const nifContraparte = esCompra ? camposFinales.emisor?.nif : camposFinales.receptor?.nif;
        const conocido = await aprendizaje.buscarProveedorConocido(pool, nifContraparte, {
          userId: context?.userId, empresaNif: context?.empresa_nif,
        });
        if (conocido) {
          camposFinales = JSON.parse(JSON.stringify(camposFinales));
          if (esCompra) camposFinales.emisor.nombre = conocido.nombre;
          else camposFinales.receptor.nombre = conocido.nombre;
          aprendizajeAplicado = { fuente: conocido.fuente, confirmaciones: conocido.confirmaciones };
          observabilidad.logEtapaV2(logger, 'info', 'aprendizaje', documentId, aprendizajeAplicado);
        }
      } catch (err) {
        observabilidad.logEtapaV2(logger, 'warn', 'aprendizaje', documentId, { error: err.message });
      }
    }

    // ── Gap "aprendizaje continuo" (2026-07-28): verificación cruzada
    // anti-alucinación con Tesseract (motor local, coste 0 USD). Si un valor
    // crítico no aparece en NINGÚN sitio del texto bruto reconocido, se
    // marca como sospechoso — la señal más importante del proyecto (regla 8
    // de CLAUDE.md). Solo tras ocr_extraccion_v2_tesseract_enabled (default
    // false). Fail-safe: un fallo de Tesseract no afecta al resto.
    let alucinacionesSospechosas = [];
    if (cfg.ocr_extraccion_v2_tesseract_enabled && mimeType.startsWith('image/')) {
      const resultadoTesseract = await tesseractAdapter.reconocerTextoBruto(filePath);
      if (resultadoTesseract.ok) {
        const criticos = extraerValoresCriticos(camposFinales);
        for (const [campo, valor] of Object.entries(criticos)) {
          if (!valor) continue;
          const aparece = tesseractAdapter.apareceEnTexto(valor, resultadoTesseract.textoBruto);
          if (aparece === false) alucinacionesSospechosas.push(campo);
        }
        if (alucinacionesSospechosas.length > 0) {
          observabilidad.logEtapaV2(logger, 'warn', 'alucinacion_sospechosa', documentId, { campos: alucinacionesSospechosas });
        }
      } else {
        observabilidad.logEtapaV2(logger, 'warn', 'tesseract', documentId, { error: resultadoTesseract.error });
      }
    }

    // ── Fase 8: score + estado ────────────────────────────────────────────
    const totalCampos = Object.keys(arbitrajeGanador.decisiones || {}).length || 1;
    const scoreGlobal = confidence.calcularScoreGlobal({
      confianzaA: resAzureGanador.ok ? resAzureGanador.campos._confianza : null,
      confianzaB: resGeminiGanador.ok ? resGeminiGanador.campos._confianza : null,
      totalCampos, disputasIniciales: disputasInicialesGanador, disputasFinales,
    });
    const { estado, motivo: motivoEstado } = confidence.decidirEstadoV2({ scoreGlobal, disputasFinales, esFacturaValida: camposFinales.es_factura_valida }, cfg);
    observabilidad.logEtapaV2(logger, 'info', 'confianza', documentId, { score_global: scoreGlobal, estado, motivo: motivoEstado, variante });

    // Coste real de TODAS las llamadas hechas (si hubo comparación de
    // variantes, incluye las dos, no solo la ganadora — el coste ya se
    // incurrió aunque se descarte el resultado).
    const costeTotal = (resAzure.coste_estimado_usd || 0) + (resGemini.coste_estimado_usd || 0)
      + (resAzureGanador !== resAzure ? (resAzureGanador.coste_estimado_usd || 0) : 0)
      + (resGeminiGanador !== resGemini ? (resGeminiGanador.coste_estimado_usd || 0) : 0);

    return {
      upload_id: uploadId,
      campos_canonicos: camposFinales,
      confianzas: { azure: resAzureGanador.campos?._confianza ?? null, gemini_flash: resGeminiGanador.campos?._confianza ?? null },
      disputas: camposEnDisputaFinal,
      score_global: scoreGlobal,
      estado,
      variante,
      alucinaciones_sospechosas: alucinacionesSospechosas,
      aprendizaje_aplicado: aprendizajeAplicado,
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
