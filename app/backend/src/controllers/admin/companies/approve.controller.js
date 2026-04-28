// POST /api/admin/companies/:id/approve — aprueba empresa pendiente.
// Asigna activa=true + pendiente=false + reviewed_by/at. Incluye actualización
// de uploads para asignar client_company_id (fix 2026-04-21 post-presentación).
'use strict';

function makeAdminCompaniesApproveController({
  clientCompaniesRepo,
  uploadsRepo,
  companyAuditLogRepo,
  auditService,
  logger,
} = {}) {
  if (!clientCompaniesRepo?.approve) {
    throw new Error('admin companies approve.controller: "clientCompaniesRepo.approve" required');
  }

  return async function adminCompaniesApproveController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

    const result = await clientCompaniesRepo.approve({ id, adminId: req.user.userId });
    if (!result) return res.status(404).json({ error: 'Empresa no encontrada o ya activa' });

    if (uploadsRepo?.attachCompanyByCif) {
      await uploadsRepo.attachCompanyByCif({
        companyId: id,
        cif: result.cif,
        newStatus: 'active',
      }).catch((err) => logger?.warn?.('attachCompanyByCif fallo', { message: err.message }));
    }

    if (companyAuditLogRepo?.log) {
      await companyAuditLogRepo.log({
        companyId: id,
        adminId: req.user.userId,
        action: 'APPROVED',
      }).catch(() => {});
    }

    await auditService?.log?.({
      action: 'ADMIN_COMPANY_APPROVED',
      userId: req.user.userId,
      ip: req.ip,
      details: { company_id: id, cif: result.cif },
    });

    res.json({ ok: true, company: result, company_id: id });
  };
}

module.exports = { makeAdminCompaniesApproveController };
