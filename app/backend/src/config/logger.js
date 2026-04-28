// Factoría de logger winston con sanitizado PII integrado. Todo log que pase por
// este logger se saniza recursivamente vía lib/pii-sanitizer ANTES de serializar.
//
// Motivo: aunque el backend no logea secretos intencionadamente, errores inesperados
// pueden arrastrar req.body/req.headers a un stack trace. El sanitizer redacta
// password/token/session/email (formato) sin tocar el flujo normal.
'use strict';

const winston = require('winston');
const { sanitize, isSensitiveKey } = require('../lib/pii-sanitizer');

// IMPORTANTE: winston.format(fn) requiere que `fn` MUTE el `info` y lo devuelva,
// o devuelva `false` para descartar. Devolver un objeto NUEVO hace que winston
// descarte la entrada silenciosamente y el log nunca llegue al transport.
//
// Bug detectado en runtime tras Etapa 6 (2026-04-28): el v3 corría sin emitir
// ningún log porque sanitizeMetaFormat devolvía un objeto fresco. Fix: sanitizar
// en-place sobre las propias keys de `info`.
const RESERVED_KEYS = new Set(['level', 'message', 'timestamp']);
const REDACT = '[REDACTED]';

const sanitizeMetaFormat = winston.format((info) => {
  // Si el message es un objeto, sanitizarlo recursivamente (los emails se redactan
  // a nivel string, las keys sensibles a nivel objeto).
  if (typeof info.message !== 'string') {
    info.message = sanitize(info.message);
  }
  // Top-level meta: cada key de `info` (excepto las reservadas + Symbols internos
  // de winston) puede ser sensitive (password=...) o contener un objeto con keys
  // sensitive. Aplicamos doble check:
  //   - Si la key TOP-level es sensitive → REDACT directo.
  //   - Si no, el VALOR puede ser un objeto con keys sensitive dentro → sanitize.
  for (const key of Object.keys(info)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (isSensitiveKey(key)) {
      info[key] = REDACT;
    } else {
      info[key] = sanitize(info[key]);
    }
  }
  return info;
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
