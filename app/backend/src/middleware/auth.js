// Middleware de autenticación y autorización.
//
// Todos los middleware aquí son FACTORIES que reciben deps por destructuring
// (patrón DI — ver ADR-0005). En Round 9 se cablean desde el container; hasta
// entonces se pueden usar directamente:
//   const { makeAuthenticate } = require('./middleware/auth');
//   app.use(makeAuthenticate({ pool, jwtSecret, logger }));
'use strict';

const jwt = require('jsonwebtoken');

function makeAuthenticate({ pool, jwtSecret, logger }) {
  if (!pool) throw new Error('auth middleware: "pool" required');
  if (!jwtSecret) throw new Error('auth middleware: "jwtSecret" required');

  return async function authenticate(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    let user;
    try {
      user = jwt.verify(token, jwtSecret);
    } catch {
      return res.status(403).json({ error: 'Token inválido' });
    }

    if (user?.userId && user.token_version !== undefined) {
      try {
        const { rows } = await pool.query(
          'SELECT token_version, is_admin FROM users WHERE id = $1',
          [user.userId]
        );
        if (rows.length === 0) {
          return res.status(403).json({ error: 'Usuario no encontrado' });
        }
        if (rows[0].token_version !== user.token_version) {
          return res.status(403).json({ error: 'Sesión expirada. Vuelve a iniciar sesión.' });
        }
        user.is_admin = rows[0].is_admin;
      } catch (err) {
        logger?.error?.('token_version DB check failed (fail-secure)', { message: err.message });
        return res.status(503).json({ error: 'Servicio temporalmente no disponible. Inténtalo en unos segundos.' });
      }
    }

    req.user = user;
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Permisos insuficientes' });
  next();
}

function makeRequireActiveCompany({ pool, logger }) {
  if (!pool) throw new Error('requireActiveCompany: "pool" required');

  return async function requireActiveCompany(req, res, next) {
    if (!req.user?.userId) return res.status(401).json({ error: 'No autenticado' });

    try {
      const { rows } = await pool.query(
        `SELECT cc.status FROM client_companies cc
         WHERE cc.nif = (SELECT company_nif FROM users WHERE id = $1)
         LIMIT 1`,
        [req.user.userId]
      );
      const status = rows[0]?.status;
      if (status === 'active') return next();
      if (status === 'pending') {
        return res.status(403).json({ error: 'Empresa pendiente de aprobación', company_status: 'pending' });
      }
      return res.status(403).json({ error: 'Empresa no activa', company_status: status || 'unknown' });
    } catch (err) {
      logger?.error?.('requireActiveCompany DB error', { message: err.message });
      return res.status(503).json({ error: 'Servicio no disponible' });
    }
  };
}

function requireXHR(req, res, next) {
  const xrw = req.headers['x-requested-with'];
  if (xrw !== 'XMLHttpRequest') {
    return res.status(400).json({ error: 'Petición inválida' });
  }
  next();
}

module.exports = {
  makeAuthenticate,
  requireAdmin,
  makeRequireActiveCompany,
  requireXHR,
};
