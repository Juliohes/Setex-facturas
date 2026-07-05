// Validación de coincidencia CIF emisor/receptor con el usuario logueado.
// Devuelve errores bloqueantes y warnings informativos para que el frontend
// pinte avisos y bloquee el botón Guardar antes de llamar a /upload-confirm.
// El backend repite esta misma validación en /upload-confirm (defensa en
// profundidad) para que un cliente HTTP no pueda saltarse las reglas.
'use strict';

function normalizeNif(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[\s\-.]/g, '')
    .replace(/^ES/, '');                 // intracomunitario "ESB12345678" → "B12345678"
}

function normalizeNombre(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')                                          // tildes fuera
    .replace(/[.,;:()"'`´]/g, '')                                           // puntuación fuera
    .replace(/\b(s\.?l\.?u?\.?|s\.?a\.?(?:\s|$)|s\.?coop\.?|c\.?b\.?|sociedad limitada(?: unipersonal)?|sociedad anonima)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateInvoiceCifs({ invoiceType, emisorNif, emisorNombre, receptorNif, receptorNombre, userNif, userNombre }) {
  const errors = [];
  const warnings = [];

  const eN = normalizeNif(emisorNif);
  const rN = normalizeNif(receptorNif);
  const uN = normalizeNif(userNif);

  // Regla 1 — emisor.cif === receptor.cif: nunca permitido
  if (eN && rN && eN === rN) {
    errors.push({
      field: 'both',
      code: 'SAME_EMISOR_RECEPTOR',
      message: 'El CIF del emisor y del receptor no pueden ser idénticos. Una empresa no puede emitirse facturas a sí misma.'
    });
  }

  // Regla 2 — el lado del usuario debe coincidir con su CIF.
  // Si el OCR no detectó CIF en el lado del usuario, no bloqueamos: el usuario
  // editará manualmente y la próxima evaluación cuadrará (o no).
  if (uN) {
    if (invoiceType === 'venta') {
      if (eN && eN !== uN) {
        errors.push({
          field: 'emisor',
          code: 'EMISOR_MISMATCH',
          message: `El CIF del emisor leído en la factura (${emisorNif}) no coincide con el de tu empresa (${userNif}). Esta factura no parece emitida por ti.`
        });
      }
      if (eN && eN === uN && userNombre && emisorNombre &&
          normalizeNombre(emisorNombre) !== normalizeNombre(userNombre)) {
        warnings.push({
          field: 'emisor',
          code: 'EMISOR_NAME_DIFFERS',
          message: `El nombre del emisor en la factura ("${emisorNombre}") difiere del registrado en tu empresa ("${userNombre}"). El CIF coincide, así que probablemente sea solo variación tipográfica.`
        });
      }
    } else if (invoiceType === 'compra') {
      if (rN && rN !== uN) {
        errors.push({
          field: 'receptor',
          code: 'RECEPTOR_MISMATCH',
          message: `El CIF del receptor leído en la factura (${receptorNif}) no coincide con el de tu empresa (${userNif}). Esta factura no parece dirigida a ti.`
        });
      }
      if (rN && rN === uN && userNombre && receptorNombre &&
          normalizeNombre(receptorNombre) !== normalizeNombre(userNombre)) {
        warnings.push({
          field: 'receptor',
          code: 'RECEPTOR_NAME_DIFFERS',
          message: `El nombre del receptor en la factura ("${receptorNombre}") difiere del registrado en tu empresa ("${userNombre}"). CIF coincide.`
        });
      }
    }
  }

  return { errors, warnings, blocking: errors.length > 0 };
}

module.exports = { normalizeNif, normalizeNombre, validateInvoiceCifs };
