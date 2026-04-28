// Error handler global Express. Debe montarse al final (después de todas las
// rutas) para capturar errores pasados vía next(err) por los middleware y
// controllers. No filtra stack trace en producción.
//
// Jerarquía:
//   - AppError (incluye ValidationError, AuthError, NotFoundError, ...) → statusCode + payload
//   - ZodError                                                          → 400 + detail
//   - SyntaxError (JSON.parse en body)                                  → 400 body inválido
//   - otros                                                             → 500 genérico en prod
'use strict';

const { AppError, ValidationError } = require('../lib/errors');

function isZodError(err) {
  return err?.name === 'ZodError' && Array.isArray(err?.issues);
}

function makeErrorHandler({ logger, isProduction = true }) {
  // eslint-disable-next-line no-unused-vars -- Express exige arity 4 para reconocerlo
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    const requestId = req.headers?.['x-request-id'] || req.id || null;

    if (err instanceof AppError) {
      const body = {
        error: err.message,
        code: err.name,
      };
      if (err.details) body.details = err.details;
      if (requestId) body.requestId = requestId;
      return res.status(err.statusCode).json(body);
    }

    if (isZodError(err)) {
      const ve = ValidationError.fromZod(err);
      return res.status(400).json({
        error: ve.message,
        code: 'ValidationError',
        details: ve.details,
        ...(requestId ? { requestId } : {}),
      });
    }

    if (err instanceof SyntaxError && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON inválido en body', code: 'BadRequest' });
    }

    logger?.error?.('unhandled error', {
      requestId,
      method: req.method,
      path: req.path,
      message: err?.message,
      stack: isProduction ? undefined : err?.stack,
    });

    const body = { error: 'Error interno del servidor', code: 'InternalError' };
    if (requestId) body.requestId = requestId;
    if (!isProduction && err?.message) body.message = err.message;
    res.status(500).json(body);
  };
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada', code: 'NotFound', path: req.path });
}

module.exports = { makeErrorHandler, notFoundHandler };
