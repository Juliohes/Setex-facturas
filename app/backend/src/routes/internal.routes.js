// Rutas internas que nginx llama como auth_request antes de servir contenido.
// Sin auth global, sin rate limit (las llama nginx en cada request del usuario;
// limitar aquí mataría la performance del frontend).
//
// Ojo: estas rutas DEBEN responder 200/403 nunca 404. Un 404 hace que nginx
// rebote la request a @bloqueado y la app queda KO. Por eso el v3 las porta
// (incidente Round 16, 2026-04-22).
'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');

function makeInternalRoutes({
  internalCheckAccessController,
  internalCheckAdminPageController,
} = {}) {
  if (!internalCheckAccessController) {
    throw new Error('makeInternalRoutes: "internalCheckAccessController" required');
  }
  if (!internalCheckAdminPageController) {
    throw new Error('makeInternalRoutes: "internalCheckAdminPageController" required');
  }

  const router = express.Router();
  router.get('/check-access', internalCheckAccessController);
  router.get('/check-admin-page', asyncHandler(internalCheckAdminPageController));
  return router;
}

module.exports = { makeInternalRoutes };
