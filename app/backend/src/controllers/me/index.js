// Barrel de me controllers.
'use strict';

const { makeProfileGetController } = require('./profile-get.controller');
const { makeProfileUpdateController } = require('./profile-update.controller');
const { makeSettingsGetController } = require('./settings-get.controller');
const { makeSettingsUpdateController } = require('./settings-update.controller');
const { makeExportRgpdController } = require('./export-rgpd.controller');
const { makeDeleteAccountController } = require('./delete-account.controller');
const { makeClientCompaniesListController } = require('./client-companies-list.controller');
const { makeViesController } = require('./vies.controller');

module.exports = {
  makeProfileGetController,
  makeProfileUpdateController,
  makeSettingsGetController,
  makeSettingsUpdateController,
  makeExportRgpdController,
  makeDeleteAccountController,
  makeClientCompaniesListController,
  makeViesController,
};
