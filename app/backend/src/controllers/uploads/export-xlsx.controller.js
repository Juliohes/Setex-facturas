// Export XLSX controller — genera un workbook con las facturas del usuario.
// El código pesado de composición queda en server.js hasta Round 15; este
// controller delega en un service Excel (cuando se extraiga) o en ExcelJS directo.
'use strict';

function makeExportXlsxController({ uploadsRepo, excelService, logger } = {}) {
  if (!uploadsRepo?.listByUserForExport) {
    throw new Error('export-xlsx.controller: "uploadsRepo.listByUserForExport" required');
  }

  return async function exportXlsxController(req, res) {
    const userId = req.user?.userId;
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);

    const rows = await uploadsRepo.listByUserForExport({ userId, days });

    if (excelService?.buildUserWorkbook) {
      const workbook = await excelService.buildUserWorkbook({ userId, rows });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="facturas-${userId}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    // Fallback mientras excelService no está cableado (Round 15 lo reemplaza)
    logger?.warn?.('export-xlsx.controller: excelService no disponible, devolviendo JSON');
    res.json({ warning: 'xlsx engine no cableado — devolviendo JSON', rows });
  };
}

module.exports = { makeExportXlsxController };
