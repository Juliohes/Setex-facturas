// Test de paridad de superficie API — el v3 modular DEBE responder a TODAS
// las rutas del monolito legacy, salvo las allowlistadas explícitamente.
//
// Esto es lo que faltó en el incidente Round 16 (2026-04-22): nadie verificó
// automáticamente que el v3 portaba las 5 rutas que nginx llama como
// auth_request. Sin este test, cualquier deploy del v3 podría reproducir el
// 404 masivo.
//
// Mecánica:
//   - Monolito: regex sobre src/server.js (no se puede require — arranca listen).
//   - v3: container Awilix con mocks (asValue) para todos los providers, luego
//     mountRoutes(app, { container, middleware }) y se introspecciona
//     app._router.stack para extraer las rutas registradas.
//
// Si el v3 deja de portar una ruta del monolito, este test rompe en CI antes
// del merge.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createContainer, asValue } = require('awilix');

// Tras FASE 1B Etapa 6 (swap del v3 a runtime, 2026-04-28), el monolito 4308
// líneas vive en src/server.legacy.js. server.js pasa a ser el entry v3 modular.
// El test sigue siendo útil: garantiza paridad bidireccional. Si algún hotfix
// urgente añade una ruta al monolito (y debiéramos rollbackar), CI detecta que
// el v3 no la tiene y falla antes del merge.
const SERVER_JS = path.join(__dirname, '..', '..', 'src', 'server.legacy.js');

// Allowlist de rutas del monolito que decidimos NO portar al v3.
// Vacía a 2026-04-27 (cierre FASE 1B Etapa 1). Si añades una entrada aquí,
// documenta el porqué junto a ella.
const ALLOWLIST_NOT_PORTED = new Set([
  // ejemplo: 'GET /api/admin/legacy-stuff', // Razón: deprecado, eliminar Q3.
]);

// ── Extractor del monolito ─────────────────────────────────────────────────

