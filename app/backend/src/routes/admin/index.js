// Router admin montador. Crece en rounds 12-14.
'use strict';

const { makeAdminFacturasRoutes } = require('./facturas.routes');
const { makeAdminClientCompaniesRoutes } = require('./client-companies.routes');
const { makeAdminCompaniesRoutes } = require('./companies.routes');
const { makeAdminUsersRoutes } = require('./users.routes');

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

  if (container.hasRegistration('adminCompaniesPendingController')) {
    router.use(
      '/',
      makeAdminCompaniesRoutes({
        adminCompaniesPendingController: container.resolve('adminCompaniesPendingController'),
        adminCompaniesDetailController: container.resolve('adminCompaniesDetailController'),
        adminCompaniesApproveController: container.resolve('adminCompaniesApproveController'),
        adminCompaniesRejectController: container.resolve('adminCompaniesRejectController'),
        adminCompaniesLinkController: container.resolve('adminCompaniesLinkController'),
        adminCompaniesAuditLogController: container.resolve('adminCompaniesAuditLogController'),
        adminCompaniesCountPendingController: container.resolve('adminCompaniesCountPendingController'),
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
        requireXHR: middleware.requireXHR,
        csrf: middleware.csrf,
      })
    );
  }

  if (container.hasRegistration('adminUsersListController')) {
    router.use(
      '/',
      makeAdminUsersRoutes({
        adminUsersListController: container.resolve('adminUsersListController'),
        adminUsersUpdateController: container.resolve('adminUsersUpdateController'),
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
        requireXHR: middleware.requireXHR,
        csrf: middleware.csrf,
      })
    );
  }

  return router;
}

module.exports = { makeAdminRouter };
