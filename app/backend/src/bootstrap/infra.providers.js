// Registra en el container todos los providers de infraestructura: logger,
// features, pool pg (vía adapter), redis client (vía adapter cache). Se ejecuta
// UNA vez al arrancar (ver src/app.js, Round 15).
//
// Los providers se registran como SINGLETON — ciclo de vida = proceso. El
// graceful shutdown de Round 15 invoca disposer() para cerrar pool/redis/mail.
'use strict';

const { asValue, asFunction, Lifetime } = require('awilix');
const { env, isProduction, isStaging } = require('../config/env');
const { readSecret } = require('../config/secrets');
const { createLogger } = require('../config/logger');
const { createPool, closePool } = require('../config/database');
const { createRedisClient, closeRedisClient } = require('../config/redis');
const { createMailTransport, closeMailTransport } = require('../config/email');
const { getFeatures, reloadFeatures } = require('../config/features');
const { wrapPoolAsAdapter } = require('../adapters/db/pg-pool.adapter');
const { createIoredisCacheAdapter } = require('../adapters/cache/ioredis.adapter');

async function registerInfraProviders(container) {
  const logger = createLogger({ level: env.NODE_ENV === 'production' ? 'info' : 'debug' });

  const [pool, redisClient, mailTransport] = await Promise.all([
    createPool({ logger }),
    createRedisClient({ logger }),
    createMailTransport({ logger }),
  ]);

  const dbAdapter = wrapPoolAsAdapter(pool);
  const cacheAdapter = createIoredisCacheAdapter(redisClient);

  // Secretos cargados eagerly para que providers downstream los reciban via DI
  // sin tener que invocar readSecret() repetidamente. required: true → fail loud
  // en arranque si el secreto no existe.
  const jwtSecret = readSecret('jwt_secret', { required: true });

  container.register({
    env: asValue(env),
    isProduction: asValue(isProduction()),
    isStaging: asValue(isStaging()),
    readSecret: asValue(readSecret),
    jwtSecret: asValue(jwtSecret),
    // Paths — defaults coherentes con Dockerfile + docker-compose (/app/uploads)
    storageBase: asValue(process.env.STORAGE_BASE || '/app/uploads'),
    uploadsDir: asValue(process.env.UPLOADS_DIR || '/app/uploads'),
    securityConfigPath: asValue(process.env.SECURITY_CONFIG_PATH || '/app/src/config/security.json'),
    features: asFunction(() => getFeatures(), { lifetime: Lifetime.SINGLETON }),
    reloadFeatures: asValue(reloadFeatures),
    logger: asValue(logger),
    pool: asValue(pool),
    db: asValue(dbAdapter),
    redisClient: asValue(redisClient),
    cache: asValue(cacheAdapter),
    mailTransport: asValue(mailTransport),
  });

  return { logger, pool, redisClient, mailTransport };
}

async function disposeInfraProviders(container, { logger = null } = {}) {
  const log = logger || container.hasRegistration?.('logger') ? container.resolve('logger') : null;
  const pool = container.hasRegistration?.('pool') ? container.resolve('pool') : null;
  const redisClient = container.hasRegistration?.('redisClient') ? container.resolve('redisClient') : null;
  const mailTransport = container.hasRegistration?.('mailTransport') ? container.resolve('mailTransport') : null;

  await closeMailTransport(mailTransport, { logger: log });
  await closeRedisClient(redisClient, { logger: log });
  await closePool(pool, { logger: log });
}

module.exports = { registerInfraProviders, disposeInfraProviders };
