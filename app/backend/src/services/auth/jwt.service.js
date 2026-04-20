// JWT service — access token + refresh token con rotación.
//
// Política:
//  - Access token (AT): 15 min, firmado con JWT_SECRET, contiene userId + email + token_version + is_admin
//  - Refresh token (RT): 7 días, firmado igual, reuse detection via BD
//
// En Fase 3: migrar AT a cookie httpOnly (elimina XSS vector de robo).
'use strict';

const jwt = require('jsonwebtoken');

const AT_TTL = '15m';
const RT_TTL = '7d';

function createAccessToken(secret, payload) {
  return jwt.sign(payload, secret, { expiresIn: AT_TTL });
}

function createRefreshToken(secret, payload) {
  return jwt.sign(payload, secret, { expiresIn: RT_TTL });
}

function verifyToken(secret, token) {
  try {
    return { ok: true, payload: jwt.verify(token, secret) };
  } catch (err) {
    return { ok: false, error: err.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
}

/**
 * Factory con el secret inyectado. Uso:
 *   const jwtSvc = createJwtService(secret);
 *   const at = jwtSvc.createAccessToken({ userId: 1, email: '...', token_version: 2, is_admin: false });
 */
function createJwtService(secret) {
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    throw new Error('JWT secret debe ser string de >= 32 caracteres');
  }
  return {
    createAccessToken: (payload) => createAccessToken(secret, payload),
    createRefreshToken: (payload) => createRefreshToken(secret, payload),
    verifyToken: (token) => verifyToken(secret, token),
  };
}

module.exports = {
  createJwtService,
  createAccessToken,
  createRefreshToken,
  verifyToken,
  AT_TTL,
  RT_TTL,
};
