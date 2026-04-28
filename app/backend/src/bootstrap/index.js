// Bootstrap del container DI — registra providers en orden por capa.
// Se ejecuta UNA vez al arrancar (src/app.js). Orden obligatorio:
//   infra → repositories → services → middleware → controllers
'use strict';

const { createAppContainer } = require('../container');
const { registerInfraProviders, disposeInfraProviders } = require('./infra.providers');
const { registerRepositories } = require('./repositories.providers');
const { registerServices } = require('./services.providers');
const { registerMiddleware } = require('./middleware.providers');
const { registerControllers } = require('./controllers.providers');

async function bootstrapContainer({ withInfra = false } = {}) {
  const container = createAppContainer();

  if (withInfra) {
    await registerInfraProviders(container);
    registerRepositories(container);
    await registerServices(container);
    registerMiddleware(container);
    registerControllers(container);
  }

  return container;
}

async function disposeContainer(container, opts) {
  if (!container) return;
  await disposeInfraProviders(container, opts);
}

module.exports = { bootstrapContainer, disposeContainer };
