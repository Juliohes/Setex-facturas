// GET /api/admin/catalog — lista del catálogo global de proveedores.
'use strict';

function makeAdminCatalogListController({ companyCatalogRepo } = {}) {
  if (!companyCatalogRepo?.listAll) {
    throw new Error('admin catalog list.controller: "companyCatalogRepo.listAll" required');
  }
  return async function adminCatalogListController(req, res) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const items = await companyCatalogRepo.listAll({ limit, offset });
    res.json({ total: items.length, items });
  };
}

module.exports = { makeAdminCatalogListController };
