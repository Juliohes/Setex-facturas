// Barrel de auth controllers. Importar factories desde aquí:
//   const { makeLoginController, makeRegisterController } = require('../../controllers/auth');
'use strict';

const { makeLoginController } = require('./login.controller');
const { makeRegisterController } = require('./register.controller');
const { makeLogoutController } = require('./logout.controller');
const { makeRefreshController } = require('./refresh.controller');
const { makeForgotPasswordController } = require('./forgot-password.controller');
const { makeResetPasswordController } = require('./reset-password.controller');

module.exports = {
  makeLoginController,
  makeRegisterController,
  makeLogoutController,
  makeRefreshController,
  makeForgotPasswordController,
  makeResetPasswordController,
};
