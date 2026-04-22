// GET /api/admin/users — lista usuarios con contadores de facturas.
'use strict';

function makeAdminUsersListController({ usersRepo } = {}) {
  if (!usersRepo?.listAllWithCounts) {
    throw new Error('admin users list.controller: "usersRepo.listAllWithCounts" required');
  }

  return async function adminUsersListController(req, res) {
    const rows = await usersRepo.listAllWithCounts();
    res.json({ total: rows.length, items: rows });
  };
}

module.exports = { makeAdminUsersListController };
