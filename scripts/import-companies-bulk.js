#!/usr/bin/env node
// scripts/import-companies-bulk.js — carga masiva de empresas-cliente con OPCIÓN A
//
// Inserta cada (cif, nombre) en `client_companies` con activa=true, pendiente=false,
// registration_source='admin'. Cuando un usuario nuevo se registre con uno de estos
// CIFs, recibe JWT inmediato sin esperar aprobación admin.
//
// IDEMPOTENTE: ON CONFLICT (cif) DO UPDATE → re-corrible sin duplicados.
// Valida CIF/NIF con el algoritmo AEAT del proyecto (domain/validators/nif).
//
// Uso:
//   docker exec -i setex-prod-backend node /app/scripts/import-companies-bulk.js
// con DATA hardcodeada abajo (decisión consciente: una sola corrida, datos confidenciales).
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const { validateSpanishTaxId } = require('/app/src/domain/validators/nif');

// ── DATOS A IMPORTAR ─────────────────────────────────────────────────────────
const DATA = [
  ['TALLERES LUCAS BARRIGA',                  '08786525L'],
  ['MANUEL TOLEDANO VILLA',                   '80075300H'],
  ['MANUEL JOSE PIRIS GANHAO',                '80092110S'],
  ['AUTOS ZAPATA, S.L.',                      'B06179378'],
  ['EUSTAQUIO CESPEDES GUERRERO',             '80037509Q'],
  ['CV ASISTENCIAS, S.L.',                    'B06637177'],
  ['DOMINGO RODRIGUEZ SOLER',                 '33970863R'],
  ['HERMANOS MARQUEZ LOPEZ, S.L.',            'B06306534'],
  ['JOSE FRANCISCO COLETO PARDO',             '79260925G'],
  ['GARAGE PATILLA CARS, S.L.U.',             'B21743349'],
  ['JAVIER CASASALTAS JARAMILLO',             '80038925Y'],
  ['SEBASTIAN RODRIGUEZ SAYAGO',              '76248427T'],
  ['TALLERES SAN CRISTOBAL, C.B.',            'E06212393'],
  ['TALLERES JAVIER GARCIA',                  '34781563C'],
  ['AYUNTAMIENTO DE BADAJOZ',                 'P0601500B'],
  ['TALLERES HERMANOS FUENTES BLANCO, S.C.',  'J06593891'],
  ['HERMANOS RAMOS S.L.',                     'B06019269'],
  ['TALLERES GONZALEZ ROJAS',                 'B06494652'],
  ['JOSEFA VIZUETE GOMEZ',                    '30192669V'],
  ['AGRICOLA CIPRIANO, S.L.',                 'B06183446'],
  ['FERNANDO NUÑEZ MARTINEZ',                 '34777880V'],
  ['IES SAN JOSE',                            'S0600070G'],
  ['JESUS MANUEL BARNETO MUÑOZ',              '08858953C'],
  ['SIGLO XXI',                               'E06431282'],
  ['MODELOS ZAFRA, S.L.',                     'B06695985'],
  ['JUAN MIGUEL IZQUIERDO ORTIZ',             '08889982E'],
  ['SIE 2000 SL',                             'B06313530'],
  ['CELESTINO PEREZ MORILLO',                 '09205201A'],
  ['TALLERES SALPICO PAMPANO, S.C.',          'J06655799'],
  ['BARTO CHAPA & PINTURA',                   '45556416V'],
  ['RAUL LOPEZ FORERO',                       '08852042D'],
  ['CERES AUTOMOCION',                        'B10038636'],
  ['JUAN JAVIER ESTEVEZ TOSCA',               '80081300S'],
  ['SAYMA S.L.',                              'B06243778'],
  ['AUTOCIBA S.L.',                           'B06417174'],
  ['FRANCISCO MANUEL GONCAL',                 'X3383598E'],
  ['TALLERES CRESPO',                         '44779791X'],
  ['FRANCISCO JAVIER POMBERO',                '80048195F'],
  ['FRANCISCO JAVIER REBELLA',                '08860615A'],
  ['MOISES ANDRADE DURAN',                    '02274745E'],
  ['NEW GEAR SOLUTIONS S.L.',                 'B06735559'],
  ['TALLERES ROBLES',                         '08855457C'],
  ['ALBERTO CAÑA REGALADO',                   '76072394D'],
  ['ALVARO PIRIS CABALLERO',                  '80086729Q'],
  ['JUAN ANTONIO AMAYA CASTIL',               '44787131J'],
  ['JOSE MANUEL SANTOS NUÑEZ',                '80058029C'],
  ['CARLOS ORELLANA LOPEZ',                   '44775531M'],
  ['DAVID ÁLVAREZ LOPEZ',                     '80064357T'],
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toUpperCase().replace(/[\s\-.]/g, '').replace(/^ES/, '');

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const passwordPath = '/run/secrets/postgres_password';
  const password = fs.readFileSync(passwordPath, 'utf8').trim();
  const pool = new Pool({
    host:     process.env.PGHOST     || 'postgres',
    port:     parseInt(process.env.PGPORT, 10) || 5432,
    user:     process.env.PGUSER     || 'setex_user',
    password,
    database: process.env.PGDATABASE || 'setex_db',
  });

  const stats = { total: DATA.length, ok: 0, updated: 0, invalid_cif: [], errors: [] };

  // 1. Validación previa AEAT (no aborta — solo reporta)
  console.log(`\n=== Validación AEAT de los ${DATA.length} CIFs/NIFs ===`);
  const validRows = [];
  for (const [nombre, cifRaw] of DATA) {
    const cif = norm(cifRaw);
    const v = validateSpanishTaxId(cif);
    if (!v.valid) {
      stats.invalid_cif.push({ nombre, cif, reason: v.reason || 'algoritmo AEAT no pasa' });
      console.log(`  ✗ ${cif.padEnd(11)} ${nombre}  → ${v.reason || 'inválido'}`);
    } else {
      validRows.push({ nombre, cif });
    }
  }
  console.log(`Resultado: ${validRows.length} válidos, ${stats.invalid_cif.length} inválidos`);

  // 2. INSERT idempotente para los válidos. Los inválidos se reportan al final.
  // Quien decida si meter los inválidos al catálogo es Julio.
  console.log(`\n=== Insertando ${validRows.length} empresas con activa=true, pendiente=false ===`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Nunca tocar la columna `notas`: es para uso del admin humano (Julio).
    // Origen y fecha de la carga quedan trazados en audit_logs y registration_source.
    for (const { nombre, cif } of validRows) {
      const res = await client.query(`
        INSERT INTO client_companies (
          nombre, cif, activa, pendiente, registration_source,
          created_at, updated_at
        ) VALUES ($1, $2, true, false, 'admin', NOW(), NOW())
        ON CONFLICT (cif) DO UPDATE SET
          nombre              = EXCLUDED.nombre,
          activa              = true,
          pendiente           = false,
          registration_source = 'admin',
          updated_at          = NOW()
        RETURNING (xmax = 0) AS inserted, id, codigo_cliente
      `, [nombre, cif]);
      const row = res.rows[0];
      if (row.inserted) {
        stats.ok++;
        console.log(`  ✓ id=${row.id}  ${cif.padEnd(11)} ${nombre}`);
      } else {
        stats.updated++;
        console.log(`  ⟳ id=${row.id}  ${cif.padEnd(11)} ${nombre}  (ya existía → actualizada)`);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    stats.errors.push(err.message);
    console.error(`\n✗ ROLLBACK: ${err.message}`);
    process.exitCode = 2;
  } finally {
    client.release();
  }

  // 3. Audit log de la operación masiva
  await pool.query(`
    INSERT INTO audit_logs (user_id, action, details, ip_address, created_at)
    VALUES (2, 'ADMIN_BULK_IMPORT_COMPANIES',
      $1::jsonb, '127.0.0.1', NOW())
  `, [JSON.stringify({
    total: stats.total,
    inserted: stats.ok,
    updated: stats.updated,
    invalid_cif: stats.invalid_cif.length,
    source: 'import-companies-bulk.js',
    applied_by: 'juliohesuni@gmail.com via Claude Code',
  })]);

  // 4. Resumen final
  console.log(`\n=== RESUMEN ===`);
  console.log(`  Total filas:       ${stats.total}`);
  console.log(`  Insertadas nuevas: ${stats.ok}`);
  console.log(`  Actualizadas:      ${stats.updated}`);
  console.log(`  CIF/NIF inválidos: ${stats.invalid_cif.length}`);
  if (stats.invalid_cif.length) {
    console.log(`\n  Detalle inválidos (no insertados — revisa manualmente):`);
    for (const it of stats.invalid_cif) {
      console.log(`    - ${it.cif}  ${it.nombre}  (${it.reason})`);
    }
  }
  await pool.end();
  process.exit(stats.errors.length ? 2 : 0);
})().catch((e) => {
  console.error('Fatal:', e.stack || e.message);
  process.exit(3);
});
