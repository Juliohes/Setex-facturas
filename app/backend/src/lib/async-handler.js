// Wrapper para handlers Express async. Captura promesas rechazadas y las
// delega al error-handler global vía next(err). Sin esto, un `throw` dentro
// de un handler async se convierte en unhandledRejection (Node logs + 500 genérico).
//
// Uso:
//   router.post('/x', asyncHandler(async (req, res) => { ... }))
'use strict';

function asyncHandler(fn) {
  return function asyncHandlerWrapper(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
