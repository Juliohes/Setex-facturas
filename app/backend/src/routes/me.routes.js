// Me routes — endpoints del perfil del usuario autenticado.
//   GET  /api/me/profile            profile-get
//   PUT  /api/me/profile            profile-update
//   GET  /api/me/settings           settings-get
//   POST /api/me/settings           settings-update
//   GET  /api/me/export             export-rgpd (art. 15+20)
//   DELETE /api/me/account          delete-account (art. 17)
//   GET  /api/client-companies      lista empresas activas
//   GET  /api/vies/:nif             validación VIES
'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');

function makeMeRoutes({
  profileGetController,
  profileUpdateController,
  settingsGetController,
  settingsUpdateController,
  exportRgpdController,
  deleteAccountController,
  clientCompaniesListController,
  viesController,
  authenticate,
  requireActiveCompany,
  viesLimiter,
} = {}) {
  if (!profileGetController || !exportRgpdController) {
    throw new Error('me.routes: controllers requeridos faltantes');
  }

  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);

  router.get('/me/profile', ...apply(authenticate), asyncHandler(profileGetController));
  router.put('/me/profile', ...apply(authenticate), asyncHandler(profileUpdateController));
  router.get('/me/settings', ...apply(authenticate), asyncHandler(settingsGetController));
  router.post('/me/settings', ...apply(authenticate), asyncHandler(settingsUpdateController));
  router.get('/me/export', ...apply(authenticate), asyncHandler(exportRgpdController));
  router.delete('/me/account', ...apply(authenticate), asyncHandler(deleteAccountController));

  router.get('/client-companies', ...apply(authenticate), asyncHandler(clientCompaniesListController));
  router.get(
    '/vies/:nif',
    ...apply(authenticate),
    ...apply(requireActiveCompany),
    ...apply(viesLimiter),
    asyncHandler(viesController)
  );

  return router;
}

module.exports = { makeMeRoutes };
