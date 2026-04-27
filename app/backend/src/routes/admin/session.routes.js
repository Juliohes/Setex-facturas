// Admin session routes — refresh de la cookie httpOnly `setex_admin` que nginx
// valida via auth_request en /admin-facturas.html.
'use strict';

const express = require('express');

function makeAdminSessionRoutes({
  adminSessionRefreshController,
  authenticate,
  requireAdmin,
} = {}) {
  if (!adminSessionRefreshController) {
    throw new Error('makeAdminSessionRoutes: "adminSessionRefreshController" required');
  }

  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);
  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];

  router.post('/refresh-session', ...adminGuard, adminSessionRefreshController);
  return router;
}

module.exports = { makeAdminSessionRoutes };
