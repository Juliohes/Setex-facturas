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
   *
   * Dual signature:
   *   findDuplicate(userId, { nif, fecha, total })                        (legacy)
   *   findDuplicate({ userId, proveedorNif, fechaEmision, totalFactura }) (v3 service)
   */
  async findDuplicate(arg1, arg2) {
    let userId, nif, fecha, total;
    if (typeof arg1 === 'object' && arg1 !== null && arg2 === undefined) {
      userId = arg1.userId;
      nif = arg1.proveedorNif;
      fecha = arg1.fechaEmision;
      total = arg1.totalFactura;
    } else {
      userId = arg1;
      nif = arg2?.nif;
      fecha = arg2?.fecha;
      total = arg2?.total;
    }
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

  // ── Métodos añadidos para controllers v3 (Round 16.1) ──────────────────────

  /**
   * Variante con shape moderno para servicios v3 (deduplication.service).
   * Mantiene el método viejo `findDuplicate(userId, {nif, fecha, total})` intacto.
   */
  async findDuplicateV2({ userId, proveedorNif, fechaEmision, totalFactura }) {
    return this.findDuplicate(userId, { nif: proveedorNif, fecha: fechaEmision, total: totalFactura });
  }

  /**
   * Alias del legacy: invoice-persist.service espera createOrUpdate.
   * Como el flujo actual solo inserta (dedup se hace antes), delega en create.
   */
  async createOrUpdate({ userId, payload }) {
    return this.create({ ...payload, user_id: userId, procesado_en: new Date() });
  }

  async listRecentByUser({ userId, limit = 50, days = 7 }) {
    const r = await this.pool.query(
      `SELECT id, filename, proveedor_nif, proveedor_nombre, fecha_emision,
              total_factura, base_imponible, cuota_iva, numero_factura,
              lineas_iva, invoice_type, procesado_en, uploaded_at
       FROM uploads
       WHERE user_id = $1 AND uploaded_at >= NOW() - ($2 || ' days')::interval
       ORDER BY uploaded_at DESC
       LIMIT $3`,
      [userId, String(days), limit]
    );
    return r.rows;
  }

  async listByUserForExport({ userId, days = 90 }) {
    const r = await this.pool.query(
      `SELECT * FROM uploads
       WHERE user_id = $1 AND uploaded_at >= NOW() - ($2 || ' days')::interval
       ORDER BY uploaded_at DESC`,
      [userId, String(days)]
    );
    return r.rows;
  }

  async listForAdmin({ userId, cif, fechaDesde, fechaHasta, status, limit = 500 }) {
    const where = ['1 = 1'];
    const params = [];
    if (userId) { params.push(userId); where.push(`u.user_id = $${params.length}`); }
    if (cif) { params.push(cif); where.push(`UPPER(u.proveedor_nif) = $${params.length}`); }
    if (fechaDesde) { params.push(fechaDesde); where.push(`u.fecha_emision >= $${params.length}`); }
    if (fechaHasta) { params.push(fechaHasta); where.push(`u.fecha_emision <= $${params.length}`); }
    if (status) { params.push(status); where.push(`u.upload_status = $${params.length}`); }
    params.push(limit);
    const r = await this.pool.query(
      `SELECT u.*, us.email AS user_email FROM uploads u
       LEFT JOIN users us ON us.id = u.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.uploaded_at DESC
       LIMIT $${params.length}`,
      params
    );
    return r.rows;
  }

  async listDistinctUploaders() {
    const r = await this.pool.query(
      `SELECT DISTINCT us.id, us.email, COUNT(u.id)::int AS upload_count
       FROM users us
       INNER JOIN uploads u ON u.user_id = us.id
       GROUP BY us.id, us.email
       ORDER BY upload_count DESC`
    );
    return r.rows;
  }

  async listAllForExport({ userId, cif, fechaDesde, fechaHasta }) {
    return this.listForAdmin({ userId, cif, fechaDesde, fechaHasta, limit: 50000 });
  }

  async adminUpdate(id, fields) {
    return this.update(id, fields);
  }

  async deleteById(id) {
    const r = await this.pool.query('DELETE FROM uploads WHERE id = $1 RETURNING id', [id]);
    return r.rows[0] || null;
  }

  async attachCompanyByCif({ companyId, cif, newStatus = 'active' }) {
    const r = await this.pool.query(
      `UPDATE uploads SET client_company_id = $1, upload_status = $2
       WHERE UPPER(proveedor_nif) = $3 OR UPPER(receptor_nif) = $3`,
      [companyId, newStatus, cif]
    );
    return r.rowCount;
  }

  async redirectToTargetCompany({ sourceCompanyId, targetCompanyId }) {
    const r = await this.pool.query(
      `UPDATE uploads SET client_company_id = $1 WHERE client_company_id = $2`,
      [targetCompanyId, sourceCompanyId]
    );
    return r.rowCount;
  }
}

module.exports = UploadsRepository;
