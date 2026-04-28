// Sanitiza req.body eliminando tags HTML de strings. Defense-in-depth: la CSP
// estricta ya bloquea ejecución de scripts inyectados; este middleware evita
// además que entren al storage. No se aplica a req.query ni req.params.
//
// NO usar para ficheros/binarios — solo JSON body. Se monta después de express.json.
'use strict';

const TAG_PATTERN = /<\/?[a-z!][\s\S]*?>/gi;
const NULL_BYTE = /\0/g;

function stripHtml(value) {
  if (typeof value !== 'string') return value;
  return value.replace(TAG_PATTERN, '').replace(NULL_BYTE, '');
}

function sanitizeDeep(value, seen = new WeakSet(), depth = 0) {
  if (depth > 20) return value; // guard anti DoS por objetos profundamente anidados
  if (value == null) return value;
  if (typeof value === 'string') return stripHtml(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeep(item, seen, depth + 1));
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = sanitizeDeep(val, seen, depth + 1);
  }
  return out;
}

function makeSanitizeBody({ skipPaths = [] } = {}) {
  const skipSet = new Set(skipPaths);
  return function sanitizeBody(req, res, next) {
    if (skipSet.has(req.path)) return next();
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeDeep(req.body);
    }
    next();
  };
}

module.exports = { makeSanitizeBody, sanitizeDeep, stripHtml };
