// Factoría de logger winston con sanitizado PII integrado. Todo log que pase por
// este logger se saniza recursivamente vía lib/pii-sanitizer ANTES de serializar.
//
// Motivo: aunque el backend no logea secretos intencionadamente, errores inesperados
// pueden arrastrar req.body/req.headers a un stack trace. El sanitizer redacta
// password/token/session/email (formato) sin tocar el flujo normal.
'use strict';

const winston = require('winston');
const { sanitize } = require('../lib/pii-sanitizer');

const sanitizeMetaFormat = winston.format((info) => {
  const { level, message, timestamp, ...rest } = info;
  const sanitizedRest = sanitize(rest);
  const sanitizedMessage = typeof message === 'string' ? message : sanitize(message);
  return { level, message: sanitizedMessage, timestamp, ...sanitizedRest };
});

function createLogger({ level = 'info', service = 'setex-backend' } = {}) {
  return winston.createLogger({
    level,
    defaultMeta: { service },
    format: winston.format.combine(
      winston.format.timestamp(),
      sanitizeMetaFormat(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        handleExceptions: true,
        handleRejections: true,
      }),
    ],
    exitOnError: false,
  });
}

module.exports = { createLogger };
