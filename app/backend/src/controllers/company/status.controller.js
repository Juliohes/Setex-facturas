// GET /api/company/status — estado de la empresa del usuario (sin requireActiveCompany).
// Útil para diferenciar "empresa pendiente" de "empresa activa" en el frontend antes
// de cargar features específicas.
'use strict';

function makeCompanyStatusController({ usersRepo, clientCompaniesRepo, logger } = {}) {
  if (!usersRepo?.findById || !clientCompaniesRepo?.findByCif) {
    throw new Error('company/status.controller: repos required');
  }

  return async function companyStatusController(req, res) {
    try {
      if (req.user?.is_admin === true) {
        return res.json({ status: 'active', is_admin: true });
      }
      const user = await usersRepo.findById(req.user.userId);
      const nif = user?.company_nif;
      if (!nif) return res.json({ status: 'no_company' });
      const cleanNif = String(nif).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const company = await clientCompaniesRepo.findByCif(cleanNif);
      if (!company) return res.json({ status: 'not_found', company_nif: cleanNif });
      if (company.pendiente || !company.activa) {
        return res.json({
          status: 'pending',
          company_name: company.nombre,
          company_nif: cleanNif,
        });
      }
      return res.json({
        status: 'active',
        company_name: company.nombre,
        company_nif: cleanNif,
      });
    } catch (err) {
      logger?.error?.('[company/status] DB error', { message: err.message });
      res.status(503).json({ error: 'Error al consultar estado de empresa' });
    }
  };
}

module.exports = { makeCompanyStatusController };
