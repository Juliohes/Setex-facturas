// Factory del transport SMTP + adapter MailPort. Resuelve el flujo:
//   secrets → config/email.createMailTransport → adapters/mail/nodemailer.adapter
// Devuelve un MailPort listo para inyectar en services/email/*.
'use strict';

const { createMailTransport } = require('../config/email');
const { createNodemailerAdapter } = require('../adapters/mail/nodemailer.adapter');

async function createMailPort({ logger, defaultFrom } = {}) {
  const transport = await createMailTransport({ logger });
  const adapter = createNodemailerAdapter({ transport, defaultFrom, logger });
  return adapter;
}

module.exports = { createMailPort };
