// Preview controller — procesa la imagen subida con OCR, persiste preview en
// Redis (TTL 30min) y devuelve datos para el modal de confirmación.
'use strict';

const { InvoiceBuilder } = require('../../services/invoices/invoice.builder');

const PREVIEW_TTL_SECONDS = 30 * 60;

function makePreviewController({
  ocrOrchestration,
  counterpartyResolver,
  cache,
  auditService,
  logger,
} = {}) {
  if (!ocrOrchestration) throw new Error('preview.controller: "ocrOrchestration" required');
  if (!cache) throw new Error('preview.controller: "cache" required');

  return async function previewController(req, res) {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Archivo no recibido' });

    const userId = req.user?.userId;
    const ocr = await ocrOrchestration.extract({
      filePath: file.path,
      mimeType: file.mimetype,
      userCompanyNif: req.user?.company_nif,
      requestId: req.id,
    });

    const primary = ocr.primary || ocr;
    const invoice = new InvoiceBuilder().fromOcr(primary).build();

    if (counterpartyResolver && invoice.emisor_nif) {
      const resolved = await counterpartyResolver.resolve({
        userId,
        ocrNombre: invoice.emisor_nombre,
        ocrNif: invoice.emisor_nif,
      });
      invoice._counterparty_hint = resolved;
    }

    const previewId = `preview:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await cache.set(previewId, JSON.stringify({ invoice, ocr, filename: file.filename, filePath: file.path }), PREVIEW_TTL_SECONDS);

    await auditService?.log?.({
      action: 'UPLOAD_PREVIEW',
      userId,
      ip: req.ip,
      details: { filename: file.filename, size: file.size, strategy: ocr.strategy },
    });

    res.json({
      preview_id: previewId,
      invoice,
      ocr_strategy: ocr.strategy,
      dual_confirmed: !!ocr.dual_confirmed,
      duration_ms: primary.duration_ms,
    });
  };
}

module.exports = { makePreviewController, PREVIEW_TTL_SECONDS };
