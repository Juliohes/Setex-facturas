// Admin client-companies routes — 4 endpoints CRUD.
'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

function makeAdminClientCompaniesRoutes({
  adminClientCompaniesListController,
  adminClientCompaniesCreateController,
  adminClientCompaniesUpdateController,
  adminClientCompaniesDeleteController,
  authenticate,
  requireAdmin,
  requireXHR,
} = {}) {
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);

  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];
  const mutGuard = [...adminGuard, ...apply(requireXHR)];

  router.get('/client-companies', ...adminGuard, asyncHandler(adminClientCompaniesListController));
  router.post('/client-companies', ...mutGuard, asyncHandler(adminClientCompaniesCreateController));
  router.put('/client-companies/:id', ...mutGuard, asyncHandler(adminClientCompaniesUpdateController));
  router.delete('/client-companies/:id', ...mutGuard, asyncHandler(adminClientCompaniesDeleteController));

  return router;
}

module.exports = { makeAdminClientCompaniesRoutes };
