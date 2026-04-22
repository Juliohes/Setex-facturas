// POST /api/admin/companies/:id/reject — rechaza empresa pendiente (cuarentena).
'use strict';

function makeAdminCompaniesRejectController({
  clientCompaniesRepo,
  uploadsRepo,
  companyAuditLogRepo,
  auditService,
  logger,
} = {}) {
  if (!clientCompaniesRepo?.reject) {
    throw new Error('admin companies reject.controller: "clientCompaniesRepo.reject" required');
  }

  return async function adminCompaniesRejectController(req, res) {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body || {};
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

    const result = await clientCompaniesRepo.reject({
      id,
      adminId: req.user.userId,
      reason: reason ? String(reason).trim().slice(0, 1000) : null,
    });
    if (!result) return res.status(404).json({ error: 'Empresa no encontrada' });

    if (uploadsRepo?.attachCompanyByCif) {
      await uploadsRepo.attachCompanyByCif({
        companyId: id,
        cif: result.cif,
        newStatus: 'quarantine',
      }).catch((err) => logger?.warn?.('attachCompanyByCif reject fallo', { message: err.message }));
    }

    if (companyAuditLogRepo?.log) {
      await companyAuditLogRepo.log({
        companyId: id,
        adminId: req.user.userId,
        action: 'REJECTED',
        notes: reason,
      }).catch(() => {});
    }

    await auditService?.log?.({
      action: 'ADMIN_COMPANY_REJECTED',
      userId: req.user.userId,
      ip: req.ip,
      details: { company_id: id, cif: result.cif, reason },
    });

    res.json({ ok: true, company: result });
  };
}

module.exports = { makeAdminCompaniesRejectController };
