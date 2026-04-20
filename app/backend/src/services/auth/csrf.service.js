// CSRF service — double-submit cookie pattern (stateless).
//
// Flujo:
//  1. En login/sesión activa, servidor emite cookie `csrf-token` (NO httpOnly, SameSite=Strict, Secure)
//     con un valor aleatorio criptográficamente seguro.
//  2. Cliente JS lee la cookie y la envía en header `X-CSRF-Token` en cada POST/PUT/DELETE/PATCH.
//  3. Middleware compara cookie vs header. Si no match → 403.
//
// Defensa contra CSRF cross-subdomain y contra attackers con XSS previo (que no pueden
// leer la cookie sin mismo origen).
'use strict';

const crypto = require('crypto');

const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function validateDoubleSubmit(req) {
  const headerToken = req.headers[CSRF_HEADER_NAME];
  const cookieToken = req.cookies && req.cookies[CSRF_COOKIE_NAME];
  if (!headerToken || !cookieToken) return { valid: false, reason: 'missing' };
  if (headerToken.length < 32 || cookieToken.length < 32) return { valid: false, reason: 'too_short' };
  // crypto.timingSafeEqual requiere Buffers de misma longitud
  try {
    const a = Buffer.from(headerToken);
    const b = Buffer.from(cookieToken);
    if (a.length !== b.length) return { valid: false, reason: 'mismatch' };
    return { valid: crypto.timingSafeEqual(a, b), reason: 'checked' };
  } catch {
    return { valid: false, reason: 'error' };
  }
}

/**
 * Middleware Express — protege rutas mutantes.
 * Métodos seguros (GET, HEAD, OPTIONS) pasan sin validar.
 */
function csrfMiddleware(req, res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'];
  if (safe.includes(req.method)) return next();
  const result = validateDoubleSubmit(req);
  if (!result.valid) {
    return res.status(403).json({ error: 'CSRF token inválido', reason: result.reason });
  }
  next();
}

function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,       // DEBE ser leíble por JS
    secure: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
  });
}

module.exports = {
  generateToken,
  validateDoubleSubmit,
  csrfMiddleware,
  setCsrfCookie,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
};
