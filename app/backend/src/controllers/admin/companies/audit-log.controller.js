// GET /api/admin/companies/:id/audit-log — historial de acciones sobre una empresa.
'use strict';

function makeAdminCompaniesAuditLogController({ companyAuditLogRepo } = {}) {
  if (!companyAuditLogRepo?.findByCompany) {
    throw new Error('admin companies audit-log.controller: "companyAuditLogRepo.findByCompany" required');
  }

  return async function adminCompaniesAuditLogController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const items = await companyAuditLogRepo.findByCompany(id, { limit });
    res.json({ total: items.length, items });
  };
}

module.exports = { makeAdminCompaniesAuditLogController };
