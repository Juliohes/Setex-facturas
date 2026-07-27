// src/pipeline/confidence.js
// Fase 8 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: score global + estados.
//
// Score global = función de 3 señales:
//   1. Confianza media reportada por los dos motores (Fase 4 — hoy solo a
//      nivel de documento, no por campo, ver domain/routing.js:204-206).
//   2. Acuerdo INICIAL entre motores (cuántos campos coincidieron sin
//      necesitar árbitro, Fase 5) — refleja lo "limpia" que fue la lectura.
//   3. Resolución FINAL (cuántos campos siguen sin resolver tras árbitro +
//      re-extracción dirigida, Fase 7) — la señal de más peso: una disputa
//      que sobrevive a dos intentos de desempate es la más peligrosa.
//
// Fórmula (pesos documentados, ajustables):
//   score = 0.25×confianzaMedia + 0.25×acuerdoInicial + 0.50×resueltoFinal
//
// Estados (reutiliza el mismo concepto de 3 bandas que domain/routing.js,
// ya en producción desde 2026-07-22 — mismo nombre, distinta fuente de
// verdad: routing.js decide sobre validación determinista pura, esto
// decide sobre el resultado YA arbitrado del pipeline v2):
//   auto_aprobada    — sin disputas finales y score ≥ umbral_auto
//   pendiente_revision — disputas finales, o score entre ambos umbrales
//   ilegible         — es_factura_valida=false, o score < umbral_revision
'use strict';

const PESO_CONFIANZA = 0.25;
const PESO_ACUERDO_INICIAL = 0.25;
const PESO_RESUELTO_FINAL = 0.50;

/**
 * @param {object} datos
 * @param {number|null} datos.confianzaA  - confianza (0-1) del motor A (null si no disponible)
 * @param {number|null} datos.confianzaB  - confianza (0-1) del motor B
 * @param {number} datos.totalCampos      - nº de campos comparados por el árbitro
 * @param {number} datos.disputasIniciales - nº de campos que discreparon antes de arbitrar
 * @param {number} datos.disputasFinales   - nº de campos que SIGUEN en disputa tras árbitro+reextracción
 * @returns {number} score 0-1
 */
function calcularScoreGlobal({ confianzaA, confianzaB, totalCampos, disputasIniciales, disputasFinales }) {
  const confianzas = [confianzaA, confianzaB].filter((c) => typeof c === 'number');
  const confianzaMedia = confianzas.length ? confianzas.reduce((a, b) => a + b, 0) / confianzas.length : 0.5;

  const acuerdoInicial = totalCampos > 0 ? (totalCampos - disputasIniciales) / totalCampos : 1;
  const resueltoFinal = totalCampos > 0 ? (totalCampos - disputasFinales) / totalCampos : 1;

  const score = PESO_CONFIANZA * confianzaMedia + PESO_ACUERDO_INICIAL * acuerdoInicial + PESO_RESUELTO_FINAL * resueltoFinal;
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

/**
 * Decide el estado final de la factura. Reutiliza los umbrales ya
 * preparados en features.json desde la Fase 1
 * (ocr_extraccion_v2_umbral_auto / ocr_extraccion_v2_umbral_revision).
 *
 * @param {object} datos
 * @param {number} datos.scoreGlobal
 * @param {number} datos.disputasFinales
 * @param {boolean} datos.esFacturaValida
 * @param {object} cfg - features.json ya parseado
 */
function decidirEstadoV2({ scoreGlobal, disputasFinales, esFacturaValida }, cfg = {}) {
  const umbralAuto = cfg.ocr_extraccion_v2_umbral_auto ?? 0.9;
  const umbralRevision = cfg.ocr_extraccion_v2_umbral_revision ?? 0.6;

  if (!esFacturaValida) {
    return { estado: 'ilegible', motivo: 'documento no reconocido como factura o ilegible' };
  }
  if (disputasFinales > 0) {
    return { estado: 'pendiente_revision', motivo: `${disputasFinales} campo(s) sin resolver tras árbitro y re-extracción` };
  }
  if (scoreGlobal >= umbralAuto) {
    return { estado: 'auto_aprobada', motivo: `score ${scoreGlobal} ≥ umbral auto ${umbralAuto}, sin disputas` };
  }
  if (scoreGlobal < umbralRevision) {
    return { estado: 'ilegible', motivo: `score ${scoreGlobal} < umbral mínimo ${umbralRevision}` };
  }
  return { estado: 'pendiente_revision', motivo: `score ${scoreGlobal} entre umbrales (${umbralRevision}-${umbralAuto})` };
}

module.exports = { calcularScoreGlobal, decidirEstadoV2, PESO_CONFIANZA, PESO_ACUERDO_INICIAL, PESO_RESUELTO_FINAL };
