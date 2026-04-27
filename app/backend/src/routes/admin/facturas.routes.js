// Admin facturas routes — 6 endpoints tras authenticate + requireAdmin.
// PUT/DELETE exigen requireXHR (mitigación CSRF low-cost antes de CSRF full en Round 13).
'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

function makeAdminFacturasRoutes({
  adminFacturasListController,
  adminFacturasUsersListController,
  adminFacturasImageController,
  adminFacturasExportXlsxController,
  adminFacturasUpdateController,
  adminFacturasDeleteController,
  adminRetryFailedController,
  authenticate,
  requireAdmin,
  requireXHR,
} = {}) {
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);

  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];
  const mutGuard = [...adminGuard, ...apply(requireXHR)];

  router.get('/facturas', ...adminGuard, asyncHandler(adminFacturasListController));
  router.get('/facturas/usuarios', ...adminGuard, asyncHandler(adminFacturasUsersListController));
  router.get('/facturas/export.xlsx', ...adminGuard, asyncHandler(adminFacturasExportXlsxController));
  router.get('/facturas/:id/imagen', ...adminGuard, asyncHandler(adminFacturasImageController));
  router.put('/facturas/:id', ...mutGuard, asyncHandler(adminFacturasUpdateController));
  router.delete('/facturas/:id', ...mutGuard, asyncHandler(adminFacturasDeleteController));

  // FASE 1B Etapa 1 — retry-failed (mutación admin · requiere XHR)
  if (adminRetryFailedController) {
    router.post('/retry-failed/:id', ...mutGuard, asyncHandler(adminRetryFailedController));
  }

  return router;
}

module.exports = { makeAdminFacturasRoutes };
