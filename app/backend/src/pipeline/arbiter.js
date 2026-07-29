// src/pipeline/arbiter.js
// Fase 5 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: árbitro POR CAMPO —
// prohibido el "ganador global por documento" (regla 5.3 del prompt).
//
// Sustituye la fusión de hoy (ocr/index.js:compareOCRResults, prioridad FIJA
// por fuente — p.ej. "Azure siempre gana en importes", ver
// docs/INFORME-AUDITORIA-OCR.md §3.2) por una decisión basada en VALIDACIÓN:
//   a. Si ambos motores coinciden (tras normalizar) → aceptar, confianza alta.
//   b. Si discrepan → gana el valor que PASE la validación determinista
//      (checksum NIF/NIE/CIF de domain/validators/nif.js, cuadre aritmético
//      de domain/validators/iva.js — ambos YA EXISTÍAN antes de este prompt,
//      Fase 6 reutilizada tal cual).
//   c. Si ambos pasan o ninguno pasa → OpenAI como árbitro de desempate
//      (pipeline/extractors.js:ejecutarArbitro), SOLO si hay disputas.
//   d. Si persiste el conflicto → campo `en_disputa` con los candidatos,
//      la factura cae a revisión humana (Fase 8).
'use strict';

const { validateSpanishTaxId, checkDigitCIF, checkDigitNIF, checkDigitNIE } = require('../domain/validators/nif');
const { validateIVACoherencia } = require('../domain/validators/iva');
const { normalizarParaComparar } = require('../ocr/benchmark');
const { ejecutarArbitro } = require('./extractors');

// Campos de identificación fiscal (checksum aplicable por campo, de forma independiente).
const CAMPOS_IDENTIFICADOR = ['nif']; // usado internamente por resolverIdentificador, ver abajo
// Campos de texto simple sin validación determinista propia — si discrepan,
// solo el árbitro (o revisión humana) puede resolverlos.
const CAMPOS_SIMPLES = ['nombre', 'numero_factura', 'fecha_emision'];
// Bloque financiero: interdependiente (base×tipo=cuota, base+cuota-irpf=total)
// — se resuelve COMO GRUPO, nunca mezclando campos sueltos de candidatos
// distintos (evitaría un resultado internamente incoherente).
const CAMPOS_FINANCIEROS = ['base_imponible', 'iva_porcentaje', 'cuota_iva', 'total', 'retencion_irpf'];

function checkDigitGenerico(nif) {
  const formato = validateSpanishTaxId(nif);
  if (!formato.valid) return null;
  if (formato.type === 'NIF') return checkDigitNIF(nif);
  if (formato.type === 'NIE') return checkDigitNIE(nif);
  if (formato.type === 'CIF') return checkDigitCIF(nif);
  return null;
}

/** Compara dos valores tras normalizar (mayúsculas/trim/coma-punto). */
function coinciden(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return normalizarParaComparar(a) === normalizarParaComparar(b);
}

/**
 * Resuelve un NIF/NIE/CIF: si coinciden, aceptar; si discrepan, gana el que
 * tenga formato+checksum válido; si los dos o ninguno pasan, en_disputa.
 */
function resolverIdentificador(campo, valorA, fuenteA, valorB, fuenteB) {
  if (coinciden(valorA, valorB)) {
    return { campo, valor: valorA ?? valorB, fuente: valorA != null ? fuenteA : fuenteB, en_disputa: false, motivo: 'coinciden' };
  }
  const aValido = valorA != null && checkDigitGenerico(valorA) === true;
  const bValido = valorB != null && checkDigitGenerico(valorB) === true;

  if (aValido && !bValido) return { campo, valor: valorA, fuente: fuenteA, en_disputa: false, motivo: `checksum válido (${fuenteA}), ${fuenteB} inválido` };
  if (bValido && !aValido) return { campo, valor: valorB, fuente: fuenteB, en_disputa: false, motivo: `checksum válido (${fuenteB}), ${fuenteA} inválido` };
  return {
    campo, valor: null, fuente: null, en_disputa: true,
    candidatos: { [fuenteA]: valorA, [fuenteB]: valorB },
    motivo: aValido && bValido ? 'ambos checksums válidos pero discrepan' : 'ningún checksum válido',
  };
}

