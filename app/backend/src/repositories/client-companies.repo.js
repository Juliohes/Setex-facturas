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

  async approve(id, adminEmail, codigoCliente = null) {
    const r = await this.pool.query(
      `UPDATE client_companies
       SET pendiente = false, activa = true, approved_at = NOW(), approved_by_email = $1, codigo_cliente = $2
       WHERE id = $3 RETURNING *`,
      [adminEmail, codigoCliente, id]
    );
    return r.rows[0] || null;
  }

  async deactivate(id, reason = null) {
    const r = await this.pool.query(
      `UPDATE client_companies SET activa = false, deactivation_reason = $1 WHERE id = $2 RETURNING *`,
      [reason, id]
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
}

module.exports = ClientCompaniesRepository;
