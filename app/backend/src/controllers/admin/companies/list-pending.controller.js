// GET /api/admin/companies/pending — empresas pendientes de aprobación.
'use strict';

function makeAdminCompaniesPendingController({ clientCompaniesRepo } = {}) {
  if (!clientCompaniesRepo?.listPending) {
    throw new Error('admin companies pending.controller: "clientCompaniesRepo.listPending" required');
  }

  return async function adminCompaniesPendingController(req, res) {
    const items = await clientCompaniesRepo.listPending();
    res.json({ total: items.length, items });
  };
}

module.exports = { makeAdminCompaniesPendingController };
