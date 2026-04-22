// App factory — compose Express con el stack DI completo.
// Separada de server.js para poder instanciar desde tests sin listen().
'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');

const { bootstrapContainer } = require('./bootstrap');
const { setupSecurityHeaders, setupBodyParsers } = require('./middleware/setup');
const { mountRoutes } = require('./routes');
const { makeErrorHandler, notFoundHandler } = require('./middleware/error-handler');
const { attachRequestScope } = require('./container');
const requestIdMiddleware = require('./middleware/request-id');

async function createApp({ withInfra = true } = {}) {
  const container = await bootstrapContainer({ withInfra });
  const app = express();

  setupSecurityHeaders(app, {
    corsOrigin: process.env.CORS_ORIGIN || 'https://setex-facturas.es',
  });
  setupBodyParsers(app);
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(attachRequestScope(container));

  const middleware = withInfra
    ? {
        authenticate: container.resolve('authenticate'),
        requireActiveCompany: container.resolve('requireActiveCompany'),
        requireAdmin: container.resolve('requireAdmin'),
        requireXHR: container.resolve('requireXHR'),
        csrf: container.resolve('csrf'),
      }
    : {};

  mountRoutes(app, { container, middleware });

  app.use(notFoundHandler);
  app.use(
    makeErrorHandler({
      logger: container.hasRegistration('logger') ? container.resolve('logger') : console,
      isProduction: process.env.NODE_ENV === 'production',
    })
  );

  return { app, container };
}

module.exports = { createApp };
