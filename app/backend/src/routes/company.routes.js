// Company routes — estado empresa sin requireActiveCompany (útil para "pending").
'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');

function makeCompanyRoutes({ companyStatusController, authenticate } = {}) {
  if (!companyStatusController) {
    throw new Error('company.routes: "companyStatusController" required');
  }
  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);

  router.get('/company/status', ...apply(authenticate), asyncHandler(companyStatusController));

  return router;
}

module.exports = { makeCompanyRoutes };
