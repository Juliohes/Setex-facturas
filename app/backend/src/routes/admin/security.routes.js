// Admin security routes — config + ACLs + bloqueos.
'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

function makeAdminSecurityRoutes({
  adminSecurityConfigController,
  adminSecurityListUpdateController,
  adminSecurityBlockedController,
  adminSecurityTimeController,
  authenticate,
  requireAdmin,
  requireXHR,
  csrf,
} = {}) {
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);
  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];
  const mutGuard = [...adminGuard, ...apply(requireXHR), ...apply(csrf)];

  router.get('/security', ...adminGuard, asyncHandler(adminSecurityConfigController));

  // Lists ACL
  router.post('/security/blacklist', ...mutGuard, asyncHandler(adminSecurityListUpdateController.addBlacklist));
  router.delete('/security/blacklist', ...mutGuard, asyncHandler(adminSecurityListUpdateController.removeBlacklist));
  router.post('/security/whitelist', ...mutGuard, asyncHandler(adminSecurityListUpdateController.addWhitelist));
  router.delete('/security/whitelist', ...mutGuard, asyncHandler(adminSecurityListUpdateController.removeWhitelist));

  // Blocked
  router.get('/security/blocked', ...adminGuard, asyncHandler(adminSecurityBlockedController.list));
  router.delete('/security/blocked', ...mutGuard, asyncHandler(adminSecurityBlockedController.remove));

  // FASE 1B Etapa 1 — time_restriction (mutación admin · CSRF + XHR)
  if (adminSecurityTimeController) {
    router.patch('/security/time', ...mutGuard, asyncHandler(adminSecurityTimeController));
  }

  return router;
}

module.exports = { makeAdminSecurityRoutes };
