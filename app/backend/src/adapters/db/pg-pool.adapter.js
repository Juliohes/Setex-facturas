// Adapter que envuelve el Pool pg con un helper de query con timeout dinámico.
// Mantiene la API original `.query(sql, params)` para que repositories existentes
// sigan funcionando sin cambios.
//
// Helper extra: queryWithTimeout(sql, params, { timeoutMs, label }) — envuelve
// en transacción y aplica SET LOCAL statement_timeout. Usado por servicios auth
// (timeoutMs=500) para no bloquear el pool si una consulta concreta se atasca.
'use strict';

async function queryWithTimeout(pool, sql, params = [], { timeoutMs = 5000, label = null } = {}) {
  if (!pool) throw new Error('pg-pool adapter: pool is null');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`pg-pool adapter: timeoutMs inválido: ${timeoutMs}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    if (err && label) err.queryLabel = label;
    throw err;
  } finally {
    client.release();
  }
}

function wrapPoolAsAdapter(pool) {
  return {
    name: 'pg-pool',
    query: (sql, params) => pool.query(sql, params),
    queryWithTimeout: (sql, params, opts) => queryWithTimeout(pool, sql, params, opts),
    connect: () => pool.connect(),
    healthcheck: async () => {
      try {
        const { rows } = await pool.query('SELECT 1 AS ok');
        return rows[0]?.ok === 1;
      } catch {
        return false;
      }
    },
    totalCount: () => pool.totalCount,
    idleCount: () => pool.idleCount,
    waitingCount: () => pool.waitingCount,
  };
}

module.exports = { wrapPoolAsAdapter, queryWithTimeout };
