// Test del config/logger — captura la regresión silenciosa del 2026-04-28.
//
// Bug detectado en runtime tras Etapa 6 (FASE 1B): sanitizeMetaFormat devolvía
// un objeto NUEVO en lugar de mutar `info`, lo que hacía que winston descartara
// el log silenciosamente. El v3 corría sin emitir NINGÚN log a stdout/stderr.
//
// Estos tests garantizan que:
//   1. Un log simple emite output al stream del transport.
//   2. Las keys sensibles top-level se redactan a [REDACTED].
//   3. Los emails se redactan parcialmente (us***@dominio).
//   4. Las keys sensibles anidadas en objetos también se redactan.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const winston = require('winston');
const { createLogger } = require('../../src/config/logger');

// Helper: captura todo lo que el logger escribe a stdout añadiendo un transport
// extra Stream sobre un buffer en memoria.
function captureLogs(logger) {
  const chunks = [];
  const captureStream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
  });
  logger.add(new winston.transports.Stream({ stream: captureStream }));
  return {
    output: () => chunks.join(''),
    lines: () => chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}

test('logger: emite log simple a stdout (regresión 2026-04-28 silencio total)', () => {
  const logger = createLogger();
  const cap = captureLogs(logger);
  logger.info('arranque OK');
  const lines = cap.lines();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].message, 'arranque OK');
  assert.equal(lines[0].service, 'setex-backend');
  assert.ok(lines[0].timestamp, 'timestamp presente');
});

test('logger: redacta password top-level en meta', () => {
  const logger = createLogger();
  const cap = captureLogs(logger);
  logger.info('login', { userId: 42, password: 'pw-secreto' });
  const line = cap.lines()[0];
  assert.equal(line.password, '[REDACTED]');
  assert.equal(line.userId, 42);
});

test('logger: redacta email parcial (us***@dominio)', () => {
  const logger = createLogger();
  const cap = captureLogs(logger);
  logger.info('login', { email: 'jose.maria@example.com' });
  const line = cap.lines()[0];
  assert.equal(line.email, 'jo***@example.com');
});

test('logger: redacta password anidado dentro de objetos', () => {
  const logger = createLogger();
  const cap = captureLogs(logger);
  logger.error('request failed', { req: { user: 'x@y.com', body: { password: 'inner' } } });
  const line = cap.lines()[0];
  assert.equal(line.req.body.password, '[REDACTED]');
  assert.equal(line.req.user, 'x***@y.com');
});

test('logger: redacta keys que matchean patterns sensibles (token, secret, jwt, csrf...)', () => {
  const logger = createLogger();
  const cap = captureLogs(logger);
  logger.info('test', {
    accessToken: 'at-123',
    refreshToken: 'rt-456',
    apiKey: 'ak-789',
    csrf_token: 'csrf-xyz',
    jwtSecret: 'js-abc',
    cookie: 'cookie-val',
    nonSensitive: 'visible',
  });
  const line = cap.lines()[0];
  assert.equal(line.accessToken, '[REDACTED]');
  assert.equal(line.refreshToken, '[REDACTED]');
  assert.equal(line.apiKey, '[REDACTED]');
  assert.equal(line.csrf_token, '[REDACTED]');
  assert.equal(line.jwtSecret, '[REDACTED]');
  assert.equal(line.cookie, '[REDACTED]');
  assert.equal(line.nonSensitive, 'visible');
});

test('logger: tolera message como objeto (lo sanitiza)', () => {
  const logger = createLogger();
  const cap = captureLogs(logger);
  // En la práctica nadie pasa objects como message, pero winston lo permite.
  logger.info({ user: 'a@b.c', password: 'x' });
  const line = cap.lines()[0];
  // El password dentro del objeto-message debe estar redactado.
  // (Si winston serializa el message como string, depende de la version; lo
  // importante es que NO contenga el plaintext del password.)
  const serialized = JSON.stringify(line);
  assert.ok(!serialized.includes('"x"'), 'password no debe estar en plain text');
});
