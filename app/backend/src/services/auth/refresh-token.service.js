// Servicio de rotación de refresh tokens.
// Política:
//  - Cada refresh recibido se valida: existe en BD, no revocado, no expirado.
//  - Se emite uno nuevo y se marca el anterior como revocado con replaced_by_hash.
//  - Si llega un token ya revocado con replaced_by_hash ≠ null → REUSE DETECTION:
//    se revoca toda la familia (cierra sesión del atacante Y del usuario legítimo).
//  - logout revoca todos los RT del usuario.
'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const RT_TTL_DAYS = 7;
const RT_TTL_SECONDS = RT_TTL_DAYS * 24 * 60 * 60;

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function makeRefreshTokenService({ authTokensRepo, jwtSecret, logger } = {}) {
  if (!authTokensRepo) throw new Error('refresh-token.service: "authTokensRepo" required');
  if (!jwtSecret) throw new Error('refresh-token.service: "jwtSecret" required');

  async function issue({ userId, email }) {
    const familyId = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign({ userId, email, familyId }, jwtSecret, { expiresIn: `${RT_TTL_DAYS}d` });
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RT_TTL_SECONDS * 1000);
    await authTokensRepo.saveRefreshToken({ userId, tokenHash, familyId, expiresAt });
    return { token, familyId, expiresAt };
  }

  async function rotate(oldToken) {
    let payload;
    try {
      payload = jwt.verify(oldToken, jwtSecret);
    } catch {
      return { ok: false, reason: 'invalid_token' };
    }
    const oldHash = hashToken(oldToken);
    const record = await authTokensRepo.findRefreshToken(oldHash);
    if (!record) return { ok: false, reason: 'not_found' };

    if (record.revoked && record.replaced_by_hash) {
      logger?.warn?.('refresh-token REUSE detected — revoking family', {
        familyId: record.family_id,
        userId: record.user_id,
      });
      await authTokensRepo.revokeFamily(record.family_id);
      return { ok: false, reason: 'reuse_detected', familyRevoked: true };
    }
    if (record.revoked) return { ok: false, reason: 'already_revoked' };
    if (new Date(record.expires_at) <= new Date()) return { ok: false, reason: 'expired' };

    const newToken = jwt.sign(
      { userId: record.user_id, email: payload.email, familyId: record.family_id },
      jwtSecret,
      { expiresIn: `${RT_TTL_DAYS}d` }
    );
    const newHash = hashToken(newToken);
    const expiresAt = new Date(Date.now() + RT_TTL_SECONDS * 1000);
    await authTokensRepo.rotateRefreshToken({
      oldHash,
      newHash,
      familyId: record.family_id,
      userId: record.user_id,
      expiresAt,
    });
    return { ok: true, token: newToken, familyId: record.family_id, expiresAt };
  }

  async function logout({ userId }) {
    return authTokensRepo.revokeAllForUser(userId);
  }

  async function cleanupExpired() {
    return authTokensRepo.deleteExpired();
  }

  return { issue, rotate, logout, cleanupExpired, hashToken };
}

module.exports = { makeRefreshTokenService, hashToken };
