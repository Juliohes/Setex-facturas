// Reset-password controller. Consume token atómicamente + actualiza password +
// bumpea token_version (invalida todas las sesiones activas del usuario).
'use strict';

const bcrypt = require('bcrypt');

function makeResetPasswordController({
  usersRepo,
  passwordResetTokenService,
  refreshTokenService,
  auditService,
  logger,
} = {}) {
  if (!usersRepo || !passwordResetTokenService) {
    throw new Error('reset-password.controller: deps requeridas faltantes');
  }

  return async function resetPasswordController(req, res) {
    const { token, password } = req.body; // validated Zod
    const ip = req.ip;

    const consumed = await passwordResetTokenService.consume(token);
    if (!consumed.ok) {
      await auditService?.log?.({ action: 'RESET_PASSWORD_FAILED', details: { reason: consumed.reason }, ip });
      return res.status(400).json({ error: 'Token inválido, expirado o ya usado.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await usersRepo.updatePassword(consumed.userId, passwordHash);

    if (refreshTokenService) {
      await refreshTokenService.logout({ userId: consumed.userId }).catch(() => {});
    }

    await auditService?.log?.({
      action: 'RESET_PASSWORD_SUCCESS',
      userId: consumed.userId,
      ip,
    });

    res.json({ ok: true, message: 'Contraseña restablecida. Inicia sesión de nuevo.' });
  };
}

module.exports = { makeResetPasswordController };
