// Tests unitarios mínimos de las 5 rutas portadas en FASE 1B Etapa 1.
// Mockean las deps del container para invocar el handler sin levantar Express.
// La cobertura más amplia (paridad legacy↔v3 + smoke HTTP) llega en Etapa 2.
//
// Patrón: cada test llena req/res stubs, invoca el handler, asserta status code
// y respuesta. Sin BD, sin red, sin ficheros — todo en memoria.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { makeInternalCheckAccessController } = require('../../src/controllers/internal/check-access.controller');
const { makeInternalCheckAdminPageController } = require('../../src/controllers/internal/check-admin-page.controller');
const { makeAdminSessionRefreshController } = require('../../src/controllers/admin/session-refresh.controller');
const { makeAdminRetryFailedController } = require('../../src/controllers/admin/facturas/retry-failed.controller');
const { makeAdminSecurityTimeController } = require('../../src/controllers/admin/security/time.controller');

// ── helpers ────────────────────────────────────────────────────────────────

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    cookies: {},
    ended: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.ended = true; return this; },
    end() { this.ended = true; return this; },
    cookie(name, value, opts) { this.cookies[name] = { value, opts }; return this; },
  };
  return res;
}

function mockReq({ cookies = {}, body = {}, params = {}, user = null, ip = '127.0.0.1' } = {}) {
  return { cookies, body, params, user, ip };
}

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

// ── 1. check-access ────────────────────────────────────────────────────────

test('check-access: 200 cuando time_restriction.enabled=false', () => {
  const ipListManager = { load: () => ({ time_restriction: { enabled: false } }) };
  const ctrl = makeInternalCheckAccessController({ ipListManager });
  const res = mockRes();
  ctrl(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.ended, true);
});

test('check-access: 403 dentro de la ventana 00-06', () => {
  // Forzamos hora dentro de la ventana modificando el mock para que isRestrictedHour devuelva true
  // sin tocar el reloj global: enabled + start=0 + end=23 cubre cualquier h salvo 23.
  // Como la implementación real lee la hora del sistema, validamos con un cfg que SIEMPRE bloquea.
  const ipListManager = {
    load: () => ({ time_restriction: { enabled: true, start_hour: 0, end_hour: 24, timezone: 'UTC' } }),
  };
  const ctrl = makeInternalCheckAccessController({ ipListManager });
  const res = mockRes();
  ctrl(mockReq(), res);
  assert.equal(res.statusCode, 403);
});

test('check-access: throw si no se inyecta ipListManager', () => {
  assert.throws(() => makeInternalCheckAccessController({}), /ipListManager/);
});

// ── 2. check-admin-page ────────────────────────────────────────────────────

test('check-admin-page: 403 sin cookie setex_admin', async () => {
  const ipListManager = { load: () => ({ time_restriction: { enabled: false } }) };
  const tokenVerificationService = { verify: async () => ({ ok: true, user: { type: 'admin_page', is_admin: true } }) };
  const ctrl = makeInternalCheckAdminPageController({ ipListManager, tokenVerificationService });
  const res = mockRes();
  await ctrl(mockReq({ cookies: {} }), res);
  assert.equal(res.statusCode, 403);
});

test('check-admin-page: 403 si el token no valida', async () => {
  const ipListManager = { load: () => ({ time_restriction: { enabled: false } }) };
  const tokenVerificationService = { verify: async () => ({ ok: false, reason: 'invalid' }) };
  const ctrl = makeInternalCheckAdminPageController({ ipListManager, tokenVerificationService });
  const res = mockRes();
  await ctrl(mockReq({ cookies: { setex_admin: 'badtoken' } }), res);
  assert.equal(res.statusCode, 403);
});

test('check-admin-page: 403 si payload.type !== admin_page', async () => {
  const ipListManager = { load: () => ({ time_restriction: { enabled: false } }) };
  const tokenVerificationService = {
    verify: async () => ({ ok: true, user: { type: 'access', is_admin: true } }),
  };
  const ctrl = makeInternalCheckAdminPageController({ ipListManager, tokenVerificationService });
  const res = mockRes();
  await ctrl(mockReq({ cookies: { setex_admin: 'tk' } }), res);
  assert.equal(res.statusCode, 403);
});

test('check-admin-page: 403 si is_admin=false', async () => {
  const ipListManager = { load: () => ({ time_restriction: { enabled: false } }) };
  const tokenVerificationService = {
    verify: async () => ({ ok: true, user: { type: 'admin_page', is_admin: false } }),
  };
  const ctrl = makeInternalCheckAdminPageController({ ipListManager, tokenVerificationService });
  const res = mockRes();
  await ctrl(mockReq({ cookies: { setex_admin: 'tk' } }), res);
  assert.equal(res.statusCode, 403);
});

