#!/usr/bin/env node
// tests/multi-iva/test-helper-unit.js
//
// Tests unitarios de Node puros (sin dependencias) para el helper
// normalizeConfirmedLineasIva y el merger mergeLineasIva. Ejecutar con:
//   node tests/multi-iva/test-helper-unit.js
//
// Exit code 0 si todos pasan, 1 si alguno falla.
// No requiere base de datos ni servicios externos — son unitarios puros.

'use strict';

const path = require('path');
const { normalizeConfirmedLineasIva, mergeLineasIva } =
  require(path.resolve(__dirname, '../../app/backend/src/domain/validators/iva'));

let passed = 0;
let failed = 0;

function assert(label, cond, actual) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (actual !== undefined) console.error(`    obtenido: ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──────────────────────────────────────────────`);
}

// ─── Tests normalizeConfirmedLineasIva ───────────────────────────────────────
section('normalizeConfirmedLineasIva');

{
  const r = normalizeConfirmedLineasIva(null);
  assert('null → lineas null', r.lineas === null && r.base === null);
}

{
  const r = normalizeConfirmedLineasIva([]);
  assert('array vacío → lineas null', r.lineas === null);
}

{
  const r = normalizeConfirmedLineasIva([
    { base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [] }
  ]);
  assert('1 tramo válido → 1 línea', r.lineas && r.lineas.length === 1);
  assert('agregado base = 100,00', r.base === '100,00');
  assert('agregado cuota = 21,00', r.cuota === '21,00');
  assert('agregado pct dominante = 21,0', r.porcentaje === '21,0');
}

{
  const r = normalizeConfirmedLineasIva([
    { base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [{descripcion: 'Cerveza', importe: '50,00'}] },
    { base: '50,00',  porcentaje: '10,0', cuota: '5,00',  productos: [{descripcion: 'Menú', importe: '25,00'}] },
    { base: '30,00',  porcentaje: '4,0',  cuota: '1,20',  productos: [] }
  ]);
  assert('3 tramos válidos → 3 líneas', r.lineas && r.lineas.length === 3);
  assert('suma bases = 180,00', r.base === '180,00');
  assert('suma cuotas = 27,20', r.cuota === '27,20');
  assert('pct dominante = 21,0 (mayor cuota)', r.porcentaje === '21,0');
  assert('productos preservados con descripción', r.lineas[0].productos[0].descripcion === 'Cerveza');
}

{
  const r = normalizeConfirmedLineasIva([
    { base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [] },
    { base: 'abc',    porcentaje: '10,0', cuota: '5,00',  productos: [] }
  ]);
  assert('línea inválida se descarta', r.lineas && r.lineas.length === 1);
  assert('warning sobre línea inválida', r.errors && r.errors.length > 0);
}

{
  const r = normalizeConfirmedLineasIva([
    { base: '', porcentaje: '', cuota: '', productos: [] }
  ]);
  assert('todo inválido → lineas null', r.lineas === null);
  assert('errors mencionan "ninguna línea válida"',
    r.errors.some(e => /ninguna línea válida/.test(e)));
}

{
  const r = normalizeConfirmedLineasIva([
    { base: '100.00', porcentaje: '21', cuota: '21.00', productos: [] }
  ]);
  assert('formato inglés base "100.00" → parseado', r.lineas && r.lineas[0].base === '100,00');
  assert('porcentaje entero "21" → "21,0"', r.lineas[0].porcentaje === '21,0');
}

{
  const r = normalizeConfirmedLineasIva([
    { base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [
      { descripcion: 'Producto con descripción muy larga '.repeat(10), importe: '50,00' }
    ] }
  ]);
  assert('descripción truncada a 120 chars', r.lineas[0].productos[0].descripcion.length === 120);
}

{
  const r = normalizeConfirmedLineasIva([
    { base: '100,00', porcentaje: '21,0', cuota: '21,00' }  // productos missing
  ]);
  assert('productos missing → normalizado a []', Array.isArray(r.lineas[0].productos) && r.lineas[0].productos.length === 0);
}

// ─── Tests mergeLineasIva ────────────────────────────────────────────────────
section('mergeLineasIva');

{
  assert('null + null → null', mergeLineasIva(null, null) === null);
}

{
  const o = [{base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [{descripcion: 'Cerveza', importe: '50,00'}]}];
  const a = [];
  const r = mergeLineasIva(o, a);
  assert('OpenAI con productos + Azure vacío → OpenAI preservado', r && r.length === 1);
  assert('productos OpenAI preservados', r[0].productos[0].descripcion === 'Cerveza');
}

{
  const o = [{base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [{descripcion: 'A', importe: '50,00'}]}];
  const a = [{base: '50,00',  porcentaje: '10,0', cuota: '5,00',  productos: []}];
  const r = mergeLineasIva(o, a);
  assert('tramos distintos → union de 2 tramos', r && r.length === 2);
}

{
  const o = [{base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [{descripcion: 'Cerveza', importe: '50,00'}]}];
  const a = [{base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [{descripcion: 'Cerveza', importe: '50,00'}, {descripcion: 'Patatas', importe: '10,00'}]}];
  const r = mergeLineasIva(o, a);
  assert('mismo tramo ambos motores → merge dedup', r && r.length === 1);
  assert('productos dedupeados por descripcion+importe', r[0].productos.length === 2);
}

// ─── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} pasaron · ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
