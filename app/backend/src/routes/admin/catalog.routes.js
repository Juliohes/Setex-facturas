// Admin catalog routes — CRUD del catálogo global de proveedores.
'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

function makeAdminCatalogRoutes({
  adminCatalogListController,
  adminCatalogCreateController,
  adminCatalogDeleteController,
  authenticate,
  requireAdmin,
  requireXHR,
  csrf,
} = {}) {
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);
  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];
  const mutGuard = [...adminGuard, ...apply(requireXHR), ...apply(csrf)];

  router.get('/catalog', ...adminGuard, asyncHandler(adminCatalogListController));
  router.post('/catalog', ...mutGuard, asyncHandler(adminCatalogCreateController));
  router.delete('/catalog/:id', ...mutGuard, asyncHandler(adminCatalogDeleteController));

  return router;
}

module.exports = { makeAdminCatalogRoutes };
