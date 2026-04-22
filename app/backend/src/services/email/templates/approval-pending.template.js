// Template de notificación a admin cuando una empresa nueva queda pendiente
// de aprobación (POST /api/auth/register con company_nif no catalogado).
'use strict';

const { escapeHtml } = require('../../../lib/html-escape');
const { baseLayout } = require('./base-layout.template');

function renderApprovalPendingEmail({ adminEmail, pendingCompany, requestedByEmail, adminPanelUrl }) {
  const subject = `Nueva empresa pendiente: ${pendingCompany?.nombre || pendingCompany?.cif}`;

  const text = [
    `Hola,`,
    ``,
    `Un usuario ha solicitado registro con una empresa nueva:`,
    ``,
    `  Nombre: ${pendingCompany?.nombre || '—'}`,
    `  CIF:    ${pendingCompany?.cif || '—'}`,
    `  Solicitante: ${requestedByEmail || '—'}`,
    ``,
    `Revísala en el panel admin:`,
    adminPanelUrl,
    ``,
    `— SETEX`,
  ].join('\n');

  const bodyHtml = `
    <p>Hola,</p>
    <p>Un usuario ha solicitado registro con una empresa nueva:</p>
    <table cellpadding="6" style="border-collapse:collapse; font-size:14px;">
      <tr><td style="color:#6b7280;">Nombre</td><td><strong>${escapeHtml(pendingCompany?.nombre || '—')}</strong></td></tr>
      <tr><td style="color:#6b7280;">CIF</td><td><strong>${escapeHtml(pendingCompany?.cif || '—')}</strong></td></tr>
      <tr><td style="color:#6b7280;">Solicitante</td><td>${escapeHtml(requestedByEmail || '—')}</td></tr>
    </table>
    <p><a href="${escapeHtml(adminPanelUrl)}" style="display:inline-block; padding:10px 18px; background:#0a2540; color:#ffffff; text-decoration:none; border-radius:6px;">Abrir panel admin</a></p>
    <p>— SETEX</p>
  `;

  return { subject, text, html: baseLayout({ title: subject, bodyHtml }) };
}

module.exports = { renderApprovalPendingEmail };
