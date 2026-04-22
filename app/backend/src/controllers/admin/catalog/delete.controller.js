// DELETE /api/admin/catalog/:id — borra entrada del catálogo global.
'use strict';

function makeAdminCatalogDeleteController({ companyCatalogRepo, auditService } = {}) {
  if (!companyCatalogRepo?.deleteById) {
    throw new Error('admin catalog delete.controller: "companyCatalogRepo.deleteById" required');
  }
  return async function adminCatalogDeleteController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

    const rowCount = await companyCatalogRepo.deleteById(id);
    if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });

    await auditService?.log?.({
      action: 'ADMIN_CATALOG_DELETED',
      userId: req.user.userId,
      ip: req.ip,
      details: { catalog_id: id },
    });

    res.json({ ok: true, id });
  };
}

module.exports = { makeAdminCatalogDeleteController };
