// Uploads repository — acceso a tabla uploads (facturas procesadas).
'use strict';

class UploadsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const r = await this.pool.query('SELECT * FROM uploads WHERE id = $1', [id]);
    return r.rows[0] || null;
  }

  async findByUser(userId, { limit = 50, offset = 0 } = {}) {
    const r = await this.pool.query(
      'SELECT * FROM uploads WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    return r.rows;
  }

  async findAll({ limit = 50, offset = 0 } = {}) {
    const r = await this.pool.query(
      'SELECT u.*, us.email FROM uploads u LEFT JOIN users us ON us.id = u.user_id ORDER BY u.uploaded_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return r.rows;
  }

  /**
   * Detecta duplicados por (user_id, nif, fecha, total). Unique constraint en BD
   * es la red de seguridad definitiva; este método evita el INSERT + ROLLBACK.
   */
  async findDuplicate(userId, { nif, fecha, total }) {
    const r = await this.pool.query(
      `SELECT id FROM uploads
       WHERE user_id = $1 AND proveedor_nif = $2 AND fecha_emision = $3 AND total_factura = $4
       LIMIT 1`,
      [userId, nif, fecha, total]
    );
    return r.rows[0] || null;
  }

  async create(data) {
    const cols = [
      'user_id', 'filename', 'mimetype', 'size_bytes', 'file_path',
      'proveedor_nif', 'fecha_emision', 'total_factura', 'numero_factura',
      'ocr_result', 'confidence_level',
      'proveedor_nombre', 'receptor_nombre', 'receptor_nif',
      'base_imponible', 'iva_porcentaje', 'cuota_iva',
      'irpf_porcentaje', 'cuota_irpf', 'moneda',
      'invoice_type', 'lineas_iva', 'iva_validation_ok', 'iva_warnings',
      'client_company_id', 'procesado_en',
    ];
    const values = cols.map((c) => data[c] ?? null);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const r = await this.pool.query(
      `INSERT INTO uploads (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      values
    );
    return r.rows[0];
  }

  async update(id, data) {
    const keys = Object.keys(data);
    if (keys.length === 0) return null;
    const sets = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = [...keys.map((k) => data[k]), id];
    const r = await this.pool.query(
      `UPDATE uploads SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    return r.rows[0] || null;
  }

  async delete(id) {
    await this.pool.query('DELETE FROM uploads WHERE id = $1', [id]);
  }

  async countByUser(userId) {
    const r = await this.pool.query(
      'SELECT COUNT(*)::int AS total FROM uploads WHERE user_id = $1',
      [userId]
    );
    return r.rows[0].total;
  }
}

module.exports = UploadsRepository;
