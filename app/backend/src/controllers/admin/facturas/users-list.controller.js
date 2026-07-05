// GET /api/admin/facturas/usuarios — distinct users que han subido facturas.
'use strict';

function makeAdminFacturasUsersListController({ uploadsRepo } = {}) {
  if (!uploadsRepo?.listDistinctUploaders) {
    throw new Error('admin facturas users-list.controller: "uploadsRepo.listDistinctUploaders" required');
  }

  return async function adminFacturasUsersListController(req, res) {
    const rows = await uploadsRepo.listDistinctUploaders();
    // Contrato alineado con el monolito: { usuarios } — el shape { items }
    // era exactamente el patrón de bug LL-002 (frontend espera `usuarios`).
    res.json({ usuarios: rows });
  };
}

module.exports = { makeAdminFacturasUsersListController };
