// POST /api/admin/refresh-session — renueva la cookie httpOnly `setex_admin`
// usada por nginx auth_request en /admin-facturas.html.
//
// Flujo: el usuario ya tiene un access token Bearer válido (middleware
// authenticate) y es admin (middleware requireAdmin). Esta ruta solo emite
// la cookie httpOnly equivalente para que nginx la valide en auth_request.
// Llamada por app.js cuando el usuario abre /admin-facturas.html con la cookie
// expirada (tras 8h o tras login fresh).
//
// Cookie payload:
//   { userId, is_admin: true, token_version, type: 'admin_page' }
// Atributos: httpOnly, secure, sameSite='strict', path='/', maxAge 8h.
'use strict';

const jwt = require('jsonwebtoken');

const ADMIN_COOKIE_TTL_HOURS = 8;
const COOKIE_NAME = 'setex_admin';

function makeAdminSessionRefreshController({ jwtSecret, logger } = {}) {
  if (!jwtSecret) {
    throw new Error('admin session-refresh.controller: "jwtSecret" required');
  }

  return function adminSessionRefreshController(req, res) {
    const payload = {
      userId: req.user.userId,
      is_admin: true,
      token_version: req.user.token_version,
      type: 'admin_page',
    };
    const token = jwt.sign(payload, jwtSecret, { expiresIn: `${ADMIN_COOKIE_TTL_HOURS}h` });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: ADMIN_COOKIE_TTL_HOURS * 60 * 60 * 1000,
      path: '/',
    });
    logger?.info?.(`[AdminSession] Cookie admin renovada para userId=${req.user.userId}`);
    res.json({ success: true });
  };
}

module.exports = { makeAdminSessionRefreshController };
