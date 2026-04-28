// Dependency Injection container — Awilix 10.x.
//
// El registro de providers concretos vive en src/bootstrap/* y se ejecuta
// desde src/app.js al arrancar. Este fichero solo expone la factoría del
// container y helpers para el scope per-request.
//
// Ver ADR-0005 para el patrón completo.
'use strict';

const { createContainer, InjectionMode, asValue } = require('awilix');

/**
 * Crea el container raíz. Modo PROXY → los providers reciben deps por destructuring:
 *   module.exports = function makeX({ logger, repo }) { ... }
 * Modo strict → fallo loud si se resuelve un nombre no registrado.
 *
 * @returns {import('awilix').AwilixContainer}
 */
function createAppContainer() {
  return createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });
}

/**
 * Middleware Express que crea un scope per-request y registra el contexto
 * (requestId, user tras auth). El scope hereda todos los providers del padre
 * y permite sobrescribir solo los que varían por petición.
 *
 * Ver bootstrap/controllers.providers.js para el patrón de resolución:
 *   req.container.resolve('loginController')
 */
function attachRequestScope(rootContainer) {
  return function requestScopeMiddleware(req, res, next) {
    const scope = rootContainer.createScope();
    scope.register({
      requestId: asValue(req.headers['x-request-id'] || req.id || null),
      userAgent: asValue(req.headers['user-agent'] || null),
      clientIp: asValue(req.ip || null),
    });
    req.container = scope;
    res.on('finish', () => {
      // Libera refs per-request. Providers SCOPED quedan huérfanos y GC los recoge.
      req.container = null;
    });
    next();
  };
}

module.exports = { createAppContainer, attachRequestScope };
