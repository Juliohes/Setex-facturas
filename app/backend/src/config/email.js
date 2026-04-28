// Factoría del transporte SMTP nodemailer. Lee credenciales desde Docker secrets
// (smtp_user/smtp_pass) con fallback env. Devuelve el transporter ya verificado
// o null si no hay credenciales (en ese caso la app funciona sin email).
'use strict';

const nodemailer = require('nodemailer');
const { env } = require('./env');
const { readSecret } = require('./secrets');

async function createMailTransport({ logger = null } = {}) {
  const user = readSecret('smtp_user') || process.env.SMTP_USER;
  const pass = readSecret('smtp_pass') || process.env.SMTP_PASS;

  if (!user || !pass) {
    logger?.warn?.('SMTP credentials missing — email disabled');
    return null;
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  try {
    await transport.verify();
    logger?.info?.('SMTP transporter verified', { host: env.SMTP_HOST, port: env.SMTP_PORT });
  } catch (err) {
    logger?.warn?.('SMTP verify failed — emails may not send', { message: err.message });
  }

  return transport;
}

async function closeMailTransport(transport, { logger = null } = {}) {
  if (!transport) return;
  try {
    transport.close();
    logger?.info?.('SMTP transporter closed');
  } catch (err) {
    logger?.warn?.('SMTP close error', { message: err.message });
  }
}

module.exports = { createMailTransport, closeMailTransport };
