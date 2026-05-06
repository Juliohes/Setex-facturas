// Test del middleware requireActiveCompany.
// Cubre el bug detectado 2026-05-06: el v3 modular consultaba columnas
// inexistentes (cc.status, cc.nif) en client_companies. Schema real:
// booleans cc.activa, cc.pendiente con clave cc.cif.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeRequireActiveCompany } = require('../../src/middleware/auth');

function mockPool(rowsToReturn, throwError = null) {
  return {
    query: async () => {
      if (throwError) throw throwError;
      return { rows: rowsToReturn };
    },
  };
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('requireActiveCompany: empresa activa → next()', async () => {
  const middleware = makeRequireActiveCompany({
    pool: mockPool([{ activa: true, pendiente: false }]),
    logger: { error: () => {} },
  });
  const req = { user: { userId: 1 } };
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('requireActiveCompany: empresa pendiente → 403 pending', async () => {
  const middleware = makeRequireActiveCompany({
    pool: mockPool([{ activa: false, pendiente: true }]),
    logger: { error: () => {} },
  });
  const req = { user: { userId: 1 } };
  const res = mockRes();
  await middleware(req, res, () => assert.fail('next() no debe llamarse'));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.company_status, 'pending');
});

test('requireActiveCompany: empresa inactiva → 403 inactive', async () => {
  const middleware = makeRequireActiveCompany({
    pool: mockPool([{ activa: false, pendiente: false }]),
    logger: { error: () => {} },
  });
  const req = { user: { userId: 1 } };
  const res = mockRes();
  await middleware(req, res, () => assert.fail('next() no debe llamarse'));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.company_status, 'inactive');
});

test('requireActiveCompany: empresa no encontrada → 403 unknown', async () => {
  const middleware = makeRequireActiveCompany({
    pool: mockPool([]),
    logger: { error: () => {} },
  });
  const req = { user: { userId: 1 } };
  const res = mockRes();
  await middleware(req, res, () => assert.fail('next() no debe llamarse'));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.company_status, 'unknown');
});

test('requireActiveCompany: sin userId → 401', async () => {
  const middleware = makeRequireActiveCompany({
    pool: mockPool([]),
    logger: { error: () => {} },
  });
  const req = { user: {} };
  const res = mockRes();
  await middleware(req, res, () => assert.fail('next() no debe llamarse'));
  assert.equal(res.statusCode, 401);
});

test('requireActiveCompany: error BD → 503', async () => {
  const middleware = makeRequireActiveCompany({
    pool: mockPool([], new Error('connection refused')),
    logger: { error: () => {} },
  });
  const req = { user: { userId: 1 } };
  const res = mockRes();
  await middleware(req, res, () => assert.fail('next() no debe llamarse'));
  assert.equal(res.statusCode, 503);
});
