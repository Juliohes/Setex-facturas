// Refresh controller. Rota el refresh token (cookie httpOnly). Si detecta reuse,
// revoca toda la familia y devuelve 401.
'use strict';

const jwt = require('jsonwebtoken');

function setRefreshCookie(res, token, expiresAt) {
  res.cookie('rt', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    expires: expiresAt,
    path: '/api/auth',
  });
}

function makeRefreshController({
  refreshTokenService,
  usersRepo,
  jwtSecret,
  auditService,
  logger,
} = {}) {
  if (!refreshTokenService || !jwtSecret) {
    throw new Error('refresh.controller: deps requeridas faltantes');
  }

  return async function refreshController(req, res) {
    const oldToken = req.cookies?.rt;
    if (!oldToken) return res.status(401).json({ error: 'No refresh token' });

    const result = await refreshTokenService.rotate(oldToken);
    if (!result.ok) {
      if (result.familyRevoked) {
        await auditService?.log?.({
          action: 'REFRESH_REUSE_DETECTED',
          details: { reason: result.reason },
          ip: req.ip,
        });
      }
      res.clearCookie('rt', { path: '/api/auth' });
      return res.status(401).json({ error: 'Sesión expirada', reason: result.reason });
    }

    setRefreshCookie(res, result.token, result.expiresAt);

    let userId;
    try {
      ({ userId } = jwt.verify(result.token, jwtSecret));
    } catch {
      return res.status(500).json({ error: 'Token generation error' });
    }

    const user = await usersRepo.findById(userId);
    if (!user) {
      res.clearCookie('rt', { path: '/api/auth' });
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        is_admin: user.is_admin === true,
        token_version: user.token_version || 1,
      },
      jwtSecret,
      { expiresIn: '15m' }
    );

    res.json({ accessToken, expiresIn: 900 });
  };
}

module.exports = { makeRefreshController };
