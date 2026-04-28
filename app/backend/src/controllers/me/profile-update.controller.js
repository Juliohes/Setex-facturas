// PUT /api/me/profile — actualiza company_nif/company_name del usuario.
// Valida formato CIF; la verificación AEAT contra algoritmo se hace aquí antes de persistir.
'use strict';

const NIF_PATTERN = /^[A-Z0-9][0-9]{7}[A-Z0-9]$/;

function makeProfileUpdateController({ usersRepo, auditService, logger } = {}) {
  if (!usersRepo?.updateCompany) throw new Error('profile-update.controller: "usersRepo.updateCompany" required');

  return async function profileUpdateController(req, res) {
    const userId = req.user?.userId;
    const { company_nif, company_name } = req.body || {};

    const cleanNif = company_nif ? String(company_nif).toUpperCase().replace(/[^A-Z0-9]/g, '') : undefined;
    if (cleanNif !== undefined && !NIF_PATTERN.test(cleanNif)) {
      return res.status(400).json({ error: 'Formato de CIF/NIF inválido' });
    }

    const updates = {};
    if (cleanNif !== undefined) updates.companyNif = cleanNif;
    if (company_name !== undefined) updates.companyName = String(company_name).trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Sin cambios' });
    }

    const result = await usersRepo.updateCompany(userId, updates);
    if (!result) return res.status(404).json({ error: 'Usuario no encontrado' });

    await auditService?.log?.({
      action: 'PROFILE_UPDATED',
      userId,
      details: { updates: Object.keys(updates) },
      ip: req.ip,
    });

    res.json({ ok: true, profile: result });
  };
}

module.exports = { makeProfileUpdateController };
