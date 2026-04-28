// Contrato del puerto de tokens auth (refresh + password reset). Hoy backing
// PostgreSQL vía repositories/auth-tokens.repo.js (Round 6). En memoria para tests.
'use strict';

/**
 * @typedef {Object} RefreshTokenRecord
 * @property {string} id                     jti del JWT
 * @property {number} userId
 * @property {Date} expiresAt
 * @property {boolean} revoked
 * @property {string|null} replacedBy        Token de la siguiente rotación
 */

/**
 * @typedef {Object} PasswordResetTokenRecord
 * @property {string} token                  hash del token, no el claro
 * @property {number} userId
 * @property {Date} expiresAt
 * @property {boolean} used
 */

/**
 * @typedef {Object} AuthTokenPort
 * @property {string} name
 * @property {(rec: Omit<RefreshTokenRecord, 'revoked'|'replacedBy'>) => Promise<void>} saveRefreshToken
 * @property {(id: string) => Promise<RefreshTokenRecord|null>} findRefreshToken
 * @property {(id: string, replacedBy: string) => Promise<void>} rotateRefreshToken
 * @property {(userId: number) => Promise<number>} revokeAllRefreshTokens  Devuelve nº revocados
 * @property {(rec: Omit<PasswordResetTokenRecord, 'used'>) => Promise<void>} savePasswordResetToken
 * @property {(tokenHash: string) => Promise<PasswordResetTokenRecord|null>} findPasswordResetToken
 * @property {(tokenHash: string) => Promise<void>} consumePasswordResetToken
 */

function assertAuthTokenPort(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('AuthTokenPort: candidate must be an object');
  }
  const required = [
    'name',
    'saveRefreshToken',
    'findRefreshToken',
    'rotateRefreshToken',
    'revokeAllRefreshTokens',
    'savePasswordResetToken',
    'findPasswordResetToken',
    'consumePasswordResetToken',
  ];
  for (const field of required) {
    if (candidate[field] === undefined) {
      throw new Error(`AuthTokenPort: missing "${field}"`);
    }
  }
  return candidate;
}

module.exports = { assertAuthTokenPort };
