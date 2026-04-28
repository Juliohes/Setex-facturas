// Middleware de validación con Zod. Recibe un schema y una clave (body|query|
// params|headers). Si la validación falla, responde 400 con detalle estructurado;
// si pasa, reemplaza el target por el valor parseado (coerciones aplicadas).
//
//   const { validate } = require('./middleware/validate');
//   router.post('/login', validate(loginSchema, 'body'), loginController);
'use strict';

const { ValidationError } = require('../lib/errors');

const VALID_TARGETS = new Set(['body', 'query', 'params', 'headers']);

function validate(schema, target = 'body') {
  if (!schema || typeof schema.safeParse !== 'function') {
    throw new Error('validate: "schema" must be a Zod schema with .safeParse');
  }
  if (!VALID_TARGETS.has(target)) {
    throw new Error(`validate: "target" must be one of ${[...VALID_TARGETS].join(', ')}`);
  }

  return function validateMiddleware(req, res, next) {
    const result = schema.safeParse(req[target]);
    if (result.success) {
      // Reemplaza con el output parseado (coerciones, defaults aplicados).
      req[target] = result.data;
      return next();
    }
    const err = ValidationError.fromZod(result.error);
    return next(err);
  };
}

module.exports = { validate };
