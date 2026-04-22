// Adapter OpenAI que implementa OcrPort. Durante el refactor v3 delega en el
// engine existente src/ocr/openai.js. En Round 15 el engine se mueve aquí y el
// archivo legacy se elimina. El adapter expone la API uniforme del port para
// que services/invoices/ocr-orchestration.service no conozca el engine.
'use strict';

const { extractInvoice } = require('../../ocr/openai');
const { assertOcrPort } = require('../../ports/ocr.port');

function createOpenAiOcrAdapter({ apiKey, logger, features = {} } = {}) {
  if (!apiKey) {
    logger?.warn?.('openai.adapter: API key missing — engine disabled');
  }

  const adapter = {
    name: 'openai',

    async healthcheck() {
      if (!apiKey) return false;
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(3000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async extract(input) {
      if (!apiKey) throw new Error('openai.adapter: API key not configured');
      const started = Date.now();
      const raw = await extractInvoice(input.filePath, {
        apiKey,
        userCompanyNif: input.userCompanyNif,
        features,
      });
      return normalizeOpenAiResult(raw, Date.now() - started);
    },
  };

  return assertOcrPort(adapter);
}

function normalizeOpenAiResult(raw, duration_ms) {
  const r = raw || {};
  return {
    engine: 'openai',
    emisor_nombre: r.emisor_nombre ?? null,
    emisor_nif: r.emisor_nif ?? null,
    receptor_nombre: r.receptor_nombre ?? null,
    receptor_nif: r.receptor_nif ?? null,
    numero_factura: r.numero_factura ?? null,
    fecha: r.fecha ?? null,
    base_imponible: toNum(r.base_imponible),
    cuota_iva: toNum(r.cuota_iva),
    total: toNum(r.total),
    irpf_pct: toNum(r.irpf_porcentaje),
    irpf_cuota: toNum(r.irpf_cuota),
    tramos_iva: r.tramos_iva ?? (Array.isArray(r.lineas_iva) && r.lineas_iva.length > 1 ? 'multi' : 'mono'),
    lineas_iva: Array.isArray(r.lineas_iva) ? r.lineas_iva : [],
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.9,
    duration_ms,
    raw,
  };
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

module.exports = { createOpenAiOcrAdapter };
