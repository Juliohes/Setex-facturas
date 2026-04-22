// Invoice persistence service — aplica el contrato de confirmación y persiste
// la factura. Centraliza la mutación en uploads: delega en uploadsRepo la query
// y registra auditoría. Servicio "thin" que orquesta repos.
'use strict';

function makeInvoicePersistService({
  uploadsRepo,
  deduplicationService,
  counterpartyResolver,
  knownCifsRepo,
  companyCatalogRepo,
  auditService,
  logger,
} = {}) {
  if (!uploadsRepo?.createOrUpdate) {
    throw new Error('invoice-persist.service: "uploadsRepo.createOrUpdate" required');
  }
  if (!deduplicationService) {
    throw new Error('invoice-persist.service: "deduplicationService" required');
  }

  async function confirm({ userId, ip, payload }) {
    const required = ['proveedor_nif', 'fecha_emision', 'total_factura'];
    const missing = required.filter((f) => !payload?.[f]);
    if (missing.length) {
      return { ok: false, reason: 'missing_fields', missing };
    }

    const dupe = await deduplicationService.check({
      userId,
      proveedorNif: payload.proveedor_nif,
      fechaEmision: payload.fecha_emision,
      totalFactura: payload.total_factura,
    });
    if (dupe.duplicate) {
      return { ok: false, reason: 'duplicate', existingId: dupe.existingId };
    }

    const saved = await uploadsRepo.createOrUpdate({ userId, payload });

    if (counterpartyResolver && payload.proveedor_nombre && payload.proveedor_nif) {
      const nombreNorm = counterpartyResolver.normalizeNombre(payload.proveedor_nombre);
      await counterpartyResolver.remember({
        userId,
        nombreNorm,
        nif: String(payload.proveedor_nif).toUpperCase(),
      }).catch((err) => logger?.warn?.('counterparty remember failed', { message: err.message }));

      if (companyCatalogRepo?.upsert) {
        await companyCatalogRepo.upsert({
          nombre: payload.proveedor_nombre,
          nombreNorm,
          nif: String(payload.proveedor_nif).toUpperCase(),
          createdBy: userId,
        }).catch((err) => logger?.warn?.('company-catalog upsert failed', { message: err.message }));
      }
    }

    await auditService?.log?.({
      action: 'UPLOAD_CONFIRMED',
      userId,
      ip,
      details: { uploadId: saved.id, proveedor_nif: payload.proveedor_nif },
    });

    return { ok: true, upload: saved };
  }

  return { confirm };
}

module.exports = { makeInvoicePersistService };
