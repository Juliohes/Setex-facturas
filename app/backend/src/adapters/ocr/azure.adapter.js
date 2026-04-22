// Adapter Azure Document Intelligence que implementa OcrPort. Delega en el
// engine existente src/ocr/azure.js durante el refactor.
'use strict';

const { extractInvoice } = require('../../ocr/azure');
const { assertOcrPort } = require('../../ports/ocr.port');

function createAzureOcrAdapter({ endpoint, apiKey, logger } = {}) {
  if (!endpoint || !apiKey) {
    logger?.warn?.('azure.adapter: credenciales incompletas — engine disabled');
  }

  const adapter = {
    name: 'azure',

    async healthcheck() {
      if (!endpoint || !apiKey) return false;
      try {
        const url = `${endpoint.replace(/\/$/, '')}/formrecognizer/info?api-version=2023-07-31`;
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Ocp-Apim-Subscription-Key': apiKey },
          signal: AbortSignal.timeout(3000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async extract(input) {
      if (!endpoint || !apiKey) {
        throw new Error('azure.adapter: endpoint + apiKey requeridos');
      }
      const started = Date.now();
      const raw = await extractInvoice(input.filePath, { endpoint, apiKey });
      return normalizeAzureResult(raw, Date.now() - started);
    },
  };

  return assertOcrPort(adapter);
}

function normalizeAzureResult(raw, duration_ms) {
  const r = raw || {};
  return {
    engine: 'azure',
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
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.85,
    duration_ms,
    raw,
  };
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

module.exports = { createAzureOcrAdapter };
