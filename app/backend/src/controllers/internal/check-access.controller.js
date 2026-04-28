// GET /api/internal/check-access — endpoint usado por nginx auth_request en
// `/`, `/api/`, `/service-worker.js`. Sin auth. Devuelve 200 si la hora actual
// no está bloqueada, 403 si lo está (señal para nginx que mapea a 404 público).
//
// Es la ruta más crítica del sistema: si responde 404 (porque no existe), nginx
// rebota TODO el tráfico autenticado a @bloqueado y la app queda KO. Eso es
// lo que pasó en el incidente Round 16 (2026-04-22).
'use strict';

const { isRestrictedHour } = require('../../services/security/restricted-hour.service');

function makeInternalCheckAccessController({ ipListManager } = {}) {
  if (!ipListManager?.load) {
    throw new Error('internal check-access.controller: "ipListManager" required');
  }

  return function internalCheckAccessController(_req, res) {
    const cfg = ipListManager.load();
    if (isRestrictedHour(cfg)) return res.status(403).end();
    return res.status(200).end();
  };
}

module.exports = { makeInternalCheckAccessController };
