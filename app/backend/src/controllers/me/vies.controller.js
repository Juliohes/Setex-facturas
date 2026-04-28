// GET /api/vies/:nif — validación contra VIES (VAT Information Exchange System).
// Usa services/viesValidator con rate-limit específico (viesLimiter).
'use strict';

function makeViesController({ viesValidator, logger } = {}) {
  if (!viesValidator?.validate) {
    throw new Error('vies.controller: "viesValidator.validate" required');
  }

  return async function viesController(req, res) {
    const nif = String(req.params.nif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!nif) return res.status(400).json({ error: 'NIF inválido' });

    try {
      const result = await viesValidator.validate(nif);
      res.json(result);
    } catch (err) {
      logger?.warn?.('vies.controller error', { nif, message: err.message });
      res.status(502).json({ error: 'VIES no respondió', detail: err.message });
    }
  };
}

module.exports = { makeViesController };
