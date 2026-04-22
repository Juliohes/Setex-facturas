// DELETE /api/admin/client-companies/:id — baja (soft por defecto: activa=false).
// Parámetro ?hard=true ejecuta DELETE real (solo si no hay uploads asociados).
'use strict';

function makeAdminClientCompaniesDeleteController({ clientCompaniesRepo, auditService, logger } = {}) {
  if (!clientCompaniesRepo?.softDelete) {
    throw new Error('admin client-companies delete.controller: "clientCompaniesRepo.softDelete" required');
  }

  return async function adminClientCompaniesDeleteController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

    const hard = req.query.hard === 'true';
    let result;
    if (hard && clientCompaniesRepo.hardDelete) {
      try {
        result = await clientCompaniesRepo.hardDelete(id);
      } catch (err) {
        if (err.code === '23503') {
          return res.status(409).json({
            error: 'No se puede borrar: hay facturas asociadas a esta empresa',
          });
        }
        throw err;
      }
    } else {
      result = await clientCompaniesRepo.softDelete(id);
    }

    if (!result) return res.status(404).json({ error: 'Empresa no encontrada' });

    await auditService?.log?.({
      action: hard ? 'ADMIN_COMPANY_HARD_DELETED' : 'ADMIN_COMPANY_DEACTIVATED',
      userId: req.user.userId,
      ip: req.ip,
      details: { company_id: id },
    });

    res.json({ ok: true, id, hard });
  };
}

module.exports = { makeAdminClientCompaniesDeleteController };
