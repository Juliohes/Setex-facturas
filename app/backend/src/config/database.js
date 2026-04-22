// Factoría async de la Pool PostgreSQL. Lee password desde Docker secret con
// fallback env, aplica configuración óptima y un statement_timeout de 5s por
// default (previene queries bloqueantes que saturen el pool).
//
// Rounds futuros (9+) migrarán server.js para consumir este pool desde el
// container DI en lugar de construirlo inline.
'use strict';

const { Pool } = require('pg');
const { env } = require('./env');
const { readSecret } = require('./secrets');

const DEFAULT_POOL_CONFIG = {
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
  query_timeout: 10000,
  allowExitOnIdle: false,
};

async function createPool({ logger = null, overrides = {} } = {}) {
  const password = readSecret('postgres_password', { required: true });
  const pool = new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password,
    ...DEFAULT_POOL_CONFIG,
    ...overrides,
  });

  pool.on('error', (err) => {
    logger?.error?.('pg pool idle client error', { code: err.code, message: err.message });
  });

  // Healthcheck inicial — falla rápido si la BD no responde.
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT 1 AS ok');
    if (rows[0]?.ok !== 1) throw new Error('unexpected SELECT 1 result');
    logger?.info?.('pg pool ready', {
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      max: DEFAULT_POOL_CONFIG.max,
    });
  } finally {
    client.release();
  }

  return pool;
}

async function closePool(pool, { logger = null, graceMs = 10000 } = {}) {
  if (!pool) return;
  const timeout = setTimeout(() => {
    logger?.warn?.('pg pool end timeout exceeded', { graceMs });
  }, graceMs);
  try {
    await pool.end();
    logger?.info?.('pg pool closed cleanly');
  } catch (err) {
    logger?.warn?.('pg pool close error', { message: err.message });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { createPool, closePool, DEFAULT_POOL_CONFIG };
