// Bootstrap del container DI — registra todos los providers en orden de capa.
// Se ejecuta UNA vez al arrancar la app (ver src/app.js, Round 15).
//
// Orden de registro obligatorio (cada capa depende de las anteriores):
//   1. infra        — clientes singleton (pool pg, redis, mailer, logger)
//   2. adapters     — implementaciones de ports (reciben infra)
//   3. factories    — factories que eligen adapter por config (reciben adapters)
//   4. repositories — DAOs sobre pool (reciben infra.pool)
//   5. services     — lógica dominio (reciben repos + ports)
//   6. controllers  — handlers HTTP (reciben services)
//
// Durante Round 2 solo existe el esqueleto. Cada round posterior añade el
// archivo de su capa sin tocar este index.
'use strict';

const { createAppContainer } = require('../container');
const { registerInfraProviders, disposeInfraProviders } = require('./infra.providers');

async function bootstrapContainer({ withInfra = false } = {}) {
  const container = createAppContainer();

  if (withInfra) {
    await registerInfraProviders(container);
  }

  // Round 7: registerAdaptersOcr(container)
  // Round 7: registerFactories(container)
  // Round 8: registerAdaptersMail(container)
  // Round 6: registerRepositories(container)
  // Round 7-14: registerServices(container)
  // Round 9-14: registerControllers(container)

  return container;
}

async function disposeContainer(container, opts) {
  if (!container) return;
  await disposeInfraProviders(container, opts);
}

module.exports = { bootstrapContainer, disposeContainer };
