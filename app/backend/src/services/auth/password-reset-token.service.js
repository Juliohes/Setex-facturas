// Servicio de tokens para password reset. Token crudo viaja al email del usuario;
// BD almacena solo el hash SHA-256. Consumo atómico (UPDATE ... used=true WHERE
// used=false AND expires_at>NOW()) → imposible re-usar ni usar expirado.
'use strict';

const crypto = require('node:crypto');

const TTL_MINUTES = 30;

function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function makePasswordResetTokenService({ authTokensRepo } = {}) {
  if (!authTokensRepo) throw new Error('password-reset-token.service: "authTokensRepo" required');

  async function issue({ userId }) {
    const raw = generateRawToken();
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);
    await authTokensRepo.savePasswordResetToken({ userId, tokenHash, expiresAt });
    return { rawToken: raw, expiresAt };
  }

  async function verify(rawToken) {
    const tokenHash = hashToken(rawToken);
    const record = await authTokensRepo.findPasswordResetToken(tokenHash);
    if (!record) return { ok: false, reason: 'not_found' };
    if (record.used) return { ok: false, reason: 'already_used' };
    if (new Date(record.expires_at) <= new Date()) return { ok: false, reason: 'expired' };
    return { ok: true, userId: record.user_id };
  }

  async function consume(rawToken) {
    const tokenHash = hashToken(rawToken);
    const result = await authTokensRepo.consumePasswordResetToken(tokenHash);
    if (!result) return { ok: false, reason: 'not_found_or_used' };
    return { ok: true, userId: result.user_id };
  }

  return { issue, verify, consume, hashToken, TTL_MINUTES };
}

module.exports = { makePasswordResetTokenService };