function extractMonolithRoutes(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const re = /^app\.(get|post|put|patch|delete|all)\(['"]([^'"]+)['"]/gm;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const sig = `${m[1].toUpperCase()} ${m[2]}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push({ method: m[1].toUpperCase(), path: m[2] });
    }
  }
  return out;
}

// ── Extractor del v3 ───────────────────────────────────────────────────────

function buildMockContainer() {
  const container = createContainer({ injectionMode: 'PROXY' });

  // Handlers stub: una función para controllers función-style; un objeto-Proxy
  // para controllers que exponen múltiples acciones (ej. listUpdate, blocked).
  const noopHandler = (_req, res) => res.end();
  const noopProxy = new Proxy(
    {},
    {
      get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (!(prop in target)) target[prop] = noopHandler;
        return target[prop];
      },
    }
  );

  // Lista de providers que mountRoutes/admin index resuelven. Para cada uno
  // registramos un stub. asValue garantiza que cualquier resolve devuelve esto
  // sin invocar factories reales (que necesitarían db/redis).
  const controllerNames = [
    // auth
    'loginController',
    'registerController',
    'logoutController',
    'refreshController',
    'forgotPasswordController',
    'resetPasswordController',
    // uploads
    'previewController',
    'confirmController',
    'listMineController',
    'imageController',
    'proveedorController',
    'exportXlsxController',
    // me
    'profileGetController',
    'profileUpdateController',
    'settingsGetController',
    'settingsUpdateController',
    'exportRgpdController',
    'deleteAccountController',
    'clientCompaniesListController',
    'viesController',
    // company
    'companyStatusController',
    // admin facturas
    'adminFacturasListController',
    'adminFacturasUsersListController',
    'adminFacturasImageController',
    'adminFacturasExportXlsxController',
    'adminFacturasUpdateController',
    'adminFacturasDeleteController',
    'adminRetryFailedController',
    // admin client-companies
    'adminClientCompaniesListController',
    'adminClientCompaniesCreateController',
    'adminClientCompaniesUpdateController',
    'adminClientCompaniesDeleteController',
    // admin companies (approval)
    'adminCompaniesPendingController',
    'adminCompaniesDetailController',
    'adminCompaniesApproveController',
    'adminCompaniesRejectController',
    'adminCompaniesLinkController',
    'adminCompaniesAuditLogController',
    'adminCompaniesCountPendingController',
    // admin users
    'adminUsersListController',
    'adminUsersUpdateController',
    // admin catalog
    'adminCatalogListController',
    'adminCatalogCreateController',
    'adminCatalogDeleteController',
    // admin security
    'adminSecurityConfigController',
    'adminSecurityBlockedController',
    'adminSecurityTimeController',
    // admin ocr-engine
    'adminOcrEngineGetController',
    'adminOcrEngineUpdateController',
    // admin system
    'adminSystemHealthController',
    // admin session refresh (FASE 1B)
    'adminSessionRefreshController',
    // internal (FASE 1B)
    'internalCheckAccessController',
    'internalCheckAdminPageController',
  ];

  for (const name of controllerNames) {
    container.register({ [name]: asValue(noopHandler) });
  }

  // Multi-action controllers (stubbed con Proxy, todas las props son noop).
  container.register({
    adminSecurityListUpdateController: asValue(noopProxy),
  });
  // Re-stub blocked como Proxy también (expone .list y .remove).
  container.register({
    adminSecurityBlockedController: asValue(noopProxy),
  });

  // Infra mínima usada por health route:
  container.register({
    db: asValue({ queryWithTimeout: async () => ({ rows: [] }) }),
    cache: asValue({ get: async () => null, set: async () => {} }),
    logger: asValue({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  });

  return container;
}

function buildMockMiddleware() {
  const passThrough = (_req, _res, next) => next();
  return {
    authenticate: passThrough,
    requireActiveCompany: passThrough,
    requireAdmin: passThrough,
    requireXHR: passThrough,
    csrf: passThrough,
    authLimiter: passThrough,
    refreshLimiter: passThrough,
    uploadLimiter: passThrough,
    confirmLimiter: passThrough,
    viesLimiter: passThrough,
    fileUploader: passThrough,
  };
}

// Extrae el mount path de un Express router layer. Para layer.regexp.source con
// formato `^\/api\/admin\/?(?=\/|$)`, devuelve `/api/admin`. Para el root mount
// (source=`^\/?(?=\/|$)` o variantes), devuelve cadena vacía.
function extractMountPathFromRegexp(re) {
  const src = re.source;
  if (src === '^\\/?(?=\\/|$)' || src === '^\\/?$') return '';
  // Matchea ^\/<seg1>\/<seg2>...\/?(?=\/|$)
  const m = src.match(/^\^((?:\\\/[^\\?(]+)+)\\\/\?\(\?=/);
  if (!m) return '';
  return m[1].replace(/\\\//g, '/');
}

function extractV3Routes() {
  const { mountRoutes } = require('../../src/routes');
  const app = express();
  const container = buildMockContainer();
  const middleware = buildMockMiddleware();
  mountRoutes(app, { container, middleware });

  const out = [];
  const seen = new Set();
  function walk(stack, prefix = '') {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
        for (const method of methods) {
          const sig = `${method} ${prefix}${layer.route.path}`;
          if (!seen.has(sig)) {
            seen.add(sig);
            out.push({ method, path: prefix + layer.route.path });
          }
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const pfx = extractMountPathFromRegexp(layer.regexp);
        walk(layer.handle.stack, prefix + pfx);
      }
    }
  }
  walk(app._router.stack);
  return out;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('paridad: el v3 porta TODAS las rutas del monolito (salvo allowlist)', () => {
  const monolithRoutes = extractMonolithRoutes(SERVER_JS);
  const v3Routes = extractV3Routes();

  assert.ok(monolithRoutes.length >= 50, `monolito tiene ${monolithRoutes.length} rutas — extractor podría estar roto`);
  assert.ok(v3Routes.length >= 30, `v3 tiene ${v3Routes.length} rutas — extractor podría estar roto`);

  const v3Set = new Set(v3Routes.map((r) => `${r.method} ${r.path}`));
  const missing = monolithRoutes
    .map((r) => `${r.method} ${r.path}`)
    .filter((sig) => !v3Set.has(sig) && !ALLOWLIST_NOT_PORTED.has(sig));

  if (missing.length > 0) {
    console.error('\n=== Rutas del monolito que el v3 NO porta (y no están en allowlist) ===');
    missing.forEach((m) => console.error('  MISS  ' + m));
    console.error('\nPara cada una: porta al v3 o añade a ALLOWLIST_NOT_PORTED con razón.\n');
  }

  assert.equal(
    missing.length,
    0,
    `el v3 no porta ${missing.length} rutas del monolito. Ver lista arriba.`
  );
});

test('extractor: el monolito tiene >= 50 rutas conocidas (sanity)', () => {
  const routes = extractMonolithRoutes(SERVER_JS);
  assert.ok(routes.length >= 50, `solo ${routes.length} rutas extraídas — regex roto?`);
});

test('extractor: el v3 tiene >= 30 rutas montadas con mocks (sanity)', () => {
  const routes = extractV3Routes();
  assert.ok(routes.length >= 30, `solo ${routes.length} rutas montadas — bootstrap mock roto?`);
});

test('paridad: las 5 rutas portadas en FASE 1B Etapa 1 están en el v3', () => {
  const v3 = new Set(extractV3Routes().map((r) => `${r.method} ${r.path}`));
  const phase1bPorted = [
    'GET /api/internal/check-access',
    'GET /api/internal/check-admin-page',
    'POST /api/admin/refresh-session',
    'POST /api/admin/retry-failed/:id',
    'PATCH /api/admin/security/time',
  ];
  for (const sig of phase1bPorted) {
    assert.ok(v3.has(sig), `FASE 1B Etapa 1: ${sig} debería estar en el v3`);
  }
});
