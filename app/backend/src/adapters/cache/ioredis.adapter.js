// Adapter ioredis que implementa el contrato CachePort (ports/cache.port.js).
// Normaliza la API: get/set/del/has/incr/expire/keys/healthcheck con semántica
// consistente (null vs. undefined, ttl opcional en set, etc.).
'use strict';

const { assertCachePort } = require('../../ports/cache.port');

function createIoredisCacheAdapter(client) {
  if (!client) throw new Error('ioredis adapter: client is null');

  const adapter = {
    name: 'ioredis',
    healthcheck: async () => {
      try {
        return (await client.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
    get: async (key) => {
      const v = await client.get(key);
      return v === undefined ? null : v;
    },
    set: async (key, value, ttlSeconds) => {
      if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
        await client.set(key, value, 'EX', Math.floor(ttlSeconds));
      } else {
        await client.set(key, value);
      }
    },
    del: async (key) => client.del(key),
    has: async (key) => (await client.exists(key)) === 1,
    incr: async (key, increment = 1) => {
      if (increment === 1) return client.incr(key);
      return client.incrby(key, Math.floor(increment));
    },
    expire: async (key, ttlSeconds) => {
      const res = await client.expire(key, Math.floor(ttlSeconds));
      return res === 1;
    },
    keys: async (pattern) => client.keys(pattern),
  };

  return assertCachePort(adapter);
}

module.exports = { createIoredisCacheAdapter };
