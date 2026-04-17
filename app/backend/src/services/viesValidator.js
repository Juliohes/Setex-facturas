// src/services/viesValidator.js
// Valida CIF/NIF españoles contra el sistema VIES de la Unión Europea.
// API gratuita, sin autenticación, sin límite de uso moderado.
// IMPORTANTE: solo informacional — nunca bloquea el flujo principal.
'use strict';

const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/ES/vat';

/**
 * Valida un CIF español contra el registro VIES de la UE.
 * Solo aplica a CIFs (letra + 7 dígitos + control) — NIFs personales no están en VIES.
 * Timeout: 5 segundos. Devuelve null si la API no responde (nunca lanza excepción).
 *
 * @param {string} nif - CIF limpio sin guiones/espacios, ej: "B39793294"
 * @returns {Promise<{valid: boolean, nombre: string|null}|null>}
 */
async function validateVIES(nif) {
  if (!nif || typeof nif !== 'string') return null;
  const clean = nif.toUpperCase().replace(/[\s\-\.]/g, '');

  // Solo CIFs de entidades (letra entidad + 7 dígitos + control)
  if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(clean)) return null;

  try {
    const res = await fetch(`${VIES_URL}/${encodeURIComponent(clean)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) return null;

    const data = await res.json();
    return {
      valid: data.isValid === true,
      nombre: data.name ? data.name.trim().toUpperCase() : null,
    };
  } catch {
    // VIES caído o timeout — no bloquear flujo
    return null;
  }
}

module.exports = { validateVIES };
