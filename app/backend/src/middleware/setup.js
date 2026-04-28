// Monta el stack de middleware de setup (security headers + cors + json parser
// + request id) en el orden correcto y documentado. El orden es crítico:
//
//   1. helmet       — cabeceras de seguridad antes de cualquier respuesta
//   2. cors         — política CORS estricta a origen único
//   3. compression  — gzip payloads > 1KB (opt-in)
//   4. express.json — parser con límite 1MB (antes de routers)
//   5. requestId    — añade correlation id a cada request
//
// Los middleware de seguridad IP / autoblock se montan aparte (llaman a Redis)
// y se cablean en app.js Round 15 tras `setupSecurityHeaders`.
'use strict';

const helmet = require('helmet');
const cors = require('cors');
const express = require('express');

const EXTENDED_HELMET_DEFAULTS = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  originAgentCluster: true,
};

function setupSecurityHeaders(app, { corsOrigin, helmetOverrides = {} } = {}) {
  app.use(helmet({ ...EXTENDED_HELMET_DEFAULTS, ...helmetOverrides }));

  // Permissions-Policy no está soportado nativamente por helmet — se inyecta aquí.
  app.use((req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      [
        'accelerometer=()',
        'camera=()',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=()',
        'usb=()',
      ].join(', ')
    );
    next();
  });

  if (corsOrigin) {
    app.use(cors({ origin: corsOrigin, credentials: true }));
  }
}

function setupBodyParsers(app, { jsonLimit = '1mb' } = {}) {
  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ extended: false, limit: jsonLimit }));
}

module.exports = { setupSecurityHeaders, setupBodyParsers, EXTENDED_HELMET_DEFAULTS };
