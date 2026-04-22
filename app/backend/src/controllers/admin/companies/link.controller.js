// POST /api/admin/companies/:id/link — vincula empresa pendiente a otra existente
// (cuando un usuario se registra con una variante del CIF de una empresa ya activa).
'use strict';

function makeAdminCompaniesLinkController({
  clientCompaniesRepo,
  uploadsRepo,
  companyAuditLogRepo,
  auditService,
  logger,
} = {}) {
  if (!clientCompaniesRepo?.linkToExisting) {
    throw new Error('admin companies link.controller: "clientCompaniesRepo.linkToExisting" required');
  }

  return async function adminCompaniesLinkController(req, res) {
    const id = parseInt(req.params.id, 10);
    const { target_company_id } = req.body || {};
    const targetId = parseInt(target_company_id, 10);
    if (!Number.isInteger(id) || !Number.isInteger(targetId) || id === targetId) {
      return res.status(400).json({ error: 'id y target_company_id distintos requeridos' });
    }

    const result = await clientCompaniesRepo.linkToExisting({
      pendingId: id,
      targetId,
      adminId: req.user.userId,
    });
    if (!result) return res.status(404).json({ error: 'Empresa no encontrada' });

    if (uploadsRepo?.redirectToTargetCompany) {
      await uploadsRepo.redirectToTargetCompany({
        sourceCompanyId: id,
        targetCompanyId: targetId,
      }).catch((err) => logger?.warn?.('redirectToTargetCompany fallo', { message: err.message }));
    }

    if (companyAuditLogRepo?.log) {
      await companyAuditLogRepo.log({
        companyId: id,
        adminId: req.user.userId,
        action: 'LINKED',
        metadata: { target_company_id: targetId },
      }).catch(() => {});
    }

    await auditService?.log?.({
      action: 'ADMIN_COMPANY_LINKED',
      userId: req.user.userId,
      ip: req.ip,
      details: { pending_id: id, target_company_id: targetId },
    });

    res.json({ ok: true, linked: result });
  };
}

module.exports = { makeAdminCompaniesLinkController };
