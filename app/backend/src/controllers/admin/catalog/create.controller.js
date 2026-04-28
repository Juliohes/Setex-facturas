// POST /api/admin/catalog — alta manual en catálogo global.
'use strict';

const NIF_PATTERN = /^[A-Z0-9][0-9]{7}[A-Z0-9]$/;

function makeAdminCatalogCreateController({ companyCatalogRepo, auditService } = {}) {
  if (!companyCatalogRepo?.upsert) {
    throw new Error('admin catalog create.controller: "companyCatalogRepo.upsert" required');
  }
  return async function adminCatalogCreateController(req, res) {
    const { proveedor_nombre, proveedor_nif, notas } = req.body || {};
    if (!proveedor_nombre || !proveedor_nif) {
      return res.status(400).json({ error: 'proveedor_nombre y proveedor_nif obligatorios' });
    }
    const cleanNif = String(proveedor_nif).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!NIF_PATTERN.test(cleanNif)) return res.status(400).json({ error: 'NIF inválido' });

    const nombreNorm = String(proveedor_nombre)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const result = await companyCatalogRepo.upsert({
      nombre: String(proveedor_nombre).trim(),
      nombreNorm,
      nif: cleanNif,
      createdBy: req.user.userId,
      notas: notas ? String(notas).slice(0, 500) : null,
    });

    await auditService?.log?.({
      action: 'ADMIN_CATALOG_UPSERTED',
      userId: req.user.userId,
      ip: req.ip,
      details: { catalog_id: result.id, nif: cleanNif },
    });

    res.status(201).json({ ok: true, entry: result });
  };
}

module.exports = { makeAdminCatalogCreateController };
