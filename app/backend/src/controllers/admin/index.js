// Barrel de controllers admin (crece en rounds 12-14).
'use strict';

// facturas (Round 12 + FASE 1B Etapa 1: retry-failed)
const { makeAdminFacturasListController } = require('./facturas/list.controller');
const { makeAdminFacturasUsersListController } = require('./facturas/users-list.controller');
const { makeAdminFacturasImageController } = require('./facturas/image.controller');
const { makeAdminFacturasExportXlsxController } = require('./facturas/export-xlsx.controller');
const { makeAdminFacturasUpdateController } = require('./facturas/update.controller');
const { makeAdminFacturasDeleteController } = require('./facturas/delete.controller');
const { makeAdminRetryFailedController } = require('./facturas/retry-failed.controller');

// client-companies (Round 12)
const { makeAdminClientCompaniesListController } = require('./client-companies/list.controller');
const { makeAdminClientCompaniesCreateController } = require('./client-companies/create.controller');
const { makeAdminClientCompaniesUpdateController } = require('./client-companies/update.controller');
const { makeAdminClientCompaniesDeleteController } = require('./client-companies/delete.controller');

// companies approval flow (Round 13)
const { makeAdminCompaniesPendingController } = require('./companies/list-pending.controller');
const { makeAdminCompaniesDetailController } = require('./companies/detail.controller');
const { makeAdminCompaniesApproveController } = require('./companies/approve.controller');
const { makeAdminCompaniesRejectController } = require('./companies/reject.controller');
const { makeAdminCompaniesLinkController } = require('./companies/link.controller');
const { makeAdminCompaniesAuditLogController } = require('./companies/audit-log.controller');
const { makeAdminCompaniesCountPendingController } = require('./companies/count-pending.controller');

// users (Round 13)
const { makeAdminUsersListController } = require('./users/list.controller');
const { makeAdminUsersUpdateController } = require('./users/update.controller');

// catalog (Round 14)
const { makeAdminCatalogListController } = require('./catalog/list.controller');
const { makeAdminCatalogCreateController } = require('./catalog/create.controller');
const { makeAdminCatalogDeleteController } = require('./catalog/delete.controller');

// security (Round 14)
const { makeAdminSecurityConfigController } = require('./security/config.controller');
const { makeAdminSecurityListUpdateController } = require('./security/list-update.controller');
const { makeAdminSecurityBlockedController } = require('./security/blocked.controller');

// ocr-engine (Round 14)
const { makeAdminOcrEngineGetController } = require('./ocr-engine/get.controller');
const { makeAdminOcrEngineUpdateController } = require('./ocr-engine/update.controller');

// system (Round 14)
const { makeAdminSystemHealthController } = require('./system/health.controller');

// session refresh (FASE 1B Etapa 1)
const { makeAdminSessionRefreshController } = require('./session-refresh.controller');

module.exports = {
  // facturas
  makeAdminFacturasListController,
  makeAdminFacturasUsersListController,
  makeAdminFacturasImageController,
  makeAdminFacturasExportXlsxController,
  makeAdminFacturasUpdateController,
  makeAdminFacturasDeleteController,
  makeAdminRetryFailedController,
  // client-companies
  makeAdminClientCompaniesListController,
  makeAdminClientCompaniesCreateController,
  makeAdminClientCompaniesUpdateController,
  makeAdminClientCompaniesDeleteController,
  // companies approval flow
  makeAdminCompaniesPendingController,
  makeAdminCompaniesDetailController,
  makeAdminCompaniesApproveController,
  makeAdminCompaniesRejectController,
  makeAdminCompaniesLinkController,
  makeAdminCompaniesAuditLogController,
  makeAdminCompaniesCountPendingController,
  // users
  makeAdminUsersListController,
  makeAdminUsersUpdateController,
  // catalog
  makeAdminCatalogListController,
  makeAdminCatalogCreateController,
  makeAdminCatalogDeleteController,
  // security
  makeAdminSecurityConfigController,
  makeAdminSecurityListUpdateController,
  makeAdminSecurityBlockedController,
  // ocr-engine
  makeAdminOcrEngineGetController,
  makeAdminOcrEngineUpdateController,
  // system
  makeAdminSystemHealthController,
  // session refresh (FASE 1B)
  makeAdminSessionRefreshController,
};
