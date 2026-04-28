// Barrel de controllers internal (auth_request endpoints para nginx).
'use strict';

const { makeInternalCheckAccessController } = require('./check-access.controller');
const { makeInternalCheckAdminPageController } = require('./check-admin-page.controller');

module.exports = {
  makeInternalCheckAccessController,
  makeInternalCheckAdminPageController,
};
