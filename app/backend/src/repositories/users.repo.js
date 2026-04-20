// Users repository — acceso a la tabla users.
// ÚNICA capa que toca BD para este recurso. Centraliza queries, facilita
// testing (mock del pool) y migración futura (cambio de ORM sin tocar services).
'use strict';

class UsersRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const r = await this.pool.query(
      'SELECT id, email, company_name, company_nif, is_admin, auto_confirm_enabled, token_version, created_at FROM users WHERE id = $1',
      [id]
    );
    return r.rows[0] || null;
  }

  async findByEmail(email) {
    const r = await this.pool.query(
      'SELECT id, email, password_hash, company_name, company_nif, is_admin, token_version FROM users WHERE email = $1',
      [email]
    );
    return r.rows[0] || null;
  }

  async create({ email, passwordHash, companyName, companyNif, isAdmin = false }) {
    const r = await this.pool.query(
      `INSERT INTO users (email, password_hash, company_name, company_nif, is_admin)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, company_name, company_nif, is_admin`,
      [email, passwordHash, companyName || null, companyNif || null, isAdmin]
    );
    return r.rows[0];
  }

  async updateCompany(userId, { companyNif, companyName }) {
    const updates = [];
    const values = [];
    let i = 1;
    if (companyNif !== undefined) {
      updates.push(`company_nif = $${i++}`);
      values.push(companyNif);
    }
    if (companyName !== undefined) {
      updates.push(`company_name = $${i++}`);
      values.push(companyName);
    }
    if (updates.length === 0) return null;
    values.push(userId);
    const r = await this.pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, company_nif, company_name`,
      values
    );
    return r.rows[0] || null;
  }

  async updatePassword(userId, passwordHash) {
    await this.pool.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [passwordHash, userId]
    );
  }

  async incrementTokenVersion(userId) {
    await this.pool.query(
      'UPDATE users SET token_version = token_version + 1 WHERE id = $1',
      [userId]
    );
  }

  async verifyTokenVersion(userId, tokenVersion) {
    const r = await this.pool.query(
      'SELECT token_version, is_admin FROM users WHERE id = $1',
      [userId]
    );
    if (r.rows.length === 0) return { exists: false };
    return {
      exists: true,
      match: r.rows[0].token_version === tokenVersion,
      isAdmin: r.rows[0].is_admin === true,
    };
  }

  async setAutoConfirm(userId, enabled) {
    await this.pool.query(
      'UPDATE users SET auto_confirm_enabled = $1 WHERE id = $2',
      [enabled, userId]
    );
  }

  /**
   * Borrado en cascada (usuarios + uploads). Para endpoint /api/me/delete-account (RGPD).
   * Requiere transacción.
   */
  async deleteWithUploads(userId, client) {
    await client.query('DELETE FROM uploads WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM audit_logs WHERE user_id = $1', [userId]);
    const r = await client.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, email',
      [userId]
    );
    return r.rows[0] || null;
  }

  async exportUserData(userId) {
    const user = await this.findById(userId);
    if (!user) return null;
    const uploads = await this.pool.query(
      'SELECT * FROM uploads WHERE user_id = $1 ORDER BY uploaded_at DESC',
      [userId]
    );
    return { user, uploads: uploads.rows };
  }
}

module.exports = UsersRepository;