/** Campos de texto sin validación propia: solo se acepta si coinciden. */
function resolverCampoSimple(campo, valorA, fuenteA, valorB, fuenteB) {
  if (coinciden(valorA, valorB)) {
    return { campo, valor: valorA ?? valorB, fuente: valorA != null ? fuenteA : fuenteB, en_disputa: false, motivo: 'coinciden' };
  }
  // Un motor que no encontró nada (null) no está "en desacuerdo" con el que sí
  // encontró un valor concreto -- es una ausencia, no una discrepancia. Antes
  // esto se trataba igual que dos valores distintos y se mandaba a arbitraje
  // (o quedaba en null si el árbitro tampoco coincidía exactamente), perdiendo
  // el único dato disponible. Incidente real: Azure DI (prebuilt-invoice) no
  // reconoce numero_factura con formato "26#XXXX" y devuelve null sistemáticamente
  // mientras Gemini sí lo lee -- facturas #5/#16/#19 del replay 2026-07-29.
  if (valorA == null && valorB != null) {
    return { campo, valor: valorB, fuente: fuenteB, en_disputa: false, motivo: `${fuenteA} no encontró el campo, se acepta ${fuenteB}` };
  }
  if (valorB == null && valorA != null) {
    return { campo, valor: valorA, fuente: fuenteA, en_disputa: false, motivo: `${fuenteB} no encontró el campo, se acepta ${fuenteA}` };
  }
  return {
    campo, valor: null, fuente: null, en_disputa: true,
    candidatos: { [fuenteA]: valorA, [fuenteB]: valorB },
    motivo: 'discrepan, sin validación determinista propia',
  };
}

/**
 * El esquema canónico guarda base/tipo/cuota DENTRO de `lineas_iva[]`, no
 * como campos planos — esta función los "aplana" para poder comparar campo
 * a campo y para alimentar validateIVACoherencia (que sí espera el shape
 * plano de siempre). Con más de un tramo, base/tipo/cuota agregados quedan
 * null (se validan vía la suma de líneas, Comprobación 3 de
 * validateIVACoherencia) — solo total/retención se comparan sueltos.
 */
function aplanarFinanciero(canonico) {
  const lineas = canonico.lineas_iva || [];
  const unaSolaLinea = lineas.length === 1 ? lineas[0] : null;
  return {
    base_imponible: unaSolaLinea ? (unaSolaLinea.base ?? null) : null,
    iva_porcentaje: unaSolaLinea ? (unaSolaLinea.tipo ?? null) : null,
    cuota_iva: unaSolaLinea ? (unaSolaLinea.cuota ?? null) : null,
    total: canonico.total ?? null,
    retencion_irpf: canonico.retencion_irpf ?? null,
    lineas_iva: lineas.length > 1 ? lineas.map((l) => ({ base: l.base, cuota: l.cuota, porcentaje: l.tipo })) : [],
  };
}

/** Shape que espera validateIVACoherencia (cuota_irpf, no retencion_irpf). */
function aPlanoParaValidar(plano) {
  return { ...plano, cuota_irpf: plano.retencion_irpf };
}

/**
 * Resuelve el bloque financiero completo como grupo: valida cada candidato
 * INTERNAMENTE coherente (validateIVACoherencia, ya existente) y gana el que
 * tenga menos errores. Si empatan (mismo nº de errores, incl. 0-0), cada
 * campo financiero que discrepe queda en_disputa.
 */
function resolverBloqueFinanciero(candidatoA, fuenteA, candidatoB, fuenteB) {
  const planoA = aplanarFinanciero(candidatoA);
  const planoB = aplanarFinanciero(candidatoB);
  const resultado = {};

  const todosCoinciden = CAMPOS_FINANCIEROS.every((c) => coinciden(planoA[c], planoB[c]));
  if (todosCoinciden) {
    for (const campo of CAMPOS_FINANCIEROS) {
      resultado[campo] = { campo, valor: planoA[campo], fuente: fuenteA, en_disputa: false, motivo: 'coinciden' };
    }
    return resultado;
  }

  const validA = validateIVACoherencia(aPlanoParaValidar(planoA));
  const validB = validateIVACoherencia(aPlanoParaValidar(planoB));
  const ganador = validA.errors.length < validB.errors.length ? { plano: planoA, fuente: fuenteA }
    : validB.errors.length < validA.errors.length ? { plano: planoB, fuente: fuenteB }
    : null; // empate (incl. ambos 0 errores pero discrepan) → en_disputa campo a campo

  for (const campo of CAMPOS_FINANCIEROS) {
    const valorA = planoA[campo];
    const valorB = planoB[campo];
    if (coinciden(valorA, valorB)) {
      resultado[campo] = { campo, valor: valorA ?? valorB, fuente: valorA != null ? fuenteA : fuenteB, en_disputa: false, motivo: 'coinciden' };
    } else if (ganador) {
      resultado[campo] = {
        campo, valor: ganador.plano[campo], fuente: ganador.fuente, en_disputa: false,
        motivo: `bloque financiero de ${ganador.fuente} más coherente (${ganador.fuente === fuenteA ? validA.errors.length : validB.errors.length} errores vs ${ganador.fuente === fuenteA ? validB.errors.length : validA.errors.length})`,
      };
    } else {
      resultado[campo] = {
        campo, valor: null, fuente: null, en_disputa: true,
        candidatos: { [fuenteA]: valorA, [fuenteB]: valorB },
        motivo: 'ambos bloques financieros empatan en coherencia (o ambos con errores) y discrepan en este campo',
      };
    }
  }
  return resultado;
}

