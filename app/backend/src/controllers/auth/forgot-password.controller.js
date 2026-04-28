// Forgot-password controller. Respuesta idempotente (200 siempre) para evitar
// user enumeration: si el email no existe en BD, el cliente no lo sabe.
'use strict';

function makeForgotPasswordController({
  usersRepo,
  passwordResetTokenService,
  passwordResetEmailService,
  auditService,
  logger,
} = {}) {
  if (!usersRepo || !passwordResetTokenService) {
    throw new Error('forgot-password.controller: deps requeridas faltantes');
  }

  return async function forgotPasswordController(req, res) {
    const { email } = req.body; // validated Zod
    const ip = req.ip;

    const user = await usersRepo.findByEmail(email);
    // No diferenciar en la respuesta si el usuario existe o no (mitiga enumeración).
    const response = { ok: true, message: 'Si existe una cuenta con ese email, recibirás un enlace para restablecer tu contraseña.' };

    if (!user) {
      await auditService?.log?.({ action: 'FORGOT_PASSWORD_UNKNOWN', details: { email }, ip });
      return res.json(response);
    }

    const { rawToken, expiresAt } = await passwordResetTokenService.issue({ userId: user.id });
    const ttlMinutes = passwordResetTokenService.TTL_MINUTES || 30;

    if (passwordResetEmailService) {
      passwordResetEmailService
        .send({ userEmail: user.email, rawToken, ttlMinutes })
        .catch((err) => logger?.warn?.('forgot-password email dispatch failed', { message: err.message }));
    }

    await auditService?.log?.({
      action: 'FORGOT_PASSWORD_ISSUED',
      details: { email, expiresAt },
      userId: user.id,
      ip,
    });

    return res.json(response);
  };
}

module.exports = { makeForgotPasswordController };
