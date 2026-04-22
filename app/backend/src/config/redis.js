// Factoría del cliente Redis (ioredis). Lee password desde Docker secret con
// fallback a REDIS_URL, aplica retry strategy conservadora y un healthcheck
// inicial. El cliente se expone vía adapters/cache/ioredis.adapter.js y el
// puerto CachePort.
'use strict';

const IORedis = require('ioredis');
const { env } = require('./env');
const { readSecret } = require('./secrets');

function buildRedisUrl() {
  let url = env.REDIS_URL;
  if (url.includes('@')) return url;
  const pass = readSecret('redis_password');
  if (pass) {
    url = url.replace(/^redis:\/\//, `redis://:${encodeURIComponent(pass)}@`);
  }
  return url;
}

async function createRedisClient({ logger = null } = {}) {
  const url = buildRedisUrl();
  const client = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      const backoff = Math.min(times * 100, 3000);
      return backoff;
    },
    reconnectOnError: (err) => {
      const targetError = 'READONLY';
      return err.message.includes(targetError);
    },
  });

  client.on('error', (err) => {
    if (!err.message?.includes('ECONNREFUSED')) {
      logger?.warn?.('redis client error', { message: err.message });
    }
  });

  client.on('ready', () => logger?.info?.('redis client ready'));

  const pong = await client.ping();
  if (pong !== 'PONG') throw new Error(`redis PING inesperado: ${pong}`);

  return client;
}

async function closeRedisClient(client, { logger = null } = {}) {
  if (!client) return;
  try {
    await client.quit();
    logger?.info?.('redis client closed cleanly');
  } catch (err) {
    logger?.warn?.('redis close error', { message: err.message });
    try { client.disconnect(); } catch { /* noop */ }
  }
}

module.exports = { createRedisClient, closeRedisClient, buildRedisUrl };
