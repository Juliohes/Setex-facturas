// Counterparty resolver — dado un output OCR (nombre + NIF del emisor/receptor),
// decide si es una contraparte conocida del usuario (cache known_cifs + catálogo
// global) o nueva. Aplica Capa 3 del sistema anti-fallo de CIF/NIF.
'use strict';

function normalizeNombre(raw) {
  if (!raw) return '';
  return String(raw)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeCounterpartyResolverService({
  knownCifsRepo,
  companyCatalogRepo,
  logger,
} = {}) {
  if (!knownCifsRepo || !companyCatalogRepo) {
    throw new Error('counterparty-resolver: "knownCifsRepo" y "companyCatalogRepo" required');
  }

  async function resolve({ userId, ocrNombre, ocrNif }) {
    const nombreNorm = normalizeNombre(ocrNombre);
    const cleanNif = ocrNif ? String(ocrNif).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;

    // Capa 3: caché por usuario por nombre normalizado
    if (nombreNorm) {
      const cached = await knownCifsRepo.findByUserAndNombreNorm(userId, nombreNorm);
      if (cached && (!cleanNif || cached.proveedor_nif === cleanNif)) {
        logger?.debug?.('counterparty resolved from user cache', { userId, nif: cached.proveedor_nif });
        return {
          source: 'user_cache',
          nombre: ocrNombre,
          nombre_norm: nombreNorm,
          nif: cached.proveedor_nif,
          confirmations: cached.confirmations,
        };
      }
    }

    // Catálogo global por NIF
    if (cleanNif) {
      const global = await companyCatalogRepo.findByNif(cleanNif);
      if (global) {
        logger?.debug?.('counterparty resolved from global catalog', { nif: cleanNif });
        return {
          source: 'global_catalog',
          nombre: global.proveedor_nombre,
          nombre_norm: global.proveedor_nombre_norm,
          nif: cleanNif,
        };
      }
    }

    // Fuzzy match por nombre si hay
    if (nombreNorm) {
      const matches = await companyCatalogRepo.findByNombreFuzzy(nombreNorm, { threshold: 0.4 });
      if (matches.length > 0) {
        logger?.debug?.('counterparty fuzzy match', { matches: matches.length });
        return {
          source: 'fuzzy',
          suggestions: matches,
          nombre: ocrNombre,
          nombre_norm: nombreNorm,
          nif: cleanNif,
        };
      }
    }

    return {
      source: 'unknown',
      nombre: ocrNombre,
      nombre_norm: nombreNorm,
      nif: cleanNif,
    };
  }

  async function remember({ userId, nombreNorm, nif }) {
    if (!userId || !nombreNorm || !nif) return null;
    return knownCifsRepo.upsert({ userId, nombreNorm, nif });
  }

  return { resolve, remember, normalizeNombre };
}

module.exports = { makeCounterpartyResolverService };
