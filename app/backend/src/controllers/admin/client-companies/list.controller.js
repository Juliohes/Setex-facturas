// GET /api/admin/client-companies — catálogo admin completo (activas + inactivas).
'use strict';

function makeAdminClientCompaniesListController({ clientCompaniesRepo } = {}) {
  if (!clientCompaniesRepo?.listAllForAdmin) {
    throw new Error('admin client-companies list.controller: "clientCompaniesRepo.listAllForAdmin" required');
  }

  return async function adminClientCompaniesListController(req, res) {
    const items = await clientCompaniesRepo.listAllForAdmin();
    res.json({ total: items.length, items });
  };
}

module.exports = { makeAdminClientCompaniesListController };
