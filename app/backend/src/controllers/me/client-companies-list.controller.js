// GET /api/client-companies — lista las empresas cliente activas (usado por el
// frontend para autocomplete en formulario de factura).
'use strict';

function makeClientCompaniesListController({ clientCompaniesRepo } = {}) {
  if (!clientCompaniesRepo?.listActive) {
    throw new Error('client-companies-list.controller: "clientCompaniesRepo.listActive" required');
  }

  return async function clientCompaniesListController(req, res) {
    const rows = await clientCompaniesRepo.listActive();
    res.json({ items: rows.map((r) => ({ id: r.id, nombre: r.nombre, cif: r.cif })) });
  };
}

module.exports = { makeClientCompaniesListController };
