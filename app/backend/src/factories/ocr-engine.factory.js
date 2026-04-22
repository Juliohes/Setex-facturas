// Factory de motores OCR. Recibe la config runtime (features.json + secrets)
// y devuelve los adapters activos ya instanciados.
//
// Patrón OCP: añadir un motor nuevo = crear `adapters/ocr/<nombre>.adapter.js`
// + añadir su caso aquí. Cero modificación de services/invoices/ocr-orchestration.
'use strict';

const { createOpenAiOcrAdapter } = require('../adapters/ocr/openai.adapter');
const { createAzureOcrAdapter } = require('../adapters/ocr/azure.adapter');
const { createGeminiOcrAdapter } = require('../adapters/ocr/gemini.adapter');
const { createPaddleOcrAdapter } = require('../adapters/ocr/paddle.adapter');

function createOcrEngines({ features, readSecret, logger } = {}) {
  if (!features) throw new Error('ocr-engine.factory: "features" required');
  if (typeof readSecret !== 'function') {
    throw new Error('ocr-engine.factory: "readSecret" must be a function');
  }

  const mode = features.ocr_mode || 'dual';
  const engines = [];

  const openaiKey = readSecret('openai_api_key') || process.env.OPENAI_API_KEY;
  const azureEndpoint = readSecret('azure_di_endpoint') || process.env.AZURE_DI_ENDPOINT;
  const azureKey = readSecret('azure_di_key') || process.env.AZURE_DI_KEY;

  if (mode === 'openai' || mode === 'dual') {
    engines.push(createOpenAiOcrAdapter({ apiKey: openaiKey, logger, features }));
  }
  if (mode === 'azure' || mode === 'dual') {
    engines.push(createAzureOcrAdapter({ endpoint: azureEndpoint, apiKey: azureKey, logger }));
  }

  // Registrados pero inactivos. Se incluyen en el array si explícitamente se activan
  // en features.json con ocr_experimental_engines: ['gemini', 'paddle'].
  const experimental = Array.isArray(features.ocr_experimental_engines)
    ? features.ocr_experimental_engines
    : [];
  if (experimental.includes('gemini')) {
    engines.push(createGeminiOcrAdapter({ logger }));
  }
  if (experimental.includes('paddle')) {
    engines.push(createPaddleOcrAdapter({ logger }));
  }

  if (engines.length === 0) {
    logger?.warn?.('ocr-engine.factory: ningún motor activo — OCR deshabilitado');
  }

  return engines;
}

function pickPrimary(engines, features) {
  const primaryName = features?.ocr_primary_engine || 'openai';
  return engines.find((e) => e.name === primaryName) || engines[0] || null;
}

module.exports = { createOcrEngines, pickPrimary };
