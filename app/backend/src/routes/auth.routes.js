// Auth routes. Factory recibe controllers (vía DI) + middleware (validate, rate-limit).
// El router queda desacoplado del stack runtime — se puede testear con deps mock.
//
//   POST /api/auth/login             loginSchema
//   POST /api/auth/register          registerSchema
//   POST /api/auth/logout
//   POST /api/auth/refresh
//   POST /api/auth/forgot-password   forgotPasswordSchema
//   POST /api/auth/reset-password    resetPasswordSchema
'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');
const { validate } = require('../middleware/validate');
const {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('../schemas/auth');

function makeAuthRoutes({
  loginController,
  registerController,
  logoutController,
  refreshController,
  forgotPasswordController,
  resetPasswordController,
  authenticate,
  authLimiter,
  refreshLimiter,
} = {}) {
  if (!loginController || !registerController) {
    throw new Error('auth.routes: controllers de login/register requeridos');
  }

  const router = express.Router();

  const applyLimiter = (limiter) => (limiter ? [limiter] : []);

  router.post(
    '/login',
    ...applyLimiter(authLimiter),
    validate(loginSchema, 'body'),
    asyncHandler(loginController)
  );

  router.post(
    '/register',
    ...applyLimiter(authLimiter),
    validate(registerSchema, 'body'),
    asyncHandler(registerController)
  );

  router.post(
    '/logout',
    authenticate ? authenticate : (req, res, next) => next(),
    asyncHandler(logoutController)
  );

  router.post(
    '/refresh',
    ...applyLimiter(refreshLimiter),
    asyncHandler(refreshController)
  );

  router.post(
    '/forgot-password',
    ...applyLimiter(authLimiter),
    validate(forgotPasswordSchema, 'body'),
    asyncHandler(forgotPasswordController)
  );

  router.post(
    '/reset-password',
    ...applyLimiter(authLimiter),
    validate(resetPasswordSchema, 'body'),
    asyncHandler(resetPasswordController)
  );

  return router;
}

module.exports = { makeAuthRoutes };
