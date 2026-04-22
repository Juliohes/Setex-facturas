// Company audit log repository — registro de acciones admin sobre empresas cliente
// (approve/reject/link/merge/etc.). Se consulta en el modal "Historial" del panel admin.
'use strict';

class CompanyAuditLogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async log({ companyId, adminId, action, notes = null, metadata = null }) {
    const r = await this.pool.query(
      `INSERT INTO company_audit_log (company_id, admin_id, action, notes, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [companyId, adminId || null, action, notes, metadata ? JSON.stringify(metadata) : null]
    );
    return r.rows[0];
  }

  async findByCompany(companyId, { limit = 100 } = {}) {
    const r = await this.pool.query(
      `SELECT cal.id, cal.action, cal.notes, cal.metadata, cal.created_at,
              u.email AS admin_email
       FROM company_audit_log cal
       LEFT JOIN users u ON u.id = cal.admin_id
       WHERE cal.company_id = $1
       ORDER BY cal.created_at DESC
       LIMIT $2`,
      [companyId, limit]
    );
    return r.rows;
  }

  async findLatest({ limit = 50 } = {}) {
    const r = await this.pool.query(
      `SELECT cal.id, cal.company_id, cal.action, cal.notes, cal.created_at,
              cc.nombre AS company_nombre, cc.cif AS company_cif,
              u.email AS admin_email
       FROM company_audit_log cal
       LEFT JOIN client_companies cc ON cc.id = cal.company_id
       LEFT JOIN users u ON u.id = cal.admin_id
       ORDER BY cal.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return r.rows;
  }

  async countByAction(action, { since = null } = {}) {
    const params = [action];
    let whereSince = '';
    if (since) {
      params.push(since);
      whereSince = ` AND created_at >= $2`;
    }
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM company_audit_log
       WHERE action = $1${whereSince}`,
      params
    );
    return r.rows[0].total;
  }
}

module.exports = CompanyAuditLogRepository;
