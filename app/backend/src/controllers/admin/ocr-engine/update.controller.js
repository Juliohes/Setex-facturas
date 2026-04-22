// POST /api/admin/ocr-engine — cambia ocr_mode/primary_engine. Hot-reload de
// features.json (volume-mount, no requiere rebuild).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_MODES = new Set(['dual', 'openai', 'azure']);
const ALLOWED_PRIMARY = new Set(['openai', 'azure']);
const FEATURES_PATH = path.join(__dirname, '..', '..', '..', 'config', 'features.json');

function makeAdminOcrEngineUpdateController({ reloadFeatures, auditService, logger } = {}) {
  return async function adminOcrEngineUpdateController(req, res) {
    const { mode, primary_engine, enabled } = req.body || {};

    if (mode !== undefined && !ALLOWED_MODES.has(mode)) {
      return res.status(400).json({ error: `mode inválido. Valores: ${[...ALLOWED_MODES].join(', ')}` });
    }
    if (primary_engine !== undefined && !ALLOWED_PRIMARY.has(primary_engine)) {
      return res.status(400).json({ error: `primary_engine inválido. Valores: ${[...ALLOWED_PRIMARY].join(', ')}` });
    }

    let current;
    try {
      current = JSON.parse(fs.readFileSync(FEATURES_PATH, 'utf8'));
    } catch (err) {
      logger?.error?.('ocr-engine update: features.json read failed', { message: err.message });
      return res.status(500).json({ error: 'No se pudo leer features.json' });
    }

    const next = { ...current };
    if (mode !== undefined) next.ocr_mode = mode;
    if (primary_engine !== undefined) next.ocr_primary_engine = primary_engine;
    if (typeof enabled === 'boolean') next.ocr_enabled = enabled;

    const tmp = `${FEATURES_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, FEATURES_PATH);

    if (reloadFeatures) reloadFeatures();

    await auditService?.log?.({
      action: 'ADMIN_OCR_ENGINE_UPDATED',
      userId: req.user.userId,
      ip: req.ip,
      details: { mode, primary_engine, enabled },
    });

    res.json({ ok: true, features: next });
  };
}

module.exports = { makeAdminOcrEngineUpdateController };
