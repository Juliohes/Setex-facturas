// GET /api/admin/companies/pending/count — counter para badge del panel admin.
'use strict';

function makeAdminCompaniesCountPendingController({ clientCompaniesRepo } = {}) {
  if (!clientCompaniesRepo?.countPending) {
    throw new Error('admin companies count-pending.controller: "clientCompaniesRepo.countPending" required');
  }

  return async function adminCompaniesCountPendingController(req, res) {
    const count = await clientCompaniesRepo.countPending();
    res.json({ count });
  };
}

module.exports = { makeAdminCompaniesCountPendingController };
