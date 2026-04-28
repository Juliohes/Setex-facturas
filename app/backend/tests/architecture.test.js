// Test de arquitectura v3 · ronda 6 (2 invariantes iniciales, irá creciendo).
// Se ejecuta con `node --test tests/architecture.test.js`.
//
// Invariantes actuales (Round 15 v2):
//  1. controllers/**/*.js       NO contienen `pool.query`    (DAO aislado en repos)
//  2. repositories/**/*.js      NO contienen `res.json`      (no acceden a HTTP)
//  3. Ningún fichero importa    src/server.js                (monolito legacy)
//  4. lib/**/*.js               NO importan del resto de src (sub-módulo puro)
//  5. ports/**/*.js             NO importan del resto de src (contratos puros)
//  6. Cada *Port.js tiene ≥1 adapter emparejado en adapters/
//  7. Controllers NO importan directamente pg/ioredis/openai/nodemailer/@azure

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_ROOT = path.join(__dirname, '..', 'src');

function listFiles(dir, filter = (f) => f.endsWith('.js')) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

function readFile(fullPath) {
  return fs.readFileSync(fullPath, 'utf8');
}

function relFromSrc(fullPath) {
  return path.relative(SRC_ROOT, fullPath).replace(/\\/g, '/');
}

// ── Invariante 1 ────────────────────────────────────────────────────────────
test('controllers/**/*.js NO contiene pool.query (DAO aislado)', () => {
  const controllersDir = path.join(SRC_ROOT, 'controllers');
  if (!fs.existsSync(controllersDir)) return;
  const files = listFiles(controllersDir);
  const offenders = files.filter((f) => /\bpool\.query\s*\(/.test(readFile(f)));
  assert.equal(
    offenders.length,
    0,
    `Controllers con pool.query directo (usar repository):\n${offenders.map(relFromSrc).join('\n')}`
  );
});

// ── Invariante 2 ────────────────────────────────────────────────────────────
test('repositories/**/*.js NO contienen res.json / res.status (HTTP aislado)', () => {
  const reposDir = path.join(SRC_ROOT, 'repositories');
  if (!fs.existsSync(reposDir)) return;
  const files = listFiles(reposDir);
  const offenders = files.filter((f) => {
    const src = readFile(f);
    return /\bres\.(json|status|send)\s*\(/.test(src);
  });
  assert.equal(
    offenders.length,
    0,
    `Repos con acceso a res.* (HTTP debe quedar en controllers):\n${offenders.map(relFromSrc).join('\n')}`
  );
});

// ── Invariante 3 ────────────────────────────────────────────────────────────
test('Ningún fichero (salvo app/bootstrap) importa server.js', () => {
  const allFiles = listFiles(SRC_ROOT).filter((f) => !f.endsWith('server.js'));
  const offenders = [];
  const importRx = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const file of allFiles) {
    const src = readFile(file);
    let match;
    while ((match = importRx.exec(src)) !== null) {
      const spec = match[1];
      if (/(^|\/)server(\.js)?$/.test(spec)) {
        offenders.push(`${relFromSrc(file)} → ${spec}`);
      }
    }
  }
  assert.equal(offenders.length, 0, `Imports de server.js:\n${offenders.join('\n')}`);
});

// ── Invariante 4 ────────────────────────────────────────────────────────────
test('lib/**/*.js NO importan de src/ (módulo puro)', () => {
  const files = listFiles(path.join(SRC_ROOT, 'lib'));
  const offenders = [];
  const importRx = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const file of files) {
    const src = readFile(file);
    let match;
    while ((match = importRx.exec(src)) !== null) {
      const spec = match[1];
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // módulo npm o builtin
      const resolved = path.resolve(path.dirname(file), spec);
      if (!resolved.startsWith(SRC_ROOT + path.sep)) continue;
      if (resolved.startsWith(path.join(SRC_ROOT, 'lib') + path.sep)) continue;
      offenders.push(`${relFromSrc(file)} → ${spec}`);
    }
  }
  assert.equal(offenders.length, 0, `lib/ con dependencias fuera de lib:\n${offenders.join('\n')}`);
});

// ── Invariante 5 ────────────────────────────────────────────────────────────
test('ports/**/*.js NO importan de src/ (contratos puros)', () => {
  const portsDir = path.join(SRC_ROOT, 'ports');
  if (!fs.existsSync(portsDir)) return;
  const files = listFiles(portsDir);
  const offenders = [];
  const importRx = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const file of files) {
    const src = readFile(file);
    let match;
    while ((match = importRx.exec(src)) !== null) {
      const spec = match[1];
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
      const resolved = path.resolve(path.dirname(file), spec);
      if (!resolved.startsWith(SRC_ROOT + path.sep)) continue;
      offenders.push(`${relFromSrc(file)} → ${spec}`);
    }
  }
  assert.equal(offenders.length, 0, `ports/ con dependencias a src/:\n${offenders.join('\n')}`);
});

// ── Invariante 6 ────────────────────────────────────────────────────────────
test('Cada *Port.js tiene ≥1 adapter en adapters/', () => {
  const portsDir = path.join(SRC_ROOT, 'ports');
  const adaptersDir = path.join(SRC_ROOT, 'adapters');
  if (!fs.existsSync(portsDir) || !fs.existsSync(adaptersDir)) return;

  const portFiles = listFiles(portsDir).filter((f) => f.endsWith('.port.js'));
  const adapterFiles = listFiles(adaptersDir);
  const adapterSources = adapterFiles.map((f) => readFile(f)).join('\n');

  const missing = [];
  for (const portFile of portFiles) {
    const portBase = path.basename(portFile, '.port.js');  // e.g. "ocr"
    const assertFn = `assert${portBase[0].toUpperCase()}${portBase.slice(1)}Port`
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const hasAdapter = adapterSources.includes(assertFn)
      || adapterFiles.some((a) => a.includes(`/${portBase}/`));
    if (!hasAdapter) missing.push(portBase);
  }
  assert.equal(missing.length, 0, `Ports sin adapter: ${missing.join(', ')}`);
});

// ── Invariante 7 ────────────────────────────────────────────────────────────
test('controllers/**/*.js NO importan pg / ioredis / openai / nodemailer / @azure', () => {
  const controllersDir = path.join(SRC_ROOT, 'controllers');
  if (!fs.existsSync(controllersDir)) return;
  const files = listFiles(controllersDir);
  const forbidden = /require\s*\(\s*['"](pg|ioredis|openai|nodemailer|@azure\/[^'"]+)['"]\s*\)/;
  const offenders = files.filter((f) => forbidden.test(readFile(f)));
  assert.equal(
    offenders.length,
    0,
    `Controllers con imports de infra prohibidos:\n${offenders.map(relFromSrc).join('\n')}`
  );
});
