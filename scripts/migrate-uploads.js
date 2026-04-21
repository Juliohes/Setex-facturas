#!/usr/bin/env node
// scripts/migrate-uploads.js
// Reorganiza archivos históricos de /uploads/ a /uploads/{email_prefix}/{nif}/
// Uso: docker exec setex-prod-backend node /app/scripts/migrate-uploads.js
// O directamente en el host: node /opt/setex/prod/scripts/migrate-uploads.js
// Desde staging: docker exec setex-staging-backend node /app/scripts/migrate-uploads.js
'use strict';

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto'); // eslint-disable-line no-unused-vars

async function readSecret(name) {
  return (await fs.readFile(`/run/secrets/${name}`, 'utf8')).trim();
}

async function run() {
  let password;
  try {
    password = await readSecret('postgres_password');
  } catch {
    // Fuera del contenedor — usar variable de entorno
    password = process.env.POSTGRES_PASSWORD;
    if (!password) {
      console.error('ERROR: necesitas POSTGRES_PASSWORD o ejecutar dentro del contenedor');
      process.exit(1);
    }
  }

  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'setex-prod-postgres',
    port: 5432,
    database: 'setex_db',
    user: 'setex_user',
    password,
    max: 5,
  });

  console.log('Conectando a PostgreSQL...');
  const client = await pool.connect();

  try {
    // Obtener todos los uploads con su email de usuario y NIF
    const result = await client.query(`
      SELECT u.id, u.filename, u.file_path, u.proveedor_nif,
             us.email
      FROM uploads u
      LEFT JOIN users us ON u.user_id = us.id
      ORDER BY u.id
    `);

    const rows = result.rows;
    console.log(`Total facturas en BD: ${rows.length}`);

    let moved = 0;
    let skipped = 0;
    let notFound = 0;
    let errors = 0;

    for (const row of rows) {
      const { id, filename, file_path, proveedor_nif, email } = row;

      // Determinar path esperado nuevo
      const emailPrefix = (email || 'unknown').split('@')[0].replace(/[^a-z0-9_.-]/gi, '_').toLowerCase();
      const nifFolder = proveedor_nif || 'sin_nif';
      const newDir = `/app/uploads/${emailPrefix}/${nifFolder}`;
      const newPath = `${newDir}/${filename}`;

      // Si file_path ya apunta a la ubicación nueva, saltar
      if (file_path && file_path === newPath) {
        skipped++;
        continue;
      }

      // Buscar el archivo — puede estar en la ubicación antigua o en alguna subfolder
      let currentPath = null;
      const candidates = [
        file_path,                            // ruta guardada en BD (puede ser null)
        `/app/uploads/${filename}`,           // raíz (formato antiguo)
        `/app/uploads/${emailPrefix}/${filename}`, // carpeta usuario sin NIF
      ].filter(Boolean);

      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          currentPath = candidate;
          break;
        } catch { /* no existe en esta ruta */ }
      }

      if (!currentPath) {
        console.log(`  [NOT FOUND] #${id} ${filename} — archivo no encontrado en disco`);
        notFound++;
        continue;
      }

      if (currentPath === newPath) {
        // Archivo ya está en la ubicación correcta, solo actualizar BD si es necesario
        if (file_path !== newPath) {
          await client.query('UPDATE uploads SET file_path = $1 WHERE id = $2', [newPath, id]);
        }
        skipped++;
        continue;
      }

      // Mover el archivo
      try {
        await fs.mkdir(newDir, { recursive: true });
        await fs.rename(currentPath, newPath);
        await client.query('UPDATE uploads SET file_path = $1 WHERE id = $2', [newPath, id]);
        console.log(`  [MOVED] #${id} ${path.basename(currentPath)} → ${newPath}`);
        moved++;
      } catch (err) {
        console.error(`  [ERROR] #${id} ${filename}: ${err.message}`);
        errors++;
      }
    }

    console.log('\n── Resultado ────────────────────────────────────');
    console.log(`  Movidos:    ${moved}`);
    console.log(`  Ya OK:      ${skipped}`);
    console.log(`  No hallados: ${notFound}`);
    console.log(`  Errores:    ${errors}`);
    console.log('─────────────────────────────────────────────────');

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
