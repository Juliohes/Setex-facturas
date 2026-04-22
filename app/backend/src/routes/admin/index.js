// Router admin montador. Crece en rounds 12-14.
'use strict';

const { makeAdminFacturasRoutes } = require('./facturas.routes');
const { makeAdminClientCompaniesRoutes } = require('./client-companies.routes');

function makeAdminRouter({ container, middleware = {} } = {}) {
  const express = require('express');
  const router = express.Router();

  if (container.hasRegistration('adminFacturasListController')) {
    router.use(
      '/',
      makeAdminFacturasRoutes({
        adminFacturasListController: container.resolve('adminFacturasListController'),
        adminFacturasUsersListController: container.resolve('adminFacturasUsersListController'),
        adminFacturasImageController: container.resolve('adminFacturasImageController'),
        adminFacturasExportXlsxController: container.resolve('adminFacturasExportXlsxController'),
        adminFacturasUpdateController: container.resolve('adminFacturasUpdateController'),
        adminFacturasDeleteController: container.resolve('adminFacturasDeleteController'),
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
        requireXHR: middleware.requireXHR,
      })
    );
  }

  if (container.hasRegistration('adminClientCompaniesListController')) {
    router.use(
      '/',
      makeAdminClientCompaniesRoutes({
        adminClientCompaniesListController: container.resolve('adminClientCompaniesListController'),
        adminClientCompaniesCreateController: container.resolve('adminClientCompaniesCreateController'),
        adminClientCompaniesUpdateController: container.resolve('adminClientCompaniesUpdateController'),
        adminClientCompaniesDeleteController: container.resolve('adminClientCompaniesDeleteController'),
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
        requireXHR: middleware.requireXHR,
      })
    );
  }

  return router;
}

module.exports = { makeAdminRouter };
