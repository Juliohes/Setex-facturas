// Auth tokens repository — cubre `refresh_tokens` y `password_reset_tokens`.
// Centraliza el acceso a ambas tablas porque su ciclo de vida es similar
// (crear/verificar/consumir/revocar) y así services/auth consume una única
// dependencia en lugar de dos repos separados.
'use strict';

class AuthTokensRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // ── Refresh tokens (rotación + familia) ───────────────────────────────────

  async saveRefreshToken({ userId, tokenHash, familyId, expiresAt }) {
    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, tokenHash, familyId, expiresAt]
    );
  }

  async findRefreshToken(tokenHash) {
    const r = await this.pool.query(
      `SELECT id, user_id, token_hash, family_id, expires_at, revoked, revoked_at, replaced_by_hash
       FROM refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );
    return r.rows[0] || null;
  }

  async rotateRefreshToken({ oldHash, newHash, familyId, userId, expiresAt }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE refresh_tokens
         SET revoked = true, revoked_at = NOW(), replaced_by_hash = $1
         WHERE token_hash = $2 AND revoked = false`,
        [newHash, oldHash]
      );
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, newHash, familyId, expiresAt]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async revokeFamily(familyId) {
    const r = await this.pool.query(
      `UPDATE refresh_tokens
       SET revoked = true, revoked_at = NOW()
       WHERE family_id = $1 AND revoked = false`,
      [familyId]
    );
    return r.rowCount;
  }

  async revokeAllForUser(userId) {
    const r = await this.pool.query(
      `UPDATE refresh_tokens
       SET revoked = true, revoked_at = NOW()
       WHERE user_id = $1 AND revoked = false`,
      [userId]
    );
    return r.rowCount;
  }

  async deleteExpired() {
    const r = await this.pool.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW()`
    );
    return r.rowCount;
  }

  // ── Password reset tokens ─────────────────────────────────────────────────

  async savePasswordResetToken({ userId, tokenHash, expiresAt }) {
    await this.pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt]
    );
  }

  async findPasswordResetToken(tokenHash) {
    const r = await this.pool.query(
      `SELECT id, user_id, token_hash, expires_at, used
       FROM password_reset_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );
    return r.rows[0] || null;
  }

  async consumePasswordResetToken(tokenHash) {
    const r = await this.pool.query(
      `UPDATE password_reset_tokens SET used = true
       WHERE token_hash = $1 AND used = false AND expires_at > NOW()
       RETURNING id, user_id`,
      [tokenHash]
    );
    return r.rows[0] || null;
  }
}

module.exports = AuthTokensRepository;
