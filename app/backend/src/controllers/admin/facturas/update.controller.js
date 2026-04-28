// PUT /api/admin/facturas/:id — edición inline desde Tabulator.
// Recibe campos actualizables y recalcula agregados IVA si lineas_iva cambia.
'use strict';

function makeAdminFacturasUpdateController({ uploadsRepo, auditService, logger } = {}) {
  if (!uploadsRepo?.adminUpdate) {
    throw new Error('admin facturas update.controller: "uploadsRepo.adminUpdate" required');
  }

  return async function adminFacturasUpdateController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

    const updates = req.body || {};
    const allowed = [
      'proveedor_nombre', 'proveedor_nif', 'receptor_nombre', 'receptor_nif',
      'numero_factura', 'fecha_emision', 'base_imponible', 'cuota_iva',
      'irpf_porcentaje', 'cuota_irpf', 'total_factura', 'moneda',
      'invoice_type', 'lineas_iva', 'notas', 'upload_status',
    ];
    const safe = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) safe[key] = updates[key];
    }
    if (Object.keys(safe).length === 0) {
      return res.status(400).json({ error: 'Sin cambios válidos' });
    }

    const updated = await uploadsRepo.adminUpdate(id, safe);
    if (!updated) return res.status(404).json({ error: 'Factura no encontrada' });

    await auditService?.log?.({
      action: 'ADMIN_FACTURA_UPDATED',
      userId: req.user.userId,
      ip: req.ip,
      details: { factura_id: id, fields: Object.keys(safe) },
    });

    res.json({ ok: true, factura: updated });
  };
}

module.exports = { makeAdminFacturasUpdateController };
