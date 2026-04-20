// Audit repository — queries sobre audit_logs.
// Separado del services/audit/audit.service.js porque esta capa solo hace SQL;
// el service añade políticas (fallo no bloquea, inyección deps, etc.).
'use strict';

class AuditRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Inserta un evento. Bajo nivel, sin protección contra fallos.
   * En producción usar services/audit/audit.service.js que aplica la política.
   */
  async insert({ userId, action, details, ipAddress }) {
    await this.pool.query(
      'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [userId || null, action, JSON.stringify(details), ipAddress || null]
    );
  }

  async findByUser(userId, { limit = 100 } = {}) {
    const r = await this.pool.query(
      'SELECT * FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return r.rows;
  }

  async findByAction(action, { limit = 100, since = null } = {}) {
    const params = [action, limit];
    let sql = 'SELECT * FROM audit_logs WHERE action = $1';
    if (since) {
      params.push(since);
      sql += ` AND created_at >= $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC LIMIT $2';
    const r = await this.pool.query(sql, params);
    return r.rows;
  }

  async countByActionRecent(action, intervalMinutes = 60) {
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_logs
       WHERE action = $1 AND created_at >= NOW() - INTERVAL '${intervalMinutes} minutes'`,
      [action]
    );
    return r.rows[0].total;
  }

  /**
   * Retention: elimina logs antiguos. Política RGPD: >5 años.
   * Retorna filas eliminadas.
   */
  async deleteOlderThan(days = 1825) {
    const r = await this.pool.query(
      `DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '${days} days' RETURNING id`
    );
    return r.rowCount;
  }
}

module.exports = AuditRepository;
