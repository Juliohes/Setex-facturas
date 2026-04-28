// Proveedor controller — GET /api/proveedor/:nif. Devuelve datos de contraparte
// cacheados por el usuario (known_cifs) o catálogo global.
'use strict';

function makeProveedorController({ knownCifsRepo, companyCatalogRepo } = {}) {
  if (!knownCifsRepo || !companyCatalogRepo) {
    throw new Error('proveedor.controller: repos required');
  }

  return async function proveedorController(req, res) {
    const userId = req.user?.userId;
    const nif = String(req.params.nif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!nif) return res.status(400).json({ error: 'NIF inválido' });

    const userCache = await knownCifsRepo.findByUserAndNif(userId, nif);
    if (userCache.length > 0) {
      return res.json({
        source: 'user_cache',
        nif,
        nombre: userCache[0].proveedor_nombre_norm,
        confirmations: userCache[0].confirmations,
      });
    }

    const catalog = await companyCatalogRepo.findByNif(nif);
    if (catalog) {
      return res.json({
        source: 'global_catalog',
        nif,
        nombre: catalog.proveedor_nombre,
      });
    }

    res.status(404).json({ source: 'unknown', nif, error: 'No encontrado' });
  };
}

module.exports = { makeProveedorController };
