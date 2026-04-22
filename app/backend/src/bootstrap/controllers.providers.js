// Registra los controllers como factories DI. Cada controller declara las
// deps en su destructuring — Awilix PROXY las inyecta desde el container.
'use strict';

const { asFunction } = require('awilix');

const authCtrl = require('../controllers/auth');
const uploadsCtrl = require('../controllers/uploads');
const meCtrl = require('../controllers/me');
const companyCtrl = require('../controllers/company');
const adminCtrl = require('../controllers/admin');

function registerControllers(container) {
  container.register({
    // auth
    loginController: asFunction(authCtrl.makeLoginController).singleton(),
    registerController: asFunction(authCtrl.makeRegisterController).singleton(),
    logoutController: asFunction(authCtrl.makeLogoutController).singleton(),
    refreshController: asFunction(authCtrl.makeRefreshController).singleton(),
    forgotPasswordController: asFunction(authCtrl.makeForgotPasswordController).singleton(),
    resetPasswordController: asFunction(authCtrl.makeResetPasswordController).singleton(),

    // uploads
    previewController: asFunction(uploadsCtrl.makePreviewController).singleton(),
    confirmController: asFunction(uploadsCtrl.makeConfirmController).singleton(),
    listMineController: asFunction(uploadsCtrl.makeListMineController).singleton(),
    imageController: asFunction(uploadsCtrl.makeImageController).singleton(),
    proveedorController: asFunction(uploadsCtrl.makeProveedorController).singleton(),
    exportXlsxController: asFunction(uploadsCtrl.makeExportXlsxController).singleton(),

    // me
    profileGetController: asFunction(meCtrl.makeProfileGetController).singleton(),
    profileUpdateController: asFunction(meCtrl.makeProfileUpdateController).singleton(),
    settingsGetController: asFunction(meCtrl.makeSettingsGetController).singleton(),
    settingsUpdateController: asFunction(meCtrl.makeSettingsUpdateController).singleton(),
    exportRgpdController: asFunction(meCtrl.makeExportRgpdController).singleton(),
    deleteAccountController: asFunction(meCtrl.makeDeleteAccountController).singleton(),
    clientCompaniesListController: asFunction(meCtrl.makeClientCompaniesListController).singleton(),
    viesController: asFunction(meCtrl.makeViesController).singleton(),

    // company
    companyStatusController: asFunction(companyCtrl.makeCompanyStatusController).singleton(),

    // admin facturas
    adminFacturasListController: asFunction(adminCtrl.makeAdminFacturasListController).singleton(),
    adminFacturasUsersListController: asFunction(adminCtrl.makeAdminFacturasUsersListController).singleton(),
    adminFacturasImageController: asFunction(adminCtrl.makeAdminFacturasImageController).singleton(),
    adminFacturasExportXlsxController: asFunction(adminCtrl.makeAdminFacturasExportXlsxController).singleton(),
    adminFacturasUpdateController: asFunction(adminCtrl.makeAdminFacturasUpdateController).singleton(),
    adminFacturasDeleteController: asFunction(adminCtrl.makeAdminFacturasDeleteController).singleton(),

    // admin client-companies
    adminClientCompaniesListController: asFunction(adminCtrl.makeAdminClientCompaniesListController).singleton(),
    adminClientCompaniesCreateController: asFunction(adminCtrl.makeAdminClientCompaniesCreateController).singleton(),
    adminClientCompaniesUpdateController: asFunction(adminCtrl.makeAdminClientCompaniesUpdateController).singleton(),
    adminClientCompaniesDeleteController: asFunction(adminCtrl.makeAdminClientCompaniesDeleteController).singleton(),

    // admin companies (approval)
    adminCompaniesPendingController: asFunction(adminCtrl.makeAdminCompaniesPendingController).singleton(),
    adminCompaniesDetailController: asFunction(adminCtrl.makeAdminCompaniesDetailController).singleton(),
    adminCompaniesApproveController: asFunction(adminCtrl.makeAdminCompaniesApproveController).singleton(),
    adminCompaniesRejectController: asFunction(adminCtrl.makeAdminCompaniesRejectController).singleton(),
    adminCompaniesLinkController: asFunction(adminCtrl.makeAdminCompaniesLinkController).singleton(),
    adminCompaniesAuditLogController: asFunction(adminCtrl.makeAdminCompaniesAuditLogController).singleton(),
    adminCompaniesCountPendingController: asFunction(adminCtrl.makeAdminCompaniesCountPendingController).singleton(),

    // admin users
    adminUsersListController: asFunction(adminCtrl.makeAdminUsersListController).singleton(),
    adminUsersUpdateController: asFunction(adminCtrl.makeAdminUsersUpdateController).singleton(),

    // admin catalog
    adminCatalogListController: asFunction(adminCtrl.makeAdminCatalogListController).singleton(),
    adminCatalogCreateController: asFunction(adminCtrl.makeAdminCatalogCreateController).singleton(),
    adminCatalogDeleteController: asFunction(adminCtrl.makeAdminCatalogDeleteController).singleton(),

    // admin security
    adminSecurityConfigController: asFunction(adminCtrl.makeAdminSecurityConfigController).singleton(),
    adminSecurityListUpdateController: asFunction(adminCtrl.makeAdminSecurityListUpdateController).singleton(),
    adminSecurityBlockedController: asFunction(adminCtrl.makeAdminSecurityBlockedController).singleton(),

    // admin ocr-engine
    adminOcrEngineGetController: asFunction(adminCtrl.makeAdminOcrEngineGetController).singleton(),
    adminOcrEngineUpdateController: asFunction(adminCtrl.makeAdminOcrEngineUpdateController).singleton(),

    // admin system
    adminSystemHealthController: asFunction(adminCtrl.makeAdminSystemHealthController).singleton(),
  });
}

module.exports = { registerControllers };
