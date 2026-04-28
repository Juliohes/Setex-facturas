// Montador de rutas. Recibe el container DI (tras bootstrap) y el objeto app
// Express; resuelve controllers y monta cada sub-router en su prefix.
//
// Round 9 monta solo health + auth. Rounds 10-14 añaden uploads/me/company/admin
// sin tocar este archivo — cada round edita este index para añadir su mount.
'use strict';

const { makeHealthRoutes } = require('./health.routes');
const { makeAuthRoutes } = require('./auth.routes');
const { makeUploadsRoutes } = require('./uploads.routes');
const { makeMeRoutes } = require('./me.routes');
const { makeCompanyRoutes } = require('./company.routes');
const { makeAdminRouter } = require('./admin');
const { makeInternalRoutes } = require('./internal.routes');

function mountRoutes(app, { container, middleware = {} } = {}) {
  if (!app) throw new Error('mountRoutes: "app" required');
  if (!container) throw new Error('mountRoutes: "container" required');

  const db = container.hasRegistration('db') ? container.resolve('db') : null;
  const cache = container.hasRegistration('cache') ? container.resolve('cache') : null;
  const logger = container.hasRegistration('logger') ? container.resolve('logger') : null;

  app.use('/', makeHealthRoutes({ db, cache, logger }));

  if (container.hasRegistration('loginController')) {
    const authRouter = makeAuthRoutes({
      loginController: container.resolve('loginController'),
      registerController: container.resolve('registerController'),
      logoutController: container.resolve('logoutController'),
      refreshController: container.resolve('refreshController'),
      forgotPasswordController: container.resolve('forgotPasswordController'),
      resetPasswordController: container.resolve('resetPasswordController'),
      authenticate: middleware.authenticate,
      authLimiter: middleware.authLimiter,
      refreshLimiter: middleware.refreshLimiter,
    });
    app.use('/api/auth', authRouter);
  }

  if (container.hasRegistration('previewController')) {
    const uploadsRouter = makeUploadsRoutes({
      previewController: container.resolve('previewController'),
      confirmController: container.resolve('confirmController'),
      listMineController: container.resolve('listMineController'),
      imageController: container.resolve('imageController'),
      proveedorController: container.resolve('proveedorController'),
      exportXlsxController: container.resolve('exportXlsxController'),
      authenticate: middleware.authenticate,
      requireActiveCompany: middleware.requireActiveCompany,
      uploadLimiter: middleware.uploadLimiter,
      confirmLimiter: middleware.confirmLimiter,
      fileUploader: middleware.fileUploader,
    });
    app.use('/api', uploadsRouter);
  }

  if (container.hasRegistration('profileGetController')) {
    const meRouter = makeMeRoutes({
      profileGetController: container.resolve('profileGetController'),
      profileUpdateController: container.resolve('profileUpdateController'),
      settingsGetController: container.resolve('settingsGetController'),
      settingsUpdateController: container.resolve('settingsUpdateController'),
      exportRgpdController: container.resolve('exportRgpdController'),
      deleteAccountController: container.resolve('deleteAccountController'),
      clientCompaniesListController: container.resolve('clientCompaniesListController'),
      viesController: container.resolve('viesController'),
      authenticate: middleware.authenticate,
      requireActiveCompany: middleware.requireActiveCompany,
      viesLimiter: middleware.viesLimiter,
    });
    app.use('/api', meRouter);
  }

  if (container.hasRegistration('companyStatusController')) {
    const companyRouter = makeCompanyRoutes({
      companyStatusController: container.resolve('companyStatusController'),
      authenticate: middleware.authenticate,
    });
    app.use('/api', companyRouter);
  }

  const adminRouter = makeAdminRouter({ container, middleware });
  app.use('/api/admin', adminRouter);

  // Internal endpoints para nginx auth_request — sin auth global, sin rate limit.
  // FASE 1B Etapa 1 (descongelado v3 post-incidente Round 16, 2026-04-22).
  if (container.hasRegistration('internalCheckAccessController')) {
    const internalRouter = makeInternalRoutes({
      internalCheckAccessController: container.resolve('internalCheckAccessController'),
      internalCheckAdminPageController: container.resolve('internalCheckAdminPageController'),
    });
    app.use('/api/internal', internalRouter);
  }
}

module.exports = { mountRoutes };
