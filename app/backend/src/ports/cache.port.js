// Contrato del puerto de cache (key-value con TTL). Adapter hoy:
// adapters/cache/ioredis.adapter.js. Alternativa futura: in-memory para tests.
//
// Todas las operaciones son async y devuelven null (no undefined) cuando no hay valor.
'use strict';

/**
 * @typedef {Object} CachePort
 * @property {string} name
 * @property {() => Promise<boolean>} healthcheck
 * @property {(key: string) => Promise<string|null>} get
 * @property {(key: string, value: string, ttlSeconds?: number) => Promise<void>} set
 * @property {(key: string) => Promise<number>} del               Devuelve número de keys borradas
 * @property {(key: string) => Promise<boolean>} has
 * @property {(key: string, increment?: number) => Promise<number>} incr  Atomic increment
 * @property {(key: string, ttlSeconds: number) => Promise<boolean>} expire
 * @property {(pattern: string) => Promise<string[]>} keys        Solo para debug; evitar en caliente
 */

function assertCachePort(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('CachePort: candidate must be an object');
  }
  const required = ['name', 'healthcheck', 'get', 'set', 'del', 'has', 'incr', 'expire', 'keys'];
  for (const field of required) {
    if (candidate[field] === undefined) {
      throw new Error(`CachePort: missing "${field}"`);
    }
  }
  if (typeof candidate.name !== 'string' || !candidate.name) {
    throw new Error('CachePort: "name" must be a non-empty string');
  }
  return candidate;
}

module.exports = { assertCachePort };
