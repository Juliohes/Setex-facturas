// Service para enviar email de recuperación de contraseña.
// Recibe mail (MailPort) + template + logger. Service pura, sin SMTP ni
// nodemailer directos — cumple DIP.
'use strict';

const { renderPasswordResetEmail } = require('./templates/password-reset.template');

function makePasswordResetEmailService({ mail, baseUrl, defaultFrom, logger } = {}) {
  if (!mail) throw new Error('password-reset email.service: "mail" port required');
  if (!baseUrl) throw new Error('password-reset email.service: "baseUrl" required');

  async function send({ userEmail, rawToken, ttlMinutes = 30 }) {
    const resetUrl = `${baseUrl.replace(/\/$/, '')}/reset-password.html?token=${encodeURIComponent(rawToken)}`;
    const { subject, text, html } = renderPasswordResetEmail({ userEmail, resetUrl, ttlMinutes });

    try {
      const info = await mail.send({
        from: defaultFrom,
        to: userEmail,
        subject,
        text,
        html,
      });
      logger?.info?.('password-reset email sent', { to: userEmail, messageId: info.messageId });
      return { ok: true, messageId: info.messageId };
    } catch (err) {
      logger?.error?.('password-reset email failed', { to: userEmail, message: err.message });
      return { ok: false, error: err.message };
    }
  }

  return { send };
}

module.exports = { makePasswordResetEmailService };
