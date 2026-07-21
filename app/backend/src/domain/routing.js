// src/domain/routing.js
// Routing determinista de 3 bandas (auto-aceptar / revisión humana / recaptura)
// para el pipeline de facturas. Módulo puro: sin I/O, sin llamadas a red ni BD.
//
// Contexto (2026-07-21): esta decisión ya existe hoy, pero entrelazada dentro
// del handler de POST /api/upload-preview en server.js (líneas ~1616-1853).
// Este módulo la extrae a una función pura y testeable, reutilizando los
// validadores deterministas existentes (checksums NIF/NIE/CIF + coherencia
// IVA/totales) y añadiendo las comprobaciones de campos obligatorios y fecha
// plausible que el prompt maestro de facturas pide como Fase A.
//
// IMPORTANTE — esto NO sustituye la lógica de server.js todavía: se introduce
// en modo shadow (calculado y registrado, sin cambiar la respuesta real al
// usuario) hasta validar que iguala o mejora la decisión actual con datos
// reales. El switch es una decisión explícita posterior de Julio.
'use strict';

const {
  validateSpanishTaxId,
  checkDigitCIF,
  checkDigitNIF,
  checkDigitNIE,
} = require('./validators/nif');
const { validateIVACoherencia } = require('./validators/iva');

const DECISION = Object.freeze({
  AUTO_ACEPTADA: 'auto_aceptada',
  REVISION_HUMANA: 'revision_humana',
  RECAPTURA: 'recaptura',
});

const SEVERIDAD = Object.freeze({ ERROR: 'error', AVISO: 'aviso' });

const UMBRAL_OCR_CRITICO = 0.90;
const ANTIGUEDAD_MAXIMA_DIAS = 6 * 365; // 6 años: prescripción fiscal amplia

/** Aplica el checksum correcto (NIF/NIE/CIF) según el tipo detectado por formato. */
function checkDigitGenerico(taxId) {
  const formato = validateSpanishTaxId(taxId);
  if (!formato.valid) return null; // el formato ya lo reporta otra regla
  if (formato.type === 'NIF') return checkDigitNIF(taxId);
  if (formato.type === 'NIE') return checkDigitNIE(taxId);
  if (formato.type === 'CIF') return checkDigitCIF(taxId);
  return null;
}

/** Regla: formato + checksum de los identificadores fiscales de proveedor y receptor. */
function validarIdentificadores(campos) {
  const incidencias = [];
  const partes = [
    ['proveedor', 'proveedor_nif'],
    ['receptor', 'receptor_nif'],
  ];
  for (const [rol, campo] of partes) {
    const valor = campos[campo];
    if (valor == null || String(valor).trim() === '') continue; // ausencia: regla de campos obligatorios
    const formato = validateSpanishTaxId(String(valor).trim());
    if (!formato.valid) {
      incidencias.push({
        regla: 'formato_identificador', campo, severidad: SEVERIDAD.ERROR,
        mensaje: `${rol}: ${formato.reason} ('${valor}')`,
      });
      continue;
    }
    const digitoOk = checkDigitGenerico(String(valor).trim());
    if (digitoOk === false) {
      incidencias.push({
        regla: 'checksum_identificador', campo, severidad: SEVERIDAD.ERROR,
        mensaje: `${rol}: dígito de control de '${valor}' no válido — probable error de lectura OCR`,
      });
    }
  }
  return incidencias;
}

/** Regla: cuadre aritmético de IVA/totales, delegando en el validador existente. */
function validarAritmetica(campos) {
  const incidencias = [];
  const resultado = validateIVACoherencia(campos);
  for (const mensaje of resultado.errors) {
    incidencias.push({ regla: 'cuadre_aritmetico', campo: 'iva_totales', severidad: SEVERIDAD.ERROR, mensaje });
  }
  for (const mensaje of resultado.warnings) {
    incidencias.push({ regla: 'cuadre_aritmetico', campo: 'iva_totales', severidad: SEVERIDAD.AVISO, mensaje });
  }
  return { incidencias, sugerencias: resultado.sugerencias || {} };
}

/** Regla: campos obligatorios de toda factura (nº factura, NIF proveedor, total). */
function validarCamposObligatorios(campos) {
  const incidencias = [];
  const obligatorios = {
    numero_factura: campos.numero_factura,
    proveedor_nif: campos.proveedor_nif,
    total: campos.total,
  };
  for (const [campo, valor] of Object.entries(obligatorios)) {
    if (valor == null || String(valor).trim() === '') {
      incidencias.push({
        regla: 'campos_obligatorios', campo, severidad: SEVERIDAD.ERROR,
        mensaje: `Campo obligatorio '${campo}' ausente o ilegible`,
      });
    }
  }
  return incidencias;
}

/**
 * Parsea fecha_emision al formato canónico de BD (DD/MM/YYYY, ver
 * server.js TO_DATE(...,'DD/MM/YYYY')), con fallback a ISO 8601, y
 * devuelve un Date o null si no es parseable.
 */
/**
 * Construye un Date UTC a partir de año/mes(1-12)/día y verifica que los
 * componentes no se "normalizaron" (p.ej. día 32 o mes 13) — Date.UTC() por
 * defecto hace roll-over silencioso a vez de rechazar fechas de calendario
 * inválidas.
 */
