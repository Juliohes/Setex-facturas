// Contrato del puerto de correo. Adapters concretos: adapters/mail/nodemailer.adapter.js
// (hoy) y potencial adapters/mail/sendgrid.adapter.js si se migra.
'use strict';

/**
 * @typedef {Object} MailMessage
 * @property {string} to                     Email destinatario
 * @property {string} subject
 * @property {string} text                   Versión texto plano (obligatoria)
 * @property {string} [html]                 Versión HTML opcional
 * @property {string} [from]                 Sobrescribe default del adapter
 * @property {string} [replyTo]
 * @property {Array<{filename: string, content: Buffer|string}>} [attachments]
 */

/**
 * @typedef {Object} MailResult
 * @property {string} messageId              ID devuelto por el transport
 * @property {boolean} accepted              true si el servidor aceptó el mail
 */

/**
 * @typedef {Object} MailPort
 * @property {string} name
 * @property {() => Promise<boolean>} healthcheck
 * @property {(msg: MailMessage) => Promise<MailResult>} send
 */

function assertMailPort(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('MailPort: candidate must be an object');
  }
  if (typeof candidate.name !== 'string' || !candidate.name) {
    throw new Error('MailPort: "name" must be a non-empty string');
  }
  if (typeof candidate.healthcheck !== 'function') {
    throw new Error('MailPort: "healthcheck" must be a function');
  }
  if (typeof candidate.send !== 'function') {
    throw new Error('MailPort: "send" must be a function');
  }
  return candidate;
}

module.exports = { assertMailPort };
