// Deduplication service — detecta facturas duplicadas por combinación
// (user_id, proveedor_nif, fecha_emision, total_factura). El índice único
// en BD ya lo enforce; este service centraliza la lógica de pre-check.
'use strict';

function normalizeTotal(raw) {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

function makeDeduplicationService({ uploadsRepo, logger } = {}) {
  if (!uploadsRepo?.findDuplicate) {
    throw new Error('deduplication.service: "uploadsRepo.findDuplicate" required');
  }

  async function check({ userId, proveedorNif, fechaEmision, totalFactura }) {
    if (!userId || !proveedorNif || !fechaEmision || !totalFactura) {
      return { duplicate: false, reason: 'missing_fields' };
    }
    const existing = await uploadsRepo.findDuplicate({
      userId,
      proveedorNif: String(proveedorNif).toUpperCase().replace(/[^A-Z0-9]/g, ''),
      fechaEmision: normalizeDate(fechaEmision),
      totalFactura: normalizeTotal(totalFactura),
    });
    if (existing) {
      logger?.info?.('deduplication: duplicate detected', {
        userId,
        existingId: existing.id,
      });
      return { duplicate: true, existingId: existing.id, uploadedAt: existing.uploaded_at };
    }
    return { duplicate: false };
  }

  return { check, normalizeDate, normalizeTotal };
}

module.exports = { makeDeduplicationService };
