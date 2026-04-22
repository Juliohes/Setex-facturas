// Verificación de access tokens con chequeo de token_version en BD.
// Todas las consultas usan queryWithTimeout (500ms) para no bloquear el pool
// en caso de degradación PostgreSQL. Política fail-secure: si la BD no responde
// se rechaza el token (no quedan tokens revocados activos durante caída).
'use strict';

const { verifyToken } = require('./jwt.service');

const DEFAULT_TIMEOUT_MS = 500;

function makeTokenVerificationService({ db, jwtSecret, logger } = {}) {
  if (!db?.queryWithTimeout) {
    throw new Error('token-verification.service: "db" con queryWithTimeout requerido');
  }
  if (!jwtSecret) throw new Error('token-verification.service: "jwtSecret" requerido');

  async function verify(token) {
    const { ok, payload, error } = verifyToken(jwtSecret, token);
    if (!ok) return { ok: false, reason: error };

    if (!payload.userId || payload.token_version === undefined) {
      return { ok: true, user: payload, strict: false };
    }

    try {
      const result = await db.queryWithTimeout(
        'SELECT token_version, is_admin FROM users WHERE id = $1',
        [payload.userId],
        { timeoutMs: DEFAULT_TIMEOUT_MS, label: 'token-verification' }
      );
      const row = result.rows[0];
      if (!row) return { ok: false, reason: 'user_not_found' };
      if (row.token_version !== payload.token_version) {
        return { ok: false, reason: 'token_revoked' };
      }
      return {
        ok: true,
        user: { ...payload, is_admin: row.is_admin === true },
        strict: true,
      };
    } catch (err) {
      logger?.error?.('token-verification fail-secure', {
        message: err.message,
        userId: payload.userId,
      });
      return { ok: false, reason: 'db_unavailable', retriable: true };
    }
  }

  return { verify };
}

module.exports = { makeTokenVerificationService };
