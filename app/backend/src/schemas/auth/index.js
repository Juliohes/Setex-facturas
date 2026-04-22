// Barrel de schemas de auth. Importar desde aquí:
//   const { loginSchema, registerSchema } = require('../../schemas/auth');
'use strict';

const { loginSchema } = require('./login.schema');
const { registerSchema } = require('./register.schema');
const { forgotPasswordSchema } = require('./forgot-password.schema');
const { resetPasswordSchema } = require('./reset-password.schema');

module.exports = {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
