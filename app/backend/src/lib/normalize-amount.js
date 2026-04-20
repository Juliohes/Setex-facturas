// Normalización de importes en formato español (1.234,56) o inglés (1,234.56)
// a número JavaScript. Extraído del orquestador OCR.
'use strict';

function normalizeToFloat(str) {
  if (!str) return null;
  let s = String(str).trim().replace(/[€$\s]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    // Formato mixto: el separador decimal es el último
    return s.lastIndexOf(',') > s.lastIndexOf('.')
      ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
      : parseFloat(s.replace(/,/g, ''));
  }
  if (s.includes(',')) {
    // Solo coma: si hay 3 dígitos después es separador de miles, si no es decimal
    const after = s.split(',').pop();
    return after?.length === 3
      ? parseFloat(s.replace(/,/g, ''))
      : parseFloat(s.replace(',', '.'));
  }
  return parseFloat(s);
}

function amountsAgree(a, b, tolerance = 0.02) {
  const fa = normalizeToFloat(a);
  const fb = normalizeToFloat(b);
  if (fa == null || fb == null) return true;
  if (fa === 0 && fb === 0) return true;
  const max = Math.max(Math.abs(fa), Math.abs(fb));
  if (max === 0) return true;
  return Math.abs(fa - fb) / max < tolerance;
}

function toSpanishAmount(amount) {
  if (amount == null || isNaN(amount)) return null;
  const fixed = Number(amount).toFixed(2);
  const [int, dec] = fixed.split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFormatted},${dec}`;
}

module.exports = { normalizeToFloat, amountsAgree, toSpanishAmount };
