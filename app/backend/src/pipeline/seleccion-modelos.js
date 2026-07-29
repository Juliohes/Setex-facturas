// src/pipeline/seleccion-modelos.js
// Selección configurable de motores del pipeline v2 (2026-07-29, petición de
// Julio): poder incluir/quitar EN CALIENTE entre 2 y 4 motores base + un
// árbitro opcional, editando features.json (bind-mount, sin rebuild).
//
// Contrato de seguridad (por qué este módulo es conservador):
//  1. Si NO hay flag `ocr_extraccion_v2_modelos_base`, el default reproduce
//     EXACTAMENTE el comportamiento de hoy: base = ['azure','gemini_flash'],
//     árbitro = ninguno. Así, desplegar el código nuevo NO cambia nada por sí
//     solo — el cambio de mezcla de modelos es siempre una decisión explícita
//     de Julio vía flag (regla 4 de CLAUDE.md: features.json en caliente).
//  2. La config deseada por Julio (2026-07-29) — Gemini Flash + Mistral OCR 4
//     de base, OpenAI 4.1 como árbitro, SIN Azure — se activa poniendo:
//        "ocr_extraccion_v2_modelos_base": ["gemini_flash", "mistral"],
//        "ocr_extraccion_v2_modelo_arbitro": "openai"
//  3. Toda entrada inválida se ignora con aviso, nunca rompe el pipeline
//     (fail-safe): un motor desconocido se descarta; si no queda ninguno
//     válido, se cae al default seguro.
//
// IDs de modelo reales (verificados en el código, NO inventados):
//   gemini_flash → cfg.ocr_gemini_flash_model (default "gemini-3.5-flash").
//                  Si Google publica "gemini-3.6-flash", basta cambiar ese
//                  flag — este módulo no fija la versión, solo el rol.
//   mistral      → "mistral-ocr-latest" (alias de OCR 4, ocr/mistral.js).
//   openai       → "gpt-4.1" (ocr/openai.js).
'use strict';

const { MOTORES_SOPORTADOS } = require('./extractors');

// Default = comportamiento actual del modo sombra (azure+gemini, sin árbitro
// externo). NO es la config deseada por Julio: es el punto de partida seguro.
const DEFAULT_BASE = ['azure', 'gemini_flash'];
const DEFAULT_ARBITRO = null;

// Config recomendada por Julio (2026-07-29) para cuando se despliegue: se deja
// documentada aquí y en el plan; se aplica poniendo los flags, no cambiando
// este default (que debe seguir siendo el comportamiento seguro de hoy).
const CONFIG_RECOMENDADA = {
  ocr_extraccion_v2_modelos_base: ['gemini_flash', 'mistral'],
  ocr_extraccion_v2_modelo_arbitro: 'openai',
};

const MIN_BASE = 1; // se permite 1 (sin arbitraje cruzado), pero se avisa
const MAX_BASE = 4; // más de 4 no aporta y multiplica coste/latencia

// Valores que significan "sin árbitro" en el flag (tolerante).
const SIN_ARBITRO = new Set([null, '', 'ninguno', 'none', 'off', false]);

/**
 * Resuelve la selección efectiva de motores a partir de features.json ya
 * parseado. Puro y determinista — no hace E/S. Devuelve siempre una selección
 * usable (nunca lanza).
 *
 * @param {object} [cfg] - features.json parseado
 * @returns {{ base: string[], arbitro: (string|null), avisos: string[], personalizada: boolean }}
 */
function resolverConfigModelos(cfg = {}) {
  const avisos = [];
  const raw = cfg.ocr_extraccion_v2_modelos_base;
  const personalizada = Array.isArray(raw) && raw.length > 0
    || cfg.ocr_extraccion_v2_modelo_arbitro !== undefined;

  // ── Base ────────────────────────────────────────────────────────────────
  let base = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_BASE;
  const vistos = new Set();
  const baseValida = [];
  for (const m of base) {
    if (!MOTORES_SOPORTADOS.includes(m)) { avisos.push(`motor base desconocido ignorado: ${m}`); continue; }
    if (vistos.has(m)) { avisos.push(`motor base duplicado ignorado: ${m}`); continue; }
    vistos.add(m);
    baseValida.push(m);
  }
  let baseFinal = baseValida;
  if (baseFinal.length === 0) {
    avisos.push('ningún motor base válido; se usa el default seguro');
    baseFinal = [...DEFAULT_BASE];
  }
  if (baseFinal.length > MAX_BASE) {
    avisos.push(`>${MAX_BASE} motores base; recortado a los ${MAX_BASE} primeros: ${baseFinal.slice(0, MAX_BASE).join(',')}`);
    baseFinal = baseFinal.slice(0, MAX_BASE);
  }
  if (baseFinal.length < 2) {
    avisos.push(`solo ${baseFinal.length} motor base: el árbitro por campo no puede cruzar candidatos (se recomienda 2-4)`);
  }

  // ── Árbitro ───────────────────────────────────────────────────────────────
  let arbitro = cfg.ocr_extraccion_v2_modelo_arbitro;
  if (arbitro === undefined) {
    arbitro = DEFAULT_ARBITRO;
  } else if (SIN_ARBITRO.has(arbitro)) {
    arbitro = null;
  } else if (!MOTORES_SOPORTADOS.includes(arbitro)) {
    avisos.push(`árbitro desconocido (${arbitro}) ignorado; se resuelve sin árbitro externo`);
    arbitro = null;
  }

  return { base: baseFinal, arbitro, avisos, personalizada: Boolean(personalizada) };
}

/**
 * True si la selección difiere del default seguro (base azure+gemini, sin
 * árbitro). El orquestador usa esto para tomar la ruta multi SOLO cuando Julio
 * ha configurado algo distinto — si no, sigue la ruta legacy ya probada.
 */
function esSeleccionPersonalizada(seleccion) {
  if (!seleccion) return false;
  const base = seleccion.base || [];
  const mismaBase = base.length === DEFAULT_BASE.length && base.every((m, i) => m === DEFAULT_BASE[i]);
  const mismoArbitro = (seleccion.arbitro || null) === DEFAULT_ARBITRO;
  return !(mismaBase && mismoArbitro);
}

module.exports = {
  resolverConfigModelos,
  esSeleccionPersonalizada,
  DEFAULT_BASE,
  DEFAULT_ARBITRO,
  CONFIG_RECOMENDADA,
  MIN_BASE,
  MAX_BASE,
};