/**
 * Árbitro principal: recibe los dos candidatos canónicos (Fase 4,
 * pipeline/schema.js) y devuelve la factura fusionada CAMPO A CAMPO +
 * lista de disputas. Si hay disputas y se pasa `arbitroFn` (o se usa el
 * árbitro por defecto vía pipeline/extractors.js), se invoca UNA VEZ sobre
 * la imagen completa y su valor desempata cualquier campo en disputa donde
 * coincida con uno de los dos candidatos originales — si el árbitro aporta
 * un tercer valor distinto, la disputa persiste (cae a revisión humana).
 *
 * @param {object} resultadoA - { motor, ok, campos } de ejecutarExtractor (p.ej. azure)
 * @param {object} resultadoB - { motor, ok, campos } de ejecutarExtractor (p.ej. gemini_flash)
 * @param {{filePath: string, mimeType: string, context: object, cfg: object, logger: object, motorArbitro: string}} [opts]
 */
async function arbitrarFactura(resultadoA, resultadoB, opts = {}) {
  // Si un motor falló del todo, no hay nada que arbitrar — el otro "gana" sin disputa.
  if (!resultadoA.ok && !resultadoB.ok) {
    return { campos: null, disputas: [], motivo: 'ambos motores fallaron', sin_resultado: true };
  }
  if (!resultadoA.ok) return { campos: resultadoB.campos, disputas: [], motivo: `${resultadoA.motor} falló (${resultadoA.error}) — usando ${resultadoB.motor} sin arbitraje` };
  if (!resultadoB.ok) return { campos: resultadoA.campos, disputas: [], motivo: `${resultadoB.motor} falló (${resultadoB.error}) — usando ${resultadoA.motor} sin arbitraje` };

  const A = resultadoA.campos, B = resultadoB.campos, fuenteA = resultadoA.motor, fuenteB = resultadoB.motor;
  const decisiones = {};

  decisiones['emisor.nif'] = resolverIdentificador('emisor.nif', A.emisor.nif, fuenteA, B.emisor.nif, fuenteB);
  decisiones['receptor.nif'] = resolverIdentificador('receptor.nif', A.receptor.nif, fuenteA, B.receptor.nif, fuenteB);
  decisiones['emisor.nombre'] = resolverCampoSimple('emisor.nombre', A.emisor.nombre, fuenteA, B.emisor.nombre, fuenteB);
  decisiones['receptor.nombre'] = resolverCampoSimple('receptor.nombre', A.receptor.nombre, fuenteA, B.receptor.nombre, fuenteB);
  decisiones['numero_factura'] = resolverCampoSimple('numero_factura', A.numero_factura, fuenteA, B.numero_factura, fuenteB);
  decisiones['fecha_emision'] = resolverCampoSimple('fecha_emision', A.fecha_emision, fuenteA, B.fecha_emision, fuenteB);
  Object.assign(decisiones, resolverBloqueFinanciero(A, fuenteA, B, fuenteB));

  let disputas = Object.values(decisiones).filter((d) => d.en_disputa);

  if (disputas.length > 0 && opts.filePath) {
    const motorArbitro = opts.motorArbitro || 'openai';
    const resArbitro = await ejecutarArbitro(motorArbitro, opts.filePath, opts.mimeType, opts.context || {}, opts.cfg || {}, opts.logger);
    if (resArbitro.ok) {
      const plano = aplanarCanonico(resArbitro.campos);
      for (const d of disputas) {
        const valorArbitro = plano[d.campo];
        if (valorArbitro == null) continue;
        if (coinciden(valorArbitro, d.candidatos[fuenteA])) {
          decisiones[d.campo] = { campo: d.campo, valor: d.candidatos[fuenteA], fuente: fuenteA, en_disputa: false, motivo: `desempatado por ${motorArbitro}, coincide con ${fuenteA}` };
        } else if (coinciden(valorArbitro, d.candidatos[fuenteB])) {
          decisiones[d.campo] = { campo: d.campo, valor: d.candidatos[fuenteB], fuente: fuenteB, en_disputa: false, motivo: `desempatado por ${motorArbitro}, coincide con ${fuenteB}` };
        }
        // si el árbitro aporta un 3er valor distinto: la disputa persiste tal cual (regla 5.2.d)
      }
      disputas = Object.values(decisiones).filter((d) => d.en_disputa);
    }
  }

  const campos = reconstruirCanonico(decisiones, A, B);
  return { campos, disputas, decisiones, motivo: disputas.length ? `${disputas.length} campo(s) en disputa` : 'resuelto sin disputas' };
}

