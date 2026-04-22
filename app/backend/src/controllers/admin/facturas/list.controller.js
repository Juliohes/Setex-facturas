// GET /api/admin/facturas — listado admin con filtros opcionales por user_id,
// CIF, fecha, status. Devuelve payload listo para Tabulator del panel admin.
'use strict';

function makeAdminFacturasListController({ uploadsRepo, logger } = {}) {
  if (!uploadsRepo?.listForAdmin) {
    throw new Error('admin facturas list.controller: "uploadsRepo.listForAdmin" required');
  }

  return async function adminFacturasListController(req, res) {
    const { user_id, cif, fecha_desde, fecha_hasta, status, limit } = req.query;
    const items = await uploadsRepo.listForAdmin({
      userId: user_id ? parseInt(user_id, 10) : null,
      cif: cif ? String(cif).toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
      fechaDesde: fecha_desde || null,
      fechaHasta: fecha_hasta || null,
      status: status || null,
      limit: Math.min(parseInt(limit, 10) || 500, 2000),
    });
    res.json({ total: items.length, items });
  };
}

module.exports = { makeAdminFacturasListController };
