// ═══════════════════════════════════════════════════════════════
// SETEX · Seed script · Solo entorno STAGING
// ═══════════════════════════════════════════════════════════════
// Inserta datos sintéticos idempotentes para probar la app sin
// datos reales. Safe-guard al inicio verifica NODE_ENV.
//
// Uso (desde el host):
//   cat seed-staging.js | docker exec -i setex-staging-backend node -
// ═══════════════════════════════════════════════════════════════

const bcrypt = require('bcrypt');
const path = require('path');
const sharp = require('sharp');
const { Pool } = require('pg');
const fs = require('fs').promises;

const PASSWORD = 'Staging2026!';
const BCRYPT_ROUNDS = 12;
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';

async function main() {
  // Guard: nunca correr fuera de staging
  if (process.env.NODE_ENV !== 'staging') {
    console.error(`REFUSED: NODE_ENV=${process.env.NODE_ENV} (se requiere 'staging').`);
    process.exit(1);
  }

  const postgresPassword = (await fs.readFile('/run/secrets/postgres_password', 'utf8')).trim();
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: 5432,
    database: 'setex_db',
    user: 'setex_user',
    password: postgresPassword,
    max: 4,
  });

  console.log('→ Generando hash bcrypt de la contraseña común...');
  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Usuarios ─────────────────────────────────────────────
    // 2 admins + 3 usuarios-empresa
    console.log('→ Insertando/actualizando usuarios (5)...');
    const users = [
      { email: 'admin@staging.setex.local',    is_admin: true,  company_name: null,                     company_nif: null },
      { email: 'gestor@staging.setex.local',   is_admin: true,  company_name: null,                     company_nif: null },
      { email: 'empresa1@staging.setex.local', is_admin: false, company_name: 'Taller Staging A',       company_nif: 'B00000001' },
      { email: 'empresa2@staging.setex.local', is_admin: false, company_name: 'Consultoría Staging B',  company_nif: 'B00000002' },
      { email: 'empresa3@staging.setex.local', is_admin: false, company_name: 'Comercial Staging C',    company_nif: 'B00000003' },
    ];
    for (const u of users) {
      await client.query(
        `INSERT INTO users (email, password_hash, is_admin, company_name, company_nif, auto_confirm_enabled)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               is_admin      = EXCLUDED.is_admin,
               company_name  = EXCLUDED.company_name,
               company_nif   = EXCLUDED.company_nif`,
        [u.email, passwordHash, u.is_admin, u.company_name, u.company_nif]
      );
    }

    // ── 2. Client companies ─────────────────────────────────────
    // 3 activas + 1 pendiente (para probar flujo de aprobación)
    console.log('→ Insertando/actualizando empresas cliente (4)...');
    const companies = [
      { nombre: 'Taller Staging A',      cif: 'B00000001', activa: true,  pendiente: false, codigo: 'STG-A' },
      { nombre: 'Consultoría Staging B', cif: 'B00000002', activa: true,  pendiente: false, codigo: 'STG-B' },
      { nombre: 'Comercial Staging C',   cif: 'B00000003', activa: true,  pendiente: false, codigo: 'STG-C' },
      { nombre: 'Empresa Pendiente D',   cif: 'B00000004', activa: false, pendiente: true,  codigo: 'STG-D' },
    ];
    for (const c of companies) {
      await client.query(
        `INSERT INTO client_companies (nombre, cif, activa, pendiente, codigo_cliente, registration_source)
         VALUES ($1, $2, $3, $4, $5, 'admin')
         ON CONFLICT (cif) DO UPDATE
           SET nombre = EXCLUDED.nombre,
               activa = EXCLUDED.activa,
               pendiente = EXCLUDED.pendiente,
               codigo_cliente = EXCLUDED.codigo_cliente`,
        [c.nombre, c.cif, c.activa, c.pendiente, c.codigo]
      );
    }

    // ── 3. Allowed emails ───────────────────────────────────────
    console.log('→ Insertando emails permitidos (2)...');
    const allowedEmails = [
      { email: 'test@staging.setex.local', notes: 'seed staging — libre registro para test' },
      { email: 'demo@staging.setex.local', notes: 'seed staging — libre registro para demo' },
    ];
    for (const a of allowedEmails) {
      await client.query(
        `INSERT INTO allowed_emails (email, notes)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING`,
        [a.email, a.notes]
      );
    }

    // ── 4. Uploads sintéticos ───────────────────────────────────
    console.log('→ Insertando 15 facturas sintéticas...');
    // Obtener ids reales tras el upsert
    const { rows: empresaUsers } = await client.query(
      `SELECT id, email, company_nif FROM users WHERE email LIKE 'empresa%@staging.setex.local' ORDER BY email`
    );
    const { rows: clientCompanies } = await client.query(
      `SELECT id, cif FROM client_companies WHERE cif IN ('B00000001','B00000002','B00000003') ORDER BY cif`
    );
    const companyByCif = Object.fromEntries(clientCompanies.map(c => [c.cif, c.id]));

    // 15 facturas repartidas: 5 por usuario
    const proveedores = [
      { nombre: 'Suministros Ibéricos SL',  nif: 'B12345678' },
      { nombre: 'Ferretería Central SA',    nif: 'A87654321' },
      { nombre: 'Gasolinera Avenida SL',    nif: 'B11223344' },
      { nombre: 'Telefónica España SAU',    nif: 'A82018474' },
      { nombre: 'Papelería del Sur SL',     nif: 'B22334455' },
    ];
    const tiposIva = [
      { pct: '21', ratio: 0.21 },
      { pct: '10', ratio: 0.10 },
      { pct: '4',  ratio: 0.04 },
    ];
    const hoy = new Date();

    // Asegurar que el directorio de uploads existe
    await fs.mkdir(UPLOADS_DIR, { recursive: true });

    const uploads = [];
    for (let i = 0; i < 15; i++) {
      const user = empresaUsers[i % empresaUsers.length];
      const proveedor = proveedores[i % proveedores.length];
      const iva = tiposIva[i % tiposIva.length];
      const baseImp = 100 + (i * 37.5);                // 100, 137.5, 175, ...
      const cuotaIva = +(baseImp * iva.ratio).toFixed(2);
      const total    = +(baseImp + cuotaIva).toFixed(2);
      const fecha = new Date(hoy);
      fecha.setDate(fecha.getDate() - (i * 7));        // facturas escalonadas cada semana
      const fechaStr = fecha.toISOString().slice(0, 10);

      // Generar JPEG sintético con sharp. Color único por índice para
      // identificar visualmente cada factura sin confundir con una real.
      const hue = (i * 24) % 360;                      // reparte tonos en el círculo
      const rgb = hueToRgb(hue, 0.20, 0.92);           // pastel muy suave
      const filename = `staging-seed-${String(i+1).padStart(2,'0')}.jpg`;
      const filePath = path.join(UPLOADS_DIR, filename);
      // skip si ya existe (idempotencia con disco real)
      let sizeBytes;
      try {
        const stat = await fs.stat(filePath);
        sizeBytes = stat.size;
      } catch {
        const buf = await sharp({
          create: { width: 480, height: 360, channels: 3, background: rgb }
        }).jpeg({ quality: 78 }).toBuffer();
        await fs.writeFile(filePath, buf);
        sizeBytes = buf.length;
      }

      uploads.push({
        user_id: user.id,
        filename,
        mimetype: 'image/jpeg',
        size_bytes: sizeBytes,
        file_path: filePath,
        proveedor_nif: proveedor.nif,
        proveedor_nombre: proveedor.nombre,
        receptor_nif: user.company_nif,
        receptor_nombre: null,                         // se autocompleta desde user.company_name
        fecha_emision: fechaStr,
        numero_factura: `F${fechaStr.replace(/-/g,'')}-${String(i+1).padStart(3,'0')}`,
        base_imponible: baseImp.toFixed(2),
        iva_porcentaje: iva.pct,
        cuota_iva: cuotaIva.toFixed(2),
        total_factura: total.toFixed(2),
        moneda: 'EUR',
        invoice_type: (i % 4 === 0) ? 'venta' : 'compra',
        client_company_id: companyByCif[user.company_nif] || null,
        procesado_en: new Date(),
        confidence_level: (i % 3 === 0) ? 'high' : (i % 3 === 1 ? 'medium' : 'low'),
      });
    }

    let inserted = 0;
    let fileUpdated = 0;
    for (const u of uploads) {
      // Actualizar file_path si el upload ya existe (re-ejecución)
      const upd = await client.query(
        `UPDATE uploads SET file_path = $1, size_bytes = $2
         WHERE user_id = $3 AND proveedor_nif = $4 AND fecha_emision = $5 AND total_factura = $6
           AND (file_path IS NULL OR file_path <> $1)`,
        [u.file_path, u.size_bytes, u.user_id, u.proveedor_nif, u.fecha_emision, u.total_factura]
      );
      fileUpdated += upd.rowCount;

      const r = await client.query(
        `INSERT INTO uploads (
           user_id, filename, mimetype, size_bytes, file_path,
           proveedor_nif, proveedor_nombre, receptor_nif,
           fecha_emision, numero_factura, base_imponible,
           iva_porcentaje, cuota_iva, total_factura, moneda,
           invoice_type, client_company_id, procesado_en,
           confidence_level, upload_status
         )
         VALUES (
           $1,$2,$3,$4,$5,
           $6,$7,$8,
           $9,$10,$11,
           $12,$13,$14,$15,
           $16,$17,$18,
           $19,'active'
         )
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          u.user_id, u.filename, u.mimetype, u.size_bytes, u.file_path,
          u.proveedor_nif, u.proveedor_nombre, u.receptor_nif,
          u.fecha_emision, u.numero_factura, u.base_imponible,
          u.iva_porcentaje, u.cuota_iva, u.total_factura, u.moneda,
          u.invoice_type, u.client_company_id, u.procesado_en,
          u.confidence_level,
        ]
      );
      if (r.rowCount > 0) inserted++;
    }

    await client.query('COMMIT');

    // ── Resumen ─────────────────────────────────────────────────
    const { rows: summary } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM users)             AS usuarios,
        (SELECT COUNT(*) FROM users WHERE is_admin) AS admins,
        (SELECT COUNT(*) FROM client_companies)  AS empresas,
        (SELECT COUNT(*) FROM client_companies WHERE pendiente) AS empresas_pendientes,
        (SELECT COUNT(*) FROM allowed_emails)    AS allowed_emails,
        (SELECT COUNT(*) FROM uploads)           AS uploads,
        (SELECT SUM(total_factura::numeric) FROM uploads) AS total_facturado
    `);

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  SEED OK · ${inserted} nuevos uploads · ${fileUpdated} file_path actualizados`);
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Usuarios: ${summary[0].usuarios} (${summary[0].admins} admins)`);
    console.log(`  Empresas cliente: ${summary[0].empresas} (${summary[0].empresas_pendientes} pendientes)`);
    console.log(`  Allowed emails: ${summary[0].allowed_emails}`);
    console.log(`  Uploads: ${summary[0].uploads}`);
    console.log(`  Total facturado: ${Number(summary[0].total_facturado || 0).toFixed(2)} EUR`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('  Credenciales de acceso:');
    console.log('  ─────────────────────────────────────────────────');
    console.log('  admin@staging.setex.local    / Staging2026!  (admin)');
    console.log('  gestor@staging.setex.local   / Staging2026!  (admin)');
    console.log('  empresa1@staging.setex.local / Staging2026!');
    console.log('  empresa2@staging.setex.local / Staging2026!');
    console.log('  empresa3@staging.setex.local / Staging2026!');
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// HSL → RGB (para generar colores pastel únicos por índice)
function hueToRgb(h, s, l) {
  h /= 360;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

main().catch(e => { console.error(e); process.exit(1); });
