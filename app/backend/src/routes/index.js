// Montador de rutas. Recibe el container DI (tras bootstrap) y el objeto app
// Express; resuelve controllers y monta cada sub-router en su prefix.
//
// Round 9 monta solo health + auth. Rounds 10-14 añaden uploads/me/company/admin
// sin tocar este archivo — cada round edita este index para añadir su mount.
'use strict';

const { makeHealthRoutes } = require('./health.routes');
const { makeAuthRoutes } = require('./auth.routes');

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
}

module.exports = { mountRoutes };
