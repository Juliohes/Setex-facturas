// Admin users routes — list + update con CSRF.
'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

function makeAdminUsersRoutes({
  adminUsersListController,
  adminUsersUpdateController,
  authenticate,
  requireAdmin,
  requireXHR,
  csrf,
} = {}) {
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);
  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];
  const mutGuard = [...adminGuard, ...apply(requireXHR), ...apply(csrf)];

  router.get('/users', ...adminGuard, asyncHandler(adminUsersListController));
  router.put('/users/:id', ...mutGuard, asyncHandler(adminUsersUpdateController));

  return router;
}

module.exports = { makeAdminUsersRoutes };
