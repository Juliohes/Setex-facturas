// Admin companies routes — 7 endpoints (approval workflow completo).
// Mutaciones (approve/reject/link) protegidas con CSRF double-submit (Round 13 P1.2).
'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');

function makeAdminCompaniesRoutes({
  adminCompaniesPendingController,
  adminCompaniesDetailController,
  adminCompaniesApproveController,
  adminCompaniesRejectController,
  adminCompaniesLinkController,
  adminCompaniesAuditLogController,
  adminCompaniesCountPendingController,
  authenticate,
  requireAdmin,
  requireXHR,
  csrf,
} = {}) {
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);

  const adminGuard = [...apply(authenticate), ...apply(requireAdmin)];
  const mutGuard = [...adminGuard, ...apply(requireXHR), ...apply(csrf)];

  router.get('/companies/pending', ...adminGuard, asyncHandler(adminCompaniesPendingController));
  router.get('/companies/pending/count', ...adminGuard, asyncHandler(adminCompaniesCountPendingController));
  router.get('/companies/:id/detail', ...adminGuard, asyncHandler(adminCompaniesDetailController));
  router.get('/companies/:id/audit-log', ...adminGuard, asyncHandler(adminCompaniesAuditLogController));
  router.post('/companies/:id/approve', ...mutGuard, asyncHandler(adminCompaniesApproveController));
  router.post('/companies/:id/reject', ...mutGuard, asyncHandler(adminCompaniesRejectController));
  router.post('/companies/:id/link', ...mutGuard, asyncHandler(adminCompaniesLinkController));

  return router;
}

module.exports = { makeAdminCompaniesRoutes };
