// Client companies repository — empresas cliente de SETEX.
// Tabla client_companies: catálogo de empresas que SETEX gestiona contablemente.
'use strict';

class ClientCompaniesRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const r = await this.pool.query('SELECT * FROM client_companies WHERE id = $1', [id]);
    return r.rows[0] || null;
  }

  async findByCif(cif) {
    const clean = cif.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const r = await this.pool.query(
      `SELECT * FROM client_companies
       WHERE UPPER(REPLACE(cif, ' ', '')) = $1 LIMIT 1`,
      [clean]
    );
    return r.rows[0] || null;
  }

  async findActiveAll() {
    const r = await this.pool.query(
      `SELECT id, nombre, cif, codigo_cliente FROM client_companies
       WHERE activa = true AND pendiente = false
       ORDER BY nombre ASC`
    );
    return r.rows;
  }

  async findPending() {
    const r = await this.pool.query(
      `SELECT * FROM client_companies
       WHERE pendiente = true
       ORDER BY requested_at DESC`
    );
    return r.rows;
  }

  async create({ nombre, cif, requestedByEmail = null, pendiente = true }) {
    const r = await this.pool.query(
      `INSERT INTO client_companies (nombre, cif, requested_by_email, requested_at, pendiente, activa)
       VALUES ($1, $2, $3, NOW(), $4, $5)
       RETURNING *`,
      [nombre, cif, requestedByEmail, pendiente, !pendiente]
    );
    return r.rows[0];
  }

  async approve(arg1, arg2) {
    // Dual signature: approve(id, userId) (legacy) | approve({ id, adminId }) (v3)
    const id = typeof arg1 === 'object' ? arg1.id : arg1;
    const adminId = typeof arg1 === 'object' ? arg1.adminId : arg2;
    const r = await this.pool.query(
      `UPDATE client_companies
       SET pendiente = false, activa = true, reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 RETURNING *`,
      [adminId, id]
    );
    return r.rows[0] || null;
  }

  async reject(arg1, arg2, arg3) {
    // Dual signature: reject(id, userId, reason?) | reject({ id, adminId, reason })
    const id = typeof arg1 === 'object' ? arg1.id : arg1;
    const adminId = typeof arg1 === 'object' ? arg1.adminId : arg2;
    const reason = typeof arg1 === 'object' ? (arg1.reason ?? null) : (arg3 ?? null);
    const r = await this.pool.query(
      `UPDATE client_companies
       SET pendiente = false, activa = false, reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3 RETURNING *`,
      [adminId, reason, id]
    );
    return r.rows[0] || null;
  }

  async updateRequestedBy(id, email) {
    await this.pool.query(
      `UPDATE client_companies SET requested_by_email = COALESCE(requested_by_email, $1),
       requested_at = COALESCE(requested_at, NOW()) WHERE id = $2`,
      [email, id]
    );
  }

  /**
   * Búsqueda fuzzy por CIF para sugerencias cuando un usuario registra CIF no encontrado.
   * Útil para detectar typos (ej: B42634044 sugiere B42634048).
   */
  async findSimilarByCif(cif, limit = 5) {
    const clean = cif.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length < 3) return [];
    const prefix = clean.substring(0, Math.min(5, clean.length - 2));
    const r = await this.pool.query(
      `SELECT id, nombre, cif FROM client_companies
       WHERE activa = true AND pendiente = false
       AND UPPER(REPLACE(cif, ' ', '')) LIKE $1
       LIMIT $2`,
      [`${prefix}%`, limit]
    );
    return r.rows;
  }

  // ── Alias y variantes añadidas para controllers v3 (Round 16.1) ────────────

  async listActive() { return this.findActiveAll(); }
  async listPending() { return this.findPending(); }

  async listAllForAdmin() {
    const r = await this.pool.query(
      `SELECT * FROM client_companies ORDER BY nombre ASC`
    );
    return r.rows;
  }

  async createPending({ nombre, cif, requestedByEmail }) {
    return this.create({ nombre, cif, requestedByEmail, pendiente: true });
  }

  async update(id, fields) {
    const allowed = ['nombre', 'codigo_cliente', 'activa', 'notas'];
    const sets = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        values.push(fields[key]);
      }
    }
    if (sets.length === 0) return null;
    values.push(id);
    const r = await this.pool.query(
      `UPDATE client_companies SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${i} RETURNING *`,
      values
    );
    return r.rows[0] || null;
  }

  async softDelete(id) {
    const r = await this.pool.query(
      `UPDATE client_companies SET activa = false, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return r.rows[0] || null;
  }

  async hardDelete(id) {
    const r = await this.pool.query(
      `DELETE FROM client_companies WHERE id = $1 RETURNING id`,
      [id]
    );
    return r.rows[0] || null;
  }

  async linkToExisting({ pendingId, targetId, adminId }) {
    const r = await this.pool.query(
      `UPDATE client_companies
       SET linked_to_company_id = $1, pendiente = false, activa = false,
           reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3 RETURNING *`,
      [targetId, adminId, pendingId]
    );
    return r.rows[0] || null;
  }

  async countPending() {
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM client_companies WHERE pendiente = true`
    );
    return r.rows[0].total;
  }

}

module.exports = ClientCompaniesRepository;
