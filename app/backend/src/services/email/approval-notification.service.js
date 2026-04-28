// Service para notificar a admins cuando una empresa nueva queda pendiente de
// aprobación. Recibe lista de admin emails + datos de la empresa.
'use strict';

const { renderApprovalPendingEmail } = require('./templates/approval-pending.template');

function makeApprovalNotificationService({ mail, baseUrl, defaultFrom, logger } = {}) {
  if (!mail) throw new Error('approval-notification.service: "mail" port required');
  if (!baseUrl) throw new Error('approval-notification.service: "baseUrl" required');

  async function notifyPending({ adminEmails, pendingCompany, requestedByEmail }) {
    if (!Array.isArray(adminEmails) || adminEmails.length === 0) {
      logger?.warn?.('approval-notification: sin admins destinatarios, skip');
      return { ok: false, reason: 'no_admins' };
    }

    const adminPanelUrl = `${baseUrl.replace(/\/$/, '')}/admin-facturas.html#pending`;
    const results = [];

    for (const adminEmail of adminEmails) {
      const { subject, text, html } = renderApprovalPendingEmail({
        adminEmail,
        pendingCompany,
        requestedByEmail,
        adminPanelUrl,
      });
      try {
        const info = await mail.send({
          from: defaultFrom,
          to: adminEmail,
          subject,
          text,
          html,
        });
        results.push({ adminEmail, ok: true, messageId: info.messageId });
      } catch (err) {
        logger?.warn?.('approval-notification send failed', {
          adminEmail,
          message: err.message,
        });
        results.push({ adminEmail, ok: false, error: err.message });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    logger?.info?.('approval-notification dispatched', { total: results.length, sent });
    return { ok: sent > 0, sent, results };
  }

  return { notifyPending };
}

module.exports = { makeApprovalNotificationService };
