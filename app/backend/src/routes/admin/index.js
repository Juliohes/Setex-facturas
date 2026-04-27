// Router admin montador. Crece en rounds 12-14.
'use strict';

const { makeAdminFacturasRoutes } = require('./facturas.routes');
const { makeAdminClientCompaniesRoutes } = require('./client-companies.routes');
const { makeAdminCompaniesRoutes } = require('./companies.routes');
const { makeAdminUsersRoutes } = require('./users.routes');
const { makeAdminCatalogRoutes } = require('./catalog.routes');
const { makeAdminSecurityRoutes } = require('./security.routes');
const { makeAdminOcrEngineRoutes } = require('./ocr-engine.routes');
const { makeAdminSystemRoutes } = require('./system.routes');
const { makeAdminSessionRoutes } = require('./session.routes');

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
        adminRetryFailedController: container.hasRegistration('adminRetryFailedController')
          ? container.resolve('adminRetryFailedController')
          : null,
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

  if (container.hasRegistration('adminCatalogListController')) {
    router.use(
      '/',
      makeAdminCatalogRoutes({
        adminCatalogListController: container.resolve('adminCatalogListController'),
        adminCatalogCreateController: container.resolve('adminCatalogCreateController'),
        adminCatalogDeleteController: container.resolve('adminCatalogDeleteController'),
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
        requireXHR: middleware.requireXHR,
        csrf: middleware.csrf,
      })
    );
  }

  if (container.hasRegistration('adminSecurityConfigController')) {
    router.use(
      '/',
      makeAdminSecurityRoutes({
        adminSecurityConfigController: container.resolve('adminSecurityConfigController'),
        adminSecurityListUpdateController: container.resolve('adminSecurityListUpdateController'),
        adminSecurityBlockedController: container.resolve('adminSecurityBlockedController'),
        adminSecurityTimeController: container.hasRegistration('adminSecurityTimeController')
          ? container.resolve('adminSecurityTimeController')
          : null,
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
        requireXHR: middleware.requireXHR,
        csrf: middleware.csrf,
      })
    );
  }

  if (container.hasRegistration('adminOcrEngineGetController')) {
    router.use(
      '/',
      makeAdminOcrEngineRoutes({
        adminOcrEngineGetController: container.resolve('adminOcrEngineGetController'),
        adminOcrEngineUpdateController: container.resolve('adminOcrEngineUpdateController'),
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
        requireXHR: middleware.requireXHR,
        csrf: middleware.csrf,
      })
    );
  }

  if (container.hasRegistration('adminSystemHealthController')) {
    router.use(
      '/',
      makeAdminSystemRoutes({
        adminSystemHealthController: container.resolve('adminSystemHealthController'),
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
      })
    );
  }

  // FASE 1B Etapa 1 — refresh de cookie admin para nginx auth_request
  if (container.hasRegistration('adminSessionRefreshController')) {
    router.use(
      '/',
      makeAdminSessionRoutes({
        adminSessionRefreshController: container.resolve('adminSessionRefreshController'),
        authenticate: middleware.authenticate,
        requireAdmin: middleware.requireAdmin,
      })
    );
  }

  return router;
}

module.exports = { makeAdminRouter };
