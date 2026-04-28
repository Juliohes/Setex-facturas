// Admin ocr-engine routes — GET config + POST cambio de modo.
'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

function makeAdminOcrEngineRoutes({
  adminOcrEngineGetController,
  adminOcrEngineUpdateController,
  authenticate,
  requireAdmin,
  requireXHR,
  csrf,
} = {}) {
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);
  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];
  const mutGuard = [...adminGuard, ...apply(requireXHR), ...apply(csrf)];

  router.get('/ocr-engine', ...adminGuard, asyncHandler(adminOcrEngineGetController));
  router.post('/ocr-engine', ...mutGuard, asyncHandler(adminOcrEngineUpdateController));

  return router;
}

module.exports = { makeAdminOcrEngineRoutes };
