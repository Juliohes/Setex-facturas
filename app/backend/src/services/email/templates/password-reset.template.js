// Template de email para recuperación de contraseña.
'use strict';

const { escapeHtml } = require('../../../lib/html-escape');
const { baseLayout } = require('./base-layout.template');

function renderPasswordResetEmail({ userEmail, resetUrl, ttlMinutes = 30 }) {
  const subject = 'Recupera tu contraseña · SETEX';
  const safeEmail = escapeHtml(userEmail);
  const safeUrl = escapeHtml(resetUrl);

  const text = [
    `Hola,`,
    ``,
    `Hemos recibido una solicitud para restablecer la contraseña de ${userEmail}.`,
    ``,
    `Para continuar, abre este enlace (válido ${ttlMinutes} minutos):`,
    resetUrl,
    ``,
    `Si tú no solicitaste el cambio, ignora este mensaje. La contraseña actual sigue siendo válida.`,
    ``,
    `— Equipo SETEX`,
  ].join('\n');

  const bodyHtml = `
    <p>Hola,</p>
    <p>Hemos recibido una solicitud para restablecer la contraseña de <strong>${safeEmail}</strong>.</p>
    <p>Para continuar, abre este enlace (válido <strong>${ttlMinutes} minutos</strong>):</p>
    <p><a href="${safeUrl}" style="display:inline-block; padding:10px 18px; background:#2563eb; color:#ffffff; text-decoration:none; border-radius:6px;">Restablecer contraseña</a></p>
    <p style="color:#6b7280; font-size:13px;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
    <a href="${safeUrl}" style="color:#2563eb;">${safeUrl}</a></p>
    <p style="color:#6b7280; font-size:13px;">Si tú no solicitaste el cambio, ignora este mensaje. La contraseña actual sigue siendo válida.</p>
    <p>— Equipo SETEX</p>
  `;

  return { subject, text, html: baseLayout({ title: subject, bodyHtml }) };
}

module.exports = { renderPasswordResetEmail };
