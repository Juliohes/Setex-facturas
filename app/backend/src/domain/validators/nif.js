// src/ocr/validateCIF.js
// Validación de CIF/NIF españoles: lista negra + formato.
// Defensa contra alucinaciones de GPT-4o que inventa CIFs falsos.
// IMPORTANTE: Solo rechaza por LISTA NEGRA o formato inválido.
// El dígito de control NO rechaza — solo genera warning (muchos CIFs
// reales, antiguos o de ejemplo no pasan el algoritmo).
'use strict';

const CIF_ENTITY_LETTERS = 'ABCDEFGHJNPQRSUVW';

// Letras de control NIF/NIE, indexadas por (número % 23). Fuente: Ministerio
// del Interior. Tabla oficial única para persona física (NIF) y NIE
// (sustituyendo X/Y/Z por 0/1/2 antes de aplicar el módulo).
const LETRAS_NIF = 'TRWAGMYFPDXBNJZSQVHLCKE';

// CIFs/NIFs placeholder que GPT-4o tiende a inventar (secuencias obvias)
const BLACKLIST = new Set([
  'A12345678', 'B12345678', 'C12345678', 'D12345678',
  'A00000000', 'B00000000', 'A11111111', 'B11111111',
  'A99999999', 'B99999999', 'A12345679', 'B12345679',
  'A22222222', 'A33333333', 'A44444444', 'A55555555',
  'A66666666', 'A77777777', 'A88888888',
  'B22222222', 'B33333333', 'B44444444', 'B55555555',
  'B66666666', 'B77777777', 'B88888888',
  'A23456789', 'B23456789', 'A87654321', 'B87654321',
  'A98765432', 'B98765432', 'B00000001', 'A00000001',
  '00000000T', '11111111H', '12345678Z', '99999999R',
  '00000001R', '22222222J', '33333333P', '44444444A',
  '55555555K', '66666666Q', '77777777B', '88888888Y',
  '98765432M', '87654321X',
]);

/**
 * Valida un identificador fiscal español (NIF, NIE o CIF).
 *
 * Retorna:
 *   { valid: true }                          → formato OK, no está en blacklist
 *   { valid: false, reason, severity }       → rechazado
 *     severity: 'blacklisted' → DEBE rechazarse (alucinación segura)
 *     severity: 'bad_format'  → formato incorrecto (no es CIF/NIF válido)
 */
function validateSpanishTaxId(taxId) {
  if (!taxId || typeof taxId !== 'string') {
    return { type: 'unknown', valid: false, severity: 'bad_format', reason: 'Valor vacío' };
  }
  const clean = taxId.toUpperCase().replace(/[\s\-\.]/g, '');

  // Comprobar lista negra PRIMERO (alucinaciones conocidas)
  if (BLACKLIST.has(clean)) {
    return { type: 'blacklisted', valid: false, severity: 'blacklisted', reason: 'CIF/NIF en lista negra (placeholder/inventado por IA)' };
  }

  // NIF: 8 dígitos + letra
  if (/^\d{8}[A-Z]$/.test(clean)) {
    return { type: 'NIF', valid: true };
  }

  // NIE: X/Y/Z + 7 dígitos + letra
  if (/^[XYZ]\d{7}[A-Z]$/.test(clean)) {
    return { type: 'NIE', valid: true };
  }

  // CIF: letra entidad + 7 dígitos + control (letra o dígito)
  if (/^[A-Z]\d{7}[A-Z0-9]$/.test(clean)) {
    // Solo verificar que la letra de entidad sea válida
    if (!CIF_ENTITY_LETTERS.includes(clean[0])) {
      return { type: 'CIF', valid: false, severity: 'bad_format', reason: `Letra '${clean[0]}' no válida para CIF` };
    }
    return { type: 'CIF', valid: true };
  }

  // No coincide con ningún formato conocido
  return { type: 'unknown', valid: false, severity: 'bad_format', reason: 'No coincide con formato NIF, NIE ni CIF' };
}

