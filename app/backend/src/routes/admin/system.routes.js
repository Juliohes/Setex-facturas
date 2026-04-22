// Admin system routes — health enriquecido.
'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

function makeAdminSystemRoutes({ adminSystemHealthController, authenticate, requireAdmin } = {}) {
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);
  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];

  router.get('/system-health', ...adminGuard, asyncHandler(adminSystemHealthController));

  return router;
}

module.exports = { makeAdminSystemRoutes };
