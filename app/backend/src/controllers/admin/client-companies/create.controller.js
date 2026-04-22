// POST /api/admin/client-companies — alta manual de empresa cliente.
'use strict';

const NIF_PATTERN = /^[A-Z0-9][0-9]{7}[A-Z0-9]$/;

function makeAdminClientCompaniesCreateController({ clientCompaniesRepo, auditService } = {}) {
  if (!clientCompaniesRepo?.create) {
    throw new Error('admin client-companies create.controller: "clientCompaniesRepo.create" required');
  }

  return async function adminClientCompaniesCreateController(req, res) {
    const { nombre, cif, codigo_cliente, notas } = req.body || {};
    if (!nombre || !cif) return res.status(400).json({ error: 'nombre y cif obligatorios' });
    const cleanCif = String(cif).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!NIF_PATTERN.test(cleanCif)) {
      return res.status(400).json({ error: 'CIF con formato inválido' });
    }

    try {
      const created = await clientCompaniesRepo.create({
        nombre: String(nombre).trim(),
        cif: cleanCif,
        codigo_cliente: codigo_cliente ? String(codigo_cliente).trim() : null,
        notas: notas ? String(notas).trim() : null,
      });
      await auditService?.log?.({
        action: 'ADMIN_COMPANY_CREATED',
        userId: req.user.userId,
        ip: req.ip,
        details: { company_id: created.id, cif: cleanCif },
      });
      res.status(201).json({ ok: true, company: created });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una empresa con ese CIF o codigo_cliente' });
      }
      throw err;
    }
  };
}

module.exports = { makeAdminClientCompaniesCreateController };
