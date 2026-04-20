// Base repository — utilidades compartidas para todos los repos.
// Incluye wrapper de transacción para operaciones atómicas multi-tabla.
'use strict';

/**
 * Ejecuta una función dentro de una transacción PostgreSQL.
 * Commit automático al completar, rollback si lanza.
 *
 * @param {Pool} pool - pg Pool
 * @param {Function} fn - async (client) => any
 * @returns {Promise<any>} lo que devuelva fn
 *
 * Ejemplo:
 *   const user = await withTransaction(pool, async (client) => {
 *     await client.query('INSERT INTO users ...');
 *     return client.query('SELECT ...').then(r => r.rows[0]);
 *   });
 */
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
