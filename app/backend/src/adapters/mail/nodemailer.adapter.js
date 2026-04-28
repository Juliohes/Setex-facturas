// Adapter nodemailer que implementa MailPort. Wrappea el transport creado
// por config/email.js (createMailTransport). Si el transport es null (sin
// credenciales), el adapter responde healthcheck=false y send() lanza.
'use strict';

const { assertMailPort } = require('../../ports/mail.port');

function createNodemailerAdapter({ transport, defaultFrom, logger } = {}) {
  const adapter = {
    name: 'nodemailer',

    async healthcheck() {
      if (!transport) return false;
      try {
        return await transport.verify();
      } catch (err) {
        logger?.warn?.('nodemailer.adapter healthcheck failed', { message: err.message });
        return false;
      }
    },

    async send(msg) {
      if (!transport) throw new Error('nodemailer.adapter: transport no disponible');
      if (!msg?.to || !msg?.subject || !msg?.text) {
        throw new Error('nodemailer.adapter: to/subject/text obligatorios');
      }
      const payload = {
        from: msg.from || defaultFrom,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        replyTo: msg.replyTo,
        attachments: msg.attachments,
      };
      const info = await transport.sendMail(payload);
      return {
        messageId: info.messageId,
        accepted: Array.isArray(info.accepted) ? info.accepted.length > 0 : true,
      };
    },
  };

  return assertMailPort(adapter);
}

module.exports = { createNodemailerAdapter };
