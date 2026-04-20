// Request ID middleware — añade X-Request-Id a cada request si no viene del cliente.
// Permite trace entre frontend ↔ backend ↔ logs y correlación en audit_logs.
// W3C Trace Context compatible.
'use strict';

const crypto = require('crypto');

function requestIdMiddleware(req, res, next) {
  const existing = req.headers['x-request-id'];
  const requestId = existing && /^[a-zA-Z0-9-]{8,128}$/.test(existing)
    ? existing
    : crypto.randomBytes(16).toString('hex');

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

module.exports = requestIdMiddleware;
