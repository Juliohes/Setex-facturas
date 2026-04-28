// DELETE /api/admin/facturas/:id — borra factura y fichero físico (best-effort).
'use strict';

const { safeUnlink } = require('../../../lib/file-cleanup');

function makeAdminFacturasDeleteController({
  uploadsRepo,
  auditService,
  storageBase = '/app/uploads',
  logger,
} = {}) {
  if (!uploadsRepo?.findById || !uploadsRepo?.deleteById) {
    throw new Error('admin facturas delete.controller: "uploadsRepo.findById|deleteById" required');
  }

  return async function adminFacturasDeleteController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

    const upload = await uploadsRepo.findById(id);
    if (!upload) return res.status(404).json({ error: 'No encontrado' });

    await uploadsRepo.deleteById(id);

    if (upload.file_path) {
      await safeUnlink(storageBase, upload.file_path, logger).catch(() => {});
    }

    await auditService?.log?.({
      action: 'ADMIN_FACTURA_DELETED',
      userId: req.user.userId,
      ip: req.ip,
      details: { factura_id: id, owner_user_id: upload.user_id },
    });

    res.json({ ok: true, id });
  };
}

module.exports = { makeAdminFacturasDeleteController };
