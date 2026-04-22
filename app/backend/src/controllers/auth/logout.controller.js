// Logout controller. Revoca todos los refresh tokens del usuario y limpia cookie.
'use strict';

function makeLogoutController({ refreshTokenService, auditService } = {}) {
  return async function logoutController(req, res) {
    const userId = req.user?.userId;
    if (userId && refreshTokenService) {
      await refreshTokenService.logout({ userId });
    }
    res.clearCookie('rt', { path: '/api/auth' });
    await auditService?.log?.({ action: 'LOGOUT', userId, ip: req.ip });
    res.json({ ok: true });
  };
}

module.exports = { makeLogoutController };