test('check-admin-page: 503 fail-secure cuando reason=db_unavailable', async () => {
  const ipListManager = { load: () => ({ time_restriction: { enabled: false } }) };
  const tokenVerificationService = {
    verify: async () => ({ ok: false, reason: 'db_unavailable', retriable: true }),
  };
  const ctrl = makeInternalCheckAdminPageController({
    ipListManager,
    tokenVerificationService,
    logger: noopLogger,
  });
  const res = mockRes();
  await ctrl(mockReq({ cookies: { setex_admin: 'tk' } }), res);
  assert.equal(res.statusCode, 503);
});

test('check-admin-page: 200 cuando todo OK', async () => {
  const ipListManager = { load: () => ({ time_restriction: { enabled: false } }) };
  const tokenVerificationService = {
    verify: async () => ({ ok: true, user: { type: 'admin_page', is_admin: true, userId: 1 } }),
  };
  const ctrl = makeInternalCheckAdminPageController({ ipListManager, tokenVerificationService });
  const res = mockRes();
  await ctrl(mockReq({ cookies: { setex_admin: 'tk' } }), res);
  assert.equal(res.statusCode, 200);
});

// ── 3. refresh-session ─────────────────────────────────────────────────────

test('refresh-session: emite cookie setex_admin httpOnly + secure + 8h', () => {
  const jwtSecret = 'a'.repeat(32);
  const ctrl = makeAdminSessionRefreshController({ jwtSecret, logger: noopLogger });
  const res = mockRes();
  ctrl(mockReq({ user: { userId: 7, token_version: 3 } }), res);

  assert.equal(res.body?.success, true);
  assert.ok(res.cookies.setex_admin, 'cookie setex_admin esperada');
  assert.equal(res.cookies.setex_admin.opts.httpOnly, true);
  assert.equal(res.cookies.setex_admin.opts.secure, true);
  assert.equal(res.cookies.setex_admin.opts.sameSite, 'strict');
  assert.equal(res.cookies.setex_admin.opts.maxAge, 8 * 60 * 60 * 1000);

  const payload = jwt.verify(res.cookies.setex_admin.value, jwtSecret);
  assert.equal(payload.userId, 7);
  assert.equal(payload.is_admin, true);
  assert.equal(payload.token_version, 3);
  assert.equal(payload.type, 'admin_page');
});

test('refresh-session: throw si jwtSecret no inyectado', () => {
  assert.throws(() => makeAdminSessionRefreshController({}), /jwtSecret/);
});

// ── 4. retry-failed ────────────────────────────────────────────────────────

test('retry-failed: 400 si id no entero positivo', async () => {
  const failedJobsRepo = { findById: async () => null, markRetried: async () => {} };
  const ctrl = makeAdminRetryFailedController({ failedJobsRepo });
  const res = mockRes();
  await ctrl(mockReq({ params: { id: 'abc' }, user: { userId: 1 } }), res);
  assert.equal(res.statusCode, 400);
});

test('retry-failed: 404 si no existe', async () => {
  const failedJobsRepo = { findById: async () => null, markRetried: async () => {} };
  const ctrl = makeAdminRetryFailedController({ failedJobsRepo });
  const res = mockRes();
  await ctrl(mockReq({ params: { id: '99' }, user: { userId: 1 } }), res);
  assert.equal(res.statusCode, 404);
});

test('retry-failed: 404 si ya estaba marcado', async () => {
  const failedJobsRepo = {
    findById: async () => ({ id: 1, retried_at: new Date(), upload_id: 5 }),
    markRetried: async () => assert.fail('no debe marcar de nuevo'),
  };
  const ctrl = makeAdminRetryFailedController({ failedJobsRepo });
  const res = mockRes();
  await ctrl(mockReq({ params: { id: '1' }, user: { userId: 1 } }), res);
  assert.equal(res.statusCode, 404);
});

