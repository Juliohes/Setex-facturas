// Company catalog repository — catálogo global de contrapartes (proveedores/clientes
// detectados en facturas procesadas). Usa pg_trgm para fuzzy matching por nombre.
// Se alimenta en /api/upload-confirm cuando el OCR resuelve un nuevo proveedor.
'use strict';

class CompanyCatalogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findByNif(nif) {
    const r = await this.pool.query(
      `SELECT id, proveedor_nombre, proveedor_nombre_norm, proveedor_nif, notas, created_at
       FROM company_catalog
       WHERE proveedor_nif = $1`,
      [nif]
    );
    return r.rows[0] || null;
  }

  /**
   * Fuzzy search por similitud de nombre (pg_trgm).
   * @param {number} threshold 0..1 (default 0.3)
   * @param {number} limit default 10
   */
  async findByNombreFuzzy(nombreNorm, { threshold = 0.3, limit = 10 } = {}) {
    const r = await this.pool.query(
      `SELECT proveedor_nombre, proveedor_nif,
              similarity(proveedor_nombre_norm, $1) AS score
       FROM company_catalog
       WHERE proveedor_nombre_norm % $1
       ORDER BY score DESC
       LIMIT $2`,
      [nombreNorm, limit]
    );
    return r.rows.filter((row) => row.score >= threshold);
  }

  async upsert({ nombre, nombreNorm, nif, createdBy, notas = null }) {
    const r = await this.pool.query(
      `INSERT INTO company_catalog (proveedor_nombre, proveedor_nombre_norm, proveedor_nif, created_by, notas)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (proveedor_nif)
       DO UPDATE SET proveedor_nombre = EXCLUDED.proveedor_nombre,
                     proveedor_nombre_norm = EXCLUDED.proveedor_nombre_norm,
                     updated_at = NOW()
       RETURNING id`,
      [nombre, nombreNorm, nif, createdBy || null, notas]
    );
    return r.rows[0];
  }

  async listAll({ limit = 500, offset = 0 } = {}) {
    const r = await this.pool.query(
      `SELECT id, proveedor_nombre, proveedor_nif, created_at
       FROM company_catalog
       ORDER BY proveedor_nombre ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return r.rows;
  }

  async deleteById(id) {
    const r = await this.pool.query(`DELETE FROM company_catalog WHERE id = $1`, [id]);
    return r.rowCount;
  }
}

module.exports = CompanyCatalogRepository;
