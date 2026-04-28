// Middleware CSRF para mutaciones admin (P1.2). Usa csrf.service del Round 4/8
// (double-submit cookie pattern). Skip para GET/HEAD/OPTIONS + lista opcional
// de paths exentos (useful para endpoints server-to-server si llegan).
'use strict';

const { csrfMiddleware } = require('../services/auth/csrf.service');

function makeCsrfMiddleware({ skipPaths = [], logger } = {}) {
  const skipSet = new Set(skipPaths);

  return function csrf(req, res, next) {
    if (skipSet.has(req.path)) return next();
    if (req.path.startsWith('/api/internal/')) return next();
    return csrfMiddleware(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  };
}

module.exports = { makeCsrfMiddleware };