/** Aplana un canónico a las mismas claves que usan las decisiones (para comparar contra el árbitro). */
function aplanarCanonico(canonico) {
  const primeraLinea = (canonico.lineas_iva || [])[0] || {};
  return {
    'emisor.nif': canonico.emisor?.nif, 'receptor.nif': canonico.receptor?.nif,
    'emisor.nombre': canonico.emisor?.nombre, 'receptor.nombre': canonico.receptor?.nombre,
    numero_factura: canonico.numero_factura, fecha_emision: canonico.fecha_emision,
    base_imponible: primeraLinea.base, iva_porcentaje: primeraLinea.tipo, cuota_iva: primeraLinea.cuota,
    total: canonico.total, retencion_irpf: canonico.retencion_irpf,
  };
}

/** Reconstruye el shape canónico completo a partir de las decisiones campo a campo. */
function reconstruirCanonico(decisiones, A, B) {
  return {
    emisor: { nif: decisiones['emisor.nif'].valor, nombre: decisiones['emisor.nombre'].valor },
    receptor: { nif: decisiones['receptor.nif'].valor, nombre: decisiones['receptor.nombre'].valor },
    numero_factura: decisiones['numero_factura'].valor,
    fecha_emision: decisiones['fecha_emision'].valor,
    lineas_iva: decisiones['base_imponible'].en_disputa ? (A.lineas_iva.length ? A.lineas_iva : B.lineas_iva) : [{
      base: decisiones['base_imponible'].valor, tipo: decisiones['iva_porcentaje'].valor, cuota: decisiones['cuota_iva'].valor,
    }],
    retencion_irpf: decisiones['retencion_irpf'].valor,
    total: decisiones['total'].valor,
    moneda: A.moneda || B.moneda || 'EUR',
    es_factura_valida: A.es_factura_valida !== false && B.es_factura_valida !== false,
  };
}

// Campos de identificación fiscal corregibles por un humano vía PATCH.
const CAMPOS_NIF_CORREGIBLES = ['emisor.nif', 'receptor.nif'];

/**
 * Valida una corrección humana ANTES de aceptarla (gap 1 del plan de cierre
 * sobre el pipeline v2 existente, 2026-07-28). Hasta ahora el PATCH de
 * corrección guardaba cualquier valor a ciegas. Reutiliza EXACTAMENTE la
 * misma validación determinista que ya usa el árbitro al fusionar
 * (checksum NIF/CIF, cuadre aritmético) — nunca inventa una segunda regla.
 *
 * @param {string} campo - clave aplanada (ver aplanarCanonico), p.ej. 'emisor.nif' o 'total'
 * @param {*} valorCorregido
 * @param {object} canonico - campos_canonicos actuales de la extracción
 * @returns {{ok: true} | {ok: false, motivo: string}}
 */
function validarCorreccionHumana(campo, valorCorregido, canonico) {
  if (CAMPOS_NIF_CORREGIBLES.includes(campo)) {
    const formato = validateSpanishTaxId(String(valorCorregido));
    if (!formato.valid) {
      return { ok: false, motivo: formato.reason || 'Formato de NIF/CIF no válido' };
    }
    if (formato.type === 'CIF' && checkDigitCIF(valorCorregido) === false) {
      return { ok: false, motivo: 'Dígito de control del CIF incorrecto' };
    }
    return { ok: true };
  }

  if (CAMPOS_FINANCIEROS.includes(campo)) {
    const planoActual = aplanarCanonico(canonico);
    const planoPropuesto = { ...planoActual, [campo]: valorCorregido };
    const { errors } = validateIVACoherencia(aPlanoParaValidar(planoPropuesto));
    if (errors.length > 0) {
      return { ok: false, motivo: errors[0] };
    }
    return { ok: true };
  }

  return { ok: true };
}

module.exports = {
  arbitrarFactura,
  resolverIdentificador,
  resolverCampoSimple,
  resolverBloqueFinanciero,
  coinciden,
  CAMPOS_SIMPLES,
  CAMPOS_FINANCIEROS,
  // 2026-07-28 (gap 1 del plan de cierre): reutilizadas por el PATCH de
  // corrección humana en server.js para validar contra la misma vista
  // aplanada que ya usa el árbitro, sin duplicar la lógica de aplanado.
  aplanarCanonico,
  aPlanoParaValidar,
  validarCorreccionHumana,
};