/**
 * Valida el dígito de control de un CIF español (algoritmo AEAT).
 * Solo aplica a CIFs (letra entidad + 7 dígitos + control).
 *
 * Retorna:
 *   true  → dígito de control correcto
 *   false → dígito de control incorrecto (probable error OCR)
 *   null  → no se puede determinar (NIF, NIE u otro formato)
 *
 * IMPORTANTE: Usar solo como señal de confianza, NO como rechazo duro.
 * Algunos CIFs históricos o especiales pueden no seguir el algoritmo estrictamente.
 */
function checkDigitCIF(taxId) {
  if (!taxId || typeof taxId !== 'string') return null;
  const clean = taxId.toUpperCase().replace(/[\s\-\.]/g, '');

  // Solo aplica a formato CIF: letra + 7 dígitos + control
  if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(clean)) return null;

  const digits = clean.slice(1, 8).split('').map(Number);
  const control = clean[8];

  // Posiciones IMPARES (1,3,5,7 → índices 0,2,4,6): DOBLAR, si resultado ≥10 sumar sus dígitos
  let sumOdd = 0;
  for (const i of [0, 2, 4, 6]) {
    const d = digits[i] * 2;
    sumOdd += d >= 10 ? Math.floor(d / 10) + (d % 10) : d;
  }

  // Posiciones PARES (2,4,6 → índices 1,3,5): SUMAR directamente
  const sumEven = digits[1] + digits[3] + digits[5];

  const unit = (sumOdd + sumEven) % 10;
  const checkNum = (10 - unit) % 10;
  const checkLetters = 'JABCDEFGHI';

  // N, P, Q, R, S, W → control es siempre letra (AEAT). Fix 2026-07-13: el set
  // anterior ('KPQS') tenía K de más (ni siquiera es letra de entidad CIF
  // válida, ver CIF_ENTITY_LETTERS en ocr/validateCIF.js) y le faltaban N, R
  // y W — causaba falsos "CIF no válido" en empresas extranjeras (N),
  // congregaciones religiosas (R) y establecimientos permanentes de entidad
  // no residente (W). Fuente: Ministerio del Interior / Wikipedia NIF.
  if ('NPQRSW'.includes(clean[0])) {
    return control === checkLetters[checkNum];
  }

  // Resto de entidades → control es dígito
  return control === String(checkNum);
}

/**
 * Valida el dígito de control de un NIF de persona física (algoritmo módulo 23).
 * Solo aplica a formato NIF (8 dígitos + letra).
 *
 * Retorna:
 *   true  → dígito de control correcto
 *   false → dígito de control incorrecto (probable error OCR)
 *   null  → no se puede determinar (no es formato NIF)
 *
 * IMPORTANTE: igual que checkDigitCIF, usar solo como señal de confianza,
 * NO como rechazo duro (2026-07-21: hasta ahora validateSpanishTaxId daba
 * por válido cualquier NIF con formato correcto sin comprobar la letra —
 * un solo dígito mal leído por el OCR pasaba desapercibido).
 */
function checkDigitNIF(taxId) {
  if (!taxId || typeof taxId !== 'string') return null;
  const clean = taxId.toUpperCase().replace(/[\s\-\.]/g, '');
  if (!/^\d{8}[A-Z]$/.test(clean)) return null;

  const numero = Number(clean.slice(0, 8));
  const control = clean[8];
  return control === LETRAS_NIF[numero % 23];
}

/**
 * Valida el dígito de control de un NIE (algoritmo módulo 23, sustituyendo
 * el prefijo X/Y/Z por 0/1/2 antes de calcular). Solo aplica a formato NIE.
 *
 * Retorna true / false / null con la misma semántica que checkDigitNIF.
 */
function checkDigitNIE(taxId) {
  if (!taxId || typeof taxId !== 'string') return null;
  const clean = taxId.toUpperCase().replace(/[\s\-\.]/g, '');
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(clean);
  if (!m) return null;

  const EQUIVALENCIA_PREFIJO = { X: '0', Y: '1', Z: '2' };
  const numero = Number(EQUIVALENCIA_PREFIJO[m[1]] + m[2]);
  const control = m[3];
  return control === LETRAS_NIF[numero % 23];
}

module.exports = { validateSpanishTaxId, checkDigitCIF, checkDigitNIF, checkDigitNIE };
