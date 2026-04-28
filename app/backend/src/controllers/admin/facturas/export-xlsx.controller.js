// GET /api/admin/facturas/export.xlsx — export completo admin (todos los users).
'use strict';

function makeAdminFacturasExportXlsxController({ uploadsRepo, excelService, logger } = {}) {
  if (!uploadsRepo?.listAllForExport) {
    throw new Error('admin facturas export-xlsx.controller: "uploadsRepo.listAllForExport" required');
  }

  return async function adminFacturasExportXlsxController(req, res) {
    const { user_id, cif, fecha_desde, fecha_hasta } = req.query;
    const rows = await uploadsRepo.listAllForExport({
      userId: user_id ? parseInt(user_id, 10) : null,
      cif: cif ? String(cif).toUpperCase() : null,
      fechaDesde: fecha_desde || null,
      fechaHasta: fecha_hasta || null,
    });

    if (excelService?.buildAdminWorkbook) {
      const workbook = await excelService.buildAdminWorkbook({ rows });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="facturas-admin.xlsx"');
      await workbook.xlsx.write(res);
      return res.end();
    }

    logger?.warn?.('admin export-xlsx: excelService no disponible, devolviendo JSON');
    res.json({ warning: 'xlsx engine no cableado — devolviendo JSON', rows });
  };
}

module.exports = { makeAdminFacturasExportXlsxController };
