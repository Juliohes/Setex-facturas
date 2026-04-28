// PUT /api/admin/client-companies/:id — edita empresa cliente.
'use strict';

function makeAdminClientCompaniesUpdateController({ clientCompaniesRepo, auditService } = {}) {
  if (!clientCompaniesRepo?.update) {
    throw new Error('admin client-companies update.controller: "clientCompaniesRepo.update" required');
  }

  return async function adminClientCompaniesUpdateController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

    const allowed = ['nombre', 'codigo_cliente', 'activa', 'notas'];
    const updates = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Sin cambios válidos' });
    }

    const updated = await clientCompaniesRepo.update(id, updates);
    if (!updated) return res.status(404).json({ error: 'Empresa no encontrada' });

    await auditService?.log?.({
      action: 'ADMIN_COMPANY_UPDATED',
      userId: req.user.userId,
      ip: req.ip,
      details: { company_id: id, fields: Object.keys(updates) },
    });
    res.json({ ok: true, company: updated });
  };
}

module.exports = { makeAdminClientCompaniesUpdateController };
