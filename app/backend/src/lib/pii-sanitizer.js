// Sanitiza estructuras antes de enviarlas a logs/telemetría. Redacta campos con
// PII (emails, tokens, passwords, API keys, datos fiscales). No mutuamente exclusivo
// con el PII stripping de winston — es una capa extra para objetos complejos.
//
// Uso típico:
//   logger.info('upload confirmed', sanitize({ user, body }))
'use strict';

const REDACT = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /jwt/i,
  /refresh[_-]?token/i,
  /csrf/i,
  /x-openai-api-key/i,
  /x-azure-key/i,
];

const EMAIL_REGEX = /([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi;

function isSensitiveKey(key) {
  const k = String(key);
  return SENSITIVE_KEY_PATTERNS.some((rx) => rx.test(k));
}

function redactEmail(str) {
  return String(str).replace(EMAIL_REGEX, (_match, user, domain) => {
    const head = user.length <= 2 ? user[0] : user.slice(0, 2);
    return `${head}***@${domain}`;
  });
}

function sanitize(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactEmail(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen));
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACT;
    } else {
      out[key] = sanitize(val, seen);
    }
  }
  return out;
}

module.exports = { sanitize, redactEmail, isSensitiveKey };
