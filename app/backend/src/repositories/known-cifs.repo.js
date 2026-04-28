// Known CIFs repository — caché de proveedores confirmados por usuario.
// Forma la Capa 3 del sistema anti-fallo de CIF/NIF (ver INFORME sec. 6):
// si el OCR produce un nombre de proveedor cercano a uno ya visto por el
// usuario, se valida el CIF contra la caché antes de aceptar.
'use strict';

class KnownCifsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findByUserAndNombreNorm(userId, nombreNorm) {
    const r = await this.pool.query(
      `SELECT id, proveedor_nombre_norm, proveedor_nif, confirmations, last_seen
       FROM known_cifs
       WHERE user_id = $1 AND proveedor_nombre_norm = $2
       LIMIT 1`,
      [userId, nombreNorm]
    );
    return r.rows[0] || null;
  }

  async findByUserAndNif(userId, nif) {
    const r = await this.pool.query(
      `SELECT id, proveedor_nombre_norm, proveedor_nif, confirmations, last_seen
       FROM known_cifs
       WHERE user_id = $1 AND proveedor_nif = $2`,
      [userId, nif]
    );
    return r.rows;
  }

  async listByUser(userId, { limit = 200 } = {}) {
    const r = await this.pool.query(
      `SELECT proveedor_nombre_norm, proveedor_nif, confirmations, last_seen
       FROM known_cifs
       WHERE user_id = $1
       ORDER BY confirmations DESC, last_seen DESC
       LIMIT $2`,
      [userId, limit]
    );
    return r.rows;
  }

  async upsert({ userId, nombreNorm, nif }) {
    const r = await this.pool.query(
      `INSERT INTO known_cifs (user_id, proveedor_nombre_norm, proveedor_nif, confirmations, last_seen)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (user_id, proveedor_nombre_norm)
       WHERE user_id IS NOT NULL
       DO UPDATE SET confirmations = known_cifs.confirmations + 1,
                     proveedor_nif = EXCLUDED.proveedor_nif,
                     last_seen = NOW()
       RETURNING id, confirmations`,
      [userId, nombreNorm, nif]
    );
    return r.rows[0];
  }

  async deleteByUser(userId) {
    const r = await this.pool.query(
      `DELETE FROM known_cifs WHERE user_id = $1`,
      [userId]
    );
    return r.rowCount;
  }
}

module.exports = KnownCifsRepository;
