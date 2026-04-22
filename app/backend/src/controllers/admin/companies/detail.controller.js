// GET /api/admin/companies/:id/detail — ficha completa con sugerencias de matching.
'use strict';

function makeAdminCompaniesDetailController({ clientCompaniesRepo, companyAuditLogRepo } = {}) {
  if (!clientCompaniesRepo?.findById) {
    throw new Error('admin companies detail.controller: "clientCompaniesRepo.findById" required');
  }

  return async function adminCompaniesDetailController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
    const company = await clientCompaniesRepo.findById(id);
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });

    let auditLog = [];
    if (companyAuditLogRepo?.findByCompany) {
      auditLog = await companyAuditLogRepo.findByCompany(id, { limit: 20 });
    }

    res.json({ company, audit_log: auditLog });
  };
}

module.exports = { makeAdminCompaniesDetailController };