function construirFechaUTCEstricta(yyyy, mm, dd) {
  const fecha = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (Number.isNaN(fecha.getTime())) return null;
  const seNormalizo = (
    fecha.getUTCFullYear() !== yyyy
    || fecha.getUTCMonth() !== mm - 1
    || fecha.getUTCDate() !== dd
  );
  return seNormalizo ? null : fecha;
}

function parseFechaFactura(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const limpio = valor.trim();

  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(limpio);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return construirFechaUTCEstricta(Number(yyyy), Number(mm), Number(dd));
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpio);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return construirFechaUTCEstricta(Number(yyyy), Number(mm), Number(dd));
  }

  return null;
}

/** Regla: plausibilidad de la fecha de emisión (ni futura ni excesivamente antigua). */
function validarFechaPlausible(campos, ahora = new Date()) {
  const incidencias = [];
  const valor = campos.fecha_emision;
  if (valor == null || String(valor).trim() === '') return incidencias; // ausencia: regla de obligatorios

  const fecha = parseFechaFactura(String(valor));
  if (!fecha) {
    incidencias.push({
      regla: 'fecha_plausible', campo: 'fecha_emision', severidad: SEVERIDAD.AVISO,
      mensaje: `Fecha '${valor}' no reconocible en formato DD/MM/YYYY ni ISO 8601`,
    });
    return incidencias;
  }

  const hoyUTC = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  const diasDiferencia = (hoyUTC - fecha.getTime()) / 86_400_000;

  if (diasDiferencia < 0) {
    incidencias.push({
      regla: 'fecha_plausible', campo: 'fecha_emision', severidad: SEVERIDAD.ERROR,
      mensaje: `Fecha futura (${valor}): probable error de lectura`,
    });
  } else if (diasDiferencia > ANTIGUEDAD_MAXIMA_DIAS) {
    incidencias.push({
      regla: 'fecha_plausible', campo: 'fecha_emision', severidad: SEVERIDAD.AVISO,
      mensaje: `Fecha muy antigua (${valor}): confirmar`,
    });
  }
  return incidencias;
}

/**
 * Ejecuta todas las reglas deterministas sobre los campos de una factura.
 * @param {object} campos - shape LIVE de ocr/index.js (proveedor_nif, total, etc.)
 * @returns {{ incidencias: object[], sugerencias: object }}
 */
function validarFactura(campos) {
  const incidencias = [
    ...validarCamposObligatorios(campos),
    ...validarIdentificadores(campos),
    ...validarFechaPlausible(campos),
  ];
  const aritmetica = validarAritmetica(campos);
  return {
    incidencias: incidencias.concat(aritmetica.incidencias),
    sugerencias: aritmetica.sugerencias,
  };
}

/**
 * Decide la banda de routing para una factura ya extraída por el OCR.
 *
 * @param {object} campos - campos fusionados del OCR (shape de ocr/index.js)
 * @param {object} [opts]
 * @param {object} [opts.confianzaCampos] - confianza 0-1 por campo crítico si
 *   está disponible (hoy el pipeline solo emite `confidence` global, no por
 *   campo — este umbral queda listo para cuando exista confianza por campo)
 * @returns {{ decision: string, motivo: string, incidencias: object[], sugerencias: object }}
 */
function decidirRouting(campos, opts = {}) {
  if (!campos || campos.es_factura_valida === false) {
    return {
      decision: DECISION.RECAPTURA,
      motivo: (campos && campos.motivo_no_procesable) || 'Documento no reconocido como factura o ilegible.',
      incidencias: [],
      sugerencias: {},
    };
  }

  const { incidencias, sugerencias } = validarFactura(campos);
  const camposConError = [...new Set(
    incidencias.filter((i) => i.severidad === SEVERIDAD.ERROR).map((i) => i.campo)
  )];

  if (camposConError.length > 0) {
    return {
      decision: DECISION.REVISION_HUMANA,
      motivo: `Errores de validación en: ${camposConError.join(', ')}`,
      incidencias,
      sugerencias,
    };
  }

  const confianzaCampos = opts.confianzaCampos || {};
  const camposCriticos = ['total', 'cuota_iva', 'proveedor_nif'];
  const bajaConfianza = camposCriticos.some((c) => (
    typeof confianzaCampos[c] === 'number' && confianzaCampos[c] < UMBRAL_OCR_CRITICO
  ));
  if (bajaConfianza) {
    return {
      decision: DECISION.REVISION_HUMANA,
      motivo: 'Confianza OCR baja en campos críticos pese a validación correcta.',
      incidencias,
      sugerencias,
    };
  }

  return {
    decision: DECISION.AUTO_ACEPTADA,
    motivo: 'Checksums y cuadre aritmético correctos.',
    incidencias,
    sugerencias,
  };
}

module.exports = {
  DECISION,
  decidirRouting,
  validarFactura,
  validarIdentificadores,
  validarAritmetica,
  validarCamposObligatorios,
  validarFechaPlausible,
  parseFechaFactura,
};
