// Barrel de controllers admin (crece en rounds 12-14).
'use strict';

// facturas (Round 12)
const { makeAdminFacturasListController } = require('./facturas/list.controller');
const { makeAdminFacturasUsersListController } = require('./facturas/users-list.controller');
const { makeAdminFacturasImageController } = require('./facturas/image.controller');
const { makeAdminFacturasExportXlsxController } = require('./facturas/export-xlsx.controller');
const { makeAdminFacturasUpdateController } = require('./facturas/update.controller');
const { makeAdminFacturasDeleteController } = require('./facturas/delete.controller');

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

module.exports = {
  // facturas
  makeAdminFacturasListController,
  makeAdminFacturasUsersListController,
  makeAdminFacturasImageController,
  makeAdminFacturasExportXlsxController,
  makeAdminFacturasUpdateController,
  makeAdminFacturasDeleteController,
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
};
