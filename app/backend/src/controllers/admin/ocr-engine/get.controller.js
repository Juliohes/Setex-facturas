// GET /api/admin/ocr-engine — estado actual del motor OCR (features.json hot).
'use strict';

function makeAdminOcrEngineGetController({ features, ocrEngines = [] } = {}) {
  if (!features) throw new Error('admin ocr-engine get.controller: "features" required');

  return async function adminOcrEngineGetController(req, res) {
    const healthchecks = await Promise.all(
      ocrEngines.map(async (e) => ({
        name: e.name,
        ok: await e.healthcheck().catch(() => false),
      }))
    );
    res.json({
      mode: features.ocr_mode || 'dual',
      primary: features.ocr_primary_engine || 'openai',
      enabled: features.ocr_enabled !== false,
      engines: healthchecks,
    });
  };
}

module.exports = { makeAdminOcrEngineGetController };
