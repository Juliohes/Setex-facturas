// Confirm controller — recibe preview_id + correcciones del usuario, valida,
// persiste en uploads table vía invoice-persist service. Reemplaza la
// implementación inline de server.js /api/upload-confirm (~200 líneas).
'use strict';

function makeConfirmController({ invoicePersistService, cache, logger } = {}) {
  if (!invoicePersistService) throw new Error('confirm.controller: "invoicePersistService" required');
  if (!cache) throw new Error('confirm.controller: "cache" required');

  return async function confirmController(req, res) {
    const userId = req.user?.userId;
    const { preview_id, invoice } = req.body;

    if (!preview_id || !invoice) {
      return res.status(400).json({ error: 'preview_id e invoice son obligatorios' });
    }

    const raw = await cache.get(preview_id);
    if (!raw) {
      return res.status(410).json({ error: 'Preview expirado. Por favor vuelve a subir el fichero.' });
    }

    let preview;
    try {
      preview = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Preview corrupto' });
    }

    const payload = {
      ...preview.invoice,
      ...invoice,
      proveedor_nif: (invoice.emisor_nif || preview.invoice.emisor_nif || '').toUpperCase(),
      proveedor_nombre: invoice.emisor_nombre || preview.invoice.emisor_nombre,
      fecha_emision: invoice.fecha_emision || preview.invoice.fecha_emision,
      total_factura: invoice.total_factura || preview.invoice.total_factura,
      numero_factura: invoice.numero_factura || preview.invoice.numero_factura,
      file_path: preview.filePath,
      filename: preview.filename,
      ocr_result: preview.ocr,
    };

    const result = await invoicePersistService.confirm({ userId, ip: req.ip, payload });

    if (!result.ok) {
      if (result.reason === 'duplicate') {
        return res.status(409).json({ error: 'Factura duplicada', existingId: result.existingId });
      }
      if (result.reason === 'missing_fields') {
        return res.status(400).json({ error: 'Campos obligatorios faltantes', missing: result.missing });
      }
      return res.status(500).json({ error: 'Error al guardar la factura' });
    }

    await cache.del(preview_id);
    res.json({ ok: true, upload: result.upload });
  };
}

module.exports = { makeConfirmController };
