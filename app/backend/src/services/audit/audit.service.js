// Audit service — registro de eventos en audit_logs para compliance (RGPD art. 32).
// Política: NUNCA deja que un fallo de audit bloquee la operación de negocio.
// Si la inserción falla (BD caída, disco lleno), se loguea warning pero el flujo sigue.
// Para operaciones donde el audit es obligatorio legal, usar flujo síncrono separado.
'use strict';

/**
 * Registra un evento en audit_logs.
 *
 * @param {object} deps - Dependencias inyectadas (pool, logger)
 * @param {string} action - Nombre del evento (REGISTER_SUCCESS, LOGIN_BLOCKED, etc.)
 * @param {object} details - Metadatos del evento (se serializa a JSONB)
 * @param {number|null} userId - ID del usuario afectado (puede ser null)
 * @param {string|null} ip - IP del request (se limpia prefijo IPv4-mapped)
 * @returns {Promise<void>}
 */
async function auditLog({ pool, logger }, action, details, userId, ip) {
  try {
    const cleanIp = ip ? String(ip).replace(/^::ffff:/, '') : null;
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [userId || null, action, JSON.stringify(details), cleanIp]
    );
  } catch (err) {
    logger.warn('Audit log write failed', { action, error: err.message });
  }
}

/**
 * Factory que devuelve una función auditLog con dependencias ya inyectadas.
 * Uso: const audit = createAuditLogger(pool, logger);
 *      await audit('LOGIN_OK', {...}, userId, ip);
 *
 * Facilita el consumo en servicios/controllers sin propagar pool+logger por todas partes.
 */
function createAuditLogger(pool, logger) {
  return (action, details, userId, ip) =>
    auditLog({ pool, logger }, action, details, userId, ip);
}

module.exports = { auditLog, createAuditLogger };
