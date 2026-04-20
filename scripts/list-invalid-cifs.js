#!/usr/bin/env node
// scripts/list-invalid-cifs.js
//
// Lista users.company_nif que NO pasan el algoritmo AEAT (dígito de control CIF).
// INFORMATIVO — NO modifica BD. Lectura + reporte a stdout.
//
// Por qué existe: `validateCIF.js` del proyecto decide intencionadamente NO
// rechazar por dígito de control (hay CIFs históricos que no cumplen el
// algoritmo oficial). Pero esa tolerancia enmascara typos reales en registro.
// Este script permite detectar candidatos a typo sin imponer una política
// agresiva de rechazo.
//
// Uso:
//   node scripts/list-invalid-cifs.js
//
// Requiere `docker` disponible y el contenedor `setex-postgres` en ejecución.
'use strict';

const { execSync } = require('child_process');

// Misma implementación que app/backend/src/ocr/validateCIF.js::checkDigitCIF
// duplicada aquí para que el script sea autocontenido sin dependencias del
// contenedor backend.
function checkDigitCIF(taxId) {
  if (!taxId || typeof taxId !== 'string') return null;
  const clean = taxId.toUpperCase().replace(/[\s\-\.]/g, '');
  if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(clean)) return null;

  const digits  = clean.slice(1, 8).split('').map(Number);
  const control = clean[8];

  let sumOdd = 0;
  for (const i of [0, 2, 4, 6]) {
    const d = digits[i] * 2;
    sumOdd += d >= 10 ? Math.floor(d / 10) + (d % 10) : d;
  }
  const sumEven  = digits[1] + digits[3] + digits[5];
  const unit     = (sumOdd + sumEven) % 10;
  const checkNum = (10 - unit) % 10;
  const checkLetters = 'JABCDEFGHI';

  if ('KPQS'.includes(clean[0])) {
    return { ok: control === checkLetters[checkNum], expected: checkLetters[checkNum], actual: control };
  }
  return { ok: control === String(checkNum), expected: String(checkNum), actual: control };
}

function isCIF(taxId) {
  return typeof taxId === 'string' && /^[A-Z]\d{7}[A-Z0-9]$/.test(taxId.toUpperCase().replace(/[\s\-\.]/g, ''));
}

// ─── Consulta a PostgreSQL vía docker exec ───────────────────────────────────
const sql = `
  SELECT id, email, company_nif, company_name, created_at
  FROM users
  WHERE company_nif IS NOT NULL
  ORDER BY id;
`.trim();

let rows;
try {
  const raw = execSync(
    `docker exec setex-postgres psql -U setex_user -d setex_db -t -A -F '|' -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' }
  );
  rows = raw.split('\n').filter(l => l.trim().length > 0).map(line => {
    const [id, email, company_nif, company_name, created_at] = line.split('|');
    return { id, email, company_nif, company_name, created_at };
  });
} catch (e) {
  console.error(`ERROR: no se pudo consultar la BD — ${e.message}`);
  process.exit(2);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log(' SETEX — Validación AEAT de CIFs registrados');
console.log(`          Consulta: ${new Date().toISOString()}`);
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('');

let okCount = 0;
let badCount = 0;
let notCIFCount = 0;
const invalid = [];

for (const row of rows) {
  const cif = row.company_nif;
  if (!isCIF(cif)) {
    notCIFCount++;
    continue;
  }
  const result = checkDigitCIF(cif);
  if (result?.ok) {
    okCount++;
  } else {
    badCount++;
    invalid.push({ ...row, expected: result?.expected, actual: result?.actual });
  }
}

console.log(`Total usuarios con company_nif : ${rows.length}`);
console.log(`CIFs válidos AEAT              : ${okCount}`);
console.log(`CIFs inválidos AEAT            : ${badCount}`);
console.log(`No CIF (NIF/NIE/otro)          : ${notCIFCount}`);
console.log('');

if (invalid.length > 0) {
  console.log('─── CIFs inválidos (probable typo histórico) ─────────────────────────');
  for (const r of invalid) {
    console.log(`  id=${r.id}  email=${r.email}  CIF=${r.company_nif}  empresa="${r.company_name}"`);
    console.log(`     → control esperado='${r.expected}'  real='${r.actual}'`);
  }
  console.log('');
  console.log('Nota: el código actual (validateCIF.js) NO rechaza por dígito de control,');
  console.log('sólo por formato o blacklist. Estos CIFs están ACTIVOS en producción.');
  console.log('Revisión manual recomendada — pueden ser typos o CIFs históricos legítimos.');
  console.log('');
  process.exit(1);
}

console.log('✓ Todos los CIFs en BD pasan el algoritmo AEAT.');
process.exit(0);