test('retry-failed: 200 + audit si OK', async () => {
  let marked = false;
  let auditCalled = null;
  const failedJobsRepo = {
    findById: async () => ({ id: 7, retried_at: null, upload_id: 33 }),
    markRetried: async () => { marked = true; },
  };
  const auditService = { log: async (entry) => { auditCalled = entry; } };
  const ctrl = makeAdminRetryFailedController({ failedJobsRepo, auditService, logger: noopLogger });
  const res = mockRes();
  await ctrl(mockReq({ params: { id: '7' }, user: { userId: 9, email: 'a@b.c' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.message, /Job 7/);
  assert.equal(marked, true);
  assert.equal(auditCalled.action, 'RETRY_FAILED_JOB');
  assert.equal(auditCalled.details.failed_job_id, 7);
  assert.equal(auditCalled.details.upload_id, 33);
});

// ── 5. security/time ───────────────────────────────────────────────────────

test('security/time: 200 + audit cuando ipListManager actualiza OK', async () => {
  let saved = null;
  let auditCalled = null;
  const ipListManager = {
    updateTimeRestriction(patch) {
      saved = patch;
      return { enabled: true, start_hour: 1, end_hour: 5, timezone: 'Europe/Madrid' };
    },
  };
  const auditService = { log: async (e) => { auditCalled = e; } };
  const ctrl = makeAdminSecurityTimeController({ ipListManager, auditService, logger: noopLogger });
  const res = mockRes();
  await ctrl(
    mockReq({ body: { enabled: true, start_hour: 1, end_hour: 5 }, user: { userId: 1 } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.time_restriction.start_hour, 1);
  assert.equal(saved.start_hour, 1);
  assert.equal(saved.end_hour, 5);
  assert.equal(auditCalled.action, 'SECURITY_TIME_UPDATE');
});

test('security/time: 400 cuando ipListManager lanza INVALID_RANGE', async () => {
  const ipListManager = {
    updateTimeRestriction() {
      const err = new Error('start_hour y end_hour no pueden ser iguales (causaría bloqueo permanente del sitio).');
      err.code = 'INVALID_RANGE';
      throw err;
    },
  };
  const ctrl = makeAdminSecurityTimeController({ ipListManager, logger: noopLogger });
  const res = mockRes();
  await ctrl(
    mockReq({ body: { start_hour: 3, end_hour: 3 }, user: { userId: 1 } }),
    res
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /no pueden ser iguales/);
});

test('security/time: 500 si ipListManager lanza error genérico', async () => {
  const ipListManager = {
    updateTimeRestriction() {
      throw new Error('disk full');
    },
  };
  const ctrl = makeAdminSecurityTimeController({ ipListManager, logger: noopLogger });
  const res = mockRes();
  await ctrl(mockReq({ body: { enabled: true }, user: { userId: 1 } }), res);
  assert.equal(res.statusCode, 500);
});

// ── 6. ipListManager.updateTimeRestriction (smoke unit) ────────────────────

test('updateTimeRestriction: rechaza start === end', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setex-test-'));
  const cfgPath = path.join(tmpDir, 'security.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ time_restriction: { enabled: true, start_hour: 0, end_hour: 6 } })
  );
  const { makeIpListManagerService } = require('../../src/services/security/ip-list-manager.service');
  const svc = makeIpListManagerService({ configPath: cfgPath });

  assert.throws(
    () => svc.updateTimeRestriction({ start_hour: 3, end_hour: 3 }),
    (err) => err.code === 'INVALID_RANGE'
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('updateTimeRestriction: rechaza start_hour fuera de [0,23]', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setex-test-'));
  const cfgPath = path.join(tmpDir, 'security.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ time_restriction: { enabled: true, start_hour: 0, end_hour: 6 } }));
  const { makeIpListManagerService } = require('../../src/services/security/ip-list-manager.service');
  const svc = makeIpListManagerService({ configPath: cfgPath });

  assert.throws(
    () => svc.updateTimeRestriction({ start_hour: 24 }),
    (err) => err.code === 'INVALID_RANGE' && /start_hour/.test(err.message)
  );
  assert.throws(
    () => svc.updateTimeRestriction({ end_hour: -1 }),
    (err) => err.code === 'INVALID_RANGE' && /end_hour/.test(err.message)
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('updateTimeRestriction: actualiza enabled + start + end con backup', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setex-test-'));
  const cfgPath = path.join(tmpDir, 'security.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ time_restriction: { enabled: true, start_hour: 0, end_hour: 6 } })
  );
  const { makeIpListManagerService } = require('../../src/services/security/ip-list-manager.service');
  const svc = makeIpListManagerService({ configPath: cfgPath });

  const next = svc.updateTimeRestriction({ enabled: false, start_hour: 22, end_hour: 7 });
  assert.equal(next.enabled, false);
  assert.equal(next.start_hour, 22);
  assert.equal(next.end_hour, 7);

  // Backup creado
  assert.ok(fs.existsSync(`${cfgPath}.bak`));
  // Disco actualizado
  const reread = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(reread.time_restriction.enabled, false);
  assert.equal(reread.time_restriction.start_hour, 22);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
