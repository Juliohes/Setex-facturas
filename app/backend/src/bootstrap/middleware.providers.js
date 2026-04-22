// Registra middleware derivados del container. Middleware de setup (helmet,
// cors, body parsers) se montan directamente en app.js, no pasan por aquí.
'use strict';

const { asFunction } = require('awilix');

const {
  makeAuthenticate,
  makeRequireActiveCompany,
  requireAdmin,
  requireXHR,
} = require('../middleware/auth');
const { makeSecurityIpMiddleware } = require('../middleware/security-ip');
const { makeSecurityAutoBlockMiddleware } = require('../middleware/security-autoblock');
const { makeCsrfMiddleware } = require('../middleware/csrf');
const { makeSanitizeBody } = require('../middleware/sanitize');

function registerMiddleware(container) {
  container.register({
    authenticate: asFunction(({ pool, logger, readSecret }) =>
      makeAuthenticate({
        pool,
        jwtSecret: readSecret('jwt_secret', { required: true }),
        logger,
      })
    ).singleton(),

    requireActiveCompany: asFunction(makeRequireActiveCompany).singleton(),

    requireAdmin: asFunction(() => requireAdmin).singleton(),
    requireXHR: asFunction(() => requireXHR).singleton(),

    securityIp: asFunction(({ loadSecurityConfig, logger }) =>
      makeSecurityIpMiddleware({ loadSecurityConfig, logger })
    ).singleton(),

    securityAutoblock: asFunction(({ loadSecurityConfig, redisClient, logger }) =>
      makeSecurityAutoBlockMiddleware({ loadSecurityConfig, redisClient, logger })
    ).singleton(),

    csrf: asFunction(({ logger }) => makeCsrfMiddleware({ logger })).singleton(),

    sanitizeBody: asFunction(() => makeSanitizeBody()).singleton(),
  });
}

module.exports = { registerMiddleware };
