// Barrel de config/. Re-exporta env, secrets, features + factorías async de
// infra (database, redis, email, logger). Los consumidores deben importar desde
// aquí en lugar de tocar submódulos directamente.
//
//   const { env, readSecret, createPool, createRedisClient, createLogger,
//           createMailTransport, getFeatures } = require('./config');
'use strict';

const { env, isProduction, isStaging } = require('./env');
const { readSecret, readSecretCached } = require('./secrets');
const { createLogger } = require('./logger');
const { createPool, closePool, DEFAULT_POOL_CONFIG } = require('./database');
const { createRedisClient, closeRedisClient, buildRedisUrl } = require('./redis');
const { createMailTransport, closeMailTransport } = require('./email');
const { loadFeatures, getFeatures, reloadFeatures, DEFAULTS: FEATURE_DEFAULTS } = require('./features');

module.exports = {
  env,
  isProduction,
  isStaging,
  readSecret,
  readSecretCached,
  createLogger,
  createPool,
  closePool,
  DEFAULT_POOL_CONFIG,
  createRedisClient,
  closeRedisClient,
  buildRedisUrl,
  createMailTransport,
  closeMailTransport,
  loadFeatures,
  getFeatures,
  reloadFeatures,
  FEATURE_DEFAULTS,
};
