const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs'); // Para lectura/escritura síncrona de features.json
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
// rateLimit se sigue importando aquí por el `require` dinámico de algunos endpoints.
// Los limiters reales vienen ahora de middleware/rate-limit.js (paso 9/22).
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const winston = require('winston');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const sharp = require('sharp');
const { extractInvoiceOCR, extractCIFOnlyOCR, compararVarianteContraste } = require('./ocr/index');
const { ejecutarBenchmarkCompleto, GRUPOS_CAMPOS } = require('./ocr/benchmark');
const { analizarCalidadImagen } = require('./pipeline/preprocess');
const { ejecutarPipelineV2Sombra } = require('./pipeline/orchestrator');
const { aplanarCanonico, validarCorreccionHumana } = require('./pipeline/arbiter');

// ── Módulos refactorizados (Strangler-Fig, pasos 1-20 completados) ────────────
// Ubicación objetivo: domain/, services/, repositories/, middleware/, lib/, config/
// Los requires desde ./ocr/validateCIF e ./ocr/validateIVA siguen funcionando por
// shims retrocompatibles, pero ahora importamos directamente desde domain/.
const { validateSpanishTaxId, checkDigitCIF } = require('./domain/validators/nif');
const { validateIVACoherencia, normalizeConfirmedLineasIva, fillDerivedBases } = require('./domain/validators/iva');
// Fase 3 pipeline v2 (2026-07-21): routing determinista en modo shadow — se
// calcula y se registra junto a la decisión real, sin sustituirla todavía.
const { decidirRouting } = require('./domain/routing');
const { connection: redisClient } = require('./queue/index');
const { validateVIES } = require('./services/viesValidator');
const { validateInvoiceCifs } = require('./lib/invoice-cif-validator');
const { normalizeToFloat, toSpanishAmount } = require('./lib/normalize-amount');
const { detectarGruposDuplicados, encontrarDuplicadoPorNumero } = require('./lib/duplicate-detector');

// Rate limiters centralizados (middleware/rate-limit.js)
const {
  authLimiter: authLimiterV2,
  uploadLimiter: uploadLimiterV2,
  confirmLimiter: confirmLimiterV2,
  refreshLimiter: refreshLimiterV2,
  viesLimiter: viesLimiterV2,
} = require('./middleware/rate-limit');

// Audit service con dependency injection (services/audit/audit.service.js)
const { createAuditLogger } = require('./services/audit/audit.service');

// Request ID middleware (middleware/request-id.js)
const requestIdMiddleware = require('./middleware/request-id');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache de secrets — se leen UNA VEZ al arrancar, no en cada request
let jwtSecretCached = null;

// Trust proxy for correct IP detection behind Traefik/Nginx
app.set('trust proxy', 1);
app.disable('x-powered-by'); // No revelar que usamos Express

// Request ID middleware — añade X-Request-Id a cada request (trazabilidad).
// Se aplica antes que cualquier otro middleware para que req.requestId esté
// disponible en logs, audit y respuestas de error. (Strangler-Fig paso 8/22)
app.use(requestIdMiddleware);

// ── Seguridad: carga de security.json (equivalente a .htaccess) ───────────────
const SECURITY_PATH = '/app/src/config/security.json';
let _secCfg = null;
let _secCfgTs = 0;

function loadSecurityConfig() {
  try {
    const now = Date.now();
    if (now - _secCfgTs < 30000 && _secCfg) return _secCfg;
    const raw = fsSync.readFileSync(SECURITY_PATH, 'utf8');
    _secCfg = JSON.parse(raw);
    _secCfgTs = now;
    return _secCfg;
  } catch {
    return { time_restriction: { enabled: true, start_hour: 0, end_hour: 6, timezone: 'Europe/Madrid' },
             ip_whitelist: [], ip_blacklist: [], auto_block: { enabled: true, max_requests: 100, window_seconds: 300, block_duration_minutes: 60 }, max_users: 350 };
  }
}

// Backup de security.json antes de cada escritura — protege contra corrupción
function backupSecurityConfig() {
  try {
    const content = fsSync.readFileSync(SECURITY_PATH, 'utf8');
    fsSync.writeFileSync(`${SECURITY_PATH}.bak`, content, 'utf8');
  } catch (e) {
    logger.warn('[Security] Backup de security.json falló:', e.message);
  }
}

// Comprueba si una IP pertenece a un rango (soporta CIDR: 10.0.0.0/8 y exacto: 1.2.3.4)
function ipInRange(ip, range) {
  if (!ip || !range || typeof range !== 'string' || range.startsWith('_')) return false;
  if (!range.includes('/')) return ip === range;
  try {
    const [net, bits] = range.split('/');
    const b = parseInt(bits, 10);
    if (isNaN(b) || b < 0 || b > 32) return false;
    const toNum = (a) => a.split('.').reduce((acc, o) => ((acc * 256) + parseInt(o, 10)) >>> 0, 0);
    const mask = b === 0 ? 0 : ((0xFFFFFFFF << (32 - b)) >>> 0);
    return (toNum(ip) & mask) === (toNum(net) & mask);
  } catch { return false; }
}
function ipInList(ip, list) {
  return Array.isArray(list) && list.some(r => ipInRange(ip, r));
}

// Comprueba si estamos en horario restringido (hora de Madrid)
function isRestrictedHour(cfg) {
  if (!cfg?.time_restriction?.enabled) return false;
  const { start_hour = 0, end_hour = 6, timezone = 'Europe/Madrid' } = cfg.time_restriction;
  // SEC-012: si start=end la configuración es inválida — devolver false para evitar lockout total permanente
  if (start_hour === end_hour) return false;
  let h;
  try {
    h = parseInt(new Intl.DateTimeFormat('es-ES', { timeZone: timezone, hour: 'numeric', hour12: false }).format(new Date()), 10);
  } catch { h = new Date().getUTCHours(); }
  return start_hour < end_hour ? (h >= start_hour && h < end_hour) : (h >= start_hour || h < end_hour);
}

// Logger con rotación automática (max 50MB por fichero, 5 ficheros → máx 250MB total)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({
      filename: '/app/logs/error.log',
      level: 'error',
      maxsize: 50 * 1024 * 1024,  // 50 MB
      maxFiles: 3,
      tailable: true,
    }),
    new winston.transports.File({
      filename: '/app/logs/app.log',
      maxsize: 50 * 1024 * 1024,  // 50 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.Console()
  ]
});

// Leer secrets
async function readSecret(name) {
  try {
    return (await fs.readFile(`/run/secrets/${name}`, 'utf8')).trim();
  } catch (err) {
    logger.error(`Error leyendo secret ${name}:`, err);
    process.exit(1);
  }
}

// Configurar transporter de email
// HAL-006: SMTP leído desde Docker secrets (/run/secrets/smtp_user, /run/secrets/smtp_pass)
// Fallback a variables de entorno para compatibilidad con entornos de desarrollo
let emailTransporter;
let smtpUserCached = null; // SEC-003: cachear para usar en from: sin depender de process.env
async function initEmailTransporter() {
  let smtpUser = process.env.SMTP_USER;
  let smtpPass = process.env.SMTP_PASS;

  // Intentar leer desde Docker secrets (producción)
  try {
    const secretUser = await fs.readFile('/run/secrets/smtp_user', 'utf8');
    if (secretUser.trim()) smtpUser = secretUser.trim();
  } catch {}
  try {
    const secretPass = await fs.readFile('/run/secrets/smtp_pass', 'utf8');
    if (secretPass.trim()) smtpPass = secretPass.trim();
  } catch {}

  smtpUserCached = smtpUser || null; // guardar para uso posterior sin depender de env vars

  emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: smtpUser, pass: smtpPass }
  });

  if (smtpUser) {
    try {
      await emailTransporter.verify();
      logger.info('Email transporter configured successfully');
    } catch (err) {
      logger.warn('Email transporter verification failed:', err.message);
    }
  } else {
    logger.warn('SMTP not configured - password reset emails will not be sent');
  }
}

// PostgreSQL pool
let pool;
async function initDB() {
  const password = await readSecret('postgres_password');
  pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: 5432,
    database: 'setex_db',
    user: 'setex_user',
    password,
    max: 20
  });

  // Crear tablas
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      filename VARCHAR(255) NOT NULL,
      mimetype VARCHAR(100) NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      n8n_sent BOOLEAN DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_reset_token_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens(expires_at);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS proveedor_nif VARCHAR(20);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS fecha_emision VARCHAR(20);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS total_factura VARCHAR(30);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS numero_factura VARCHAR(50);
    CREATE INDEX IF NOT EXISTS idx_uploads_duplicate ON uploads(user_id, proveedor_nif, fecha_emision, total_factura);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS ocr_result JSONB;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS confidence_level VARCHAR(10);
    CREATE TABLE IF NOT EXISTS failed_jobs (
      id SERIAL PRIMARY KEY,
      upload_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      filename VARCHAR(255),
      error_message TEXT,
      attempts INTEGER DEFAULT 0,
      job_data JSONB,
      failed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_failed_jobs_user ON failed_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_failed_jobs_failed_at ON failed_jobs(failed_at);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_confirm_enabled BOOLEAN DEFAULT true;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS proveedor_nombre VARCHAR(255);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS receptor_nombre VARCHAR(255);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS receptor_nif VARCHAR(20);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS base_imponible VARCHAR(30);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS iva_porcentaje VARCHAR(10);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS cuota_iva VARCHAR(30);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS irpf_porcentaje VARCHAR(10);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS cuota_irpf VARCHAR(30);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS moneda VARCHAR(5);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS procesado_en TIMESTAMP;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS lineas_iva JSONB;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS iva_validation_ok BOOLEAN;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS iva_warnings JSONB;
    ALTER TABLE failed_jobs ADD COLUMN IF NOT EXISTS retried_at TIMESTAMP;
    CREATE TABLE IF NOT EXISTS allowed_emails (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes VARCHAR(500)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      details JSONB,
      ip_address VARCHAR(45),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
    CREATE TABLE IF NOT EXISTS known_cifs (
      id SERIAL PRIMARY KEY,
      proveedor_nombre_norm TEXT NOT NULL,
      proveedor_nif TEXT NOT NULL,
      confirmations INT DEFAULT 1,
      last_seen TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE known_cifs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_known_cifs_user_nombre ON known_cifs(user_id, proveedor_nombre_norm) WHERE user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_known_cifs_user_nif ON known_cifs(user_id, proveedor_nif);
    -- google_tokens eliminada: integración Google Drive/Sheets retirada
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE TABLE IF NOT EXISTS company_catalog (
      id SERIAL PRIMARY KEY,
      proveedor_nombre VARCHAR(255) NOT NULL,
      proveedor_nombre_norm TEXT NOT NULL,
      proveedor_nif VARCHAR(20) NOT NULL,
      notas TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_company_catalog_nif ON company_catalog(proveedor_nif);
    CREATE INDEX IF NOT EXISTS idx_company_catalog_trgm ON company_catalog USING gin (proveedor_nombre_norm gin_trgm_ops);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS company_nif VARCHAR(20);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(20) DEFAULT 'compra';
    CREATE TABLE IF NOT EXISTS client_companies (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(255) NOT NULL,
      cif VARCHAR(20) UNIQUE NOT NULL,
      activa BOOLEAN DEFAULT true,
      notas TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS codigo_cliente VARCHAR(50) UNIQUE;
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS pendiente BOOLEAN DEFAULT false;
    -- Enlace de facturas admin a la empresa cliente (receptor seleccionado manualmente)
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS client_company_id INTEGER REFERENCES client_companies(id);
    CREATE INDEX IF NOT EXISTS idx_client_companies_cif ON client_companies(cif);
    CREATE INDEX IF NOT EXISTS idx_client_companies_activa ON client_companies(activa);
    -- HAL-003: is_admin en BD (reemplaza ADMIN_EMAILS hardcoded)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
    -- HAL-002: token_version para revocación de sesiones tras cambio de contraseña
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
    -- SANDBOX 2026-05-07: usuarios de pruebas (no aparecen en panel admin, se purgan
    -- sus uploads y audit_logs cada 60s via services/test-cleanup.js)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_users_is_test ON users(is_test) WHERE is_test = true;
    -- Empresas-cliente de prueba (vinculadas a usuarios is_test). Se filtran de los
    -- endpoints admin para que la cuenta sandbox no contamine el catálogo real.
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_client_companies_is_test ON client_companies(is_test) WHERE is_test = true;
    -- allowed_emails — tabla obsoleta reemplazada por client_companies
    -- Extensión para Levenshtein (distancia de edición en CIFs con typos)
    CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
    -- Relaciones empresa SETEX ↔ contrapartes (proveedores/clientes en facturas)
    CREATE TABLE IF NOT EXISTS company_relationships (
      id SERIAL PRIMARY KEY,
      client_cif VARCHAR(20) NOT NULL,
      counterparty_nif VARCHAR(20),
      counterparty_nombre VARCHAR(255),
      counterparty_nombre_norm TEXT NOT NULL DEFAULT '',
      relationship_type VARCHAR(10) DEFAULT 'proveedor',
      confirmations INTEGER DEFAULT 1,
      last_seen TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_company_rel_unique
      ON company_relationships(client_cif, counterparty_nif) WHERE counterparty_nif IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_company_rel_trgm
      ON company_relationships USING gin (counterparty_nombre_norm gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_company_rel_client ON company_relationships(client_cif);
    -- REFRESH TOKENS: almacenamiento server-side de refresh tokens (cookie httpOnly)
    -- token_hash = SHA-256 del token crudo; family_id = cadena de rotación para detectar reuso
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL,
      family_id VARCHAR(64) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      revoked BOOLEAN DEFAULT false,
      revoked_at TIMESTAMP,
      replaced_by_hash VARCHAR(64)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_token_hash ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_rt_family ON refresh_tokens(family_id);
    CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_rt_expires ON refresh_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_rt_revoked ON refresh_tokens(revoked, revoked_at) WHERE revoked = true;
    -- APPROVAL FLOW: columnas adicionales en client_companies para trazabilidad de registro y revisión
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS registration_source VARCHAR(30) DEFAULT 'admin';
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS requested_by_email VARCHAR(255);
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP;
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS linked_to_company_id INTEGER REFERENCES client_companies(id) ON DELETE SET NULL;
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS nombre_registrado VARCHAR(255);
    ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS matching_suggestions JSONB;
    -- GIN index para búsqueda fuzzy de nombres de empresa
    CREATE INDEX IF NOT EXISTS idx_client_companies_trgm ON client_companies USING gin (nombre gin_trgm_ops);
    -- APPROVAL FLOW: ciclo de vida de documentos (active | pending | quarantine | migrated)
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS upload_status VARCHAR(20) DEFAULT 'active';
    CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(upload_status);
    -- APPROVAL FLOW: log de acciones admin sobre empresas
    CREATE TABLE IF NOT EXISTS company_audit_log (
      id SERIAL PRIMARY KEY,
      company_id INTEGER REFERENCES client_companies(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(50) NOT NULL,
      notes TEXT,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_company_audit_log_company ON company_audit_log(company_id);
    CREATE INDEX IF NOT EXISTS idx_company_audit_log_created ON company_audit_log(created_at);

    -- Fase 3/4 pipeline v2 (2026-07-21): comparación en modo shadow entre la
    -- decisión real (v1, entrelazada en upload-preview) y la decisión del
    -- nuevo routing determinista (v2, domain/routing.js). Solo trazabilidad
    -- para validar v2 antes del switch — no participa en el flujo real.
    CREATE TABLE IF NOT EXISTS ocr_shadow_validaciones (
      id SERIAL PRIMARY KEY,
      preview_id UUID NOT NULL,
      decision_v1 VARCHAR(20) NOT NULL,
      decision_v2 VARCHAR(20) NOT NULL,
      coincide BOOLEAN NOT NULL,
      incidencias JSONB NOT NULL DEFAULT '[]',
      sugerencias JSONB NOT NULL DEFAULT '{}',
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_shadow_validaciones_coincide ON ocr_shadow_validaciones(coincide);
    CREATE INDEX IF NOT EXISTS idx_shadow_validaciones_creado ON ocr_shadow_validaciones(creado_en);

    -- 2026-07-21 (a petición de Julio, volumen bajo ~1 factura/2 días): enlaza
    -- cada comparación shadow con la factura real que terminó guardándose, y
    -- con si el humano tuvo que corregir algo. Sin esto, v1/v2 quedaban sin
    -- forma de contrastarse contra lo que de verdad pasó factura a factura.
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS preview_id UUID;
    CREATE INDEX IF NOT EXISTS idx_uploads_preview_id ON uploads(preview_id);
    ALTER TABLE ocr_shadow_validaciones ADD COLUMN IF NOT EXISTS humano_corrigio BOOLEAN;

    -- Vista de consulta directa (psql o el nuevo endpoint admin): una fila por
    -- factura con v1, v2, si coincidieron y si el humano corrigió algo.
    CREATE OR REPLACE VIEW ocr_shadow_comparativa AS
      SELECT
        s.id, s.preview_id, u.id AS upload_id,
        u.proveedor_nombre, u.proveedor_nif, u.total_factura, u.fecha_emision,
        s.decision_v1, s.decision_v2, s.coincide, s.humano_corrigio,
        s.incidencias, s.sugerencias, s.creado_en
      FROM ocr_shadow_validaciones s
      LEFT JOIN uploads u ON u.preview_id = s.preview_id
      ORDER BY s.creado_en DESC;

    -- Bloque 5 pipeline v2 (2026-07-22): comparativa original vs variante de
    -- contraste (CLAHE) — automático en cada factura mientras el flag esté
    -- activo (decisión de Julio). Solo trazabilidad, no participa en el flujo
    -- real: el usuario nunca ve ni la variante ni esta comparación.
    CREATE TABLE IF NOT EXISTS ocr_imagen_variante_comparativa (
      id SERIAL PRIMARY KEY,
      preview_id UUID NOT NULL,
      motor VARCHAR(30) NOT NULL,
      ruta_variante TEXT,
      campos_original JSONB NOT NULL DEFAULT '{}',
      campos_variante JSONB NOT NULL DEFAULT '{}',
      diffs JSONB NOT NULL DEFAULT '[]',
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_imagen_variante_preview ON ocr_imagen_variante_comparativa(preview_id);

    -- Benchmark multi-imagen × multi-motor (2026-07-23, petición de Julio):
    -- 3 variantes de la foto (actual/original/contraste) × todos los motores
    -- OCR disponibles, puntuado contra lo confirmado por el humano. Cuesta
    -- dinero real (hasta 15 llamadas por factura) — solo corre si el flag
    -- pipeline_v2_benchmark_enabled está activo, o al pulsar el botón de
    -- "últimas facturas" en el panel admin. Nunca afecta al pipeline real.
    CREATE TABLE IF NOT EXISTS ocr_benchmark_resultados (
      id SERIAL PRIMARY KEY,
      upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      variante VARCHAR(20) NOT NULL,
      motor VARCHAR(30) NOT NULL,
      campos JSONB NOT NULL DEFAULT '{}',
      es_factura_valida BOOLEAN,
      tiempo_ms INTEGER,
      error TEXT,
      aciertos INTEGER NOT NULL DEFAULT 0,
      comparables INTEGER NOT NULL DEFAULT 0,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_unico ON ocr_benchmark_resultados(upload_id, variante, motor);
    CREATE INDEX IF NOT EXISTS idx_benchmark_upload ON ocr_benchmark_resultados(upload_id);
    -- 2026-07-24: acierto/fallo por campo (CIF, nombre, fecha, importes,
    -- tramos IVA...), no solo el ratio agregado — permite el ranking por
    -- campo del panel sin volver a llamar a ninguna IA.
    ALTER TABLE ocr_benchmark_resultados ADD COLUMN IF NOT EXISTS detalle_campos JSONB NOT NULL DEFAULT '{}';

    -- Fase 8 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md (2026-07-27): resultado
    -- completo del pipeline v2 (extracción + árbitro + confianza + estado)
    -- para cada factura procesada por esa vía. Tabla nueva, aditiva —
    -- ninguna tabla existente se modifica. Rollback: scripts/rollback/
    -- 2026-07-27-extracciones-v2-down.sql (DROP TABLE IF EXISTS).
    CREATE TABLE IF NOT EXISTS extracciones_v2 (
      id SERIAL PRIMARY KEY,
      upload_id INTEGER REFERENCES uploads(id) ON DELETE CASCADE,
      campos_canonicos JSONB NOT NULL,
      confianzas JSONB NOT NULL DEFAULT '{}',
      disputas JSONB NOT NULL DEFAULT '[]',
      score_global NUMERIC(4,3),
      estado VARCHAR(20) NOT NULL,
      version_pipeline VARCHAR(20) NOT NULL DEFAULT 'v2',
      coste_estimado_usd NUMERIC(8,5),
      latencia_ms INTEGER,
      correccion_humana JSONB,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_extracciones_v2_upload ON extracciones_v2(upload_id);
    CREATE INDEX IF NOT EXISTS idx_extracciones_v2_estado ON extracciones_v2(estado);

    -- 2026-07-28 (gap 1 del plan de cierre): distingue de dónde viene cada
    -- fila. 'shadow' = las que ya se generaban automáticamente en cada
    -- confirmación real; 'replay' = generadas por el comando de replay sobre
    -- facturas ya confirmadas, sin afectar a v1; 'activo' reservado para
    -- cuando v2 decida de verdad. Aditiva, con default para no romper filas
    -- ya existentes. Rollback: scripts/rollback/2026-07-28-extracciones-v2-modo-down.sql
    ALTER TABLE extracciones_v2 ADD COLUMN IF NOT EXISTS modo VARCHAR(20) NOT NULL DEFAULT 'shadow';
    CREATE INDEX IF NOT EXISTS idx_extracciones_v2_modo ON extracciones_v2(modo);

    -- 2026-07-28 (gap "variantes + aprendizaje continuo"): aditivas, con
    -- default para no romper filas ya existentes. Rollback: scripts/rollback/
    -- 2026-07-28-extracciones-v2-aprendizaje-down.sql
    --   variante: qué imagen ganó la comparación ('estandar'|'contraste'),
    --     solo relevante si ocr_extraccion_v2_variantes_enabled estaba activo.
    --   alucinaciones_sospechosas: campos críticos cuyo valor NO aparece en
    --     el texto bruto de Tesseract — señal de posible invención, no de
    --     certeza (Tesseract también falla en fotos malas).
    --   aprendizaje_aplicado: si se sustituyó el nombre de la contraparte por
    --     uno ya conocido (known_cifs/company_relationships), y de dónde.
    ALTER TABLE extracciones_v2 ADD COLUMN IF NOT EXISTS variante VARCHAR(20) NOT NULL DEFAULT 'estandar';
    ALTER TABLE extracciones_v2 ADD COLUMN IF NOT EXISTS alucinaciones_sospechosas JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE extracciones_v2 ADD COLUMN IF NOT EXISTS aprendizaje_aplicado JSONB;

    -- 2026-07-29 (revision ground truth): admin marca a mano campos de una
    -- factura como no fiables (ej. CIF ilegible incluso a simple vista) para
    -- que el panel los pinte en rojo y quede visible que ese dato requiere
    -- revision antes de usarse en contabilidad. Aditiva, default '[]'.
    -- Rollback: scripts/rollback/2026-07-29-uploads-campos-no-fiables-down.sql
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS campos_no_fiables JSONB NOT NULL DEFAULT '[]';
    -- Factura multipágina (2026-08-13): lista de páginas [{pagina, path}] cuando
    -- la factura se subió como varias imágenes. NULL para facturas de una página.
    -- La página 1 también está en file_path; aquí se guardan todas para el visor
    -- del panel admin. Rollback: scripts/rollback/2026-08-13-uploads-paginas-down.sql
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS paginas JSONB;
  `);

  // 2026-07-29: helper unico para leer uploads.total_factura (VARCHAR con dos
  // formatos historicos) como NUMERIC. Si el texto lleva coma, el punto es
  // separador de miles ("1.234,56"); si no lleva coma, el punto es decimal
  // ("1234.56"). Devuelve NULL si no es un numero, para no romper agregados.
  await pool.query(`
    CREATE OR REPLACE FUNCTION setex_total_num(t TEXT) RETURNS NUMERIC AS $fn$
    DECLARE s TEXT;
    BEGIN
      IF t IS NULL OR btrim(t) = '' THEN RETURN NULL; END IF;
      s := btrim(t);
      IF position(',' in s) > 0 THEN
        s := replace(replace(s, '.', ''), ',', '.');
      END IF;
      IF s ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN RETURN s::NUMERIC; END IF;
      RETURN NULL;
    END;
    $fn$ LANGUAGE plpgsql IMMUTABLE;
  `);

  // Backfill: uploads anteriores sin upload_status → 'active'
  await pool.query(`
    UPDATE uploads SET upload_status = 'active'
    WHERE upload_status IS NULL
  `);

  // Backfill: migrar n8n_sent → procesado_en (legacy de integración Google Drive/Sheets eliminada)
  await pool.query(`
    UPDATE uploads SET procesado_en = uploaded_at
    WHERE n8n_sent = true AND procesado_en IS NULL
  `);

  // Promover admins existentes por email (idempotente — si ya son admin, no cambia nada)
  await pool.query(`
    UPDATE users SET is_admin = true
    WHERE email = ANY($1) AND is_admin = false
  `, [ADMIN_EMAILS_BOOTSTRAP]);

  logger.info('Database initialized');
}

// Middleware — Security hardened
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(cors({ origin: 'https://setex-facturas.es', credentials: true }));
app.use(express.json({ limit: '1mb' }));

// ── Middleware de seguridad global (equivalente a .htaccess) ──────────────────
// Capa 1: whitelist/blacklist de IPs + restricción horaria + auto-block
app.use((req, res, next) => {
  const cfg = loadSecurityConfig();
  const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');

  // WHITELIST: bypass total de todas las restricciones
  if (ipInList(ip, cfg.ip_whitelist)) return next();

  // BLACKLIST: bloqueo permanente (403 — acceso denegado)
  if (ipInList(ip, cfg.ip_blacklist)) {
    logger.warn(`[Security] IP bloqueada (blacklist): ${ip} → ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  // RESTRICCIÓN HORARIA: devuelve 403 como señal para nginx auth_request.
  // nginx convierte ese 403 en 404 via error_page → el usuario ve 404 (sitio inexistente).
  if (isRestrictedHour(cfg)) {
    logger.info(`[Security] Acceso bloqueado por horario para IP ${ip} → ${req.method} ${req.path}`);
    return res.status(403).end();
  }

  next();
});

// Capa 2: auto-block por exceso de peticiones (usa Redis para persistir contadores)
app.use((req, res, next) => {
  // Las rutas /api/internal/* son subrequests de nginx (auth_request). auth_request sólo
  // acepta 200/401/403; un 429 del auto-block hace que nginx devuelva 500 al cliente, dejando
  // el sitio inutilizable hasta que el bloqueo caduque (60 min). Se exceptúan: son endpoints
  // internos, idempotentes, sin BD ni coste relevante.
  if (req.path.startsWith('/api/internal/')) return next();

  const cfg = loadSecurityConfig();
  if (!cfg?.auto_block?.enabled || !redisClient) return next();
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  if (!ip || ipInList(ip, cfg.ip_whitelist)) return next();

  const blockKey = `sec:block:${ip}`;
  const countKey = `sec:count:${ip}`;
  const { max_requests = 400, window_seconds = 300, block_duration_minutes = 60 } = cfg.auto_block;

  redisClient.get(blockKey).then(blocked => {
    if (blocked) {
      return res.status(429).json({ error: 'Acceso bloqueado temporalmente por exceso de solicitudes. Inténtalo en 1 hora.' });
    }
    redisClient.incr(countKey).then(count => {
      if (count === 1) redisClient.expire(countKey, window_seconds);
      if (count > max_requests) {
        const dur = block_duration_minutes * 60;
        redisClient.setex(blockKey, dur, new Date().toISOString());
        logger.warn(`[Security] Auto-block activado para IP ${ip} (${count} req en ${window_seconds}s → bloqueada ${block_duration_minutes}min)`);
        return res.status(429).json({ error: 'Acceso bloqueado temporalmente por exceso de solicitudes. Inténtalo en 1 hora.' });
      }
      next();
    }).catch(() => next());
  }).catch(() => next());
});

// Rate limiters — ahora vienen centralizados de middleware/rate-limit.js
// (Strangler-Fig paso 9/22). Se alias a los nombres originales para no romper
// las ~9 rutas que los consumen abajo. En Round 6 estos alias se eliminarán
// cuando las rutas se extraigan a src/routes/*.routes.js.
const authLimiter = authLimiterV2;
const uploadLimiter = uploadLimiterV2;
const confirmLimiter = confirmLimiterV2;
const refreshLimiter = refreshLimiterV2;

// Multer upload — organizado por usuario
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const emailPrefix = (req.user?.email || 'unknown').split('@')[0].replace(/[^a-z0-9_.-]/gi, '_').toLowerCase();
    const dir = `/app/uploads/${emailPrefix}`;
    require('fs').promises.mkdir(dir, { recursive: true }).then(() => cb(null, dir)).catch(cb);
  },
  filename: (req, file, cb) => {
    const username = req.user?.email?.split('@')[0] || 'unknown';
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const rand = crypto.randomBytes(3).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${username}_${dateStr}${ms}_${rand}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10*1024*1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'));
  }
});

// Subida MULTIPÁGINA (2026-08-13): una factura repartida en varias imágenes.
// Solo imágenes — el PDF se rasteriza a imágenes EN EL CLIENTE con el pdfjs ya
// vendorizado (frontend), así el backend recibe siempre N fotos. El tope duro de
// páginas se aplica en el handler (según features.json); aquí se fija un máximo
// defensivo alto para multer y un límite de tamaño por fichero igual al de una
// página. Mismo `storage` (rutas por usuario) que la subida de una página.
const MULTIPAGINA_MAX_HARD = 12; // backstop de multer; el tope real lo pone el flag
const uploadMultipagina = multer({
  storage,
  limits: { fileSize: 10*1024*1024, files: MULTIPAGINA_MAX_HARD },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (el PDF se convierte en el navegador)'));
  }
});

// Auth middleware — verifica JWT y token_version (revocación de sesiones)
async function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const user = jwt.verify(token, jwtSecretCached);

    // HAL-002: verificar token_version contra BD para detectar sesiones revocadas
    // Solo si el JWT tiene token_version (tokens nuevos emitidos tras el update)
    if (user.userId && user.token_version !== undefined) {
      try {
        const vCheck = await pool.query('SELECT token_version, is_admin, role FROM users WHERE id = $1', [user.userId]);
        if (vCheck.rows.length === 0) {
          return res.status(403).json({ error: 'Usuario no encontrado' });
        }
        if (vCheck.rows[0].token_version !== user.token_version) {
          return res.status(403).json({ error: 'Sesión expirada. Vuelve a iniciar sesión.' });
        }
        // Actualizar is_admin y role desde BD (fuente de verdad). Ignoramos lo que diga
        // el JWT porque el rol pudo cambiar tras emitir el token (ej: degradación tras
        // detectar abuso, promoción, etc). Defensa contra token-stale.
        user.is_admin = vCheck.rows[0].is_admin;
        user.role     = vCheck.rows[0].role || 'user';
      } catch (dbErr) {
        // SEC-004: fail-secure — si no se puede verificar token_version, rechazar la petición
        // (evita que tokens revocados queden activos durante una degradación de PostgreSQL)
        logger.error('token_version DB check failed (fail-secure) — rejecting request:', dbErr.message);
        return res.status(503).json({ error: 'Servicio temporalmente no disponible. Inténtalo en unos segundos.' });
      }
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Token inválido' });
  }
}

// @deprecated 2026-07-27 — código muerto desde el commit inicial del
// proyecto (nunca se llamó desde ningún sitio). Su umbral de nitidez (<2)
// rechazaría más de la mitad de las facturas reales que sí se leyeron bien
// (verificado contra 27 facturas reales, Fase 3 de la migración OCR v2).
// Sustituido por src/pipeline/preprocess.js:analizarCalidadImagen(), con
// umbrales recalibrados. No se borra (regla 6 del prompt de migración) —
// eliminar en una limpieza futura una vez la migración esté consolidada.
// Image quality analysis
async function analyzeImageQuality(filePath) {
  const stats = await sharp(filePath)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .stats();

  const channels = stats.channels;
  const channelCount = Math.min(channels.length, 3);

  // Blur detection (Laplacian-based sharpness from sharp stats)
  const sharpnessScore = stats.sharpness;
  const isBlurry = sharpnessScore < 2;

  // Brightness detection (perceived luminance)
  const brightness = channelCount >= 3
    ? 0.299 * channels[0].mean + 0.587 * channels[1].mean + 0.114 * channels[2].mean
    : channels[0].mean;
  const isTooDark = brightness < 30;
  const isTooBright = brightness > 225;

  // Blank/uniform image detection (entropy + standard deviation)
  const avgStdev = channels.slice(0, channelCount).reduce((sum, ch) => sum + ch.stdev, 0) / channelCount;
  const isBlank = stats.entropy < 1.0 && avgStdev < 5;

  // Build issues list with user-friendly messages
  const issues = [];
  if (isBlurry) issues.push('La imagen está borrosa o desenfocada');
  if (isTooDark) issues.push('La imagen está demasiado oscura');
  if (isTooBright) issues.push('La imagen está sobreexpuesta (demasiado clara)');
  if (isBlank) issues.push('La imagen parece estar en blanco o vacía');

  return {
    passed: issues.length === 0,
    issues,
    metrics: { sharpness: Math.round(sharpnessScore * 100) / 100, brightness: Math.round(brightness), entropy: Math.round(stats.entropy * 100) / 100, avgStdev: Math.round(avgStdev * 10) / 10 }
  };
}

// ── Security helpers ─────────────────────────────────────────────────────────

// Escapar HTML para prevenir XSS en emails
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Validate file magic bytes (prevents MIME spoofing)
async function validateFileMagicBytes(filePath, declaredMime) {
  const fd = await fs.open(filePath, 'r');
  const buf = Buffer.alloc(8);
  await fd.read(buf, 0, 8, 0);
  await fd.close();
  const hex = buf.toString('hex').toUpperCase();
  if (declaredMime === 'image/jpeg') return hex.startsWith('FFD8FF');
  if (declaredMime === 'image/png') return hex.startsWith('89504E47');
  if (declaredMime === 'application/pdf') return hex.startsWith('25504446');
  return false;
}

// Validate email format
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// SEC-019: ADMIN_EMAILS eliminado — la fuente de verdad es la columna is_admin en la tabla users.
// ADMIN_EMAILS_BOOTSTRAP se mantiene solo para el initDB (migración idempotente al arrancar).
// Admins: juliohesuni (Autoken), albertomurimarti (Autoken)
const ADMIN_EMAILS_BOOTSTRAP = ['juliohesuni@gmail.com', 'albertomurimarti@gmail.com'];

// Audit log — writes to audit_logs table for compliance
async function auditLog(action, details, userId, ip) {
  try {
    const cleanIp = ip ? String(ip).replace(/^::ffff:/, '') : null;
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [userId || null, action, JSON.stringify(details), cleanIp]
    );
  } catch (err) {
    logger.warn('Audit log write failed', { action, error: err.message });
  }
}

// Send quality notification email
async function sendQualityEmail(userEmail, filename, issues) {
  if (!emailTransporter || !smtpUserCached) return; // SEC-003: comprobar transporter+cached, no env var
  try {
    const safeFilename = escapeHtml(filename);
    const issueList = issues.map(i => `<li>${escapeHtml(i)}</li>`).join('');
    await emailTransporter.sendMail({
      from: `"SETEX Facturas" <${smtpUserCached}>`,
      to: userEmail,
      subject: 'Problema de calidad en tu factura - SETEX',
      html: `
        <h2>Problema de Calidad en tu Imagen</h2>
        <p>Hola,</p>
        <p>La imagen <strong>${safeFilename}</strong> que subiste tiene problemas de calidad:</p>
        <ul>${issueList}</ul>
        <p>Por favor, vuelve a tomar la foto asegurándote de:</p>
        <ul>
          <li>Buena iluminación (sin sombras excesivas)</li>
          <li>Mantener el móvil estable (sin movimiento)</li>
          <li>Enfocar correctamente el documento</li>
          <li>Que toda la factura sea visible</li>
        </ul>
        <p>Accede a <a href="https://setex-facturas.es">SETEX Facturas</a> para subir una nueva imagen.</p>
        <br>
        <p>Saludos,<br>Equipo SETEX</p>
      `,
      text: `Problema de calidad en tu imagen: ${filename}\n\nProblemas detectados:\n${issues.join('\n')}\n\nPor favor, vuelve a tomar la foto. Accede a https://setex-facturas.es\n\nEquipo SETEX`
    });
    logger.info(`Quality notification email sent to ${userEmail}`);
  } catch (err) {
    logger.error('Error sending quality notification email:', err);
  }
}

// Routes

// Endpoint interno para que nginx auth_request compruebe si el acceso está permitido.
// nginx lo llama como subrequest interno antes de servir cualquier recurso.
// El middleware de seguridad global también actúa sobre él: si hay horario bloqueado,
// el propio middleware devuelve 404, lo que hace que auth_request falle → 404 al cliente.
// Este handler actúa como respaldo explícito con la misma lógica.
app.get('/api/internal/check-access', (_req, res) => {
  const cfg = loadSecurityConfig();
  if (isRestrictedHour(cfg)) {
    return res.status(403).end(); // 403 = señal para nginx auth_request → nginx devuelve 404 al usuario
  }
  return res.status(200).end();
});

// Endpoint interno para que nginx auth_request proteja /admin-facturas.html.
// Valida: (1) horario no bloqueado, (2) cookie httpOnly 'setex_admin' presente y válida,
// (3) token_version vigente y is_admin=true en BD.
// Sin cookie admin o con cookie inválida → 403 → nginx redirige a /?next=admin.
app.get('/api/internal/check-admin-page', async (req, res) => {
  // 1. Verificar horario (misma lógica que check-access)
  const cfg = loadSecurityConfig();
  if (isRestrictedHour(cfg)) return res.status(403).end();

  // 2. Parsear cookie 'setex_admin' del header Cookie (sin cookie-parser para no añadir dep.)
  let adminToken = null;
  const rawCookies = req.headers.cookie || '';
  for (const part of rawCookies.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim();
    const v = part.slice(eqIdx + 1).trim();
    if (k === 'setex_admin') { adminToken = v; break; }
  }
  if (!adminToken) return res.status(403).end();

  // 3. Validar JWT de la cookie
  let payload;
  try {
    payload = jwt.verify(adminToken, jwtSecretCached);
  } catch {
    return res.status(403).end();
  }
  if (payload.type !== 'admin_page' || !payload.is_admin) return res.status(403).end();

  // 4. Verificar token_version y is_admin vigentes en BD (fail-secure)
  try {
    const result = await pool.query(
      'SELECT token_version, is_admin FROM users WHERE id = $1',
      [payload.userId]
    );
    if (!result.rows.length) return res.status(403).end();
    const u = result.rows[0];
    if (u.token_version !== payload.token_version || !u.is_admin) return res.status(403).end();
    return res.status(200).end();
  } catch (err) {
    logger.error('[check-admin-page] DB error:', err.message);
    return res.status(503).end(); // fail-secure: error de BD → denegar
  }
});

// Regenera la cookie httpOnly admin cuando el usuario ya tiene JWT válido en localStorage.
// Usado por app.js cuando detecta ?next=admin y el token es válido pero la cookie expiró.
app.post('/api/admin/refresh-session', authenticateToken, requireAdmin, (req, res) => {
  const adminCookiePayload = {
    userId: req.user.userId,
    is_admin: true,
    token_version: req.user.token_version,
    type: 'admin_page',
  };
  const adminCookieToken = jwt.sign(adminCookiePayload, jwtSecretCached, { expiresIn: '8h' });
  res.cookie('setex_admin', adminCookieToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
  logger.info(`[AdminSession] Cookie admin renovada para userId=${req.user.userId}`);
  res.json({ success: true, is_tech_admin: isTechAdmin(req.user.email) });
});

// POST /api/auth/refresh — rota el Refresh Token y emite nuevo Access Token.
// La cookie httpOnly 'setex_rt' se envía automáticamente por el navegador.
// Implementa detección de reuso: si el RT ya fue usado (revocado), se revoca
// toda la familia de tokens (señal de posible robo).
app.post('/api/auth/refresh', refreshLimiter, async (req, res) => {
  // Parsear cookie setex_rt del header Cookie
  const rawCookies = req.headers.cookie || '';
  let rawRt = null;
  for (const part of rawCookies.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    if (part.slice(0, eqIdx).trim() === 'setex_rt') { rawRt = part.slice(eqIdx + 1).trim(); break; }
  }
  if (!rawRt) return res.status(401).json({ error: 'No refresh token' });

  const hash = hashToken(rawRt);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Buscar RT en BD — lock para prevenir race conditions
    const rtRes = await client.query(
      `SELECT id, user_id, family_id, expires_at, revoked, replaced_by_hash
       FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!rtRes.rows.length) {
      await client.query('ROLLBACK');
      res.clearCookie('setex_rt', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
      return res.status(401).json({ error: 'Refresh token inválido' });
    }

    const rt = rtRes.rows[0];

    // Detectar reuso: RT ya revocado → posible robo → revocar familia entera
    if (rt.revoked) {
      await client.query('ROLLBACK');
      await revokeTokenFamily(rt.family_id); // fuera de transacción por claridad
      res.clearCookie('setex_rt', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
      res.clearCookie('setex_admin', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
      logger.warn(`[RT] Reuso detectado para userId=${rt.user_id}, familia=${rt.family_id}`);
      return res.status(401).json({ error: 'Sesión inválida. Por seguridad, inicia sesión de nuevo.' });
    }

    // Verificar expiración
    if (new Date(rt.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      res.clearCookie('setex_rt', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
      return res.status(401).json({ error: 'Sesión expirada' });
    }

    // Cargar datos del usuario (token_version, is_admin y role siempre de BD — fuente de verdad)
    const userRes = await client.query(
      'SELECT id, email, is_admin, role, token_version FROM users WHERE id = $1',
      [rt.user_id]
    );
    if (!userRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    const user = userRes.rows[0];

    // Determinar si es "remember me" según la duración restante del RT original
    const remainingMs = new Date(rt.expires_at) - new Date();
    const rememberMe = remainingMs > 24 * 60 * 60 * 1000; // >1 día → era remember_me

    // Revocar RT actual y emitir nuevo (rotación)
    const newRt = await createRefreshToken(user.id, rt.family_id, rememberMe);
    await client.query(
      `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), replaced_by_hash = $1
       WHERE id = $2`,
      [newRt.hash, rt.id]
    );

    await client.query('COMMIT');

    // Nuevo AT (15 min, en el body). Incluye role para que el frontend conozca privilegios.
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, is_admin: user.is_admin === true, role: user.role || 'user', token_version: user.token_version || 1 },
      jwtSecretCached,
      { expiresIn: '15m' }
    );

    // Nueva cookie RT
    setRtCookie(res, newRt.raw, newRt.expiresAt);

    // Renovar cookie admin si es admin (mantiene nginx gate activo)
    if (user.is_admin === true) {
      setAdminCookie(res, user, newRt.ttlDays);
    }

    logger.info(`[RT] Refresh exitoso para userId=${user.id}`);
    return res.json({ accessToken, expiresIn: 900 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('[RT] Error en refresh:', err.message);
    return res.status(500).json({ error: 'Error interno al renovar sesión' });
  } finally {
    client.release();
  }
});

// POST /api/auth/logout — revoca el RT en BD y borra ambas cookies.
app.post('/api/auth/logout', async (req, res) => {
  // Intentar revocar el RT si viene la cookie
  const rawCookies = req.headers.cookie || '';
  let rawRt = null;
  for (const part of rawCookies.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    if (part.slice(0, eqIdx).trim() === 'setex_rt') { rawRt = part.slice(eqIdx + 1).trim(); break; }
  }
  if (rawRt) {
    try {
      const hash = hashToken(rawRt);
      await pool.query(
        `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
         WHERE token_hash = $1 AND revoked = false`,
        [hash]
      );
    } catch (err) {
      logger.error('[Logout] Error revocando RT:', err.message);
      // No bloquear el logout aunque falle la revocación en BD
    }
  }
  // Borrar ambas cookies
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };
  res.clearCookie('setex_rt', cookieOpts);
  res.clearCookie('setex_admin', cookieOpts);
  res.json({ success: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, company_name, company_nif } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // Validar formato de email
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Formato de email no válido' });
    }

    // Validar contraseña (min 8 caracteres)
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'La contraseña es demasiado larga' });
    }

    // Límite máximo de usuarios (hard cap)
    const secCfg = loadSecurityConfig();
    const maxUsers = secCfg?.max_users || 350;
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCount.rows[0].count, 10) >= maxUsers) {
      logger.warn(`[Security] Registro bloqueado: límite de ${maxUsers} usuarios alcanzado (intento: ${email})`);
      return res.status(503).json({ error: 'El sistema ha alcanzado el límite de usuarios. Contacte al administrador.' });
    }

    // Verificar que se proporcionó el CIF de empresa
    if (!company_nif || String(company_nif).trim().length < 5) {
      return res.status(400).json({ error: 'El CIF de la empresa es obligatorio para el registro.' });
    }
    const cleanCompanyNif = String(company_nif).toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 20);

    // Verificar / auto-registrar la empresa con flujo de aprobación
    const clientCompanyResult = await pool.query(
      `SELECT id, nombre, activa, pendiente FROM client_companies
       WHERE UPPER(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')) = $1`,
      [cleanCompanyNif]
    );

    let companyIsPending = false;

    if (clientCompanyResult.rows.length === 0) {
      // Empresa nueva: buscar coincidencias antes de crear (para que el admin pueda hacer link)
      const autoNombre = company_name ? String(company_name).trim().substring(0, 255) : `Empresa ${cleanCompanyNif}`;
      const matchingSuggestions = await findMatchingCompanies(autoNombre, cleanCompanyNif);

      const newComp = await pool.query(
        `INSERT INTO client_companies
           (nombre, cif, pendiente, activa,
            registration_source, requested_by_email, requested_at,
            nombre_registrado, matching_suggestions)
         VALUES ($1, $2, true, false, 'self_register', $3, NOW(), $4, $5)
         RETURNING id`,
        [autoNombre, cleanCompanyNif, email, autoNombre, JSON.stringify(matchingSuggestions)]
      );
      const newCompId = newComp.rows[0].id;
      companyIsPending = true;
      logger.info(`[Register] Nueva empresa pendiente: CIF=${cleanCompanyNif} (${autoNombre}) por ${email}, ${matchingSuggestions.length} coincidencias`);
      auditLog('REGISTER_NEW_COMPANY_PENDING', { email, company_nif: cleanCompanyNif, company_name: autoNombre, suggestions: matchingSuggestions.length }, null, req.ip);
      await logCompanyAudit(newCompId, null, 'REGISTER_PENDING', `Empresa auto-registrada por ${email}`, { email, matching_suggestions: matchingSuggestions });
      // Notificar admins asíncronamente (no bloquea respuesta)
      sendAdminPendingEmail({ nombre: autoNombre, cif: cleanCompanyNif, requested_by_email: email, matching_suggestions: matchingSuggestions }).catch(() => {});
    } else {
      const company = clientCompanyResult.rows[0];
      // Empresa explícitamente desactivada (no pendiente) → bloquear registro
      if (!company.activa && !company.pendiente) {
        logger.warn(`[Register] Empresa desactivada: CIF=${cleanCompanyNif} email=${email}`);
        auditLog('REGISTER_BLOCKED', { email, company_nif: cleanCompanyNif, reason: 'company_deactivated' }, null, req.ip);
        return res.status(403).json({
          error: 'El acceso de tu empresa ha sido desactivado. Contacta al administrador de SETEX.'
        });
      }
      // Empresa pendiente de revisión → registrar usuario pero sin JWT
      if (company.pendiente || !company.activa) {
        companyIsPending = true;
      }
      // Actualizar requested_by_email si no está ya registrado (empresa ya pendiente de otro usuario)
      if (companyIsPending && !company.pendiente_email) {
        await pool.query(
          `UPDATE client_companies SET requested_by_email = COALESCE(requested_by_email, $1), requested_at = COALESCE(requested_at, NOW()) WHERE id = $2`,
          [email, company.id]
        );
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const cleanCompanyName = company_name ? String(company_name).trim().substring(0, 255) : null;
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, company_name, company_nif) VALUES ($1, $2, $3, $4) RETURNING id, email',
      [email, passwordHash, cleanCompanyName, cleanCompanyNif]
    );

    logger.info(`New user registered: ${email} (company_pending=${companyIsPending})`);

    if (companyIsPending) {
      // SEGURIDAD: No emitir JWT hasta que el admin apruebe la empresa
      // El usuario debe esperar — pantalla de "pendiente de aprobación"
      return res.status(202).json({
        pending: true,
        message: 'Tu empresa está pendiente de verificación por el equipo de SETEX. Recibirás acceso una vez que sea aprobada.',
        user: { email: result.rows[0].email }
      });
    }

    // Empresa activa y aprobada → emitir AT (15min) + RT cookie (mismo sistema que login)
    // Nota: role se lee de BD en authenticateToken; este payload solo lo informa cliente.
    const atPayload = {
      userId: result.rows[0].id,
      email,
      is_admin: false,
      role: 'user',
      token_version: 1,
    };
    const accessToken = jwt.sign(atPayload, jwtSecretCached, { expiresIn: '15m' });
    const regFamilyId = crypto.randomBytes(16).toString('hex');
    const regRt = await createRefreshToken(result.rows[0].id, regFamilyId, false);
    setRtCookie(res, regRt.raw, regRt.expiresAt);
    auditLog('REGISTER_SUCCESS', { email }, result.rows[0].id, req.ip);
    // Vigilancia humana: alertar a soporte técnico cuando alguien usa un CIF
    // del catálogo pre-aprobado para registrarse. El correo permite detectar
    // posibles suplantaciones (los CIFs son datos públicos).
    sendAdminAutoApprovedEmail({
      email,
      cif:    cleanCompanyNif,
      nombre: cleanCompanyName || `Empresa ${cleanCompanyNif}`,
      ip:     req.ip,
    }).catch(() => {});
    res.json({ accessToken, expiresIn: 900, user: { id: result.rows[0].id, email } });
  } catch (err) {
    logger.error('Register error:', err);
    if (err.code === '23505') {
      res.status(400).json({ error: 'Este email ya está registrado' });
    } else {
      res.status(400).json({ error: 'Error al registrar' });
    }
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || !isValidEmail(email)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      auditLog('LOGIN_FAILED', { email, reason: 'user_not_found' }, null, req.ip);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      auditLog('LOGIN_FAILED', { email, reason: 'bad_password' }, user.id, req.ip);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificar que la empresa del usuario sigue activa (skip para admins — fuente de verdad: is_admin en BD)
    if (user.company_nif && !user.is_admin) {
      const cleanNif = String(user.company_nif).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const compCheck = await pool.query(
        `SELECT id, activa, pendiente FROM client_companies WHERE UPPER(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')) = $1`,
        [cleanNif]
      );
      if (compCheck.rows.length === 0) {
        auditLog('LOGIN_BLOCKED', { email, reason: 'company_not_found', company_nif: user.company_nif }, user.id, req.ip);
        logger.warn(`[Login] Empresa no encontrada en BD: CIF=${user.company_nif} email=${email}`);
        // Mensaje diagnóstico — la causa más frecuente NO es desactivación, es un typo
        // del CIF en el registro. El antiguo "tu empresa ha sido desactivada" llevó a
        // varios falsos positivos (incidente 2026-04-20 info@murimarti.com).
        return res.status(403).json({
          error: `El CIF ${user.company_nif} asociado a tu cuenta no coincide con ninguna empresa registrada en SETEX. Revisa que tu CIF sea correcto en tu perfil, o contacta con el administrador.`
        });
      }
      const company = compCheck.rows[0];
      if (company.pendiente && !company.activa) {
        auditLog('LOGIN_BLOCKED', { email, reason: 'company_pending', company_nif: user.company_nif }, user.id, req.ip);
        logger.warn(`[Login] Empresa pendiente de aprobación: CIF=${user.company_nif} email=${email}`);
        return res.status(403).json({
          error: 'Tu empresa está pendiente de revisión por SETEX. Recibirás acceso una vez que sea aprobada por un administrador.'
        });
      }
      if (!company.activa) {
        auditLog('LOGIN_BLOCKED', { email, reason: 'company_deactivated', company_nif: user.company_nif }, user.id, req.ip);
        logger.warn(`[Login] Empresa desactivada: CIF=${user.company_nif} email=${email}`);
        return res.status(403).json({
          error: 'El acceso de tu empresa ha sido desactivado. Contacta al administrador de SETEX.'
        });
      }
    }

    const rememberMe = req.body.remember_me === true;

    // ── Access Token (AT): corta duración, en memoria JS del cliente ────────
    // 15 minutos. El cliente lo guarda en una variable JS (inmune a XSS).
    const atPayload = {
      userId: user.id,
      email: user.email,
      is_admin: user.is_admin === true,
      role: user.role || 'user',
      token_version: user.token_version || 1,
    };
    const accessToken = jwt.sign(atPayload, jwtSecretCached, { expiresIn: '15m' });

    // ── Refresh Token (RT): larga duración, cookie httpOnly ─────────────────
    // El JS nunca ve el RT. El servidor lo verifica y rota en cada uso.
    const familyId = crypto.randomBytes(16).toString('hex');
    const rt = await createRefreshToken(user.id, familyId, rememberMe);
    setRtCookie(res, rt.raw, rt.expiresAt);

    // ── Cookie admin para nginx (protección /admin-facturas.html) ───────────
    if (user.is_admin === true) {
      setAdminCookie(res, user, rt.ttlDays);
    }

    // ── Limpieza oportunista: eliminar RTs expirados de este usuario ─────────
    // Coste ~1ms, mantiene la tabla pequeña sin esperar al scheduler global.
    pool.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < NOW()`,
      [user.id]
    ).catch(() => {}); // fire-and-forget — no bloquea la respuesta

    auditLog('LOGIN_SUCCESS', { email, remember_me: rememberMe }, user.id, req.ip);

    // Responder con AT. El RT viaja en cookie, no en el body.
    const loginResponse = { accessToken, expiresIn: 900, user: { id: user.id, email: user.email } };
    if (user.is_admin === true) loginResponse.is_tech_admin = isTechAdmin(user.email);
    res.json(loginResponse);
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// GET /api/company/status — estado de la empresa del usuario (sin requireActiveCompany — útil para pendientes)
app.get('/api/company/status', authenticateToken, async (req, res) => {
  try {
    if (req.user?.is_admin === true) return res.json({ status: 'active', is_admin: true });
    const userRow = await pool.query('SELECT company_nif, company_name FROM users WHERE id = $1', [req.user.userId]);
    const nif = userRow.rows[0]?.company_nif;
    if (!nif) return res.json({ status: 'no_company' });
    const cleanNif = nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const compRow = await pool.query(
      `SELECT id, nombre, activa, pendiente FROM client_companies WHERE UPPER(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')) = $1 LIMIT 1`,
      [cleanNif]
    );
    if (!compRow.rows.length) return res.json({ status: 'not_found', company_nif: cleanNif });
    const { activa, pendiente, nombre } = compRow.rows[0];
    if (pendiente || !activa) return res.json({ status: 'pending', company_name: nombre, company_nif: cleanNif });
    return res.json({ status: 'active', company_name: nombre, company_nif: cleanNif });
  } catch (err) {
    logger.error('[company/status] DB error:', err.message);
    res.status(503).json({ error: 'Error al consultar estado de empresa' });
  }
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email requerido' });
    }

    // Verificar si el usuario existe
    const userResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);

    // Siempre retornar éxito (seguridad: no revelar si el email existe)
    if (userResult.rows.length === 0) {
      logger.info(`Password reset requested for non-existent email: ${email}`);
      return res.json({ message: 'Si el email existe, recibirás instrucciones de recuperación' });
    }

    const user = userResult.rows[0];

    // Generar token aleatorio seguro (32 bytes = 64 caracteres hex)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Guardar token en BD
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );

    // Construir URL de reset
    const resetUrl = `https://setex-facturas.es/reset-password?token=${resetToken}`;

    // Enviar email si está configurado (SEC-003: comprobar smtpUserCached, no process.env.SMTP_USER)
    if (emailTransporter && smtpUserCached) {
      try {
        await emailTransporter.sendMail({
          from: `"SETEX Facturas" <${smtpUserCached}>`,
          to: user.email,
          subject: 'Recuperación de Contraseña - SETEX',
          html: `
            <h2>Recuperación de Contraseña</h2>
            <p>Hola,</p>
            <p>Recibimos una solicitud para restablecer tu contraseña en SETEX Facturas.</p>
            <p>Haz clic en el siguiente enlace para crear una nueva contraseña:</p>
            <p><a href="${resetUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Restablecer Contraseña</a></p>
            <p>O copia y pega este enlace en tu navegador:</p>
            <p>${resetUrl}</p>
            <p><strong>Este enlace expirará en 1 hora.</strong></p>
            <p>Si no solicitaste este cambio, puedes ignorar este email.</p>
            <br>
            <p>Saludos,<br>Equipo SETEX</p>
          `,
          text: `
Recuperación de Contraseña

Hola,

Recibimos una solicitud para restablecer tu contraseña en SETEX Facturas.

Haz clic en el siguiente enlace para crear una nueva contraseña:
${resetUrl}

Este enlace expirará en 1 hora.

Si no solicitaste este cambio, puedes ignorar este email.

Saludos,
Equipo SETEX
          `
        });
        logger.info(`Password reset email sent to ${user.email}`);
      } catch (emailErr) {
        logger.error('Error sending password reset email:', emailErr);
        return res.status(500).json({ error: 'Error al enviar el email de recuperación' });
      }
    } else {
      // SEGURIDAD: nunca loguear el token en claro — solo el hash truncado para trazabilidad
      logger.warn(`Password reset requested but email not configured. Token hash: ${tokenHash.substring(0, 16)}... (configure SMTP to enable email delivery)`);
    }

    res.json({ message: 'Si el email existe, recibirás instrucciones de recuperación' });
  } catch (err) {
    logger.error('Forgot password error:', err);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    if (newPassword.length > 128) {
      return res.status(400).json({ error: 'La contraseña es demasiado larga' });
    }

    // Hash del token recibido para comparar con BD
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Buscar token válido
    const tokenResult = await pool.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.used, u.email
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token_hash = $1 AND prt.used = false AND prt.expires_at > NOW()`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Token inválido o expirado' });
    }

    const resetRecord = tokenResult.rows[0];

    // Hash de la nueva contraseña
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Actualizar contraseña del usuario e incrementar token_version (HAL-002: revoca todas las sesiones activas)
    await pool.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [newPasswordHash, resetRecord.user_id]
    );

    // Invalidar TODOS los tokens del usuario (no solo este)
    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE user_id = $1',
      [resetRecord.user_id]
    );

    // Limpiar tokens expirados (cleanup)
    await pool.query('DELETE FROM password_reset_tokens WHERE expires_at < NOW()');

    auditLog('PASSWORD_RESET', { email: resetRecord.email }, resetRecord.user_id, req.ip);
    logger.info(`Password reset successful for user ${resetRecord.email}`);

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (err) {
    logger.error('Reset password error:', err);
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
});

// ── Helpers de matching empresa registrada ↔ entidades de factura ────────────

// Normaliza nombre de empresa para comparación: quita tildes, mayúsculas, puntación
// y formas jurídicas comunes (S.L., S.A., SLU…) para matching fuzzy.
function normalizeCompanyName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/\bS\.?L\.?U?\.?\b|\bS\.?A\.?U?\.?\b|\bS\.?R\.?L\.?\b|\bS\.?C\.?P\.?\b|\bS\.?C\.?\b/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Determina qué entidades de la factura corresponden a "nuestra empresa" y cuál es la
// contraparte, usando tres niveles de prioridad: CIF exacto → nombre normalizado → invoice_type.
// Devuelve campos display_* listos para el frontend + matched_side + match_confidence.
function computeDisplayCompanies(row) {
  const regNif  = (row.empresa_nif  || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const provNif = (row.proveedor_nif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const recNif  = (row.receptor_nif  || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let matched_side   = 'none';
  let match_confidence = 'low';

  // Prioridad 1: coincidencia exacta de CIF
  if (regNif) {
    if (provNif && regNif === provNif) {
      matched_side = 'issuer'; match_confidence = 'high';
    } else if (recNif && regNif === recNif) {
      matched_side = 'receiver'; match_confidence = 'high';
    }
  }

  // Prioridad 2: nombre normalizado
  if (matched_side === 'none' && row.empresa_nombre) {
    const regName  = normalizeCompanyName(row.empresa_nombre);
    const provName = normalizeCompanyName(row.proveedor_nombre || '');
    const recName  = normalizeCompanyName(row.receptor_nombre  || '');
    if (regName && provName && regName === provName) {
      matched_side = 'issuer'; match_confidence = 'medium';
    } else if (regName && recName && regName === recName) {
      matched_side = 'receiver'; match_confidence = 'medium';
    }
  }

  // Prioridad 3: invoice_type como señal de contexto
  if (matched_side === 'none' && row.invoice_type) {
    // venta → nosotros somos el proveedor/emisor
    // compra → nosotros somos el receptor
    matched_side = row.invoice_type === 'venta' ? 'issuer' : 'receiver';
    match_confidence = 'low';
  }

  // Construir campos display según el lado detectado
  if (matched_side === 'issuer') {
    return {
      display_empresa:         row.proveedor_nombre,
      display_empresa_nif:     row.proveedor_nif,
      display_contraparte:     row.receptor_nombre,
      display_contraparte_nif: row.receptor_nif,
      matched_side, match_confidence,
    };
  } else if (matched_side === 'receiver') {
    return {
      display_empresa:         row.receptor_nombre,
      display_empresa_nif:     row.receptor_nif,
      display_contraparte:     row.proveedor_nombre,
      display_contraparte_nif: row.proveedor_nif,
      matched_side, match_confidence,
    };
  }
  // Fallback total: proveedor como empresa, receptor como contraparte
  return {
    display_empresa:         row.proveedor_nombre,
    display_empresa_nif:     row.proveedor_nif,
    display_contraparte:     row.receptor_nombre,
    display_contraparte_nif: row.receptor_nif,
    matched_side: 'none', match_confidence: 'low',
  };
}

// Normaliza nombre de proveedor para búsqueda en known_cifs (sin tildes, solo alfanum)
function normalizeProveedorNombre(nombre) {
  if (!nombre || typeof nombre !== 'string') return '';
  return nombre
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 100);
}

// ── Company Relationships — helpers ──────────────────────────────────────────
// Determina la contraparte en una factura según tipo y NIF de empresa del usuario.
// compra → proveedor es la contraparte; venta → receptor es la contraparte.
function getCounterpartyInfo(userCompanyNif, campos, invoiceType) {
  if (invoiceType === 'venta') {
    return { nif: campos.receptor_nif || null, nombre: campos.receptor_nombre || null, type: 'cliente' };
  }
  return { nif: campos.proveedor_nif || null, nombre: campos.proveedor_nombre || null, type: 'proveedor' };
}

// Busca contraparte conocida con 3 niveles de fuzzy matching:
//   1. CIF exacto              → confidence: high
//   2. Trigrama nombre ≥ 0.65  → confidence: high  (autocorregir)
//      Trigrama nombre 0.45–0.65 → confidence: medium (sugerir)
//   3. Levenshtein CIF ≤ 1     → confidence: high
//      Levenshtein CIF = 2     → confidence: medium
async function lookupCounterparty(clientCif, ocrNif, ocrNombre) {
  if (!clientCif) return null;
  const cleanNif   = ocrNif    ? ocrNif.toUpperCase().replace(/[^A-Z0-9]/g, '')    : null;
  const normNombre = normalizeProveedorNombre(ocrNombre);

  // Nivel 1: CIF exacto
  if (cleanNif) {
    const r1 = await pool.query(
      `SELECT counterparty_nif, counterparty_nombre, confirmations
       FROM company_relationships
       WHERE client_cif = $1 AND counterparty_nif = $2
       LIMIT 1`,
      [clientCif, cleanNif]
    );
    if (r1.rows.length) {
      return { counterparty_nif: r1.rows[0].counterparty_nif, counterparty_nombre: r1.rows[0].counterparty_nombre,
               confidence: 'high', method: 'cif_exacto', confirmations: r1.rows[0].confirmations };
    }
  }

  // Nivel 2: Trigrama nombre
  if (normNombre.length >= 4) {
    const r2 = await pool.query(
      `SELECT counterparty_nif, counterparty_nombre,
              similarity(counterparty_nombre_norm, $2) AS sim,
              confirmations
       FROM company_relationships
       WHERE client_cif = $1 AND counterparty_nombre_norm != ''
       ORDER BY sim DESC
       LIMIT 1`,
      [clientCif, normNombre]
    );
    if (r2.rows.length && r2.rows[0].sim >= 0.45) {
      const sim = r2.rows[0].sim;
      return { counterparty_nif: r2.rows[0].counterparty_nif, counterparty_nombre: r2.rows[0].counterparty_nombre,
               confidence: sim >= 0.65 ? 'high' : 'medium',
               method: `trigrama_${sim.toFixed(2)}`, confirmations: r2.rows[0].confirmations };
    }
  }

  // Nivel 3: Levenshtein CIF (typos de 1-2 caracteres)
  if (cleanNif && cleanNif.length >= 7) {
    const r3 = await pool.query(
      `SELECT counterparty_nif, counterparty_nombre,
              levenshtein($2, counterparty_nif) AS lev,
              confirmations
       FROM company_relationships
       WHERE client_cif = $1 AND counterparty_nif IS NOT NULL
         AND length(counterparty_nif) BETWEEN $3 AND $4
       ORDER BY lev ASC
       LIMIT 1`,
      [clientCif, cleanNif, cleanNif.length - 1, cleanNif.length + 1]
    );
    if (r3.rows.length && r3.rows[0].lev <= 2) {
      return { counterparty_nif: r3.rows[0].counterparty_nif, counterparty_nombre: r3.rows[0].counterparty_nombre,
               confidence: r3.rows[0].lev <= 1 ? 'high' : 'medium',
               method: `levenshtein_cif_${r3.rows[0].lev}`, confirmations: r3.rows[0].confirmations };
    }
  }

  return null;
}

// Guarda o actualiza una relación empresa↔contraparte.
// Solo persiste si tenemos NIF de la contraparte (columna indexada).
async function saveCompanyRelationship(clientCif, counterpartyNif, counterpartyNombre, relationshipType) {
  if (!clientCif || !counterpartyNif) return;
  const normNombre = normalizeProveedorNombre(counterpartyNombre);
  try {
    await pool.query(`
      INSERT INTO company_relationships
        (client_cif, counterparty_nif, counterparty_nombre, counterparty_nombre_norm, relationship_type, confirmations, last_seen)
      VALUES ($1, $2, $3, $4, $5, 1, NOW())
      ON CONFLICT (client_cif, counterparty_nif) WHERE counterparty_nif IS NOT NULL
      DO UPDATE SET
        counterparty_nombre      = EXCLUDED.counterparty_nombre,
        counterparty_nombre_norm = EXCLUDED.counterparty_nombre_norm,
        confirmations = company_relationships.confirmations + 1,
        last_seen     = NOW()
    `, [clientCif, counterpartyNif, counterpartyNombre || null, normNombre, relationshipType || 'proveedor']);
    logger.info(`[Relationship] ${clientCif} ↔ ${counterpartyNif} (${counterpartyNombre}) type=${relationshipType} confirmations++`);
  } catch (relErr) {
    logger.warn(`[Relationship] no se pudo guardar ${clientCif}↔${counterpartyNif}: ${relErr.message}`);
  }
}

app.post('/api/upload-preview', authenticateToken, requireActiveCompany, uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const filePath = req.file.path;
    const fileInfo = { filename: req.file.filename, mimetype: req.file.mimetype, size: req.file.size };
    const userInfo = { userId: req.user.userId, email: req.user.email };

    // Leer preferencias del usuario (auto-confirm + NIF empresa para detectar compra/venta)
    const userSettingsRes = await pool.query('SELECT auto_confirm_enabled, company_nif, company_name, is_admin FROM users WHERE id = $1', [req.user.userId]);
    const userAutoConfirmPref = userSettingsRes.rows[0]?.auto_confirm_enabled !== false;
    const userIsAdmin = userSettingsRes.rows[0]?.is_admin === true;
    let userCompanyNif = userSettingsRes.rows[0]?.company_nif
      ? userSettingsRes.rows[0].company_nif.toUpperCase().replace(/[^A-Z0-9]/g, '')
      : null;
    let userCompanyName = userSettingsRes.rows[0]?.company_name || null;

    // invoice_type enviado por el usuario desde el selector de tipo (compra/venta)
    // multer pone los campos no-file de multipart/form-data en req.body
    const invoiceTypeFromUser = (req.body.invoice_type === 'venta') ? 'venta' : 'compra';

    // ADMIN: si se seleccionó empresa cliente, usar sus datos como contexto OCR (receptor)
    // Esto permite a admins de Autoken/Setex subir facturas en nombre de cualquier cliente.
    let clientCompanyId = null;
    let clientCompanyData = null;
    const rawClientCompanyId = req.body.client_company_id ? parseInt(req.body.client_company_id, 10) : null;
    if (userIsAdmin && rawClientCompanyId && !isNaN(rawClientCompanyId)) {
      try {
        const ccRes = await pool.query('SELECT id, nombre, cif FROM client_companies WHERE id = $1 AND activa = true', [rawClientCompanyId]);
        if (ccRes.rows.length > 0) {
          clientCompanyData = ccRes.rows[0];
          clientCompanyId = clientCompanyData.id;
          // Para OCR: el receptor es la empresa cliente → contexto más preciso
          userCompanyNif  = clientCompanyData.cif ? clientCompanyData.cif.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
          userCompanyName = clientCompanyData.nombre;
          logger.info(`[Admin Upload] user=${req.user.email} → empresa cliente: ${clientCompanyData.nombre} (${clientCompanyData.cif})`);
        } else {
          logger.warn(`[Admin Upload] client_company_id=${rawClientCompanyId} no encontrada o inactiva`);
        }
      } catch (ccErr) {
        logger.warn(`[Admin Upload] Error cargando empresa cliente: ${ccErr.message}`);
      }
    }

    // Contexto para OCR: tipo de factura + NIF empresa para desambiguación precisa
    const ocrContext = {
      invoice_type:   invoiceTypeFromUser,
      empresa_nif:    userCompanyNif,
      empresa_nombre: userCompanyName
    };

    // ── FASE 0: Validar magic bytes (anti-spoofing de MIME) ─────────────
    try {
      const validMagic = await validateFileMagicBytes(filePath, req.file.mimetype);
      if (!validMagic) {
        logger.warn(`File magic bytes mismatch: ${fileInfo.filename} (declared: ${req.file.mimetype})`);
        auditLog('UPLOAD_BLOCKED', { filename: fileInfo.filename, reason: 'magic_bytes_mismatch', mime: req.file.mimetype }, userInfo.userId, req.ip);
        fs.unlink(filePath).catch(() => {});
        return res.status(400).json({ error: 'El archivo no corresponde al tipo declarado. Sube una imagen JPEG, PNG o PDF válido.' });
      }
    } catch (magicErr) {
      // SEC-005: fail-secure — si no se puede verificar magic bytes, rechazar el archivo
      logger.warn('Magic bytes validation error — rejecting file as precaution', { error: magicErr.message });
      fs.unlink(filePath).catch(() => {});
      return res.status(400).json({ error: 'No se pudo verificar el tipo de archivo. Inténtalo de nuevo.' });
    }

    // ── Quality gate v2 (Fase 3, 2026-07-27) — SOLO SOMBRA, no bloquea ──────
    // Fire-and-forget: nunca añade latencia ni puede afectar la respuesta
    // real. Mientras ocr_extraccion_v2_quality_gate_blocking sea false (hoy),
    // solo calcula y loguea nitidez/brillo/blanco con los umbrales
    // recalibrados (pipeline/preprocess.js) — no rechaza ninguna factura.
    try {
      const qgCfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
      if (qgCfg.ocr_extraccion_v2_enabled && fileInfo.mimetype.startsWith('image/')) {
        analizarCalidadImagen(filePath)
          .then((calidad) => {
            logger.info('[QualityGate-v2]', {
              document: fileInfo.filename,
              passed: calidad.passed,
              issues: calidad.issues,
              metrics: calidad.metrics,
              blocking_activo: qgCfg.ocr_extraccion_v2_quality_gate_blocking === true,
            });
            // NUNCA bloquea todavía, aunque !calidad.passed — el flag
            // ocr_extraccion_v2_quality_gate_blocking queda listo para
            // cuando Julio decida activarlo con datos reales de este log.
          })
          .catch((qgAnalyzeErr) => logger.warn('[QualityGate-v2] Error analizando calidad', { error: qgAnalyzeErr.message, document: fileInfo.filename }));
      }
    } catch (qgErr) {
      logger.warn('[QualityGate-v2] Error leyendo configuración', { error: qgErr.message });
    }

    // ── FASE 1: OCR dual (OpenAI + Azure en paralelo) + enfocado CIF ───────────
    // extractInvoiceOCR ya lanza AMBOS motores internamente en modo dual.
    // extractCIFOnlyOCR es el árbitro cuando los dos motores discrepan en el NIF.
    let ocrData = null;
    let cifFocused = null;
    try {
      [ocrData, cifFocused] = await Promise.all([
        extractInvoiceOCR(filePath, fileInfo.mimetype, fileInfo.filename, logger, ocrContext),
        extractCIFOnlyOCR(filePath, fileInfo.mimetype)
      ]);
    } catch (ocrErr) {
      logger.error('OCR falló completamente', { error: ocrErr.message, file: fileInfo.filename });
      fs.unlink(filePath).catch(() => {});
      return res.json({
        success: false,
        error: 'No se pudo procesar la imagen. Inténtalo de nuevo en unos segundos.'
      });
    }

    // Verificar si la factura es legible
    if (!ocrData || ocrData.es_factura_valida === false) {
      logger.warn(`Factura no legible o sin datos OCR: ${fileInfo.filename}`);
      fs.unlink(filePath).catch(() => {});
      return res.json({
        success: false,
        error: 'La foto no es legible o no es una factura. Por favor, repite la foto con buena iluminación y enfoque.'
      });
    }

    // ── FASE 2: Validación (ANTES de guardar en BD) ─────────────────────
    const campos = ocrData.campos || {};

    // ── Foto inmutable de lo que dijo LA IA, antes de tocarla ────────────────
    // `campos` es un ALIAS POR REFERENCIA de ocrData.campos: todo lo que este
    // endpoint escriba a continuacion (known_cifs, company_catalog,
    // company_relationships, users) machaca el resultado de la IA en el sitio,
    // sin dejar rastro. Por eso el panel admin mostraba como "IA (OCR raw)"
    // valores que ninguna IA habia leido nunca (ej. factura #31: la IA leyo
    // "Roberto Ramirez Sanchez, S.L." y el panel mostraba "ALEX DISTRIBUCIONES",
    // que venia de known_cifs). Clonamos aqui para poder mostrar las tres
    // columnas honestas: lo que leyo la IA -> lo que decidio el sistema -> lo
    // que confirmo el humano.
    const ocrIaPura = JSON.parse(JSON.stringify(campos));
    const overridesBD = [];
    const registrarOverride = (campo, valorAplicado, fuente) => {
      const valorIa = ocrIaPura[campo] ?? null;
      if (String(valorIa ?? '') === String(valorAplicado ?? '')) return; // no cambio nada
      overridesBD.push({ campo, valor_ia: valorIa ?? null, valor_aplicado: valorAplicado ?? null, fuente });
    };

    // Reconciliar CIF: doble lectura + dígito de control como árbitro
    let nifUncertain = false;
    if (cifFocused) {
      const clean1 = campos.proveedor_nif
        ? campos.proveedor_nif.toUpperCase().replace(/[\s\-\.]/g, '') : null;
      const clean2 = cifFocused.toUpperCase().replace(/[\s\-\.]/g, '');

      if (!clean1) {
        campos.proveedor_nif = clean2;
        logger.info(`[CIF] Solo lectura enfocada encontró CIF: ${clean2}`);
      } else if (clean1 === clean2) {
        campos.proveedor_nif = clean1;
        logger.info(`[CIF] Doble lectura coincide: ${clean1} ✓✓`);
      } else {
        // Discrepancia → usar dígito de control como árbitro
        const c1ok = checkDigitCIF(clean1);
        const c2ok = checkDigitCIF(clean2);
        if (c1ok === true && c2ok !== true) {
          campos.proveedor_nif = clean1;
          logger.info(`[CIF] Dígito control elige lectura completa: ${clean1} ✓ vs ${clean2} ✗`);
        } else if (c2ok === true && c1ok !== true) {
          campos.proveedor_nif = clean2;
          logger.info(`[CIF] Dígito control elige lectura enfocada: ${clean2} ✓ vs ${clean1} ✗`);
        } else {
          // Sin ganador claro → preferir lectura enfocada + marcar como incierto
          campos.proveedor_nif = clean2;
          nifUncertain = true;
          logger.warn(`[CIF] Lecturas distintas, dígito control no resuelve: "${clean1}" vs "${clean2}" → incierto "${clean2}"`);
        }
      }
    } else if (campos.proveedor_nif) {
      // Solo lectura completa (enfocada falló) → verificar dígito de control
      const clean1 = campos.proveedor_nif.toUpperCase().replace(/[\s\-\.]/g, '');
      if (checkDigitCIF(clean1) === false) {
        nifUncertain = true;
        logger.warn(`[CIF] Lectura única no pasa dígito control: "${clean1}" → incierto`);
      }
    }

    // Validar CIF/NIF contra lista negra de alucinaciones
    if (campos.proveedor_nif && campos.proveedor_nif.trim() !== '') {
      const cifCheck = validateSpanishTaxId(campos.proveedor_nif.trim());
      if (!cifCheck.valid) {
        logger.warn(`CIF/NIF proveedor RECHAZADO: "${campos.proveedor_nif}" → ${cifCheck.reason} [${cifCheck.severity}]`, {
          file: fileInfo.filename
        });
        campos.proveedor_nif = null;
      }
    }
    if (campos.receptor_nif && campos.receptor_nif.trim() !== '') {
      const cifCheck = validateSpanishTaxId(campos.receptor_nif.trim());
      if (!cifCheck.valid) {
        logger.warn(`CIF/NIF receptor RECHAZADO: "${campos.receptor_nif}" → ${cifCheck.reason} [${cifCheck.severity}]`, {
          file: fileInfo.filename
        });
        campos.receptor_nif = null;
      }
    }

    // ── SWAP automático proveedor/receptor si el OCR confundió emisor y receptor ──
    // Condición: el NIF del usuario aparece en el campo incorrecto según el tipo de factura.
    // Solo swap si tenemos ambos NIFs (no hacer swap ciego con datos incompletos).
    if (userCompanyNif && campos.proveedor_nif && campos.receptor_nif) {
      const pNif = campos.proveedor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const rNif = campos.receptor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (invoiceTypeFromUser === 'compra' && pNif === userCompanyNif && rNif !== userCompanyNif) {
        // Factura recibida: nuestro NIF debe ir en receptor, no en proveedor → SWAP
        [campos.proveedor_nif, campos.receptor_nif]       = [campos.receptor_nif, campos.proveedor_nif];
        [campos.proveedor_nombre, campos.receptor_nombre] = [campos.receptor_nombre, campos.proveedor_nombre];
        logger.info(`[Swap] Factura recibida: nuestro NIF ${userCompanyNif} estaba en proveedor → swap con receptor`);
      } else if (invoiceTypeFromUser === 'venta' && rNif === userCompanyNif && pNif !== userCompanyNif) {
        // Factura emitida: nuestro NIF debe ir en proveedor, no en receptor → SWAP
        [campos.proveedor_nif, campos.receptor_nif]       = [campos.receptor_nif, campos.proveedor_nif];
        [campos.proveedor_nombre, campos.receptor_nombre] = [campos.receptor_nombre, campos.proveedor_nombre];
        logger.info(`[Swap] Factura emitida: nuestro NIF ${userCompanyNif} estaba en receptor → swap con proveedor`);
      }
    } else if (userCompanyNif && campos.proveedor_nif && !campos.receptor_nif) {
      // Solo tenemos un NIF — si coincide con el nuestro en factura recibida → nullear proveedor_nif
      // (el OCR solo detectó nuestro NIF, no el del proveedor real)
      const pNif = campos.proveedor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (invoiceTypeFromUser === 'compra' && pNif === userCompanyNif) {
        logger.warn(`[Swap] Factura recibida: único NIF detectado es el nuestro (${userCompanyNif}) → limpiando proveedor_nif`);
        campos.proveedor_nif = null;
      }
    }

    // ── Validación coincidencia CIF emisor/receptor con usuario logueado ─────
    // Bloqueante en frontend (modal) y en /api/upload-confirm (defensa profunda).
    // Excepción admin con empresa cliente seleccionada: userCompanyNif/Name ya
    // han sido reasignados arriba (líneas 1542-1543) → la validación se hace
    // contra la empresa cliente, no contra el admin.
    const cifValidation = validateInvoiceCifs({
      invoiceType:     invoiceTypeFromUser,
      emisorNif:       campos.proveedor_nif,
      emisorNombre:    campos.proveedor_nombre,
      receptorNif:     campos.receptor_nif,
      receptorNombre:  campos.receptor_nombre,
      userNif:         userCompanyNif,
      userNombre:      userCompanyName,
    });
    if (cifValidation.blocking) {
      logger.warn(`[CIF-Match] Bloqueante en ${fileInfo.filename}: ${cifValidation.errors.map(e => e.code).join(',')}`);
    }

    // ── Validación matemática del IVA ──────────────────────────────────────────
    const ivaValidation = validateIVACoherencia(campos);
    if (!ivaValidation.valid) {
      logger.warn(`[IVA] Inconsistencia detectada en ${fileInfo.filename}: ${ivaValidation.errors.join(' | ')}`);
    }
    if (ivaValidation.warnings.length > 0) {
      logger.info(`[IVA] Avisos en ${fileInfo.filename}: ${ivaValidation.warnings.join(' | ')}`);
    }

    // Comprobar campos obligatorios faltantes.
    // Si faltan, NO se borra el archivo ni se devuelve error — se envía al modal
    // para que el usuario los corrija o repita la foto. Solo se rechazan imágenes
    // que no son facturas en absoluto (es_factura_valida === false, ya gestionado arriba).
    const missingFields = [];
    if (!campos.proveedor_nif || campos.proveedor_nif === null) missingFields.push('proveedor_nif');
    if (!campos.fecha_emision || campos.fecha_emision === null || (typeof campos.fecha_emision === 'string' && campos.fecha_emision.trim() === '')) missingFields.push('fecha_emision');
    if (!campos.total || campos.total === null || (typeof campos.total === 'string' && (campos.total.trim() === '' || campos.total === '0' || campos.total === '0,00'))) missingFields.push('total');

    if (missingFields.length > 0) {
      logger.warn(`Campos faltantes en ${fileInfo.filename}: ${missingFields.join(', ')} → enviando a revisión manual`);
    }

    // ── FASE 3: Resolución de CIF (company_catalog → known_cifs → nuevo) ─────────
    const cleanNif = campos.proveedor_nif ? campos.proveedor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
    // knownProvider  = hubo match, se aplica el valor conocido al preview.
    // knownProviderFiable = ademas tiene respaldo suficiente para SALTARSE la
    //   revision humana. Se separan por seguridad: antes bastaba UNA sola
    //   confirmacion humana (posiblemente erronea) para que el NIF cacheado
    //   sobrescribiera la lectura de la IA Y ademas empujara la factura a
    //   auto-confirmacion, convirtiendo el error en verdad permanente sin que
    //   nadie volviera a mirarlo. Ahora un solo respaldo sugiere, pero no
    //   silencia la revision.
    let knownProvider = false;
    let knownProviderFiable = false;

    if (campos.proveedor_nombre) {
      const nombreNorm = normalizeProveedorNombre(campos.proveedor_nombre);
      if (nombreNorm.length >= 4) {

        // 1º) Catálogo admin (pre-registrado, máxima confianza)
        // Usa pg_trgm: similarity > 0.50 significa nombre suficientemente parecido
        const catalogRes = await pool.query(
          `SELECT proveedor_nif, proveedor_nombre
           FROM company_catalog
           WHERE similarity(proveedor_nombre_norm, $1) > 0.50
           ORDER BY similarity(proveedor_nombre_norm, $1) DESC
           LIMIT 1`,
          [nombreNorm]
        );
        if (catalogRes.rows.length > 0) {
          const catalogNif = catalogRes.rows[0].proveedor_nif;
          logger.info(`[CIF] Catálogo admin: "${campos.proveedor_nombre}" → ${catalogNif} (OCR dijo ${cleanNif || 'null'})`);
          registrarOverride('proveedor_nif', catalogNif, 'company_catalog');
          campos.proveedor_nif = catalogNif;
          knownProvider = true;
          knownProviderFiable = true; // catalogo curado por un admin: maxima confianza
        }

        // 2º) known_cifs del usuario (confirmaciones previas)
        if (!knownProvider) {
          const knownRes = await pool.query(
            'SELECT proveedor_nif, confirmations FROM known_cifs WHERE user_id = $1 AND proveedor_nombre_norm = $2 ORDER BY confirmations DESC LIMIT 1',
            [userInfo.userId, nombreNorm]
          );
          if (knownRes.rows.length > 0) {
            const cachedNif = knownRes.rows[0].proveedor_nif;
            const confirmaciones = knownRes.rows[0].confirmations || 0;
            if (cachedNif !== cleanNif) {
              logger.info(`[CIF] known_cifs: "${campos.proveedor_nombre}" → ${cachedNif} (OCR dijo ${cleanNif}, ${confirmaciones} confirmacion(es))`);
              registrarOverride('proveedor_nif', cachedNif, `known_cifs(${confirmaciones} confirmaciones)`);
              campos.proveedor_nif = cachedNif;
            }
            knownProvider = true;
            // Con una sola confirmacion humana detras NO se silencia la revision.
            knownProviderFiable = confirmaciones >= 2;
            if (!knownProviderFiable) {
              logger.info(`[CIF] known_cifs con solo ${confirmaciones} confirmacion(es) — se aplica pero NO se salta la revision`);
            }
          }
        }
      }
    }
    // 3º) Lookup por NIF: el OCR puede haber leído bien el NIF pero mal el nombre.
    //     Prioridad: nombre confirmado en known_cifs → company_catalog admin.
    if (!knownProvider && cleanNif) {
      const nifRes = await pool.query(
        `SELECT COALESCE(kc.proveedor_nombre, cc.proveedor_nombre) AS proveedor_nombre, kc.confirmations
         FROM known_cifs kc
         LEFT JOIN company_catalog cc ON cc.proveedor_nif = kc.proveedor_nif
         WHERE kc.user_id = $1 AND kc.proveedor_nif = $2
         ORDER BY kc.confirmations DESC, kc.last_seen DESC LIMIT 1`,
        [userInfo.userId, cleanNif]
      );
      if (nifRes.rows.length > 0 && nifRes.rows[0].proveedor_nombre) {
        const confirmaciones = nifRes.rows[0].confirmations || 0;
        registrarOverride('proveedor_nombre', nifRes.rows[0].proveedor_nombre, `known_cifs por NIF (${confirmaciones} confirmaciones)`);
        campos.proveedor_nombre = nifRes.rows[0].proveedor_nombre;
        knownProvider = true;
        knownProviderFiable = confirmaciones >= 2;
        logger.info(`[CIF] Proveedor por NIF: ${cleanNif} → "${campos.proveedor_nombre}" (${confirmaciones} confirmaciones)`);
      }
    }

    const finalNif = campos.proveedor_nif ? campos.proveedor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '') : cleanNif;

    // Si el proveedor es conocido Y con respaldo suficiente, limpiar incertidumbres OCR.
    // El NIF cacheado fue confirmado por el usuario en sesiones anteriores — es más fiable que la
    // lectura actual. No tiene sentido pedir revisión por un NIF que ya verificamos varias veces.
    // Con UNA sola confirmación previa (knownProviderFiable=false) NO se salta la revisión:
    // un único error humano no debe convertirse en verdad auto-confirmada para siempre.
    if (knownProviderFiable && finalNif) {
      nifUncertain = false;
      const nifIdx = missingFields.indexOf('proveedor_nif');
      if (nifIdx !== -1) missingFields.splice(nifIdx, 1);
    }

    // ── FASE 4: VIES async (no bloquea, informacional) ─────────────────
    // Solo consultamos VIES si tenemos un CIF válido de empresa (letra inicial + 7 dígitos + control)
    const viesPromise = finalNif && /^[A-Z]\d{7}[A-Z0-9]$/.test(finalNif)
      ? validateVIES(finalNif)
      : Promise.resolve(null);

    // ── FASE 5: Calcular nivel de confianza y auto-confirm ──────────────
    // Auto-confirm = el usuario NO necesita revisar nada: la foto se procesa directamente.
    // Criterios para alta confianza:
    //   1. Sin discrepancia entre lecturas OCR (nifUncertain = false)
    //   2. Dígito de control no falla (null = NIF/NIE persona, aceptable)
    //   3. Todos los campos obligatorios presentes
    //   4. Proveedor conocido (ya confirmado antes) O dígito de control explícitamente correcto
    const digitCheck = finalNif ? checkDigitCIF(finalNif) : null;
    const cifConfident = !nifUncertain && digitCheck !== false;
    // v1 (lógica real hasta hoy) — se conservan SIEMPRE, aunque el switch de
    // abajo las sustituya: son la "banda v1" que se sigue registrando en el
    // shadow log para poder seguir comparando incluso con v2 ya al mando.
    const requiresReviewV1 = missingFields.length > 0 || nifUncertain || digitCheck === false;
    // Auto-confirm SOLO para proveedores ya verificados por el usuario (knownProvider = true).
    // Para proveedores nuevos, siempre mostrar modal aunque el dígito de control sea correcto.
    // Motivo: el dígito de control valida el formato matemático, no la precisión de lectura del OCR.
    // Un CIF leído incorrectamente puede pasar el dígito de control y guardarse silenciosamente.
    // Auto-confirm: proveedor conocido O (nuevo + dígito de control explícitamente correcto)
    // El dígito de control correcto garantiza que el CIF fue leído sin errores matemáticamente.
    const autoConfirmV1 = !requiresReviewV1 && userAutoConfirmPref && (knownProvider || digitCheck === true);
    // Q4: NIF no leído por ningún motor → confianza siempre baja sin importar proveedor conocido
    const ocrNifStatus = ocrData?.nif_status;
    const confidenceLevelV1 =
      ocrNifStatus === 'both_missing'     ? 'low'    :
      (knownProvider && !requiresReviewV1) ? 'high'   :
      (missingFields.length > 0)          ? 'low'    : 'medium';

    // Variables REALES que usa el resto del handler (respuesta al usuario +
    // preview en Redis). Por defecto = v1; el switch de abajo las sustituye
    // SOLO si pipeline_v2_validacion_enabled está activo.
    let requiresReview = requiresReviewV1;
    let autoConfirm = autoConfirmV1;
    let confidenceLevel = confidenceLevelV1;

    // ── Pipeline v2: routing determinista — shadow log SIEMPRE + SWITCH real ──
    // (Fase 3, 2026-07-21 → switch real activado 2026-07-22 a petición de
    // Julio, SIN datos de shadow mode todavía que lo validen — riesgo asumido
    // explícitamente por él, no es una decisión que tomé yo por mi cuenta.)
    // Fail-safe: cualquier error aquí se traga y se loguea — nunca debe
    // romper la subida de la factura, ni con el switch activo.
    const previewId = crypto.randomUUID();
    try {
      // Lectura en caliente de features.json (regla 4 del CLAUDE.md — el
      // fichero cambia sin rebuild, nunca se cachea el valor entre peticiones)
      const shadowCfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
      const bandaV1 = requiresReviewV1 ? 'revision_humana' : 'auto_aceptada';
      const v2 = decidirRouting(campos);
      const coincide = v2.decision === bandaV1;

      if (shadowCfg.pipeline_v2_shadow_mode) {
        pool.query(
          `INSERT INTO ocr_shadow_validaciones
             (preview_id, decision_v1, decision_v2, coincide, incidencias, sugerencias, creado_en)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())`,
          [previewId, bandaV1, v2.decision, coincide, JSON.stringify(v2.incidencias), JSON.stringify(v2.sugerencias)]
        ).catch(err => logger.error('[ShadowV2] Error guardando comparación', { error: err.message }));
        if (!coincide) {
          logger.info(`[ShadowV2] Discrepancia v1=${bandaV1} v2=${v2.decision} preview=${previewId} motivo="${v2.motivo}"`);
        }
      }

      if (shadowCfg.pipeline_v2_validacion_enabled) {
        // SWITCH REAL: a partir de aquí decide v2, no v1. Mapeo de bandas:
        //   auto_aceptada    → requiresReview=false (respeta la preferencia
        //                      auto-confirm del usuario, sin exigir además
        //                      "proveedor conocido" — v2 ya validó por su
        //                      cuenta con checksums + cuadre aritmético)
        //   revision_humana  → requiresReview=true
        //   recaptura        → a estas alturas ya pasamos el filtro
        //                      es_factura_valida !== false más arriba; si v2
        //                      igualmente decide recaptura, se trata como
        //                      revisión humana (no se descarta la factura en
        //                      un punto tan tardío del flujo)
        if (v2.decision === 'auto_aceptada') {
          requiresReview = false;
          autoConfirm = userAutoConfirmPref;
          confidenceLevel = 'high';
        } else {
          requiresReview = true;
          autoConfirm = false;
          confidenceLevel = v2.incidencias.some((i) => i.severidad === 'error') ? 'low' : 'medium';
        }
        logger.info(`[PipelineV2] SWITCH activo — decide v2: ${v2.decision} (v1 habría dicho: ${bandaV1}) motivo="${v2.motivo}"`);
      }
    } catch (shadowErr) {
      logger.error('[ShadowV2] Error calculando/aplicando routing v2', { error: shadowErr.message });
    }

    // ── Bloque 5 pipeline v2: variante de contraste (2026-07-22) ────────────
    // Genera una segunda imagen (contraste local CLAHE + brillo/saturación
    // reducidos) y compara qué lee el MISMO motor primario en cada una.
    // Automático en cada factura mientras el flag esté activo (decisión de
    // Julio). FIRE-AND-FORGET: nunca se espera (await) — jamás debe añadir
    // latencia a la respuesta real ni afectar lo que ve el usuario.
    try {
      const varianteCfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
      if (varianteCfg.pipeline_v2_imagen_variante_enabled) {
        compararVarianteContraste(filePath, fileInfo.mimetype, campos, ocrContext, logger)
          .then(async (resultado) => {
            if (!resultado) return;
            let rutaFinal = resultado.rutaVariante;
            // Carrera con auto-confirmación: si /api/upload-confirm ya movió el
            // fichero original (y su intento de mover esta variante llegó
            // demasiado pronto, cuando aún no existía) mientras generábamos la
            // comparación, la reubicamos aquí usando la ruta final ya conocida
            // en `uploads`. Sin esto, el fichero queda huérfano en la carpeta
            // plana pre-confirmación para siempre.
            try {
              const yaConfirmada = await pool.query(
                'SELECT file_path FROM uploads WHERE preview_id = $1 LIMIT 1',
                [previewId]
              );
              if (yaConfirmada.rows.length > 0) {
                const destino = `${yaConfirmada.rows[0].file_path}.variante-contraste.jpg`;
                if (destino !== rutaFinal) {
                  await fs.rename(rutaFinal, destino);
                  rutaFinal = destino;
                }
              }
            } catch (moveErr) {
              logger.warn(`[ImagenVariante] No se pudo reubicar variante tras confirmación concurrente: ${moveErr.message}`);
            }
            return pool.query(
              `INSERT INTO ocr_imagen_variante_comparativa
                 (preview_id, motor, ruta_variante, campos_original, campos_variante, diffs)
               VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
              [
                previewId, resultado.engine, rutaFinal,
                JSON.stringify(campos), JSON.stringify(resultado.camposVariante),
                JSON.stringify(resultado.diffs),
              ]
            );
          })
          .catch((err) => logger.error('[ImagenVariante] Error en comparación de variante', { error: err.message }));
      }
    } catch (varianteErr) {
      logger.error('[ImagenVariante] Error leyendo configuración', { error: varianteErr.message });
    }

    // ── FASE 6: Guardar preview en Redis (TTL 30 min) ───────────────────
    const viesResult = await Promise.race([
      viesPromise,
      new Promise(resolve => setTimeout(() => resolve(null), 4500))
    ]);

    // Detectar tipo de factura (compra o venta): la fuente de verdad es la
    // selección EXPLÍCITA del usuario en el formulario (invoiceTypeFromUser,
    // línea ~1663), nunca el OCR. Antes se re-derivaba comparando el NIF de
    // la empresa contra campos.receptor_nif/finalNif (lectura OCR) — si el
    // OCR leía mal justo el NIF del propio lado del usuario, clasificaba la
    // factura al revés, y la sustitución determinista de más abajo acababa
    // pisando el dato de la CONTRAPARTE (correcto) con la identidad propia,
    // dejando el lado propio con el dato corrupto del OCR sin corregir. La
    // comparación OCR-vs-NIF se conserva solo como aviso en el log.
    let invoiceType = invoiceTypeFromUser;
    if (userCompanyNif) {
      const provNif = finalNif ? finalNif.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
      const recpNif = campos.receptor_nif ? campos.receptor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
      const ocrSugiere = (recpNif && userCompanyNif === recpNif) ? 'compra'
        : (provNif && userCompanyNif === provNif) ? 'venta'
        : null;
      if (ocrSugiere && ocrSugiere !== invoiceType) {
        logger.warn(`[InvoiceType] Discrepancia: usuario seleccionó "${invoiceType}" pero el NIF leído por OCR sugiere "${ocrSugiere}" — se respeta la selección del usuario`);
      }
    }

    // ── OCR Autocorrection via company_relationships ────────────────────────
    // Buscar contraparte conocida para completar/corregir datos del OCR.
    // Si la confianza es 'high' → autocorregir silenciosamente.
    // Si es 'medium' → enviar sugerencia al frontend para que el usuario decida.
    let ocrCorrected = null;
    let suggestedCounterparty = null;
    let effectiveProvNif = finalNif;  // puede quedar sobreescrito si contraparte = proveedor
    if (userCompanyNif) {
      try {
        const cpOcr = getCounterpartyInfo(userCompanyNif, { ...campos, proveedor_nif: finalNif }, invoiceType);
        const relLookup = await lookupCounterparty(userCompanyNif, cpOcr.nif, cpOcr.nombre);
        if (relLookup) {
          if (relLookup.confidence === 'high') {
            const fuenteRel = `company_relationships(${relLookup.method}, ${relLookup.confirmations} confirmaciones)`;
            if (invoiceType === 'venta') {
              if (relLookup.counterparty_nif)    { registrarOverride('receptor_nif', relLookup.counterparty_nif, fuenteRel);       campos.receptor_nif    = relLookup.counterparty_nif; }
              if (relLookup.counterparty_nombre) { registrarOverride('receptor_nombre', relLookup.counterparty_nombre, fuenteRel); campos.receptor_nombre = relLookup.counterparty_nombre; }
            } else {
              if (relLookup.counterparty_nif)    { registrarOverride('proveedor_nif', relLookup.counterparty_nif, fuenteRel);       effectiveProvNif        = relLookup.counterparty_nif; }
              if (relLookup.counterparty_nombre) { registrarOverride('proveedor_nombre', relLookup.counterparty_nombre, fuenteRel); campos.proveedor_nombre = relLookup.counterparty_nombre; }
            }
            ocrCorrected = {
              nif:    relLookup.counterparty_nif,
              nombre: relLookup.counterparty_nombre,
              method: relLookup.method,
              confirmations: relLookup.confirmations,
              field: invoiceType === 'venta' ? 'receptor' : 'proveedor',
            };
          } else {
            suggestedCounterparty = {
              nif:    relLookup.counterparty_nif,
              nombre: relLookup.counterparty_nombre,
              method: relLookup.method,
              confirmations: relLookup.confirmations,
              field: invoiceType === 'venta' ? 'receptor' : 'proveedor',
            };
          }
          logger.info(`[Relationship] lookup ${userCompanyNif}→${relLookup.counterparty_nif} conf=${relLookup.confidence} method=${relLookup.method}`);
        }
      } catch (relErr) {
        logger.warn(`[Relationship] lookup error en preview: ${relErr.message}`);
      }
    }

    // ── IDENTIDAD DEL USER = FUENTE DE VERDAD DEL REGISTRO (no del OCR) ──────
    // Mismo criterio que /api/upload-confirm (ver commit 7bb9bfc): el lado propio
    // de la factura (receptor en compra, emisor en venta) se conoce con certeza
    // desde el registro (users.company_* — o la empresa cliente seleccionada por
    // un admin, ya resuelta en userCompanyNif/userCompanyName más arriba) y NUNCA
    // debe depender de lo que lea la IA. Antes solo se forzaba al confirmar: el
    // preview seguía mostrando el guess crudo del OCR y el usuario lo "corregía"
    // a mano aunque el backend lo iba a sobrescribir igual al guardar. Se adelanta
    // aquí para que el preview ya muestre el dato correcto desde el principio.
    // ESTO ES DELIBERADO Y NO ES UN BUG: el nombre y el CIF de la empresa que
    // hace la foto se conocen con certeza por su registro, asi que la IA NUNCA
    // manda sobre ellos. Queda registrado como override para que el panel lo
    // muestre con su origen ("registro del usuario") en vez de hacerlo pasar
    // por una lectura de la IA.
    if (userCompanyNif && userCompanyName) {
      if (invoiceType === 'venta') {
        registrarOverride('proveedor_nif', userCompanyNif, 'registro del usuario');
        registrarOverride('proveedor_nombre', userCompanyName, 'registro del usuario');
        effectiveProvNif        = userCompanyNif;
        campos.proveedor_nombre = userCompanyName;
      } else {
        registrarOverride('receptor_nif', userCompanyNif, 'registro del usuario');
        registrarOverride('receptor_nombre', userCompanyName, 'registro del usuario');
        campos.receptor_nif    = userCompanyNif;
        campos.receptor_nombre = userCompanyName;
      }
    }

    const previewData = {
      filePath,
      fileInfo,
      userInfo,
      campos: { ...campos, proveedor_nif: effectiveProvNif },
      ocr_result_full: ocrData?.campos || {},
      // Lo que dijo la IA antes de que este endpoint lo sobrescribiera con BD,
      // y el detalle campo a campo de cada sobrescritura (ver ocrIaPura arriba).
      ocr_merged_ia: ocrIaPura,
      overrides_bd: overridesBD,
      ocr_dual_full: {
        dual_confirmed: ocrData?.dual_confirmed || false,
        openai: ocrData?.openai_result || null,
        azure: ocrData?.azure_result || null,
        campo_sources: ocrData?.campo_sources || null,
        // 2026-07-22: antes se descartaban aquí mismo (nunca llegaban a
        // persistirse en uploads.ocr_result) — necesarios para el ranking
        // multi-motor y la trazabilidad del pipeline v2 en el panel admin.
        extra_results: ocrData?.extra_results || [],
        mistral_result: ocrData?.mistral_result || null,
        nif_status: ocrData?.nif_status || null,
        nif_discrepancy: ocrData?.nif_discrepancy || null,
        validacion_determinista: ocrData?.validacion_determinista || null,
      },
      ocrData: {
        processing_time_s: ocrData?.processing_time_s,
        ocr_engine: ocrData?.ocr_engine,
        campo_sources: ocrData?.campo_sources || null,
        dual_confirmed: ocrData?.dual_confirmed || false,
      },
      nifUncertain: nifUncertain || false,
      knownProvider,
      confidence_level: confidenceLevel,
      missing_fields: missingFields,
      invoice_type: invoiceTypeFromUser,
      iva_validation: ivaValidation,
      client_company_id: clientCompanyId,
      client_company_data: clientCompanyData,
    };
    await redisClient.setex(`preview:${previewId}`, 1800, JSON.stringify(previewData));

    logger.info(`[Preview] ${fileInfo.filename} → preview_id=${previewId} nif=${effectiveProvNif} known=${knownProvider} vies=${viesResult?.valid ?? 'n/a'} uncertain=${nifUncertain} autoConfirm=${autoConfirm} confidence=${confidenceLevel} missing=${missingFields.join(',') || 'none'} dual_confirmed=${ocrData?.dual_confirmed || false} invoice_type=${invoiceType} rel_corrected=${ocrCorrected?.method || 'none'}`);

    res.json({
      preview: true,
      preview_id: previewId,
      campos: {
        proveedor_nombre:  campos.proveedor_nombre || null,
        proveedor_nif:     effectiveProvNif,
        receptor_nombre:   campos.receptor_nombre  || null,
        receptor_nif:      campos.receptor_nif     || null,
        fecha_emision:     campos.fecha_emision    || null,
        total:             campos.total            || null,
        numero_factura:    campos.numero_factura   || null,
        // ── Desglose de IVA ─────────────────────────────────────────────────
        base_imponible:    campos.base_imponible   || null,
        iva_porcentaje:    campos.iva_porcentaje   || null,
        cuota_iva:         campos.cuota_iva        || null,
        lineas_iva:        campos.lineas_iva       || null,
        irpf_porcentaje:   campos.irpf_porcentaje  || '0,0',
        cuota_irpf:        campos.cuota_irpf       || '0,00',
      },
      auto_confirm:    autoConfirm,
      requires_review: requiresReview,
      missing_fields:  missingFields,
      cif_confident:   cifConfident,
      known_provider:  knownProvider,
      vies_valid:      viesResult?.valid ?? null,
      vies_nombre:     viesResult?.nombre ?? null,
      nif_uncertain:   nifUncertain || false,
      confidence:      confidenceLevel,
      dual_confirmed:  ocrData?.dual_confirmed || false,
      nif_status:      ocrData?.nif_status || null,   // Q13: 'confirmed'|'single_source'|'both_missing'|'conflict'
      ocr_discrepancy: (ocrData?.dual_confirmed === false && ocrData?.openai_result && ocrData?.azure_result) ? {
        nif:   { openai: ocrData.openai_result.campos?.proveedor_nif || null, azure: ocrData.azure_result.campos?.proveedor_nif || null },
        fecha: { openai: ocrData.openai_result.campos?.fecha_emision || null, azure: ocrData.azure_result.campos?.fecha_emision || null },
        total: { openai: ocrData.openai_result.campos?.total         || null, azure: ocrData.azure_result.campos?.total         || null },
      } : null,
      invoice_type:    invoiceTypeFromUser,
      iva_validation: {
        valid:    ivaValidation.valid,
        errors:   ivaValidation.errors,
        warnings: ivaValidation.warnings,
      },
      ocr_corrected:          ocrCorrected,
      suggested_counterparty: suggestedCounterparty,
      cif_validation: cifValidation,
      user_company: { nif: userCompanyNif, nombre: userCompanyName },
    });
  } catch (err) {
    logger.error('Upload-preview error:', err);
    res.status(500).json({ error: 'Error al procesar la imagen' });
  }
});

// ── POST /api/upload-preview-multipagina — factura de varias páginas ──────────
// (2026-08-13, petición de Julio). Endpoint SEPARADO del de una página a
// propósito: no toca la ruta crítica (lección LL-002). Recibe N imágenes
// (`paginas[]`), extrae cada una con el pipeline v2 y las fusiona en UNA factura
// (pipeline/orquestador-multipagina + fusion-multipagina), devolviendo el shape
// plano de siempre + `campos_faltantes` para que el frontend pida la foto extra.
//
// Apagado por defecto: solo responde si features.json tiene
// ocr_multipagina_enabled=true. Tope de páginas: ocr_multipagina_max_paginas
// (default 6), BLOQUEANTE. NO persiste todavía en `uploads` — devuelve un
// preview que el usuario confirma (la persistencia multipágina es Fase 2.2).
app.post('/api/upload-preview-multipagina', authenticateToken, requireActiveCompany, uploadLimiter, uploadMultipagina.array('paginas', MULTIPAGINA_MAX_HARD), async (req, res) => {
  const { canonicoAPlano } = require('./pipeline/adaptador-v1');
  const { ejecutarPipelineMultipagina } = require('./pipeline/orquestador-multipagina');
  const fsp = require('fs').promises;

  const ficheros = req.files || [];
  const limpiar = () => Promise.all(ficheros.map((f) => fsp.unlink(f.path).catch(() => {})));

  try {
    const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
    if (!cfg.ocr_multipagina_enabled) {
      await limpiar();
      return res.status(403).json({ error: 'La subida de facturas de varias páginas no está disponible.' });
    }
    // CANARIO (2026-08-13): mientras se valida en producción, solo los tech-admin
    // pueden usarlo (mismo criterio que el botón "Probar flujo"). Se abre a todos
    // quitando este check tras la validación de Julio en su PWA.
    if (cfg.ocr_multipagina_solo_tech_admin !== false && !isTechAdmin(req.user.email)) {
      await limpiar();
      return res.status(403).json({ error: 'La subida de varias páginas está en pruebas y aún no está disponible para tu cuenta.' });
    }
    const maxPaginas = Number.isInteger(cfg.ocr_multipagina_max_paginas) ? cfg.ocr_multipagina_max_paginas : 6;

    if (ficheros.length === 0) {
      return res.status(400).json({ error: 'No se recibió ninguna página.' });
    }
    if (ficheros.length > maxPaginas) {
      await limpiar();
      return res.status(400).json({ error: `Demasiadas páginas (${ficheros.length}). El máximo por factura es ${maxPaginas}.` });
    }

    // Validación de magic bytes por página (anti-spoofing de MIME) — fail-secure:
    // si una sola página no valida, se rechaza el envío entero y se limpia todo.
    for (const f of ficheros) {
      let ok = false;
      try { ok = await validateFileMagicBytes(f.path, f.mimetype); } catch { ok = false; }
      if (!ok) {
        auditLog('UPLOAD_BLOCKED', { filename: f.filename, reason: 'magic_bytes_mismatch_multipagina', mime: f.mimetype }, req.user.userId, req.ip);
        await limpiar();
        return res.status(400).json({ error: 'Una de las páginas no es una imagen válida. Vuelve a hacer la foto.' });
      }
    }

    // Empresa del usuario (misma fuente que el endpoint de una página).
    const userRow = (await pool.query('SELECT company_nif, company_name FROM users WHERE id = $1', [req.user.userId])).rows[0];
    const userCompanyNif = userRow?.company_nif ? userRow.company_nif.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
    const invoiceType = (req.body.invoice_type === 'venta') ? 'venta' : 'compra';

    const paginas = ficheros.map((f, i) => ({ pagina: i + 1, filePath: f.path, mimeType: f.mimetype }));
    const context = { invoice_type: invoiceType, empresa_nif: userCompanyNif, userId: req.user.userId };

    const resultado = await ejecutarPipelineMultipagina(paginas, context, cfg, logger);

    if (!resultado.campos) {
      await limpiar();
      return res.json({ success: false, error: 'No se pudo leer ninguna de las páginas. Repite las fotos con mejor luz.' });
    }

    const plano = canonicoAPlano(resultado.campos);

    // Identidad del registro: el nombre/CIF de la empresa que hace la foto se
    // conocen con certeza por su registro — la IA NUNCA manda sobre ellos. Mismo
    // criterio deliberado que la subida de una página (server.js ~2306).
    const userCompanyName = userRow?.company_name || null;
    if (userCompanyNif && userCompanyName) {
      if (invoiceType === 'venta') { plano.proveedor_nif = userCompanyNif; plano.proveedor_nombre = userCompanyName; }
      else { plano.receptor_nif = userCompanyNif; plano.receptor_nombre = userCompanyName; }
    }

    const previewId = crypto.randomUUID();
    // La página 1 representa la factura en `uploads` (el confirm persiste un
    // file_path). Las demás páginas quedan en disco y se listan en `paginas`.
    const p1 = ficheros[0];

    // Preview en Redis con el MISMO shape que espera /api/upload-confirm
    // ({ filePath, fileInfo, userInfo, campos, ocrData }) — así se reutiliza el
    // confirm probado SIN tocarlo. Se añaden las claves multipágina como extra.
    const previewData = {
      filePath: p1.path,
      fileInfo: { filename: p1.filename, mimetype: p1.mimetype, size: p1.size },
      userInfo: { userId: req.user.userId, email: req.user.email },
      campos: plano,
      ocr_result_full: plano,
      ocrData: { campos: plano, dual_confirmed: false, ocr_engine: 'multipagina_v2' },
      client_company_id: null,
      client_company_data: null,
      // Extras multipágina (no los usa el confirm; sí el registro/depuración).
      multipagina: true,
      paginas: paginas.map((p) => ({ pagina: p.pagina, path: p.filePath })),
      campos_faltantes: resultado.camposFaltantes,
      procedencia: resultado.procedencia,
      invoice_type: invoiceType,
      estado: resultado.estado,
    };
    await redisClient.setex(`preview:${previewId}`, 1800, JSON.stringify(previewData));

    logger.info(`[PreviewMultipagina] preview_id=${previewId} paginas=${resultado.paginas_validas}/${resultado.paginas_total} estado=${resultado.estado} faltan=${resultado.camposFaltantes.map((c) => c.clave).join(',') || 'nada'}`);

    return res.json({
      preview: true,
      multipagina: true,
      preview_id: previewId,
      campos: plano,
      // Guía la foto extra: qué falta y en qué hoja buscarlo (fiscal/importes).
      campos_faltantes: resultado.camposFaltantes,
      procedencia: resultado.procedencia,
      paginas_total: resultado.paginas_total,
      paginas_validas: resultado.paginas_validas,
      requires_review: resultado.estado !== 'auto_aprobada',
      estado: resultado.estado,
      avisos: resultado.avisos,
      invoice_type: invoiceType,
      user_company: { nif: userCompanyNif, nombre: userRow?.company_name || null },
    });
  } catch (err) {
    await limpiar();
    logger.error('Upload-preview-multipagina error:', err);
    return res.status(500).json({ error: 'Error al procesar las páginas.' });
  }
});

// ── POST /api/test-captura — "botón de prueba" (2026-07-27, petición de Julio) ──
// Ejecuta el flujo real de captura+OCR (mismo motor que /api/upload-preview,
// pipeline v1 en producción) pero NUNCA persiste nada — ni fichero, ni fila en
// BD, ni preview en Redis. Solo para verificar que el flujo completo (cámara →
// subida → OCR) funciona y es viable, sin dejar rastro. Restringido a
// tech_admin (mismo criterio que el panel de Benchmark IA).
app.post('/api/test-captura', authenticateToken, requireActiveCompany, uploadLimiter, upload.single('file'), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Función restringida a administradores técnicos.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const validMagic = await validateFileMagicBytes(filePath, req.file.mimetype);
    if (!validMagic) {
      return res.status(400).json({ error: 'El archivo no corresponde al tipo declarado. Sube una imagen JPEG, PNG o PDF válido.' });
    }

    const inicio = Date.now();
    const [ocrData, cifFocused] = await Promise.all([
      extractInvoiceOCR(filePath, req.file.mimetype, req.file.filename, logger, {}),
      extractCIFOnlyOCR(filePath, req.file.mimetype),
    ]);
    const tiempoMs = Date.now() - inicio;

    res.json({
      success: true,
      test_mode: true,
      aviso: 'Modo prueba: nada de esto se ha guardado (ni fichero ni registro).',
      tiempo_ms: tiempoMs,
      ocr_engine: ocrData?.ocr_engine || null,
      dual_confirmed: ocrData?.dual_confirmed ?? null,
      es_factura_valida: ocrData?.es_factura_valida ?? null,
      confidence: ocrData?.confidence ?? null,
      campos: ocrData?.campos || null,
      receptor_cif_enfocado: cifFocused || null,
    });
  } catch (err) {
    logger.error('[TestCaptura] Error:', err.message);
    res.status(500).json({ error: 'Error al procesar la prueba' });
  } finally {
    // Regla de esta función: NUNCA se persiste — se borra siempre, éxito o fallo.
    if (filePath) fs.unlink(filePath).catch(() => {});
  }
});

// ── POST /api/upload-confirm — confirmar preview y guardar en BD ─────────────
app.post('/api/upload-confirm', authenticateToken, requireActiveCompany, confirmLimiter, async (req, res) => {
  try {
    const {
      preview_id,
      confirmed_nif,
      confirmed_fecha,
      confirmed_total,
      // Nombres/NIFs de ambas partes corregibles por el usuario en el modal
      confirmed_proveedor_nombre,
      confirmed_receptor_nombre,
      confirmed_receptor_nif,
      // Número de factura editable en el modal
      confirmed_numero_factura,
      // Correcciones de IVA que el usuario puede ajustar en el modal
      confirmed_base_imponible,
      confirmed_iva_porcentaje,
      confirmed_cuota_iva,
      confirmed_irpf_porcentaje,
      confirmed_cuota_irpf,
      // Multi-IVA 2026-04-21 parte 2/7: array editable de tramos con productos
      // Estructura: [{base, porcentaje, cuota, productos:[{descripcion, importe}]}]
      // Si viene → overrides base/porcentaje/cuota agregados como sumas
      // Si no viene → backward compat con campos.lineas_iva original del OCR
      confirmed_lineas_iva,
    } = req.body || {};

    // client_company_id viene del preview almacenado en Redis (no del body — evita tampering)

    if (!preview_id) return res.status(400).json({ error: 'preview_id requerido' });

    // Recuperar preview de Redis
    const raw = await redisClient.get(`preview:${preview_id}`);
    if (!raw) {
      return res.status(410).json({ error: 'La sesión de vista previa ha expirado. Vuelve a subir la factura.' });
    }
    const preview = JSON.parse(raw);

    // Recuperar empresa cliente del preview (guardada en el momento del upload-preview)
    const previewClientCompanyId   = preview.client_company_id   || null;
    const previewClientCompanyData = preview.client_company_data || null;

    // Verificar que el preview pertenece al usuario autenticado
    if (preview.userInfo.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Sin acceso a este preview' });
    }

    const { filePath, fileInfo, userInfo, campos, ocrData } = preview;

    // Usar valores confirmados/corregidos por el usuario (o los del OCR si no se modificaron)
    const finalNif   = confirmed_nif   ? confirmed_nif.toUpperCase().replace(/[^A-Z0-9]/g, '')  : campos.proveedor_nif;
    const finalFecha = confirmed_fecha ? confirmed_fecha.trim() : campos.fecha_emision;
    const finalTotal = confirmed_total ? confirmed_total.trim() : campos.total;

    // ── Validación CIF emisor/receptor vs usuario (defensa en profundidad) ───
    // El frontend ya valida y bloquea el botón, pero un cliente HTTP malicioso
    // podría saltarse ese check. Repetimos en backend con los valores confirmados.
    // Excepción admin: si el preview viene con empresa cliente seleccionada
    // (panel admin operando en nombre de un cliente), validamos contra el CIF
    // de esa empresa cliente, no contra el del admin.
    let validationUserNif  = null;
    let validationUserName = null;
    if (previewClientCompanyData && previewClientCompanyData.cif) {
      validationUserNif  = String(previewClientCompanyData.cif).toUpperCase().replace(/[^A-Z0-9]/g, '');
      validationUserName = previewClientCompanyData.nombre || null;
    } else {
      const userProfileForCifVal = await pool.query(
        'SELECT company_nif, company_name FROM users WHERE id = $1',
        [preview.userInfo.userId]
      );
      validationUserNif = userProfileForCifVal.rows[0]?.company_nif
        ? userProfileForCifVal.rows[0].company_nif.toUpperCase().replace(/[^A-Z0-9]/g, '')
        : null;
      validationUserName = userProfileForCifVal.rows[0]?.company_name || null;
    }
    const cifValidationConfirm = validateInvoiceCifs({
      invoiceType:    preview.invoice_type || 'compra',
      emisorNif:      confirmed_nif              || campos.proveedor_nif,
      emisorNombre:   confirmed_proveedor_nombre || campos.proveedor_nombre,
      receptorNif:    confirmed_receptor_nif     || campos.receptor_nif,
      receptorNombre: confirmed_receptor_nombre  || campos.receptor_nombre,
      userNif:        validationUserNif,
      userNombre:     validationUserName,
    });
    if (cifValidationConfirm.blocking) {
      logger.warn(`[CIF-Match-Confirm] Bloqueante user=${userInfo.userId} preview=${preview_id}: ${cifValidationConfirm.errors.map(e => e.code).join(',')}`);
      auditLog('UPLOAD_BLOCKED_CIF_MISMATCH', {
        codes: cifValidationConfirm.errors.map(e => e.code),
        invoice_type: preview.invoice_type || 'compra',
      }, userInfo.userId, req.ip);
      return res.status(400).json({
        success: false,
        cif_mismatch: true,
        errors: cifValidationConfirm.errors,
        error: cifValidationConfirm.errors[0].message,
      });
    }

    // Validar campos obligatorios tras confirmación
    const missing = [];
    if (!finalNif)   missing.push('CIF/NIF del proveedor');
    if (!finalFecha) missing.push('fecha de emisión');
    if (!finalTotal) missing.push('importe total');
    if (missing.length > 0) {
      return res.status(400).json({ error: `Faltan datos: ${missing.join(', ')}` });
    }

    // Validar formato del NIF confirmado
    const cifCheck = validateSpanishTaxId(finalNif);
    if (!cifCheck.valid) {
      return res.status(400).json({ error: `CIF/NIF inválido: ${cifCheck.reason}` });
    }

    // Normalizar para BD — soporta formato español (1.234,56) e inglés (1,234.56 / 144.40)
    // La función anterior tenía un bug: "144.40" (inglés) → elimina punto → "14440.00" (100× error)
    const normalizeTotal = (t) => {
      if (!t) return '0';
      let s = String(t).trim().replace(/\s/g, '').replace(/€/g, '').replace(/\$/g, '');
      if (!s) return '0';
      const hasComma = s.includes(',');
      const hasDot   = s.includes('.');
      let val;
      if (hasComma && hasDot) {
        // Ambos separadores: el ÚLTIMO es el decimal
        val = s.lastIndexOf(',') > s.lastIndexOf('.')
          ? parseFloat(s.replace(/\./g, '').replace(',', '.'))   // español: 1.234,56
          : parseFloat(s.replace(/,/g, ''));                     // inglés:  1,234.56
      } else if (hasComma) {
        const afterComma = s.split(',').pop() || '';
        // Si hay exactamente 3 dígitos tras la coma → coma es separador de miles inglés (1,234)
        val = afterComma.length === 3
          ? parseFloat(s.replace(/,/g, ''))
          : parseFloat(s.replace(',', '.'));  // coma decimal español: 144,40
      } else if (hasDot) {
        const parts    = s.split('.');
        const lastPart = parts[parts.length - 1];
        const dotCount = (s.match(/\./g) || []).length;
        if (dotCount > 1) {
          val = parseFloat(s.replace(/\./g, ''));  // 1.234.567 → miles sin decimal
        } else if (lastPart.length <= 2) {
          val = parseFloat(s);                     // 144.40 / 4.84 → punto decimal inglés
        } else {
          val = parseFloat(s.replace(/\./g, ''));  // 4.840 / 1.234 → punto miles español
        }
      } else {
        val = parseFloat(s);
      }
      if (isNaN(val)) return '0';
      // 2026-07-29: se guarda SIEMPRE en formato español con coma ("1.234,56").
      // Antes salia con punto (val.toFixed(2)) mientras el resto de importes de
      // la app usaban coma, dejando la columna con dos formatos mezclados: eso
      // rompia sumas SQL (ver /api/admin/users) y debilitaba la deteccion de
      // duplicados, que compara total_factura como texto exacto.
      return toSpanishAmount(val) || '0';
    };
    const normalizeDate = (d) => {
      if (!d) return '';
      const m = String(d).trim().match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
      if (!m) return String(d).trim();
      const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
      // Validar rangos — sistema español: DD/MM/YYYY
      if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) {
        return String(d).trim(); // devolver original sin transformar si el rango es inválido
      }
      // SEC-010: validar que la fecha existe en el calendario real (ej: 31/02 no existe)
      const testDate = new Date(year, month - 1, day);
      if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) {
        logger.warn(`[Date] Fecha de calendario inválida: "${d}" — se devuelve original`);
        return String(d).trim();
      }
      return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
    };
    const normTotal = normalizeTotal(finalTotal);
    const normFecha = normalizeDate(finalFecha);

    // Detección de duplicados — señal 1: NIF+fecha+total
    const dupCheck = await pool.query(
      `SELECT id, filename FROM uploads
       WHERE user_id = $1 AND proveedor_nif = $2 AND fecha_emision = $3 AND total_factura = $4`,
      [userInfo.userId, finalNif, normFecha, normTotal]
    );
    if (dupCheck.rows.length > 0) {
      // H-002: eliminar archivo físico al detectar duplicado — evita acumulación en disco
      await fs.unlink(filePath).catch(() => {});
      await redisClient.del(`preview:${preview_id}`);
      return res.json({
        success: false,
        duplicate: true,
        error: `Factura duplicada. Ya existe una del ${finalFecha} con total ${finalTotal}\u20AC.`
      });
    }

    // Deteccion de duplicados, senal 2: numero_factura+fecha+total, ignorando el NIF.
    // Necesaria porque un CIF ilegible puede generar lecturas OCR distintas del NIF
    // entre dos subidas del mismo documento fisico, colando el duplicado por la senal 1
    // (incidente real: facturas #4/#15, mismo numero_factura, NIF leido de forma distinta).
    const numeroFacturaParaDup = (confirmed_numero_factura || campos.numero_factura || preview.ocr_result_full?.numero_factura || '').trim();
    if (numeroFacturaParaDup) {
      const dupPorNumero = await pool.query(
        `SELECT id, filename FROM uploads
         WHERE user_id = $1 AND fecha_emision = $2 AND total_factura = $3
           AND UPPER(REPLACE(numero_factura, ' ', '')) = UPPER(REPLACE($4, ' ', ''))`,
        [userInfo.userId, normFecha, normTotal, numeroFacturaParaDup]
      );
      if (dupPorNumero.rows.length > 0) {
        await fs.unlink(filePath).catch(() => {});
        await redisClient.del(`preview:${preview_id}`);
        return res.json({
          success: false,
          duplicate: true,
          error: `Factura duplicada. Ya existe una con el mismo numero de factura (${numeroFacturaParaDup}), fecha y total.`
        });
      }
    }

    // Organizar archivo en carpeta usuario/proveedor (estructura: uploads/{user}/{nif}/{file})
    const ocrFull = preview.ocr_result_full || {};
    const cleanStr = (v) => (v && typeof v === 'string' && v.trim()) ? v.trim() : null;
    const cleanNifVal = (v) => v ? String(v).toUpperCase().replace(/[^A-Z0-9]/g, '') || null : null;
    const emailPrefix = (userInfo.email || 'unknown').split('@')[0].replace(/[^a-z0-9_.-]/gi, '_').toLowerCase();
    const nifFolder = finalNif || 'sin_nif';
    const destDir = `/app/uploads/${emailPrefix}/${nifFolder}`;
    let finalFilePath = filePath;
    try {
      await fs.mkdir(destDir, { recursive: true });
      const newPath = `${destDir}/${path.basename(filePath)}`;
      await fs.rename(filePath, newPath);
      finalFilePath = newPath;

      // Bloque 5 (2026-07-22): si compararVarianteContraste ya generó la
      // variante de contraste durante el preview, vive junto al fichero
      // original bajo la ruta plana (pre-confirm). Al mover el original hay
      // que mover también su hermano, o queda huérfano en disco y
      // ruta_variante en BD apunta a un fichero que ya no existe.
      const oldVariantPath = `${filePath}.variante-contraste.jpg`;
      const newVariantPath = `${newPath}.variante-contraste.jpg`;
      try {
        await fs.rename(oldVariantPath, newVariantPath);
        await pool.query(
          `UPDATE ocr_imagen_variante_comparativa SET ruta_variante = $1
             WHERE preview_id = $2 AND ruta_variante = $3`,
          [newVariantPath, preview_id, oldVariantPath]
        );
      } catch (variantMoveErr) {
        // ENOENT esperado si la variante aún no se generó (carrera con el
        // fire-and-forget del preview) o si el flag está desactivado — no es
        // un error real, no debe registrarse como tal.
        if (variantMoveErr.code !== 'ENOENT') {
          logger.warn(`[Upload] No se pudo mover variante de contraste: ${variantMoveErr.message}`);
        }
      }
    } catch (moveErr) {
      logger.warn(`[Upload] No se pudo mover archivo a ${destDir}: ${moveErr.message} — se mantiene en ubicación original`);
    }

    // Recuperar NIF de empresa del usuario para detectar tipo de factura
    const userProfileRes = await pool.query('SELECT company_nif FROM users WHERE id = $1', [preview.userInfo.userId]);
    const userCompanyNif = userProfileRes.rows[0]?.company_nif
      ? userProfileRes.rows[0].company_nif.toUpperCase().replace(/[^A-Z0-9]/g, '')
      : null;
    // Usar invoice_type ya calculado en preview, o recalcularlo si hay NIF empresa
    let invoiceType = preview.invoice_type || 'compra';
    if (userCompanyNif && invoiceType === 'desconocida') {
      const provNif = finalNif?.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const recpNif = cleanNifVal(campos.receptor_nif || ocrFull.receptor_nif);
      if (recpNif && userCompanyNif === recpNif) invoiceType = 'compra';
      else if (provNif && userCompanyNif === provNif) invoiceType = 'venta';
      else invoiceType = 'compra';
    }

    // Construir ocr_result completo (dual AI) para JSONB
    const ocrResultJson = JSON.stringify({
      merged: preview.ocr_result_full || {},
      // `merged` es el resultado del SISTEMA (fusion de motores + recalculos +
      // sobrescrituras desde BD). `ia_pura` es lo que dijeron los motores antes
      // de todo eso, y `overrides_bd` explica campo a campo la diferencia.
      // Sin estas dos claves era imposible saber, mirando la BD, si un valor lo
      // habia leido la IA o lo habia puesto el catalogo/registro.
      ia_pura: preview.ocr_merged_ia || null,
      overrides_bd: preview.overrides_bd || [],
      dual_confirmed: preview.ocr_dual_full?.dual_confirmed || false,
      openai: preview.ocr_dual_full?.openai || null,
      azure: preview.ocr_dual_full?.azure || null,
      campo_sources: preview.ocr_dual_full?.campo_sources || null,
      ocr_engine: preview.ocrData?.ocr_engine || null,
      // 2026-07-22: se persisten también los motores extra (Mistral, Gemini
      // Pro...) y la validación determinista — antes se calculaban en el
      // fan-out pero se perdían al confirmar, dejando el ranking multi-motor
      // sin datos reales que mostrar.
      extra_results: preview.ocr_dual_full?.extra_results || [],
      mistral_result: preview.ocr_dual_full?.mistral_result || null,
      nif_status: preview.ocr_dual_full?.nif_status || null,
      nif_discrepancy: preview.ocr_dual_full?.nif_discrepancy || null,
      validacion_determinista: preview.ocr_dual_full?.validacion_determinista || null,
    });

    // Resolver campos IVA con prioridad: usuario > OCR-preview > OCR-full.
    // Multi-IVA (parte 2/7): si el usuario envía `confirmed_lineas_iva` editadas,
    // el helper normalizeConfirmedLineasIva valida cada tramo y recalcula los
    // agregados (base/cuota suma de tramos, porcentaje = tipo dominante).
    // Esto garantiza coherencia entre columnas agregadas y JSONB `lineas_iva`
    // (antes del fix se guardaban desincronizados).
    let finalLineasIva = campos.lineas_iva || ocrFull.lineas_iva || null;
    let aggregatedFromLines = { base: null, cuota: null, porcentaje: null };
    if (Array.isArray(confirmed_lineas_iva) && confirmed_lineas_iva.length > 0) {
      const norm = normalizeConfirmedLineasIva(confirmed_lineas_iva);
      if (norm.lineas && norm.lineas.length > 0) {
        finalLineasIva = norm.lineas;
        aggregatedFromLines = { base: norm.base, cuota: norm.cuota, porcentaje: norm.porcentaje };
        if (norm.errors.length > 0) {
          logger.warn(`[Confirm] lineas_iva con warnings (líneas descartadas): ${norm.errors.join('; ')}`);
        }
      } else {
        logger.warn(`[Confirm] lineas_iva rechazadas por normalizeConfirmedLineasIva: ${norm.errors.join('; ')}`);
      }
    } else if (Array.isArray(finalLineasIva) && finalLineasIva.length >= 2) {
      // Fix 2026-07-03 — flujo automático (el usuario NO editó los tramos):
      // normalizar el desglose OCR derivando bases ausentes para persistir un
      // JSONB coherente. Solo rellena agregados si vienen vacíos; NUNCA pisa
      // lo confirmado por el usuario (la reconciliación dura de agregados ya
      // ocurre en el orquestador ocr/index.js antes del preview).
      const norm = normalizeConfirmedLineasIva(fillDerivedBases(finalLineasIva));
      if (norm.lineas && norm.errors.length === 0) {
        finalLineasIva = norm.lineas;
        const hasBase  = cleanStr(confirmed_base_imponible || campos.base_imponible || ocrFull.base_imponible);
        const hasCuota = cleanStr(confirmed_cuota_iva      || campos.cuota_iva      || ocrFull.cuota_iva);
        const hasPct   = cleanStr(confirmed_iva_porcentaje || campos.iva_porcentaje || ocrFull.iva_porcentaje);
        if (!hasBase)  aggregatedFromLines.base       = norm.base;
        if (!hasCuota) aggregatedFromLines.cuota      = norm.cuota;
        if (!hasPct)   aggregatedFromLines.porcentaje = norm.porcentaje;
      } else if (norm.errors.length > 0) {
        logger.warn(`[Confirm] Desglose OCR multi-IVA no normalizable (se guarda tal cual): ${norm.errors.join('; ')}`);
      }
    }

    // Orden de prioridad para agregados:
    //   1. Sumas recalculadas de lineas_iva (si hay multi-tramo válido)
    //   2. Valor confirmado por el usuario en el input agregado (flujo mono-IVA)
    //   3. Valor del preview OCR
    //   4. Valor del OCR full
    const finalBaseImponible  = aggregatedFromLines.base
      || cleanStr(confirmed_base_imponible  || campos.base_imponible  || ocrFull.base_imponible);
    const finalIvaPorcentaje  = aggregatedFromLines.porcentaje
      || cleanStr(confirmed_iva_porcentaje  || campos.iva_porcentaje  || ocrFull.iva_porcentaje);
    const finalCuotaIva       = aggregatedFromLines.cuota
      || cleanStr(confirmed_cuota_iva       || campos.cuota_iva       || ocrFull.cuota_iva);
    const finalIrpfPorcentaje = cleanStr(confirmed_irpf_porcentaje || campos.irpf_porcentaje || ocrFull.irpf_porcentaje) || '0,0';
    const finalCuotaIrpf      = cleanStr(confirmed_cuota_irpf      || campos.cuota_irpf      || ocrFull.cuota_irpf)      || '0,00';
    // Número de factura: prioridad al valor confirmado/editado por el usuario en el modal
    const finalNumeroFactura  = cleanStr(confirmed_numero_factura || campos.numero_factura || ocrFull.numero_factura);

    // Validación IVA final con los valores definitivos (usuario puede haber corregido)
    const finalIvaValidation = validateIVACoherencia({
      base_imponible:  finalBaseImponible,
      iva_porcentaje:  finalIvaPorcentaje,
      cuota_iva:       finalCuotaIva,
      irpf_porcentaje: finalIrpfPorcentaje,
      cuota_irpf:      finalCuotaIrpf,
      total:           finalTotal,
      lineas_iva:      finalLineasIva,
    });
    if (!finalIvaValidation.valid) {
      logger.warn(`[IVA-Confirm] Inconsistencia en factura ${uploadId || 'nueva'}: ${finalIvaValidation.errors.join(' | ')}`);
    }

    // ADMIN: si viene empresa cliente del preview, usarla como receptor (fuente de verdad)
    // El admin seleccionó explícitamente la empresa cliente → tiene prioridad sobre OCR
    let finalReceptorNif    = cleanNifVal(confirmed_receptor_nif  || campos.receptor_nif    || ocrFull.receptor_nif);
    let finalReceptorNombre = cleanStr(confirmed_receptor_nombre  || campos.receptor_nombre  || ocrFull.receptor_nombre);
    if (previewClientCompanyData) {
      finalReceptorNif    = previewClientCompanyData.cif ? previewClientCompanyData.cif.toUpperCase().replace(/[^A-Z0-9]/g, '') : finalReceptorNif;
      finalReceptorNombre = previewClientCompanyData.nombre || finalReceptorNombre;
      logger.info(`[Admin Confirm] Receptor forzado a empresa cliente: ${finalReceptorNombre} (${finalReceptorNif})`);
    }

    // Proveedor (emisor) definitivo — variable explícita para poder forzar el lado
    // del user en facturas de venta sin alterar finalNif (usado en carpeta/known_cifs).
    let finalProveedorNif    = finalNif;
    let finalProveedorNombre = cleanStr(confirmed_proveedor_nombre || campos.proveedor_nombre || ocrFull.proveedor_nombre);

    // ── IDENTIDAD DEL USER = FUENTE DE VERDAD DEL REGISTRO (no del OCR) ──────────
    // El usuario está autenticado: su CIF y nombre se conocen con certeza desde su
    // registro (users.company_*). El lado propio de la factura (receptor en compra,
    // emisor en venta) NUNCA debe depender de lo que lea la IA: así se garantiza
    // que para un mismo CIF aparezca SIEMPRE el mismo nombre, el registrado.
    // El flujo admin ya fuerza su lado desde la empresa-cliente (bloque anterior),
    // por eso se excluye aquí (validationUserNif/Name ya valdrían lo mismo).
    if (!previewClientCompanyData && validationUserNif && validationUserName) {
      if (invoiceType === 'venta') {
        finalProveedorNif    = validationUserNif;
        finalProveedorNombre = validationUserName;
      } else {
        finalReceptorNif    = validationUserNif;
        finalReceptorNombre = validationUserName;
      }
      logger.info(`[User-Identity] Lado propio (${invoiceType}) fijado desde registro: ${validationUserName} (${validationUserNif})`);
    }

    // INSERT en BD — procesado_en=NOW() (procesamiento síncrono)
    const dbResult = await pool.query(
      `INSERT INTO uploads (
        user_id, filename, mimetype, size_bytes,
        proveedor_nif, proveedor_nombre, fecha_emision, total_factura,
        receptor_nif, receptor_nombre,
        numero_factura,
        base_imponible, iva_porcentaje, cuota_iva, irpf_porcentaje, cuota_irpf, moneda,
        lineas_iva,
        iva_validation_ok, iva_warnings,
        ocr_result, confidence_level, file_path,
        invoice_type, procesado_en, client_company_id, ocr_engine, preview_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),$25,$26,$27) RETURNING id`,
      [
        userInfo.userId, fileInfo.filename, fileInfo.mimetype, fileInfo.size,
        finalProveedorNif,
        finalProveedorNombre,
        normFecha,
        normTotal,
        finalReceptorNif,
        finalReceptorNombre,
        finalNumeroFactura,
        finalBaseImponible, finalIvaPorcentaje, finalCuotaIva,
        finalIrpfPorcentaje, finalCuotaIrpf,
        cleanStr(campos.moneda || ocrFull.moneda) || 'EUR',
        finalLineasIva ? JSON.stringify(finalLineasIva) : null,
        finalIvaValidation.valid,
        finalIvaValidation.warnings.length > 0 ? JSON.stringify(finalIvaValidation.warnings) : null,
        ocrResultJson, preview.confidence_level || 'medium',
        finalFilePath, invoiceType, previewClientCompanyId,
        preview.ocrData?.ocr_engine || null,
        preview_id || null,
      ]
    );
    const uploadId = dbResult.rows[0].id;

    // ── Multipágina (2026-08-13): mover las páginas 2..N junto a la página 1
    // (que el confirm ya renombró a finalFilePath) y persistir la lista en
    // uploads.paginas para que el panel admin muestre TODAS las hojas. Solo
    // para facturas multipágina; fail-safe (un error se registra, no rompe el
    // guardado ya hecho). La página 1 se guarda como finalFilePath.
    if (preview.multipagina && Array.isArray(preview.paginas) && preview.paginas.length > 1) {
      try {
        const destDir = path.dirname(finalFilePath);
        const paginasPersist = [];
        for (const pg of preview.paginas) {
          if (pg.pagina === 1) { paginasPersist.push({ pagina: 1, path: finalFilePath }); continue; }
          let dest = pg.path;
          try {
            dest = `${destDir}/${path.basename(pg.path)}`;
            if (dest !== pg.path) await fs.rename(pg.path, dest);
          } catch (mvErr) {
            logger.warn(`[Multipagina] no se pudo mover pág ${pg.pagina} (id=${uploadId}): ${mvErr.message}`);
            dest = pg.path;
          }
          paginasPersist.push({ pagina: pg.pagina, path: dest });
        }
        await pool.query('UPDATE uploads SET paginas = $1::jsonb WHERE id = $2', [JSON.stringify(paginasPersist), uploadId]);
      } catch (pgErr) {
        logger.warn(`[Multipagina] no se pudieron persistir las páginas (id=${uploadId}): ${pgErr.message}`);
      }
    }

    // ── Benchmark multi-imagen × multi-motor (2026-07-23, petición de Julio) ──
    // FIRE-AND-FORGET: nunca se espera (await) — no debe añadir latencia a la
    // respuesta real ni afectar lo que ve el usuario. Solo corre si el flag
    // está activo (coste real de hasta 15 llamadas OCR por factura, asumido
    // explícitamente por Julio para tener datos desde las primeras facturas).
    try {
      const benchCfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
      if (benchCfg.pipeline_v2_benchmark_enabled) {
        const confirmadoBench = {
          proveedor_nif: finalProveedorNif, proveedor_nombre: finalProveedorNombre,
          receptor_nif: finalReceptorNif, receptor_nombre: finalReceptorNombre,
          numero_factura: finalNumeroFactura, fecha_emision: normFecha,
          total: normTotal, base_imponible: finalBaseImponible,
          iva_porcentaje: finalIvaPorcentaje, cuota_iva: finalCuotaIva,
        };
        ejecutarBenchmarkCompleto(
          finalFilePath, fileInfo.mimetype,
          { invoice_type: invoiceType, empresa_nif: userCompanyNif },
          benchCfg, confirmadoBench, logger
        ).then((resultados) => Promise.all(resultados.map((r) => pool.query(
          `INSERT INTO ocr_benchmark_resultados
             (upload_id, variante, motor, campos, es_factura_valida, tiempo_ms, error, aciertos, comparables, detalle_campos)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb)
           ON CONFLICT (upload_id, variante, motor) DO UPDATE SET
             campos = EXCLUDED.campos, es_factura_valida = EXCLUDED.es_factura_valida,
             tiempo_ms = EXCLUDED.tiempo_ms, error = EXCLUDED.error,
             aciertos = EXCLUDED.aciertos, comparables = EXCLUDED.comparables,
             detalle_campos = EXCLUDED.detalle_campos, creado_en = NOW()`,
          [uploadId, r.variante, r.motor, JSON.stringify(r.campos), r.es_factura_valida, r.tiempo_ms, r.error, r.aciertos, r.comparables, JSON.stringify(r.detalle || {})]
        ))))
          .then(() => logger.info(`[Benchmark] Completado para upload ${uploadId}`))
          .catch((err) => logger.error('[Benchmark] Error ejecutando benchmark automático', { error: err.message, upload_id: uploadId }));
      }
    } catch (benchErr) {
      logger.error('[Benchmark] Error leyendo configuración', { error: benchErr.message });
    }

    // ── Pipeline v2 en modo SOMBRA (Fase 10, 2026-07-27) ───────────────────
    // FIRE-AND-FORGET: nunca se espera (await) — no debe añadir latencia a la
    // respuesta real ni afectar lo que ve el usuario NI el registro que ya se
    // ha confirmado (ese ya está guardado arriba, esto es puramente
    // observacional). Solo corre si ocr_extraccion_v2_shadow_mode está
    // activo — APAGADO por defecto (coste real: hasta 2 llamadas OCR extra
    // por factura, gemini_flash+azure — Julio debe activarlo explícitamente
    // cuando quiera empezar a recoger datos comparativos v1 vs v2).
    try {
      const v2Cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
      if (v2Cfg.ocr_extraccion_v2_shadow_mode) {
        ejecutarPipelineV2Sombra({
          uploadId, filePath: finalFilePath, mimeType: fileInfo.mimetype,
          context: { invoice_type: invoiceType, empresa_nif: userCompanyNif, userId: userInfo.userId },
          cfg: v2Cfg, logger, pool,
        }).then((registro) => {
          if (!registro) return;
          return pool.query(
            `INSERT INTO extracciones_v2
               (upload_id, campos_canonicos, confianzas, disputas, score_global, estado, version_pipeline, coste_estimado_usd, latencia_ms, variante, alucinaciones_sospechosas, aprendizaje_aplicado)
             VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
            [registro.upload_id, JSON.stringify(registro.campos_canonicos), JSON.stringify(registro.confianzas),
              JSON.stringify(registro.disputas), registro.score_global, registro.estado, registro.version_pipeline,
              registro.coste_estimado_usd, registro.latencia_ms, registro.variante || 'estandar',
              JSON.stringify(registro.alucinaciones_sospechosas || []),
              registro.aprendizaje_aplicado ? JSON.stringify(registro.aprendizaje_aplicado) : null]
          );
        }).catch((err) => logger.error('[PipelineV2Sombra] Error', { error: err.message, upload_id: uploadId }));
      }
    } catch (v2Err) {
      logger.error('[PipelineV2Sombra] Error leyendo configuración', { error: v2Err.message });
    }

    // Aprendizaje por usuario (privado): guarda nombre canónico confirmado y su CIF.
    // SEC-006: solo en known_cifs por usuario, no en company_catalog global.
    // La columna proveedor_nombre almacena el nombre real para corregir futuros OCR
    // que lean bien el NIF pero mal el nombre de la empresa.
    if (finalProveedorNif && finalProveedorNombre) {
      const nombreNorm = normalizeProveedorNombre(finalProveedorNombre);
      if (nombreNorm.length >= 4) {
        await pool.query(`
          INSERT INTO known_cifs (user_id, proveedor_nombre_norm, proveedor_nif, proveedor_nombre, confirmations, last_seen)
          VALUES ($1, $2, $3, $4, 1, NOW())
          ON CONFLICT (user_id, proveedor_nombre_norm) WHERE user_id IS NOT NULL
          DO UPDATE SET
            proveedor_nif    = EXCLUDED.proveedor_nif,
            proveedor_nombre = EXCLUDED.proveedor_nombre,
            confirmations    = known_cifs.confirmations + 1,
            last_seen        = NOW()
        `, [userInfo.userId, nombreNorm, finalProveedorNif, finalProveedorNombre]);
        logger.info(`[CIF] Aprendido: ${finalProveedorNombre} (${finalProveedorNif}) — usuario ${userInfo.userId}`);
      }
    }

    // Guardar relación empresa SETEX ↔ contraparte (aprendizaje corporativo por empresa-cliente)
    // Usa los valores definitivos confirmados/editados por el usuario, no los del OCR crudo.
    if (userCompanyNif) {
      try {
        const finalProvNombre = cleanStr(confirmed_proveedor_nombre || campos.proveedor_nombre || ocrFull.proveedor_nombre);
        const finalRecpNif    = cleanNifVal(confirmed_receptor_nif  || campos.receptor_nif    || ocrFull.receptor_nif);
        const finalRecpNombre = cleanStr(confirmed_receptor_nombre  || campos.receptor_nombre  || ocrFull.receptor_nombre);
        const cpConfirmed = getCounterpartyInfo(userCompanyNif, {
          proveedor_nif:    finalNif,
          proveedor_nombre: finalProvNombre,
          receptor_nif:     finalRecpNif,
          receptor_nombre:  finalRecpNombre,
        }, invoiceType);
        await saveCompanyRelationship(userCompanyNif, cpConfirmed.nif, cpConfirmed.nombre, cpConfirmed.type);
      } catch (relSaveErr) {
        logger.warn(`[Relationship] error guardando en confirm: ${relSaveErr.message}`);
      }
    }

    // Borrar preview de Redis
    await redisClient.del(`preview:${preview_id}`);

    const wasAutoConfirmed = preview.confidence_level === 'high' &&
      (confirmed_nif || '') === (preview.campos?.proveedor_nif || '') &&
      (confirmed_fecha || '') === (preview.campos?.fecha_emision || '') &&
      (confirmed_total || '') === (preview.campos?.total || '');
    auditLog('UPLOAD_SUCCESS', {
      filename: fileInfo.filename,
      ocr_time: ocrData?.processing_time_s,
      nif: finalNif,
      confidence_level: preview.confidence_level || 'medium',
      auto_confirmed: wasAutoConfirmed,
      confirmed_by_user: !wasAutoConfirmed,
    }, userInfo.userId, req.ip);
    logger.info(`Upload confirmed: ${fileInfo.filename} nif=${finalNif} confidence=${preview.confidence_level} auto=${wasAutoConfirmed}`);

    // ── Pipeline v2 shadow: registrar si el humano corrigió algo (2026-07-21) ──
    // Señal independiente de confidence_level (a diferencia de wasAutoConfirmed):
    // ¿tocó el usuario nif/fecha/total respecto a lo que mostró el preview?
    // Fire-and-forget, nunca debe afectar la respuesta de la subida real.
    if (preview_id) {
      const humanoCorrigio = (
        (confirmed_nif || '') !== (preview.campos?.proveedor_nif || '')
        || (confirmed_fecha || '') !== (preview.campos?.fecha_emision || '')
        || (confirmed_total || '') !== (preview.campos?.total || '')
      );
      pool.query(
        'UPDATE ocr_shadow_validaciones SET humano_corrigio = $1 WHERE preview_id = $2',
        [humanoCorrigio, preview_id]
      ).catch(err => logger.error('[ShadowV2] Error registrando humano_corrigio', { error: err.message }));
    }

    res.json({ success: true, message: 'Factura guardada correctamente.', invoice_type: invoiceType });
  } catch (err) {
    logger.error('Upload-confirm error:', err);
    res.status(500).json({ error: 'Error al guardar la factura' });
  }
});

// GET /api/proveedor/:nif — consulta si un CIF/NIF es un proveedor conocido del usuario
// Devuelve el nombre canónico guardado en historial. Usado por el modal de confirmación.
app.get('/api/proveedor/:nif', authenticateToken, requireActiveCompany, confirmLimiter, async (req, res) => {
  try {
    const nif = (req.params.nif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!nif || nif.length < 5) return res.json({ found: false });

    // 1º Historial del usuario (máxima prioridad — nombre confirmado por él mismo)
    const userRes = await pool.query(
      `SELECT COALESCE(kc.proveedor_nombre, cc.proveedor_nombre) AS proveedor_nombre
       FROM known_cifs kc
       LEFT JOIN company_catalog cc ON cc.proveedor_nif = kc.proveedor_nif
       WHERE kc.user_id = $1 AND kc.proveedor_nif = $2
       ORDER BY kc.confirmations DESC, kc.last_seen DESC LIMIT 1`,
      [req.user.userId, nif]
    );
    if (userRes.rows.length > 0 && userRes.rows[0].proveedor_nombre) {
      return res.json({ found: true, nombre: userRes.rows[0].proveedor_nombre });
    }

    // 2º Catálogo global (fallback)
    const catRes = await pool.query(
      'SELECT proveedor_nombre FROM company_catalog WHERE proveedor_nif = $1 LIMIT 1',
      [nif]
    );
    if (catRes.rows.length > 0) {
      return res.json({ found: true, nombre: catRes.rows[0].proveedor_nombre });
    }

    res.json({ found: false });
  } catch (err) {
    logger.error('Error en proveedor lookup:', err);
    res.json({ found: false });
  }
});

// GET /api/mis-facturas — historial de facturas del usuario (últimos 7 días, máx 50)
app.get('/api/mis-facturas', authenticateToken, requireActiveCompany, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, proveedor_nombre, proveedor_nif, receptor_nombre, receptor_nif,
              numero_factura, fecha_emision, total_factura, moneda,
              base_imponible, iva_porcentaje, cuota_iva, irpf_porcentaje, cuota_irpf,
              lineas_iva, iva_validation_ok, iva_warnings,
              confidence_level, invoice_type, uploaded_at, procesado_en
       FROM uploads
       WHERE user_id = $1 AND uploaded_at > NOW() - INTERVAL '7 days'
       ORDER BY uploaded_at DESC
       LIMIT 50`,
      [req.user.userId]
    ); // SEC-009: eliminado file_path (expone rutas internas del servidor)
    res.json({ facturas: result.rows });
  } catch (err) {
    logger.error('Error fetching mis-facturas:', err);
    res.status(500).json({ error: 'Error al obtener el historial' });
  }
});

// GET /api/facturas/:id/imagen — sirve la imagen local de una factura (solo el propietario)
app.get('/api/facturas/:id/imagen', authenticateToken, requireActiveCompany, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT file_path, filename FROM uploads WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrada' });
    const { file_path, filename } = result.rows[0];
    if (!file_path) return res.status(404).json({ error: 'Imagen no disponible localmente' });
    // Validar que el path es interno (prevenir path traversal)
    const safePath = path.resolve(file_path);
    if (!safePath.startsWith('/app/uploads/')) return res.status(403).json({ error: 'Acceso denegado' });
    // El recurso se embebe en <iframe> same-origin desde la SPA. X-Frame-Options:DENY
    // (helmet frameguard) bloquea ese embebido incluso mismo origen en navegadores
    // modernos. Sustituimos por frame-ancestors 'self' (CSP nivel 2, sucesora moderna)
    // que mantiene la protección anti-clickjacking permitiendo el render legítimo.
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(safePath);
  } catch (err) {
    logger.error('Error sirviendo imagen factura:', err);
    res.status(500).json({ error: 'Error al obtener la imagen' });
  }
});

// ── Fase 8 pipeline v2 (2026-07-27): consulta y corrección de la extracción ──
// Endpoints NUEVOS y versionados (/v2/, regla 4 del prompt de migración) —
// no modifican ni sustituyen ningún endpoint existente. Todavía sin datos
// reales: la tabla extracciones_v2 solo se rellenará cuando la Fase 10
// conecte el pipeline completo al flujo real de subida.

// GET /api/v2/facturas/:id/extraccion — resultado del pipeline v2 (solo el propietario)
app.get('/api/v2/facturas/:id/extraccion', authenticateToken, requireActiveCompany, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.upload_id, e.campos_canonicos, e.confianzas, e.disputas,
              e.score_global, e.estado, e.version_pipeline, e.coste_estimado_usd,
              e.latencia_ms, e.correccion_humana, e.creado_en, e.actualizado_en
       FROM extracciones_v2 e
       JOIN uploads u ON u.id = e.upload_id
       WHERE e.upload_id = $1 AND u.user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sin extracción v2 para esta factura' });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error obteniendo extraccion_v2:', err);
    res.status(500).json({ error: 'Error al obtener la extracción' });
  }
});

// PATCH /api/v2/facturas/:id/extraccion — corrección humana de un campo
// (guarda valor_original + valor_corregido juntos, Fase 8.4 del prompt:
// "ese par corregido/original es oro para mejorar prompts después").
app.patch('/api/v2/facturas/:id/extraccion', authenticateToken, requireActiveCompany, requireXHR, async (req, res) => {
  try {
    const { campo, valor_corregido } = req.body || {};
    if (!campo || typeof campo !== 'string' || valor_corregido === undefined) {
      return res.status(400).json({ error: 'Faltan campo/valor_corregido' });
    }
    const actual = await pool.query(
      `SELECT e.id, e.campos_canonicos, e.correccion_humana
       FROM extracciones_v2 e JOIN uploads u ON u.id = e.upload_id
       WHERE e.upload_id = $1 AND u.user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (actual.rows.length === 0) return res.status(404).json({ error: 'Sin extracción v2 para esta factura' });

    const fila = actual.rows[0];

    // ── Validación previa a aceptar la corrección (gap 1 del plan de cierre,
    // 2026-07-28): antes se guardaba cualquier valor a ciegas. Un NIF/CIF con
    // dígito de control inválido, o una corrección financiera que rompe la
    // aritmética (base×tipo≠cuota, base+cuota−irpf≠total), se rechaza con 422
    // y el motivo — igual que ya hace el árbitro internamente al fusionar.
    const validacion = validarCorreccionHumana(campo, valor_corregido, fila.campos_canonicos);
    if (!validacion.ok) {
      return res.status(422).json({ error: 'Corrección rechazada', motivo: validacion.motivo });
    }

    const valorOriginal = aplanarCanonico(fila.campos_canonicos)[campo] ?? null;
    const correcciones = fila.correccion_humana || {};
    correcciones[campo] = {
      valor_original: valorOriginal, valor_corregido, corregido_en: new Date().toISOString(), corregido_por: req.user.userId,
    };

    const updated = await pool.query(
      `UPDATE extracciones_v2 SET correccion_humana = $1::jsonb, actualizado_en = NOW() WHERE id = $2 RETURNING *`,
      [JSON.stringify(correcciones), fila.id]
    );
    auditLog('EXTRACCION_V2_CORREGIDA', { upload_id: req.params.id, campo }, req.user.userId, req.ip);
    res.json(updated.rows[0]);
  } catch (err) {
    logger.error('Error corrigiendo extraccion_v2:', err);
    res.status(500).json({ error: 'Error al guardar la corrección' });
  }
});

// GET /api/admin/facturas/:id/imagen — sirve la imagen de cualquier factura (solo admin)
app.get('/api/admin/facturas/:id/imagen', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT file_path, filename FROM uploads WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrada' });
    const { file_path, filename } = result.rows[0];
    if (!file_path) return res.status(404).json({ error: 'Imagen no disponible localmente' });
    const safePath = path.resolve(file_path);
    if (!safePath.startsWith('/app/uploads/')) return res.status(403).json({ error: 'Acceso denegado' });
    // Misma corrección que el endpoint usuario: permitir embebido same-origin del PDF
    // en <iframe> del panel admin sin abrir clickjacking (frame-ancestors 'self').
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(safePath);
  } catch (err) {
    logger.error('Error sirviendo imagen admin:', err);
    res.status(500).json({ error: 'Error al obtener la imagen' });
  }
});

// GET /api/admin/facturas/:id/paginas — lista de páginas de una factura multipágina
// (2026-08-13). Devuelve [{pagina}] (sin exponer rutas de disco). Vacío si es de
// una sola página. El panel admin lo usa para pintar el visor multipágina.
app.get('/api/admin/facturas/:id/paginas', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT paginas FROM uploads WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrada' });
    const paginas = Array.isArray(result.rows[0].paginas) ? result.rows[0].paginas : [];
    res.json({ paginas: paginas.map((p) => ({ pagina: p.pagina })).sort((a, b) => a.pagina - b.pagina) });
  } catch (err) {
    logger.error('Error listando páginas admin:', err);
    res.status(500).json({ error: 'Error al obtener las páginas' });
  }
});

// GET /api/admin/facturas/:id/pagina/:n — sirve la imagen de la página N de una
// factura multipágina (2026-08-13). Mismas defensas que /imagen: ruta validada
// dentro de /app/uploads, headers de embebido same-origin.
app.get('/api/admin/facturas/:id/pagina/:n', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const n = parseInt(req.params.n, 10);
    if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: 'Página inválida' });
    const result = await pool.query('SELECT paginas FROM uploads WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrada' });
    const paginas = Array.isArray(result.rows[0].paginas) ? result.rows[0].paginas : [];
    const pg = paginas.find((p) => p.pagina === n);
    if (!pg || !pg.path) return res.status(404).json({ error: 'Página no disponible' });
    const safePath = path.resolve(pg.path);
    if (!safePath.startsWith('/app/uploads/')) return res.status(403).json({ error: 'Acceso denegado' });
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(safePath);
  } catch (err) {
    logger.error('Error sirviendo página admin:', err);
    res.status(500).json({ error: 'Error al obtener la página' });
  }
});

// ── Herramienta TEMPORAL de verificación del dataset de verdad (2026-07-28) ──
// Solo tech_admin. Sirve para que Julio compare eval/facturas/{id}/documento.*
// contra su ground_truth.json y marque verificado:true campo a campo desde
// el panel, en vez de editar JSON a mano. Se borrará junto con eval/facturas/
// al terminar la verificación — no es una feature permanente del producto.
const EVAL_FACTURAS_DIR = '/app/eval/facturas';

app.get('/api/admin/eval-facturas', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    const ids = fsSync.readdirSync(EVAL_FACTURAS_DIR).filter((d) => d !== 'sintetica-ejemplo');
    const facturas = ids.map((id) => {
      const dir = path.join(EVAL_FACTURAS_DIR, id);
      const ground_truth = JSON.parse(fsSync.readFileSync(path.join(dir, 'ground_truth.json'), 'utf8'));
      const documento = fsSync.readdirSync(dir).find((f) => f.startsWith('documento.'));
      return { id, ground_truth, documento };
    }).sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
    res.json({ facturas });
  } catch (err) {
    logger.error('[EvalFacturas] Error listando dataset:', err);
    res.status(500).json({ error: 'Error al listar el dataset' });
  }
});

app.get('/api/admin/eval-facturas/:id/documento', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    const id = req.params.id.replace(/[^0-9]/g, '');
    const dir = path.join(EVAL_FACTURAS_DIR, id);
    const documento = fsSync.existsSync(dir) ? fsSync.readdirSync(dir).find((f) => f.startsWith('documento.')) : null;
    if (!documento) return res.status(404).json({ error: 'Documento no encontrado' });
    const safePath = path.resolve(path.join(dir, documento));
    if (!safePath.startsWith(path.resolve(EVAL_FACTURAS_DIR) + path.sep)) return res.status(403).json({ error: 'Acceso denegado' });
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(safePath);
  } catch (err) {
    logger.error('[EvalFacturas] Error sirviendo documento:', err);
    res.status(500).json({ error: 'Error al obtener el documento' });
  }
});

app.put('/api/admin/eval-facturas/:id/ground-truth', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    const id = req.params.id.replace(/[^0-9]/g, '');
    const rutaGT = path.join(EVAL_FACTURAS_DIR, id, 'ground_truth.json');
    if (!fsSync.existsSync(rutaGT)) return res.status(404).json({ error: 'Factura no encontrada en el dataset' });
    const { campos } = req.body || {};
    if (!campos || typeof campos !== 'object') return res.status(400).json({ error: 'Falta "campos"' });
    const gt = JSON.parse(fsSync.readFileSync(rutaGT, 'utf8'));
    gt.campos = campos;
    fsSync.writeFileSync(rutaGT, JSON.stringify(gt, null, 2));
    auditLog('EVAL_GROUND_TRUTH_VERIFICADO', { factura_id: id }, req.user.userId, req.ip);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[EvalFacturas] Error guardando ground truth:', err);
    res.status(500).json({ error: 'Error al guardar' });
  }
});

// GET /api/admin/facturas/:id/imagen-variante — sirve la variante de contraste
// (bloque 5, 2026-07-22), solo tech_admin. No existe para facturas procesadas
// sin el flag pipeline_v2_imagen_variante_enabled activo.
app.get('/api/admin/facturas/:id/imagen-variante', authenticateToken, requireAdmin, async (req, res) => {
  // Sin esto, un 404 (variante aún no generada) puede quedar cacheado por el
  // navegador para esta URL exacta (sin cache-buster, a diferencia de los
  // bundles JS) y seguir mostrándose aunque la variante ya esté disponible.
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    const result = await pool.query(
      `SELECT v.ruta_variante
         FROM uploads u
         JOIN ocr_imagen_variante_comparativa v ON v.preview_id = u.preview_id
        WHERE u.id = $1
        ORDER BY v.creado_en DESC LIMIT 1`,
      [req.params.id]
    );
    if (result.rows.length === 0 || !result.rows[0].ruta_variante) {
      return res.status(404).json({ error: 'Variante no disponible para esta factura' });
    }
    const safePath = path.resolve(result.rows[0].ruta_variante);
    if (!safePath.startsWith('/app/uploads/')) return res.status(403).json({ error: 'Acceso denegado' });
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(safePath);
  } catch (err) {
    logger.error('Error sirviendo imagen variante:', err);
    res.status(500).json({ error: 'Error al obtener la imagen variante' });
  }
});

// GET /api/admin/facturas/:id/ocr-detail — datos OCR raw vs confirmados (solo tech_admin).
// Permite comparar lo que leyó la IA vs lo que confirmó el humano.
app.get('/api/admin/facturas/:id/ocr-detail', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const result = await pool.query(`
      SELECT
        id, proveedor_nif, proveedor_nombre, receptor_nif, receptor_nombre,
        numero_factura, fecha_emision, total_factura, base_imponible,
        iva_porcentaje, cuota_iva, irpf_porcentaje, cuota_irpf, lineas_iva,
        ocr_result, confidence_level, iva_validation_ok, iva_warnings, ocr_engine,
        preview_id
      FROM uploads WHERE id = $1
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Factura no encontrada' });

    const row = result.rows[0];
    const ocr = row.ocr_result || {};

    // Bloque 5 (2026-07-22): comparativa original vs variante de contraste,
    // si se generó para esta factura (flag pipeline_v2_imagen_variante_enabled).
    let imagenVariante = null;
    if (row.preview_id) {
      const varRes = await pool.query(
        `SELECT motor, campos_variante, diffs, creado_en
           FROM ocr_imagen_variante_comparativa
          WHERE preview_id = $1
          ORDER BY creado_en DESC LIMIT 1`,
        [row.preview_id]
      );
      if (varRes.rows.length > 0) {
        imagenVariante = {
          motor: varRes.rows[0].motor,
          campos_variante: varRes.rows[0].campos_variante,
          diffs: varRes.rows[0].diffs,
          creado_en: varRes.rows[0].creado_en,
        };
      }
    }

    // 2026-07-22: ranking multi-motor — construir dinámicamente TODOS los
    // motores que de verdad participaron en esta factura (antes hardcodeado
    // a openai/azure/gemini_flash, y `gemini_flash` como clave de nivel
    // superior nunca existió en ocrResultJson: era una lectura muerta desde
    // que se activó el modo gemini_azure). Cada entrada expone `engine` con
    // el nombre real del motor (labelA/labelB, ver fix 2026-07-13), no la
    // clave interna `openai`/`azure` que es solo el nombre del slot.
    const motors = {};
    if (ocr.openai) motors.openai = ocr.openai;
    if (ocr.azure)  motors.azure  = ocr.azure;
    for (const extra of (ocr.extra_results || [])) {
      if (extra && extra.name) motors[extra.name] = extra;
    }

    res.json({
      confirmed: {
        proveedor_nif:    row.proveedor_nif,
        proveedor_nombre: row.proveedor_nombre,
        receptor_nif:     row.receptor_nif,
        receptor_nombre:  row.receptor_nombre,
        numero_factura:   row.numero_factura,
        fecha_emision:    row.fecha_emision,
        total_factura:    row.total_factura,
        base_imponible:   row.base_imponible,
        iva_porcentaje:   row.iva_porcentaje,
        cuota_iva:        row.cuota_iva,
        irpf_porcentaje:  row.irpf_porcentaje,
        cuota_irpf:       row.cuota_irpf,
        lineas_iva:       row.lineas_iva,
      },
      // TRES COLUMNAS HONESTAS (2026-07-29):
      //   ia_pura  = lo que leyeron los motores (fusion + recalculos del
      //              orquestador), ANTES de tocar la BD. Null en facturas
      //              anteriores a este cambio: no se guardaba.
      //   ocr_raw  = lo que decidio el SISTEMA (ia_pura + sobrescrituras desde
      //              known_cifs/company_catalog/relaciones/registro del usuario).
      //              Se mantiene el nombre de clave por compatibilidad.
      //   confirmed= lo que hay hoy en uploads (incluye ediciones del humano).
      // `overrides_bd` explica campo a campo la diferencia entre las dos primeras.
      ia_pura: ocr.ia_pura || null,
      overrides_bd: ocr.overrides_bd || [],
      ocr_raw: ocr.merged || null,
      motors,
      // campo_sources describe ia_pura (se calcula en ocr/index.js justo tras la
      // fusion, antes de las sobrescrituras). Se etiqueta explicitamente para
      // que el frontend lo pinte junto a la columna correcta y deje de parecer
      // desfasado respecto a la columna del sistema.
      campo_sources: ocr.campo_sources || null,
      campo_sources_describe: 'ia_pura',
      meta: {
        dual_confirmed:    ocr.dual_confirmed   ?? null,
        confidence_level:  row.confidence_level || ocr.confidence_level || null,
        iva_validation_ok: row.iva_validation_ok ?? null,
        iva_warnings:      row.iva_warnings      || [],
        ocr_engine:        row.ocr_engine || ocr.ocr_engine || null,
        nif_status:        ocr.nif_status || null,
        nif_discrepancy:   ocr.nif_discrepancy || null,
      },
      validacion_determinista: ocr.validacion_determinista || null,
      imagen_variante: imagenVariante,
    });
  } catch (err) {
    logger.error('[ocr-detail] Error:', err.message);
    res.status(500).json({ error: 'Error al obtener detalle OCR' });
  }
});

// GET /api/admin/facturas/shadow-comparativa — pipeline v2 (solo tech_admin).
// Una fila por factura procesada en modo shadow: decisión v1 (real) vs v2
// (nueva, determinista) vs si el humano tuvo que corregir algo al confirmar.
// 2026-07-21: pensado para volumen bajo — cada factura es revisable a mano,
// no hace falta esperar a acumular cientos para sacar conclusiones.
app.get('/api/admin/facturas/shadow-comparativa', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    const result = await pool.query(
      `SELECT id, preview_id, upload_id, proveedor_nombre, proveedor_nif,
              total_factura, fecha_emision, decision_v1, decision_v2, coincide,
              humano_corrigio, incidencias, sugerencias, creado_en
       FROM ocr_shadow_comparativa
       ORDER BY creado_en DESC
       LIMIT 500`
    );
    res.json({ rows: result.rows });
  } catch (err) {
    logger.error('[shadow-comparativa] Error:', err.message);
    res.status(500).json({ error: 'Error al obtener la comparativa del pipeline v2' });
  }
});

// ─── Benchmark multi-imagen × multi-motor (2026-07-23, solo tech_admin) ─────
// 3 variantes de la foto (actual/original/contraste) × todos los motores OCR.
// Coste real asumido explícitamente por Julio — nunca afecta al pipeline real.

/** GET /api/admin/benchmark-flag — estado del flag pipeline_v2_benchmark_enabled */
app.get('/api/admin/benchmark-flag', authenticateToken, requireAdmin, (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
    res.json({ enabled: cfg.pipeline_v2_benchmark_enabled === true });
  } catch (err) {
    logger.error('Error leyendo features.json', { error: err.message });
    res.status(500).json({ error: 'Error leyendo configuración' });
  }
});

/** POST /api/admin/benchmark-flag — activa/desactiva el benchmark automático en facturas nuevas */
app.post('/api/admin/benchmark-flag', authenticateToken, requireAdmin, requireXHR, (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled debe ser booleano' });
    const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
    cfg.pipeline_v2_benchmark_enabled = enabled;
    fsSync.writeFileSync(FEATURES_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    auditLog('BENCHMARK_FLAG_CHANGED', { enabled }, req.user.userId, req.ip);
    logger.info(`[Benchmark] Flag cambiado a ${enabled} por ${req.user.email}`);
    res.json({ success: true, enabled });
  } catch (err) {
    logger.error('Error escribiendo features.json', { error: err.message });
    res.status(500).json({ error: 'Error guardando configuración' });
  }
});

// 2026-07-23: bloqueo de lote concurrente. Julio disparó el botón dos veces
// (probablemente doble clic sin que hubiera ninguna señal de progreso en el
// panel) y ambas ejecuciones corrieron en paralelo sobre las mismas
// facturas — duplicó el gasto real en OCR sin ningún beneficio. Este
// candado en memoria del proceso rechaza un segundo lote mientras el
// primero siga en marcha.
let benchmarkLoteEnCurso = null; // null | { total, completadas, iniciadoEn }

/** POST /api/admin/facturas/benchmark/ultimas — dispara el benchmark retroactivo
 * sobre las últimas N facturas ya registradas (por defecto 10, tope de seguridad 30).
 * Responde de inmediato ("iniciado") y procesa en segundo plano, una factura
 * detrás de otra (no las 10 a la vez), para no saturar las APIs externas con
 * ~150 llamadas simultáneas. */
app.post('/api/admin/facturas/benchmark/ultimas', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    if (benchmarkLoteEnCurso) {
      return res.status(409).json({
        error: `Ya hay un lote en curso (${benchmarkLoteEnCurso.completadas}/${benchmarkLoteEnCurso.total} facturas) — espera a que termine antes de lanzar otro.`,
      });
    }
    const limit = Math.min(parseInt(req.body?.limit, 10) || 10, 30);
    const result = await pool.query(
      `SELECT id, file_path, mimetype, invoice_type,
              proveedor_nif, proveedor_nombre, receptor_nif, receptor_nombre,
              numero_factura, fecha_emision, total_factura, base_imponible,
              iva_porcentaje, cuota_iva
       FROM uploads
       WHERE file_path IS NOT NULL
       ORDER BY uploaded_at DESC
       LIMIT $1`,
      [limit]
    );
    const facturas = result.rows;
    benchmarkLoteEnCurso = { total: facturas.length, completadas: 0, iniciadoEn: new Date().toISOString() };
    res.json({ success: true, iniciado: true, facturas: facturas.length });

    (async () => {
      const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
      for (const f of facturas) {
        try {
          const safePath = path.resolve(f.file_path);
          if (!safePath.startsWith('/app/uploads/')) {
            logger.warn(`[Benchmark] upload ${f.id} descartado: file_path fuera de /app/uploads/`);
            continue;
          }
          await fs.access(safePath); // el fichero debe seguir existiendo en disco
          const confirmado = {
            proveedor_nif: f.proveedor_nif, proveedor_nombre: f.proveedor_nombre,
            receptor_nif: f.receptor_nif, receptor_nombre: f.receptor_nombre,
            numero_factura: f.numero_factura, fecha_emision: f.fecha_emision,
            total: f.total_factura, base_imponible: f.base_imponible,
            iva_porcentaje: f.iva_porcentaje, cuota_iva: f.cuota_iva,
          };
          const resultados = await ejecutarBenchmarkCompleto(
            safePath, f.mimetype, { invoice_type: f.invoice_type }, cfg, confirmado, logger
          );
          for (const r of resultados) {
            await pool.query(
              `INSERT INTO ocr_benchmark_resultados
                 (upload_id, variante, motor, campos, es_factura_valida, tiempo_ms, error, aciertos, comparables, detalle_campos)
               VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb)
               ON CONFLICT (upload_id, variante, motor) DO UPDATE SET
                 campos = EXCLUDED.campos, es_factura_valida = EXCLUDED.es_factura_valida,
                 tiempo_ms = EXCLUDED.tiempo_ms, error = EXCLUDED.error,
                 aciertos = EXCLUDED.aciertos, comparables = EXCLUDED.comparables,
                 detalle_campos = EXCLUDED.detalle_campos, creado_en = NOW()`,
              [f.id, r.variante, r.motor, JSON.stringify(r.campos), r.es_factura_valida, r.tiempo_ms, r.error, r.aciertos, r.comparables, JSON.stringify(r.detalle || {})]
            );
          }
          logger.info(`[Benchmark] Retroactivo completado para upload ${f.id}`);
        } catch (errFactura) {
          logger.error(`[Benchmark] Error retroactivo en upload ${f.id}`, { error: errFactura.message });
        } finally {
          if (benchmarkLoteEnCurso) benchmarkLoteEnCurso.completadas++;
        }
      }
      logger.info(`[Benchmark] Lote retroactivo de ${facturas.length} facturas terminado`);
      benchmarkLoteEnCurso = null;
    })().catch((err) => {
      logger.error('[Benchmark] Error en lote retroactivo', { error: err.message });
      benchmarkLoteEnCurso = null;
    });
  } catch (err) {
    logger.error('[Benchmark] Error iniciando lote retroactivo:', err.message);
    res.status(500).json({ error: 'Error al iniciar el benchmark retroactivo' });
  }
});

/** GET /api/admin/facturas/benchmark/estado — progreso del lote retroactivo en curso */
app.get('/api/admin/facturas/benchmark/estado', authenticateToken, requireAdmin, (req, res) => {
  if (!isTechAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
  }
  res.json({ enCurso: !!benchmarkLoteEnCurso, ...(benchmarkLoteEnCurso || { total: 0, completadas: 0 }) });
});

/** GET /api/admin/facturas/benchmark — resultados del benchmark para el panel */
app.get('/api/admin/facturas/benchmark', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    const result = await pool.query(
      `SELECT b.upload_id, u.proveedor_nombre, u.total_factura, u.fecha_emision, u.uploaded_at,
              b.variante, b.motor, b.campos, b.es_factura_valida, b.tiempo_ms, b.error,
              b.aciertos, b.comparables, b.detalle_campos, b.creado_en
       FROM ocr_benchmark_resultados b
       JOIN uploads u ON u.id = b.upload_id
       ORDER BY u.uploaded_at DESC, b.upload_id DESC, b.variante, b.motor
       LIMIT 1000`
    );
    res.json({ rows: result.rows });
  } catch (err) {
    logger.error('[benchmark] Error:', err.message);
    res.status(500).json({ error: 'Error al obtener resultados del benchmark' });
  }
});

/** GET /api/admin/facturas/benchmark/ranking — ranking profesional agregado
 * (2026-07-24, petición de Julio: "un único análisis fino, con todos los
 * valores, incluso saber si uno falla más en unos campos u otros"). Agrega
 * TODO lo ya almacenado en ocr_benchmark_resultados (sin volver a llamar a
 * ninguna IA): % de acierto global y desglose por campo/grupo (CIF, nombre,
 * fecha, importes, tramos IVA) para cada combinación motor×variante. */
app.get('/api/admin/facturas/benchmark/ranking', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    const result = await pool.query(
      `SELECT motor, variante, aciertos, comparables, detalle_campos, tiempo_ms, error
       FROM ocr_benchmark_resultados`
    );

    const claveCombo = (motor, variante) => `${motor}__${variante}`;
    const combos = {};
    for (const row of result.rows) {
      const key = claveCombo(row.motor, row.variante);
      if (!combos[key]) {
        combos[key] = {
          motor: row.motor, variante: row.variante,
          ejecuciones: 0, errores: 0, tiempoTotalMs: 0, tiempoMuestras: 0,
          aciertos: 0, comparables: 0,
          grupos: {}, // grupo -> { aciertos, comparables }
        };
      }
      const c = combos[key];
      c.ejecuciones++;
      if (row.error) c.errores++;
      if (row.tiempo_ms != null) { c.tiempoTotalMs += row.tiempo_ms; c.tiempoMuestras++; }
      c.aciertos += row.aciertos || 0;
      c.comparables += row.comparables || 0;
      const detalle = row.detalle_campos || {};
      for (const [campo, acierto] of Object.entries(detalle)) {
        const grupo = GRUPOS_CAMPOS[campo] || campo;
        if (!c.grupos[grupo]) c.grupos[grupo] = { aciertos: 0, comparables: 0 };
        c.grupos[grupo].comparables++;
        if (acierto) c.grupos[grupo].aciertos++;
      }
    }

    const ranking = Object.values(combos).map((c) => ({
      motor: c.motor,
      variante: c.variante,
      ejecuciones: c.ejecuciones,
      errores: c.errores,
      tiempo_medio_s: c.tiempoMuestras ? +(c.tiempoTotalMs / c.tiempoMuestras / 1000).toFixed(2) : null,
      ratio_global: c.comparables ? +((c.aciertos / c.comparables) * 100).toFixed(1) : null,
      aciertos: c.aciertos,
      comparables: c.comparables,
      por_grupo: Object.entries(c.grupos).map(([grupo, g]) => ({
        grupo,
        ratio: g.comparables ? +((g.aciertos / g.comparables) * 100).toFixed(1) : null,
        aciertos: g.aciertos,
        comparables: g.comparables,
      })).sort((a, b) => a.grupo.localeCompare(b.grupo)),
    })).sort((a, b) => (b.ratio_global ?? -1) - (a.ratio_global ?? -1));

    res.json({ ranking, total_filas: result.rows.length });
  } catch (err) {
    logger.error('[benchmark-ranking] Error:', err.message);
    res.status(500).json({ error: 'Error al calcular el ranking del benchmark' });
  }
});

/** GET /api/v2/metricas — Fase 9 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md:
 * "% auto-aprobadas, % revisión, % ilegibles, precisión sobre el dataset
 * dorado, coste medio por factura". Agrega extracciones_v2 (Fase 8) — sin
 * datos reales todavía (nada escribe ahí hasta la Fase 10), responde con
 * ceros/null de forma explícita en vez de fallar. Solo tech_admin, mismo
 * patrón que el benchmark. */
app.get('/api/v2/metricas', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isTechAdmin(req.user.email)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores técnicos.' });
    }
    const result = await pool.query(
      `SELECT estado, COUNT(*) AS total, AVG(score_global) AS score_medio,
              AVG(coste_estimado_usd) AS coste_medio_usd, AVG(latencia_ms) AS latencia_media_ms
       FROM extracciones_v2
       GROUP BY estado`
    );
    const totalRes = await pool.query('SELECT COUNT(*) AS total FROM extracciones_v2');
    const total = parseInt(totalRes.rows[0].total, 10);

    const porEstado = { auto_aprobada: 0, pendiente_revision: 0, ilegible: 0 };
    let costeMedioUsd = null, latenciaMediaMs = null;
    for (const fila of result.rows) {
      porEstado[fila.estado] = parseInt(fila.total, 10);
      if (fila.coste_medio_usd != null) costeMedioUsd = parseFloat(fila.coste_medio_usd);
      if (fila.latencia_media_ms != null) latenciaMediaMs = parseFloat(fila.latencia_media_ms);
    }

    res.json({
      total_facturas_v2: total,
      porcentaje_auto_aprobada: total > 0 ? +((porEstado.auto_aprobada / total) * 100).toFixed(1) : null,
      porcentaje_pendiente_revision: total > 0 ? +((porEstado.pendiente_revision / total) * 100).toFixed(1) : null,
      porcentaje_ilegible: total > 0 ? +((porEstado.ilegible / total) * 100).toFixed(1) : null,
      coste_medio_usd: costeMedioUsd,
      latencia_media_ms: latenciaMediaMs,
      nota: total === 0 ? 'Sin datos todavía — el pipeline v2 no está conectado al flujo real (pendiente Fase 10).' : null,
    });
  } catch (err) {
    logger.error('[metricas-v2] Error:', err.message);
    res.status(500).json({ error: 'Error al calcular las métricas del pipeline v2' });
  }
});

// GET /api/mis-facturas/export.xlsx — exportar todas las facturas del usuario como Excel
app.get('/api/mis-facturas/export.xlsx', authenticateToken, requireActiveCompany, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, proveedor_nombre, proveedor_nif, receptor_nombre, receptor_nif,
              fecha_emision, base_imponible, iva_porcentaje, cuota_iva,
              irpf_porcentaje, cuota_irpf, total_factura, moneda,
              confidence_level, uploaded_at, procesado_en
       FROM uploads WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 10000`,
      [req.user.userId]
    );

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SETEX Captura de Facturas';
    wb.created = new Date();
    const ws = wb.addWorksheet('Facturas');

    ws.columns = [
      { header: 'ID',            key: 'id',               width: 8  },
      { header: 'Proveedor',     key: 'proveedor_nombre', width: 30 },
      { header: 'CIF Proveedor', key: 'proveedor_nif',    width: 16 },
      { header: 'Receptor',      key: 'receptor_nombre',  width: 30 },
      { header: 'CIF Receptor',  key: 'receptor_nif',     width: 16 },
      { header: 'Fecha',         key: 'fecha_emision',    width: 14 },
      { header: 'Base Imponible',key: 'base_imponible',   width: 16 },
      { header: 'IVA %',         key: 'iva_porcentaje',   width: 10 },
      { header: 'Cuota IVA',     key: 'cuota_iva',        width: 13 },
      { header: 'IRPF %',        key: 'irpf_porcentaje',  width: 10 },
      { header: 'Cuota IRPF',    key: 'cuota_irpf',       width: 13 },
      { header: 'Total (€)',     key: 'total_factura',    width: 14 },
      { header: 'Moneda',        key: 'moneda',            width: 10 },
      { header: 'Confianza',     key: 'confidence_level', width: 12 },
      { header: 'Subido el',     key: 'uploaded_at',      width: 20 },
      { header: 'Procesado en',  key: 'procesado_en',     width: 20 },
    ];

    // Cabecera en negrita con fondo verde corporativo
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A4F' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 20;
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const numFmt = '#,##0.00';
    for (const r of result.rows) {
      ws.addRow({
        id:               r.id,
        proveedor_nombre: r.proveedor_nombre || '',
        proveedor_nif:    r.proveedor_nif    || '',
        receptor_nombre:  r.receptor_nombre  || '',
        receptor_nif:     r.receptor_nif     || '',
        fecha_emision:    r.fecha_emision    || '',
        base_imponible:   normalizeToFloat(r.base_imponible)  ?? '',
        iva_porcentaje:   normalizeToFloat(r.iva_porcentaje)  ?? '',
        cuota_iva:        normalizeToFloat(r.cuota_iva)       ?? '',
        irpf_porcentaje:  normalizeToFloat(r.irpf_porcentaje) ?? '',
        cuota_irpf:       normalizeToFloat(r.cuota_irpf)      ?? '',
        total_factura:    normalizeToFloat(r.total_factura)   ?? '',
        moneda:           r.moneda            || 'EUR',
        confidence_level: r.confidence_level  || '',
        uploaded_at:      r.uploaded_at ? new Date(r.uploaded_at).toLocaleString('es-ES') : '',
        procesado_en:     r.procesado_en ? new Date(r.procesado_en).toLocaleString('es-ES') : '',
      });
    }

    // Formato numérico en columnas monetarias/porcentaje
    const numCols = ['base_imponible','iva_porcentaje','cuota_iva','irpf_porcentaje','cuota_irpf','total_factura'];
    numCols.forEach(key => {
      const col = ws.getColumn(key);
      col.eachCell({ includeEmpty: false }, (cell, rowNum) => {
        if (rowNum > 1 && typeof cell.value === 'number') cell.numFmt = numFmt;
      });
    });

    const filename = `facturas_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error('Export XLSX error:', err);
    res.status(500).json({ error: 'Error al exportar' });
  }
});

// GET /api/me/settings — obtener preferencias del usuario
app.get('/api/me/settings', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT auto_confirm_enabled, company_nif, company_name, is_admin FROM users WHERE id = $1', [req.user.userId]);
    const cif = r.rows[0]?.company_nif || null;
    // Warning AEAT (no rechazo) — true sólo si es CIF con dígito de control inválido.
    // checkDigitCIF retorna null para NIF/NIE → no aplica.
    const company_nif_aeat_warning = cif ? checkDigitCIF(cif) === false : false;
    res.json({
      auto_confirm_enabled: r.rows[0]?.auto_confirm_enabled !== false,
      company_nif: cif,
      company_name: r.rows[0]?.company_name || null,
      company_nif_aeat_warning,
      is_admin: r.rows[0]?.is_admin === true,
      // 2026-07-27: expone is_tech_admin también a la app de usuario normal
      // (antes solo viajaba en /api/auth/login y solo si is_admin=true) —
      // necesario para el botón de prueba de captura (solo tech-admin, ver
      // /api/test-captura). isTechAdmin() lee tech_admin_emails de
      // features.json — no es un dato de la tabla users.
      is_tech_admin: isTechAdmin(req.user.email),
    });
  } catch (err) {
    logger.error('Get settings error:', err);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// GET /api/client-companies — lista de empresas cliente para el selector de admins
app.get('/api/client-companies', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, cif, codigo_cliente FROM client_companies
       WHERE activa = true AND pendiente = false AND is_test IS NOT TRUE
       ORDER BY nombre ASC`
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get client-companies error:', err);
    res.status(500).json({ error: 'Error al obtener empresas cliente' });
  }
});

// GET /api/me/profile — obtener perfil completo del usuario
app.get('/api/me/profile', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, email, company_name, company_nif, auto_confirm_enabled, created_at FROM users WHERE id = $1', [req.user.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const profile = r.rows[0];
    profile.company_nif_aeat_warning = profile.company_nif ? checkDigitCIF(profile.company_nif) === false : false;
    res.json({ profile });
  } catch (err) {
    logger.error('Get profile error:', err);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

// ─── RGPD / Derechos ARCO-POL ──────────────────────────────────────────────────
// GET /api/me/export — Derecho de acceso y portabilidad (RGPD art. 15 + 20).
// Devuelve TODOS los datos personales del usuario en JSON portable.
app.get('/api/me/export', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userResult = await pool.query(
      'SELECT id, email, company_name, company_nif, is_admin, auto_confirm_enabled, created_at FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    const uploadsResult = await pool.query(
      'SELECT * FROM uploads WHERE user_id = $1 ORDER BY uploaded_at DESC',
      [userId]
    );
    const auditResult = await pool.query(
      'SELECT action, details, ip_address, created_at FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000',
      [userId]
    );

    auditLog('USER_DATA_EXPORTED', { rows_uploads: uploadsResult.rowCount, rows_audit: auditResult.rowCount }, userId, req.ip);

    res.setHeader('Content-Disposition', `attachment; filename="setex-export-user-${userId}-${Date.now()}.json"`);
    res.json({
      export_date: new Date().toISOString(),
      legal_basis: 'RGPD art. 15 (derecho de acceso) + art. 20 (portabilidad)',
      user: userResult.rows[0],
      uploads: uploadsResult.rows,
      audit_log_last_1000: auditResult.rows,
      contact_for_questions: 'juliohesuni@gmail.com',
    });
  } catch (err) {
    logger.error('Export user data error:', err);
    res.status(500).json({ error: 'Error al exportar datos del usuario' });
  }
});

// DELETE /api/me/account — Derecho al olvido (RGPD art. 17).
// Borrado en cascada: uploads + audit_logs + user. Requiere confirmación textual.
app.delete('/api/me/account', authenticateToken, async (req, res) => {
  const { confirmation } = req.body || {};
  if (confirmation !== 'BORRAR_MI_CUENTA_DEFINITIVAMENTE') {
    return res.status(400).json({
      error: 'Para confirmar el borrado, envía en el body: { "confirmation": "BORRAR_MI_CUENTA_DEFINITIVAMENTE" }',
      legal_warning: 'Esta acción ES IRREVERSIBLE y elimina todos tus datos y facturas. Considera primero exportarlos con GET /api/me/export.',
    });
  }
  const userId = req.user.userId;
  const userEmail = req.user.email;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uploadsDeleted = await client.query('DELETE FROM uploads WHERE user_id = $1 RETURNING id', [userId]);
    const auditDeleted = await client.query('DELETE FROM audit_logs WHERE user_id = $1 RETURNING id', [userId]);
    const userDeleted = await client.query('DELETE FROM users WHERE id = $1 RETURNING id, email', [userId]);
    await client.query('COMMIT');

    // Audit final con userId=null (el usuario ya no existe pero queremos huella)
    auditLog('USER_ACCOUNT_DELETED_RGPD', {
      deleted_user_id: userId,
      deleted_email: userEmail,
      uploads_deleted: uploadsDeleted.rowCount,
      audit_logs_deleted: auditDeleted.rowCount,
    }, null, req.ip);

    logger.warn(`[RGPD] Cuenta borrada: user_id=${userId} email=${userEmail} uploads=${uploadsDeleted.rowCount}`);
    res.json({
      success: true,
      message: 'Tu cuenta y todos tus datos han sido eliminados de forma permanente.',
      deleted_user_id: userId,
      uploads_deleted: uploadsDeleted.rowCount,
      audit_logs_deleted: auditDeleted.rowCount,
      legal_basis: 'RGPD art. 17 (derecho de supresión)',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Delete account error:', err);
    res.status(500).json({ error: 'Error al borrar la cuenta' });
  } finally {
    client.release();
  }
});

// PUT /api/me/profile — actualizar perfil del usuario (company_nif, company_name)
app.put('/api/me/profile', authenticateToken, async (req, res) => {
  const { company_nif, company_name } = req.body || {};
  const updates = {};
  if (company_nif !== undefined) {
    if (company_nif === null || company_nif === '') {
      updates.company_nif = null;
    } else {
      const cleanNif = String(company_nif).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cifCheck = validateSpanishTaxId(cleanNif);
      if (!cifCheck.valid) return res.status(400).json({ error: `CIF/NIF inválido: ${cifCheck.reason}` });
      updates.company_nif = cleanNif;
    }
  }
  if (company_name !== undefined) {
    updates.company_name = company_name ? String(company_name).trim().substring(0, 255) : null;
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

  try {
    const setClauses = Object.keys(updates).map((f, i) => `${f} = $${i + 1}`);
    const values = [...Object.values(updates), req.user.userId];
    await pool.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = $${values.length}`, values);
    auditLog('PROFILE_UPDATED', { fields: Object.keys(updates) }, req.user.userId, req.ip);
    res.json({ success: true, ...updates });
  } catch (err) {
    logger.error('Update profile error:', err);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// POST /api/me/settings — actualizar preferencias del usuario
app.post('/api/me/settings', authenticateToken, async (req, res) => {
  const { auto_confirm } = req.body || {};
  if (typeof auto_confirm !== 'boolean') {
    return res.status(400).json({ error: 'auto_confirm debe ser true o false' });
  }
  try {
    await pool.query('UPDATE users SET auto_confirm_enabled = $1 WHERE id = $2', [auto_confirm, req.user.userId]);
    auditLog('SETTINGS_UPDATED', { auto_confirm_enabled: auto_confirm }, req.user.userId, req.ip);
    res.json({ success: true, auto_confirm_enabled: auto_confirm });
  } catch (err) {
    logger.error('Update settings error:', err);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

// POST /api/admin/retry-failed/:id — marcar job fallido como revisado (solo admin)
// Nota: el procesamiento async (Drive/Sheets) fue eliminado. Esta tabla conserva historial.
app.post('/api/admin/retry-failed/:id', authenticateToken, requireAdmin, requireXHR, async (req, res) => { // SEC-008: añadido requireXHR
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    const fj = await pool.query('SELECT * FROM failed_jobs WHERE id = $1 AND retried_at IS NULL', [id]);
    if (fj.rows.length === 0) return res.status(404).json({ error: 'Job no encontrado o ya marcado' });
    await pool.query('UPDATE failed_jobs SET retried_at = NOW() WHERE id = $1', [id]);
    auditLog('RETRY_FAILED_JOB', { failed_job_id: id, upload_id: fj.rows[0].upload_id }, req.user.userId, req.ip);
    logger.info(`[Admin] Failed job ${id} marcado como revisado por ${req.user.email}`);
    res.json({ success: true, message: `Job ${id} marcado como revisado` });
  } catch (err) {
    logger.error('Retry failed job error:', err);
    res.status(500).json({ error: 'Error al marcar el job' });
  }
});

// Rate limiter específico para VIES — centralizado en middleware/rate-limit.js
const viesLimiter = viesLimiterV2;

// GET /api/vies/:nif — consulta VIES pública (dato público de la UE, con rate limit)
app.get('/api/vies/:nif', authenticateToken, requireActiveCompany, viesLimiter, async (req, res) => { // SEC-014: añadido viesLimiter
  const nif = (req.params.nif || '').toUpperCase().replace(/[\s\-\.]/g, '');
  if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(nif)) {
    return res.json({ valid: null, nombre: null, reason: 'not_cif' });
  }
  try {
    const result = await validateVIES(nif);
    if (result === null) return res.json({ valid: null, nombre: null, reason: 'timeout' });
    res.json({ valid: result.valid, nombre: result.nombre });
  } catch (err) {
    res.json({ valid: null, nombre: null, reason: 'error' });
  }
});

// ─── Admin: selector de motor OCR (sin rebuild gracias al volume mount) ──────

const FEATURES_PATH = '/app/src/config/features.json';
const VALID_ENGINES = ['openai', 'azure', 'dual'];

// Middleware de autorización por rol (modelo 2026-05-06).
// - requireAdmin permite cualquier privilegio del back-office: tech O admin.
// - requireTech limita a SOPORTE TÉCNICO. Endpoints de plataforma sensibles
//   (security.json, motor OCR, link de empresas, hard-delete de empresas,
//   mutación catalogo global) deben usar requireTech en vez de requireAdmin.
// Fuente de verdad: req.user.role poblado desde BD por authenticateToken.
// Fallback a is_admin para compatibilidad si role no estuviera (no debería pasar).
function requireAdmin(req, res, next) {
  const role = req.user.role;
  const allowed = role === 'tech' || role === 'admin' || (req.user.is_admin === true && !role);
  if (!allowed) {
    auditLog('ADMIN_ACCESS_DENIED', { email: req.user.email, path: req.path, role }, req.user.userId, req.ip);
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
}

function requireTech(req, res, next) {
  if (req.user.role !== 'tech') {
    auditLog('TECH_ACCESS_DENIED', { email: req.user.email, path: req.path, role: req.user.role }, req.user.userId, req.ip);
    return res.status(403).json({ error: 'Acceso restringido a soporte técnico' });
  }
  next();
}

// ── TECH ADMIN HELPER ─────────────────────────────────────────────────────────────────────────
function isTechAdmin(email) {
  try {
    const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
    const list = cfg.tech_admin_emails || [];
    return list.map(e => e.toLowerCase()).includes((email || '').toLowerCase());
  } catch { return false; }
}

// ── APPROVAL FLOW HELPERS ────────────────────────────────────────────────────────────────────

// Normaliza nombre de empresa: mayúsculas, sin acentos, sin puntuación, sin formas jurídicas comunes
function normalizeCompanyName(nombre) {
  if (!nombre) return '';
  return nombre
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar diacríticos
    .replace(/\b(S\.?L\.?|S\.?A\.?|S\.?L\.?U\.?|S\.?A\.?U\.?|S\.?L\.?L\.?|S\.?C\.?|S\.?C\.?P\.?|S\.?R\.?L\.?|S\.?A\.?L\.?|S\.?C\.?S\.?|S\.?COOP\.?|S\.?C\.?A\.?|S\.?L\.?N\.?E\.?|C\.?B\.?)\b/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Busca empresas activas similares por nombre (pg_trgm) y CIF (levenshtein).
// Devuelve array de { id, nombre, cif, score, match_type } ordenado por score desc.
async function findMatchingCompanies(nombre, cif) {
  try {
    const nombreNorm = normalizeCompanyName(nombre);
    const cifNorm = (cif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const results = [];

    // Coincidencia exacta de CIF
    if (cifNorm.length >= 5) {
      const exactRes = await pool.query(
        `SELECT id, nombre, cif, 1.0 AS score FROM client_companies
         WHERE UPPER(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')) = $1 AND pendiente = false AND activa = true LIMIT 5`,
        [cifNorm]
      );
      for (const row of exactRes.rows) {
        results.push({ id: row.id, nombre: row.nombre, cif: row.cif, score: 1.0, match_type: 'cif_exact' });
      }
    }

    // Similitud por nombre (pg_trgm) — umbral 0.3
    if (nombreNorm.length >= 3) {
      const trgmRes = await pool.query(
        `SELECT id, nombre, cif,
                similarity(nombre, $1) AS score
         FROM client_companies
         WHERE similarity(nombre, $1) > 0.3
           AND pendiente = false AND activa = true
         ORDER BY score DESC LIMIT 5`,
        [nombreNorm]
      );
      for (const row of trgmRes.rows) {
        if (!results.find(r => r.id === row.id)) {
          results.push({ id: row.id, nombre: row.nombre, cif: row.cif, score: parseFloat(row.score), match_type: 'nombre_fuzzy' });
        }
      }
    }

    // Levenshtein en CIF (tolerancia typos) — distancia <= 2
    if (cifNorm.length >= 5) {
      const levRes = await pool.query(
        `SELECT id, nombre, cif,
                (1.0 - levenshtein(UPPER(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')), $1)::float / GREATEST(length($1), length(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')), 1)) AS score
         FROM client_companies
         WHERE levenshtein(UPPER(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')), $1) <= 2
           AND UPPER(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')) <> $1
           AND pendiente = false AND activa = true
         ORDER BY score DESC LIMIT 3`,
        [cifNorm]
      );
      for (const row of levRes.rows) {
        if (!results.find(r => r.id === row.id)) {
          results.push({ id: row.id, nombre: row.nombre, cif: row.cif, score: parseFloat(row.score), match_type: 'cif_fuzzy' });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 5);
  } catch (err) {
    logger.error('[findMatchingCompanies] error:', err.message);
    return [];
  }
}

// Registra una acción en company_audit_log (no lanza — solo loguea si falla)
async function logCompanyAudit(companyId, adminId, action, notes, metadata) {
  try {
    await pool.query(
      `INSERT INTO company_audit_log (company_id, admin_id, action, notes, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, adminId || null, action, notes || null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    logger.error('[logCompanyAudit] error al registrar:', err.message);
  }
}

// Envía email a administradores cuando se registra una nueva empresa pendiente.
// 2026-05-28: ampliado a is_admin=true (incluye tech + admin). Decisión Julio:
// todos los administradores deben recibir los avisos operativos, no solo el
// equipo técnico. Los privilegios de requireTech NO se ven afectados — siguen
// limitados a role='tech'.
async function sendAdminPendingEmail(companyData) {
  if (!emailTransporter || !smtpUserCached) return;
  try {
    const admins = await pool.query(
      `SELECT email FROM users WHERE is_admin = true`
    );
    if (!admins.rows.length) return;

    const adminEmails = admins.rows.map(r => r.email).join(',');
    const matchHtml = (companyData.matching_suggestions || []).length > 0
      ? `<p><strong>Coincidencias detectadas:</strong></p><ul>` +
        companyData.matching_suggestions.map(m =>
          `<li>${escapeHtml(m.nombre)} — CIF: ${escapeHtml(m.cif)} (${m.match_type}, score ${m.score.toFixed(2)})</li>`
        ).join('') + `</ul>`
      : `<p><em>Sin coincidencias detectadas — parece empresa nueva.</em></p>`;

    await emailTransporter.sendMail({
      from: `"SETEX Facturas" <${smtpUserCached}>`,
      to: adminEmails,
      subject: `[SETEX] Nueva empresa pendiente de aprobación: ${companyData.nombre}`,
      html: `
        <h2>Nueva empresa pendiente de aprobación</h2>
        <table border="1" cellpadding="6" cellspacing="0">
          <tr><td><strong>Nombre</strong></td><td>${escapeHtml(companyData.nombre)}</td></tr>
          <tr><td><strong>CIF</strong></td><td>${escapeHtml(companyData.cif)}</td></tr>
          <tr><td><strong>Email solicitante</strong></td><td>${escapeHtml(companyData.requested_by_email || '-')}</td></tr>
          <tr><td><strong>Fecha solicitud</strong></td><td>${new Date().toLocaleString('es-ES')}</td></tr>
        </table>
        ${matchHtml}
        <p><a href="https://setex-facturas.es/admin-facturas.html">Revisar en el panel de administración →</a></p>
      `
    });
    logger.info(`[sendAdminPendingEmail] Notificación enviada a ${admins.rows.length} administradores para empresa ${companyData.cif}`);
  } catch (err) {
    logger.error('[sendAdminPendingEmail] error:', err.message);
    // No lanzar — el fallo del email no debe bloquear el registro
  }
}

// Envía notificación a administradores cuando un usuario se autoregistra usando
// un CIF ya pre-aprobado (catálogo `client_companies` con activa=true, pendiente=false).
// Sirve para vigilancia humana de posibles suplantaciones — el CIF es público,
// alguien podría registrarse haciéndose pasar por una empresa real.
// 2026-05-28: ampliado a is_admin=true (incluye tech + admin) por petición de Julio.
async function sendAdminAutoApprovedEmail(data) {
  if (!emailTransporter || !smtpUserCached) return;
  try {
    const admins = await pool.query(`SELECT email FROM users WHERE is_admin = true`);
    if (!admins.rows.length) return;
    const adminEmails = admins.rows.map(r => r.email).join(',');

    // ¿Hay otros usuarios ya registrados con el mismo CIF? Bandera de aviso.
    const otrosRes = await pool.query(
      `SELECT email FROM users
        WHERE UPPER(REPLACE(company_nif, ' ', '')) = $1
          AND email <> $2
          AND is_test IS NOT TRUE`,
      [data.cif, data.email]
    );
    const otrosEmails = otrosRes.rows.map(r => r.email);
    const aviso = otrosEmails.length
      ? `<p style="color:#c53030;"><strong>⚠ Aviso:</strong> ya hay ${otrosEmails.length} usuario(s) registrado(s) con este CIF: <code>${otrosEmails.map(e => escapeHtml(e)).join(', ')}</code>. Verifica manualmente que no haya suplantación.</p>`
      : `<p style="color:#276749;">✓ Primer registro para este CIF — sin coincidencias previas.</p>`;

    await emailTransporter.sendMail({
      from: `"SETEX Facturas" <${smtpUserCached}>`,
      to: adminEmails,
      subject: `[SETEX] Nuevo registro auto-aprobado — ${data.nombre} (${data.cif})`,
      html: `
        <h2>Nuevo registro auto-aprobado</h2>
        <p>Una empresa del catálogo pre-aprobado ha sido usada por un usuario nuevo para registrarse. <strong>Recibió acceso inmediato sin pasar por aprobación admin.</strong></p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
          <tr><td><strong>Email del registrante</strong></td><td>${escapeHtml(data.email)}</td></tr>
          <tr><td><strong>Nombre declarado</strong></td><td>${escapeHtml(data.nombre)}</td></tr>
          <tr><td><strong>CIF/NIF</strong></td><td><code>${escapeHtml(data.cif)}</code></td></tr>
          <tr><td><strong>IP origen</strong></td><td>${escapeHtml(data.ip || '-')}</td></tr>
          <tr><td><strong>Fecha</strong></td><td>${new Date().toLocaleString('es-ES')}</td></tr>
        </table>
        ${aviso}
        <p><strong>Si no reconoces este registro o el email parece sospechoso:</strong></p>
        <ul>
          <li>Desactiva la cuenta: <code>UPDATE client_companies SET activa=false WHERE cif='${escapeHtml(data.cif)}';</code></li>
          <li>O contacta primero con la empresa real para verificar.</li>
        </ul>
        <p><a href="https://setex-facturas.es/admin-facturas.html">Abrir panel de administración →</a></p>
      `
    });
    logger.info(`[sendAdminAutoApprovedEmail] Alerta enviada a ${admins.rows.length} tech: nuevo registro ${data.email} (CIF=${data.cif})`);
  } catch (err) {
    logger.error('[sendAdminAutoApprovedEmail] error:', err.message);
  }
}

// ── REFRESH TOKEN HELPERS ────────────────────────────────────────────────────────────────────

/** SHA-256 hash del token crudo. El crudo solo existe en la cookie del cliente. */
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Crea un nuevo refresh token, lo almacena en BD y devuelve el valor crudo.
 * @param {number} userId
 * @param {string} familyId  UUID de la cadena de rotación (para detectar reuso)
 * @param {boolean} rememberMe  true → 7 días; false → 1 día
 */
async function createRefreshToken(userId, familyId, rememberMe) {
  const raw = crypto.randomBytes(32).toString('hex'); // 64 chars, 256 bits
  const hash = hashToken(raw);
  const ttlDays = rememberMe ? 7 : 1;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, hash, familyId || hash, expiresAt]
  );
  return { raw, hash, expiresAt, ttlDays };
}

/**
 * Revoca todos los tokens de una familia (detección de reuso → posible robo).
 * @param {string} familyId
 */
async function revokeTokenFamily(familyId) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
     WHERE family_id = $1 AND revoked = false`,
    [familyId]
  );
  logger.warn(`[RT] Familia de tokens revocada: ${familyId} (posible reuso detectado)`);
}

/**
 * Fija la cookie httpOnly del refresh token.
 * path='/' para que nginx también reciba la cookie en auth_request.
 */
function setRtCookie(res, rawToken, expiresAt) {
  res.cookie('setex_rt', rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Fija la cookie httpOnly admin (para nginx auth_request en /admin-facturas.html).
 * Duración alineada con el RT: 7d o 1d según rememberMe.
 */
function setAdminCookie(res, user, ttlDays) {
  const maxMs = ttlDays * 24 * 60 * 60 * 1000;
  const payload = { userId: user.id, is_admin: true, token_version: user.token_version || 1, type: 'admin_page' };
  const cookieToken = jwt.sign(payload, jwtSecretCached, { expiresIn: `${ttlDays}d` });
  res.cookie('setex_admin', cookieToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: maxMs, path: '/' });
}

// ── requireActiveCompany — verifica en BD que la empresa del usuario está activa y aprobada ──
// SIEMPRE verifica en BD (no confía solo en JWT). Fail-secure: si la BD falla → 503.
// Admins (is_admin=true) siempre pasan sin restricción.
// Sandbox (is_test=true): también pasan sin restricción, su actividad se purga
// periódicamente y no afecta a la BD productiva.
async function requireActiveCompany(req, res, next) {
  if (req.user?.is_admin === true) return next();
  try {
    const userRow = await pool.query(
      'SELECT company_nif, is_test FROM users WHERE id = $1', [req.user.userId]
    );
    if (userRow.rows[0]?.is_test === true) return next();
    const nif = userRow.rows[0]?.company_nif;
    if (!nif) {
      return res.status(403).json({
        error: 'Tu cuenta no tiene empresa asociada. Contacta al administrador de SETEX.',
        company_status: 'no_company'
      });
    }
    const cleanNif = nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const compRow = await pool.query(
      `SELECT activa, pendiente FROM client_companies
       WHERE UPPER(regexp_replace(cif, '[^A-Za-z0-9]', '', 'g')) = $1 LIMIT 1`,
      [cleanNif]
    );
    if (!compRow.rows.length) {
      logger.warn(`[requireActiveCompany] Empresa no encontrada en BD: CIF=${cleanNif} user=${req.user.userId}`);
      return res.status(403).json({
        error: 'Empresa no reconocida en el sistema. Contacta al administrador de SETEX.',
        company_status: 'not_found'
      });
    }
    const { activa, pendiente } = compRow.rows[0];
    // Estado inconsistente (activa=true, pendiente=true) → tratar como pendiente
    if (pendiente || !activa) {
      return res.status(403).json({
        error: 'Tu empresa está pendiente de aprobación por SETEX. Recibirás acceso cuando sea aprobada.',
        company_status: 'pending'
      });
    }
    return next();
  } catch (dbErr) {
    logger.error('[requireActiveCompany] DB error — fail-secure, rechazando request:', dbErr.message);
    return res.status(503).json({
      error: 'Error al verificar estado de empresa. Inténtalo en unos minutos.'
    });
  }
}

// CSRF defense — exige cabecera X-Requested-With en peticiones de estado (POST/PUT/DELETE/PATCH)
// Con JWT en Authorization header el riesgo CSRF es bajo, pero esta capa añade defensa en profundidad.
function requireXHR(req, res, next) {
  const xrw = (req.headers['x-requested-with'] || '').toLowerCase();
  if (xrw !== 'xmlhttprequest') {
    auditLog('CSRF_BLOCKED', { path: req.path, method: req.method }, req.user?.userId, req.ip);
    return res.status(403).json({ error: 'Solicitud no permitida (falta cabecera de seguridad).' });
  }
  next();
}

/** GET /api/admin/ocr-engine — devuelve el modo OCR activo */
app.get('/api/admin/ocr-engine', authenticateToken, requireAdmin, (_req, res) => {
  try {
    const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
    res.json({ engine: cfg.ocr_mode || cfg.ocr_primary_engine || 'dual' });
  } catch (err) {
    logger.error('Error leyendo features.json', { error: err.message });
    res.status(500).json({ error: 'Error leyendo configuración' });
  }
});

/** POST /api/admin/ocr-engine — cambia el modo OCR en caliente */
// Modos: 'dual' = OpenAI + Azure en paralelo (máxima confianza) | 'openai' = solo GPT-4.1 | 'azure' = solo Azure DI
app.post('/api/admin/ocr-engine', authenticateToken, requireAdmin, requireXHR, (req, res) => { // SEC-008: añadido requireXHR
  const { engine } = req.body || {};
  if (!VALID_ENGINES.includes(engine)) {
    return res.status(400).json({ error: `Modo no válido. Opciones: ${VALID_ENGINES.join(', ')}` });
  }
  try {
    const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
    const prev = cfg.ocr_mode || cfg.ocr_primary_engine || 'dual';
    cfg.ocr_mode = engine;
    cfg.ocr_primary_engine = engine === 'dual' ? 'openai' : engine;
    fsSync.writeFileSync(FEATURES_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    auditLog('OCR_ENGINE_CHANGED', { from: prev, to: engine }, req.user.userId, req.ip);
    logger.info(`Modo OCR cambiado a "${engine}" por ${req.user.email}`);
    res.json({ success: true, engine });
  } catch (err) {
    logger.error('Error escribiendo features.json', { error: err.message });
    res.status(500).json({ error: 'Error guardando configuración' });
  }
});

// HAL-009: helper SCAN para contar keys en Redis sin bloquear el servidor (reemplaza KEYS)
async function redisCountPattern(pattern) {
  let count = 0;
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
    cursor = nextCursor;
    count += keys.length;
  } while (cursor !== '0');
  return count;
}

// ─── GET /api/admin/system-health — estado completo del sistema (solo admin) ──
app.get('/api/admin/system-health', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    // Estado Redis
    let redisOk = false;
    let redisInfo = {};
    try {
      const pong = await redisClient.ping();
      redisOk = pong === 'PONG';
      const info = await redisClient.info('memory');
      const usedMem = info.match(/used_memory_human:(\S+)/)?.[1];
      const peakMem = info.match(/used_memory_peak_human:(\S+)/)?.[1];
      redisInfo = { used_memory: usedMem, peak_memory: peakMem };
    } catch (e) {
      redisInfo.error = e.message;
    }

    // Estado PostgreSQL
    let pgOk = false;
    let pgStats = {};
    try {
      const r = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM uploads) AS total_uploads,
          (SELECT COUNT(*) FROM uploads WHERE uploaded_at > NOW() - INTERVAL '24 hours') AS uploads_24h,
          (SELECT COUNT(*) FROM users) AS total_users,
          (SELECT COUNT(*) FROM failed_jobs WHERE retried_at IS NULL) AS failed_jobs_pending
      `);
      pgOk = true;
      pgStats = r.rows[0];
    } catch (e) {
      pgStats.error = e.message;
    }

    // Previews OCR activas en Redis (HAL-009: SCAN en lugar de KEYS)
    let previewsActive = 0;
    try { previewsActive = await redisCountPattern('preview:*'); } catch {}

    // IPs bloqueadas por auto-block (HAL-009: SCAN en lugar de KEYS)
    let ipsBlocked = 0;
    try { ipsBlocked = await redisCountPattern('sec:block:*'); } catch {}

    // Modo OCR activo
    let ocrMode = 'dual';
    try {
      const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
      ocrMode = cfg.ocr_mode || cfg.ocr_primary_engine || 'dual';
    } catch {}

    res.json({
      timestamp: new Date().toISOString(),
      redis: { ok: redisOk, ...redisInfo },
      postgres: { ok: pgOk, ...pgStats },
      previews_active: previewsActive,
      ips_blocked: ipsBlocked,
      ocr_mode: ocrMode,
    });
  } catch (err) {
    logger.error('System health check error:', err);
    res.status(500).json({ error: 'Error al obtener estado del sistema' });
  }
});

// GET /api/admin/facturas — todas las facturas con filtros opcionales (solo admin)
app.get('/api/admin/facturas', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { desde, hasta, proveedor, usuario_id, estado, company_nif } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;

    // Filtro por fecha de EMISIÓN de la factura (DD/MM/YYYY en BD) — no por fecha de subida
    if (desde) {
      conditions.push(`(u.fecha_emision ~ '^\\d{2}/\\d{2}/\\d{4}$' AND TO_DATE(u.fecha_emision, 'DD/MM/YYYY') >= $${p++}::date)`);
      params.push(desde);
    }
    if (hasta) {
      conditions.push(`(u.fecha_emision ~ '^\\d{2}/\\d{2}/\\d{4}$' AND TO_DATE(u.fecha_emision, 'DD/MM/YYYY') <= $${p++}::date)`);
      params.push(hasta);
    }
    if (proveedor) {
      // Buscar en AMBOS lados (proveedor y receptor) para encontrar la empresa independientemente de su rol
      const pat = `%${proveedor}%`;
      conditions.push(
        `(u.proveedor_nombre ILIKE $${p} OR u.proveedor_nif ILIKE $${p + 1}` +
        ` OR u.receptor_nombre ILIKE $${p + 2} OR u.receptor_nif ILIKE $${p + 3})`
      );
      params.push(pat, pat, pat, pat);
      p += 4;
    }
    if (usuario_id) { conditions.push(`u.user_id = $${p++}`); params.push(parseInt(usuario_id, 10)); }
    if (estado === 'procesado') conditions.push('u.procesado_en IS NOT NULL');
    if (estado === 'pendiente') conditions.push('u.procesado_en IS NULL');
    if (company_nif) {
      const cleanCif = String(company_nif).toUpperCase().replace(/[^A-Z0-9]/g, '');
      conditions.push(`UPPER(REPLACE(us.company_nif, ' ', '')) = $${p++}`);
      params.push(cleanCif);
    }
    // SANDBOX: ocultar facturas de usuarios de pruebas (is_test=true) del panel admin
    conditions.push(`us.is_test IS NOT TRUE`);

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [result, countResult, ccResult, dupResult] = await Promise.all([
      pool.query(
        `SELECT u.id, us.email AS usuario_email,
                COALESCE(us.company_name, us.email) AS empresa_nombre,
                us.company_nif AS empresa_nif,
                cc.codigo_cliente,
                u.proveedor_nombre, u.proveedor_nif,
                u.receptor_nombre, u.receptor_nif,
                u.numero_factura,
                u.fecha_emision, u.total_factura,
                u.base_imponible, u.iva_porcentaje, u.cuota_iva,
                u.irpf_porcentaje, u.cuota_irpf,
                u.lineas_iva,
                u.invoice_type,
                u.campos_no_fiables,
                u.uploaded_at, u.procesado_en,
                u.file_path
         FROM uploads u
         LEFT JOIN users us ON u.user_id = us.id
         LEFT JOIN client_companies cc ON UPPER(REPLACE(us.company_nif, ' ', '')) = UPPER(REPLACE(cc.cif, ' ', ''))
         ${where}
         ORDER BY u.uploaded_at DESC
         LIMIT 5000`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM uploads u LEFT JOIN users us ON u.user_id = us.id ${where}`,
        params
      ),
      pool.query('SELECT cif, codigo_cliente FROM client_companies WHERE codigo_cliente IS NOT NULL'),
      pool.query(
        `SELECT id, user_id, numero_factura, fecha_emision, total_factura
         FROM uploads WHERE upload_status = 'active'`
      ),
    ]);
    const gruposDuplicados = detectarGruposDuplicados(dupResult.rows);

    // Mapa CIF → codigo_cliente para fallback cuando el usuario subidor no tiene empresa registrada
    const ccMap = new Map();
    ccResult.rows.forEach(row => {
      if (row.cif) ccMap.set(row.cif.toUpperCase().replace(/[^A-Z0-9]/g, ''), row.codigo_cliente);
    });

    // Añadir campos de display computados (empresa/contraparte correctas) a cada fila
    const facturas = result.rows.map(row => {
      const display = computeDisplayCompanies(row);
      // Si codigo_cliente es nulo (usuario subidor no pertenece a empresa registrada),
      // intentar resolverlo por el NIF de la empresa detectada en el contenido de la factura
      let codigo_cliente = row.codigo_cliente;
      if (!codigo_cliente && display.display_empresa_nif) {
        const cleanNif = display.display_empresa_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
        codigo_cliente = ccMap.get(cleanNif) || null;
      }
      const duplicado_grupo = gruposDuplicados.get(row.id) || null;
      return { ...row, ...display, codigo_cliente, posible_duplicado: !!duplicado_grupo, duplicado_grupo };
    });

    res.json({ facturas, total: parseInt(countResult.rows[0].count, 10) });
  } catch (err) {
    logger.error('Admin facturas error:', err);
    res.status(500).json({ error: 'Error al obtener facturas' });
  }
});

// GET /api/admin/facturas/usuarios — lista de usuarios para filtro (solo admin)
// 2026-07-05: incluye datos de empresa (users.company_* + client_companies por
// matching de CIF, mismo patrón que el listado principal) para que el filtro
// del panel muestre NOMBRES DE EMPRESA en lugar de emails. Cambio aditivo:
// el contrato { usuarios: [{ id, email, ... }] } se mantiene.
app.get('/api/admin/facturas/usuarios', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT us.id, us.email, us.company_name, us.company_nif,
             cc.nombre AS company_nombre_registrado, cc.codigo_cliente
      FROM users us
      LEFT JOIN client_companies cc
        ON UPPER(REPLACE(us.company_nif, ' ', '')) = UPPER(REPLACE(cc.cif, ' ', ''))
      WHERE us.is_test IS NOT TRUE
        AND EXISTS (SELECT 1 FROM uploads WHERE uploads.user_id = us.id)
      ORDER BY COALESCE(cc.nombre, us.company_name, us.email)`);
    const cfg = JSON.parse(fsSync.readFileSync(FEATURES_PATH, 'utf8'));
    const techEmails = (cfg.tech_admin_emails || []).map(e => e.toLowerCase());
    const usuarios = result.rows.filter(u => !techEmails.includes((u.email || '').toLowerCase()));
    res.json({ usuarios });
  } catch (err) {
    logger.error('Admin usuarios error:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// GET /api/admin/facturas/export.xlsx — exportar todas las facturas como Excel (solo admin)
app.get('/api/admin/facturas/export.xlsx', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { desde, hasta, proveedor, usuario_id, estado, company_nif } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;

    // Filtro por fecha de EMISIÓN de la factura (DD/MM/YYYY en BD) — no por fecha de subida
    if (desde) {
      conditions.push(`(u.fecha_emision ~ '^\\d{2}/\\d{2}/\\d{4}$' AND TO_DATE(u.fecha_emision, 'DD/MM/YYYY') >= $${p++}::date)`);
      params.push(desde);
    }
    if (hasta) {
      conditions.push(`(u.fecha_emision ~ '^\\d{2}/\\d{2}/\\d{4}$' AND TO_DATE(u.fecha_emision, 'DD/MM/YYYY') <= $${p++}::date)`);
      params.push(hasta);
    }
    if (proveedor) {
      // Buscar en AMBOS lados (proveedor y receptor) para encontrar la empresa independientemente de su rol
      const pat = `%${proveedor}%`;
      conditions.push(
        `(u.proveedor_nombre ILIKE $${p} OR u.proveedor_nif ILIKE $${p + 1}` +
        ` OR u.receptor_nombre ILIKE $${p + 2} OR u.receptor_nif ILIKE $${p + 3})`
      );
      params.push(pat, pat, pat, pat);
      p += 4;
    }
    if (usuario_id) { conditions.push(`u.user_id = $${p++}`); params.push(parseInt(usuario_id, 10)); }
    if (estado === 'procesado') conditions.push('u.procesado_en IS NOT NULL');
    if (estado === 'pendiente') conditions.push('u.procesado_en IS NULL');
    if (company_nif) {
      const cleanCif = String(company_nif).toUpperCase().replace(/[^A-Z0-9]/g, '');
      conditions.push(`UPPER(REPLACE(us.company_nif, ' ', '')) = $${p++}`);
      params.push(cleanCif);
    }
    // SANDBOX: ocultar facturas de usuarios de pruebas también del export Excel
    conditions.push(`us.is_test IS NOT TRUE`);

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // JOIN con client_companies para obtener el mismo codigo_cliente que muestra el
    // panel admin como "ID". Además, consultar el mapa global CIF → codigo_cliente
    // para poder resolver por fallback cuando el user subidor no pertenece a una
    // empresa registrada pero la empresa detectada en la factura sí está en la BD.
    const [result, ccResult] = await Promise.all([
      pool.query(
        `SELECT u.id, us.email AS usuario_email,
                COALESCE(us.company_name, us.email) AS empresa_nombre,
                us.company_nif AS empresa_nif,
                cc.codigo_cliente,
                u.proveedor_nombre, u.proveedor_nif,
                u.receptor_nombre, u.receptor_nif,
                u.numero_factura,
                u.fecha_emision, u.base_imponible, u.total_factura, u.iva_porcentaje, u.cuota_iva,
                u.irpf_porcentaje, u.cuota_irpf, u.moneda, u.confidence_level,
                u.lineas_iva,
                u.invoice_type, u.uploaded_at
         FROM uploads u
         LEFT JOIN users us ON u.user_id = us.id
         LEFT JOIN client_companies cc ON UPPER(REPLACE(us.company_nif, ' ', '')) = UPPER(REPLACE(cc.cif, ' ', ''))
         ${where}
         ORDER BY u.uploaded_at DESC LIMIT 10000`,
        params
      ),
      pool.query('SELECT cif, codigo_cliente FROM client_companies WHERE codigo_cliente IS NOT NULL'),
    ]);

    // Mapa CIF → codigo_cliente (fallback idéntico al de GET /api/admin/facturas)
    const ccMap = new Map();
    ccResult.rows.forEach(row => {
      if (row.cif) ccMap.set(row.cif.toUpperCase().replace(/[^A-Z0-9]/g, ''), row.codigo_cliente);
    });

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SETEX Captura de Facturas';
    wb.created = new Date();
    const ws = wb.addWorksheet('Facturas');

    ws.columns = [
      { header: 'ID',                   key: 'codigo_cliente',       width: 12 },
      { header: 'Empresa',              key: 'display_empresa',      width: 30 },
      { header: 'CIF Empresa',          key: 'display_empresa_nif',  width: 16 },
      { header: 'Cliente / Proveedor',  key: 'display_contraparte',  width: 30 },
      { header: 'CIF Cl/Prov',          key: 'display_contraparte_nif', width: 16 },
      { header: 'Nº Factura',           key: 'numero_factura',       width: 18 },
      { header: 'Fecha',                key: 'fecha_emision',        width: 14 },
      { header: 'Base Imponible',       key: 'base_imponible',       width: 16 },
      { header: 'Total (€)',            key: 'total_factura',        width: 14 },
      { header: 'IVA %',                key: 'iva_porcentaje',       width: 10 },
      { header: 'Cuota IVA',            key: 'cuota_iva',            width: 13 },
      { header: 'IRPF %',               key: 'irpf_porcentaje',      width: 10 },
      { header: 'Cuota IRPF',           key: 'cuota_irpf',           width: 13 },
      { header: 'Moneda',               key: 'moneda',               width: 10 },
    ];

    // Cabecera en negrita con fondo verde corporativo
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A4F' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 20;
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const numFmt = '#,##0.00';
    // Nombre empresa "dominante" en el export (para filename y metadata).
    // Prioridad: filtro company_nif activo → nombre de la empresa con más filas.
    let dominantCompanyName = null;
    const companyCount = new Map();
    for (const r of result.rows) {
      const disp = computeDisplayCompanies(r);
      // Resolver codigo_cliente idéntico al panel: columna directa → fallback por NIF de la factura
      let codigoCliente = r.codigo_cliente;
      if (!codigoCliente && disp.display_empresa_nif) {
        const cleanNif = disp.display_empresa_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
        codigoCliente = ccMap.get(cleanNif) || null;
      }
      if (disp.display_empresa) {
        companyCount.set(disp.display_empresa, (companyCount.get(disp.display_empresa) || 0) + 1);
      }
      ws.addRow({
        codigo_cliente:          codigoCliente || '',
        display_empresa:         disp.display_empresa         || '',
        display_empresa_nif:     disp.display_empresa_nif     || '',
        display_contraparte:     disp.display_contraparte     || '',
        display_contraparte_nif: disp.display_contraparte_nif || '',
        numero_factura:          r.numero_factura   || '',
        fecha_emision:           r.fecha_emision    || '',
        base_imponible:          r.base_imponible   != null ? parseFloat(r.base_imponible)   : '',
        total_factura:           r.total_factura    != null ? parseFloat(r.total_factura)    : '',
        iva_porcentaje:          r.iva_porcentaje   != null ? parseFloat(r.iva_porcentaje)   : '',
        cuota_iva:               r.cuota_iva        != null ? parseFloat(r.cuota_iva)        : '',
        irpf_porcentaje:         r.irpf_porcentaje  != null ? parseFloat(r.irpf_porcentaje)  : '',
        cuota_irpf:              r.cuota_irpf       != null ? parseFloat(r.cuota_irpf)       : '',
        moneda:                  r.moneda           || 'EUR',
      });
    }
    // Empresa dominante para el filename
    if (companyCount.size === 1) {
      dominantCompanyName = companyCount.keys().next().value;
    } else if (companyCount.size > 1) {
      dominantCompanyName = [...companyCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    // Formato numérico en columnas monetarias/porcentaje
    const numCols = ['base_imponible','total_factura','iva_porcentaje','cuota_iva','irpf_porcentaje','cuota_irpf'];
    numCols.forEach(key => {
      const col = ws.getColumn(key);
      col.eachCell({ includeEmpty: false }, (cell, rowNum) => {
        if (rowNum > 1 && typeof cell.value === 'number') cell.numFmt = numFmt;
      });
    });

    // ── Multi-IVA 2026-04-21 parte 5/7 — Hoja secundaria "Desglose IVA" ──────
    // Para cada factura con lineas_iva no-null, una fila por tramo.
    // Facturas mono-IVA NO aparecen aquí (la hoja principal "Facturas" ya las cubre).
    const parseNumES = (s) => {
      if (s == null || s === '') return null;
      const clean = String(s).replace(/\./g, '').replace(',', '.').replace(/[€$\s]/g, '');
      const n = parseFloat(clean);
      return Number.isFinite(n) ? n : null;
    };
    const wsDesg = wb.addWorksheet('Desglose IVA');
    wsDesg.columns = [
      { header: 'ID',                key: 'codigo_cliente',       width: 12 },
      { header: 'Empresa',           key: 'display_empresa',      width: 30 },
      { header: 'CIF Empresa',       key: 'display_empresa_nif',  width: 16 },
      { header: 'Cliente / Proveedor', key: 'display_contraparte',width: 30 },
      { header: 'CIF Cl/Prov',       key: 'display_contraparte_nif', width: 16 },
      { header: 'Nº Factura',        key: 'numero_factura',       width: 18 },
      { header: 'Fecha',             key: 'fecha_emision',        width: 14 },
      { header: 'IVA %',             key: 'iva_pct_tramo',        width: 10 },
      { header: 'Base tramo (€)',    key: 'base_tramo',           width: 15 },
      { header: 'Cuota tramo (€)',   key: 'cuota_tramo',          width: 15 },
      { header: 'Total tramo (€)',   key: 'total_tramo',          width: 15 },
      { header: 'Productos del tramo', key: 'productos_str',      width: 60 },
    ];
    // Cabecera mismo estilo corporativo
    wsDesg.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A4F' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    wsDesg.getRow(1).height = 20;
    wsDesg.views = [{ state: 'frozen', ySplit: 1 }];

    for (const r of result.rows) {
      const lineas = Array.isArray(r.lineas_iva) ? r.lineas_iva : null;
      if (!lineas || lineas.length === 0) continue;
      const disp = computeDisplayCompanies(r);
      let codigoCliente = r.codigo_cliente;
      if (!codigoCliente && disp.display_empresa_nif) {
        const cleanNif = disp.display_empresa_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
        codigoCliente = ccMap.get(cleanNif) || null;
      }
      for (const tramo of lineas) {
        const baseN  = parseNumES(tramo.base);
        const cuotaN = parseNumES(tramo.cuota);
        const pctN   = parseNumES(tramo.porcentaje);
        const productos = Array.isArray(tramo.productos) ? tramo.productos : [];
        const productosStr = productos.length > 0
          ? productos.map(p => {
              const imp = p.importe ? ` (${p.importe} €)` : '';
              return `${p.descripcion || ''}${imp}`.trim();
            }).filter(Boolean).join(' · ')
          : '';
        wsDesg.addRow({
          codigo_cliente:          codigoCliente || '',
          display_empresa:         disp.display_empresa         || '',
          display_empresa_nif:     disp.display_empresa_nif     || '',
          display_contraparte:     disp.display_contraparte     || '',
          display_contraparte_nif: disp.display_contraparte_nif || '',
          numero_factura:          r.numero_factura   || '',
          fecha_emision:           r.fecha_emision    || '',
          iva_pct_tramo:           pctN   != null ? pctN   : '',
          base_tramo:              baseN  != null ? baseN  : '',
          cuota_tramo:             cuotaN != null ? cuotaN : '',
          total_tramo:             (baseN != null && cuotaN != null) ? (baseN + cuotaN) : '',
          productos_str:           productosStr,
        });
      }
    }
    // Formato numérico para columnas monetarias de la hoja Desglose
    ['base_tramo', 'cuota_tramo', 'total_tramo', 'iva_pct_tramo'].forEach(key => {
      const col = wsDesg.getColumn(key);
      col.eachCell({ includeEmpty: false }, (cell, rowNum) => {
        if (rowNum > 1 && typeof cell.value === 'number') cell.numFmt = numFmt;
      });
    });
    // Wrap text para la columna de productos largos
    wsDesg.getColumn('productos_str').alignment = { wrapText: true, vertical: 'top' };

    // Nombre de fichero: setex_facturas_FECHADESDE_FECHAHASTA_EMPRESA.xlsx
    // Fechas = rango de factura (filtros desde/hasta). Si no hay filtro → hoy_hoy.
    // Empresa = filtro proveedor o empresa dominante en el export o "todas".
    const hoyISO = new Date().toISOString().slice(0, 10);
    const desdeISO = desde || hoyISO;
    const hastaISO = hasta || hoyISO;
    const slugify = (s) => String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // quitar acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40) || 'empresa';
    const empresaSlug = proveedor
      ? slugify(proveedor)
      : (dominantCompanyName ? slugify(dominantCompanyName) : 'todas');
    const filename = `setex_facturas_${desdeISO}_${hastaISO}_${empresaSlug}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error('Admin export XLSX error:', err);
    res.status(500).json({ error: 'Error al exportar' });
  }
});

// ─── PUT /api/admin/facturas/:id — editar factura (solo admin) ────────────────
app.put('/api/admin/facturas/:id', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

  const EDITABLE = ['proveedor_nombre', 'proveedor_nif', 'receptor_nombre', 'receptor_nif',
    'numero_factura', 'fecha_emision', 'total_factura', 'base_imponible', 'iva_porcentaje',
    'cuota_iva', 'irpf_porcentaje', 'cuota_irpf', 'moneda', 'invoice_type'];

  const updates = {};
  for (const field of EDITABLE) {
    if (req.body[field] !== undefined) updates[field] = req.body[field] || null;
  }

  // Solo 'compra' o 'venta' -- evita que un valor mal formado rompa
  // computeDisplayCompanies() o el badge del frontend.
  if (updates.invoice_type && !['compra', 'venta'].includes(updates.invoice_type)) {
    return res.status(400).json({ error: "invoice_type debe ser 'compra' o 'venta'" });
  }

  // 2026-07-29: los importes se guardan SIEMPRE en formato español con coma.
  // Esta era una de las vias por las que se colaban los puntos (el admin
  // teclea "303.33" y se guardaba tal cual), dejando las columnas con dos
  // formatos mezclados — lo que rompia sumas SQL y comparaciones de texto.
  for (const campoImporte of ['total_factura', 'base_imponible', 'cuota_iva', 'cuota_irpf']) {
    if (!updates[campoImporte]) continue;
    const f = normalizeToFloat(updates[campoImporte]);
    if (f == null || Number.isNaN(f)) {
      return res.status(400).json({ error: `${campoImporte} no es un número válido: "${updates[campoImporte]}"` });
    }
    updates[campoImporte] = toSpanishAmount(f);
  }

  // 2026-07-29: admin marca campos concretos como no fiables (ej. CIF ilegible)
  // para que el panel los resalte en rojo. Solo se aceptan nombres de campo
  // conocidos, para evitar que un valor arbitrario llegue a la columna JSONB.
  const CAMPOS_FLAGEABLES = ['proveedor_nombre', 'proveedor_nif', 'receptor_nombre', 'receptor_nif',
    'numero_factura', 'fecha_emision', 'total_factura', 'base_imponible', 'cuota_iva', 'cuota_irpf'];
  if (req.body.campos_no_fiables !== undefined) {
    if (!Array.isArray(req.body.campos_no_fiables)) {
      return res.status(400).json({ error: 'campos_no_fiables debe ser un array' });
    }
    const invalidos = req.body.campos_no_fiables.filter((c) => !CAMPOS_FLAGEABLES.includes(c));
    if (invalidos.length > 0) {
      return res.status(400).json({ error: `campos_no_fiables contiene campos no reconocidos: ${invalidos.join(', ')}` });
    }
    updates.campos_no_fiables = JSON.stringify([...new Set(req.body.campos_no_fiables)]);
  }

  // Multi-IVA 2026-04-21 parte 4/7: admin puede editar lineas_iva (JSONB).
  // Si llega array válido, helper recalcula base/cuota/porcentaje como suma y
  // estos sobreescriben cualquier valor manual enviado en updates.
  if (Array.isArray(req.body.lineas_iva)) {
    const norm = normalizeConfirmedLineasIva(req.body.lineas_iva);
    if (norm.lineas && norm.lineas.length > 0) {
      updates.lineas_iva     = JSON.stringify(norm.lineas);
      updates.base_imponible = norm.base;
      updates.iva_porcentaje = norm.porcentaje;
      updates.cuota_iva      = norm.cuota;
      if (norm.errors.length > 0) {
        logger.warn(`[Admin PUT] lineas_iva con warnings id=${id}: ${norm.errors.join('; ')}`);
      }
    } else if (req.body.lineas_iva.length === 0) {
      // Array vacío explícito → migrar factura a mono-IVA (null en BD)
      updates.lineas_iva = null;
    } else {
      return res.status(400).json({ error: `lineas_iva inválidas: ${norm.errors.join(', ') || 'sin líneas válidas'}` });
    }
  } else if (req.body.lineas_iva === null) {
    // Acepta migración explícita mono-IVA: admin puso null
    updates.lineas_iva = null;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

  const setClauses = Object.keys(updates).map((f, i) => `${f} = $${i + 1}`);
  const values = [...Object.values(updates), id];
  try {
    // 2026-07-23: se devuelve la fila COMPLETA ya guardada (no solo el id).
    // Bug reportado por Julio: el panel se quedaba mostrando el valor
    // antiguo tras editar a mano (total, desglose IVA...) hasta que se
    // volvía a pulsar. La causa era que el frontend actualizaba su tabla
    // con el valor que el ADMIN HABÍA ESCRITO, no con lo que de verdad
    // quedó en BD — cualquier divergencia (formato, redondeo, recálculo del
    // desglose) se quedaba invisible hasta refrescar. Ahora el frontend usa
    // esta respuesta como única fuente de verdad para refrescar la fila.
    const r = await pool.query(
      `UPDATE uploads SET ${setClauses.join(', ')} WHERE id = $${values.length}
       RETURNING id, proveedor_nombre, proveedor_nif, receptor_nombre, receptor_nif,
                 numero_factura, fecha_emision, total_factura, base_imponible,
                 iva_porcentaje, cuota_iva, irpf_porcentaje, cuota_irpf, lineas_iva,
                 moneda, invoice_type, campos_no_fiables`,
      values
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Factura no encontrada' });

    auditLog('ADMIN_EDIT_FACTURA', { upload_id: id, fields: Object.keys(updates) }, req.user.userId, req.ip);
    logger.info(`[Admin] Factura ${id} editada por ${req.user.email}: ${Object.keys(updates).join(', ')}`);
    res.json({ success: true, factura: r.rows[0] });
  } catch (err) {
    logger.error('Admin edit factura error:', err);
    res.status(500).json({ error: 'Error al actualizar la factura' });
  }
});

// ─── DELETE /api/admin/facturas/:id — eliminar factura (solo admin) ───────────
// Borrado hard TOTAL: fila de uploads, todo el rastro OCR asociado y los
// ficheros en disco. Accesible a role='admin' y role='tech' (ver requireAdmin).
// Auditoría completa: ADMIN_DELETE_FACTURA con snapshot del registro previo.
//
// 2026-08-11 — "eliminado total" de verdad (petición de Julio). Antes esto
// borraba SOLO la fila de uploads, y dejaba atrás:
//   - ocr_imagen_variante_comparativa / ocr_shadow_validaciones: se enlazan por
//     `preview_id` y NO tienen FK a uploads, así que el ON DELETE CASCADE no las
//     alcanzaba. Quedaban datos fiscales del cliente (proveedor, NIF, total) tras
//     un borrado supuestamente total. (`ocr_shadow_comparativa` se listaba aquí
//     por error: es una VISTA sobre ambas — corregido el 2026-08-12.)
//   - `ruta_variante`: la imagen de contraste generada por el bloque 5 seguía
//     en disco. Es una foto legible de la factura.
// Sí estaban cubiertas por CASCADE: extracciones_v2 y ocr_benchmark_resultados.
// failed_jobs.upload_id es ON DELETE SET NULL — deliberado, la traza del fallo
// sobrevive al borrado del documento.
app.delete('/api/admin/facturas/:id', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

  // Solo se borran ficheros dentro del directorio de uploads. `file_path` y
  // `ruta_variante` vienen de BD, pero el resto del código valida igual antes
  // de servirlos (ver /imagen-variante): defensa en profundidad, un unlink()
  // sin validar es una primitiva de borrado arbitrario si alguna vez se
  // consigue escribir en esas columnas.
  const UPLOADS_DIR = '/app/uploads/';
  const borrarFichero = async (ruta, etiqueta) => {
    if (!ruta) return null;
    const abs = path.resolve(ruta.startsWith('/') ? ruta : `/app/${ruta}`);
    if (!abs.startsWith(UPLOADS_DIR)) {
      logger.warn(`[Admin] ${etiqueta} fuera de ${UPLOADS_DIR}, no se borra: ${abs}`);
      return 'rechazado';
    }
    try {
      await fs.unlink(abs);
      return 'borrado';
    } catch (e) {
      // ENOENT no es un fallo: el fichero ya no estaba.
      logger.warn(`[Admin] No se pudo borrar ${etiqueta} id=${id}: ${e.message}`);
      return e.code === 'ENOENT' ? 'inexistente' : 'error';
    }
  };

  const client = await pool.connect();
  try {
    // Snapshot previo para auditoría + rutas de los ficheros a borrar. La
    // variante se lee ANTES de borrar: su fila desaparece en la transacción.
    const prev = await client.query(
      `SELECT id, user_id, preview_id, filename, file_path, proveedor_nombre, proveedor_nif,
              receptor_nombre, receptor_nif, numero_factura, fecha_emision,
              total_factura, base_imponible, uploaded_at
       FROM uploads WHERE id = $1`,
      [id]
    );
    if (prev.rows.length === 0) return res.status(404).json({ error: 'Factura no encontrada' });
    const snapshot = prev.rows[0];
    const previewId = snapshot.preview_id;

    const variante = previewId
      ? await client.query(
          'SELECT ruta_variante FROM ocr_imagen_variante_comparativa WHERE preview_id = $1',
          [previewId]
        )
      : { rows: [] };

    await client.query('BEGIN');

    // Rastro OCR enlazado por preview_id (sin FK → no lo cubre el CASCADE).
    // Se acota a previewId no nulo: un preview_id NULL casaría con filas de
    // otras facturas y borraría de más.
    //
    // 2026-08-12: `ocr_shadow_comparativa` NO es una tabla, es una VISTA
    // (`ocr_shadow_validaciones` LEFT JOIN `uploads`, ver CREATE VIEW arriba).
    // Postgres no permite DELETE sobre una vista con join —error 55000, "cannot
    // delete from view"— y la transacción entera hacía ROLLBACK: el borrado
    // fallaba siempre con HTTP 500. Además era redundante: la vista no tiene
    // datos propios, se vacía sola al purgar `ocr_shadow_validaciones` y borrar
    // la fila de `uploads`. Se elimina la sentencia; quedan las dos tablas reales.
    const purgadas = { variante: 0, validaciones: 0 };
    if (previewId) {
      purgadas.variante = (await client.query(
        'DELETE FROM ocr_imagen_variante_comparativa WHERE preview_id = $1', [previewId])).rowCount;
      purgadas.validaciones = (await client.query(
        'DELETE FROM ocr_shadow_validaciones WHERE preview_id = $1', [previewId])).rowCount;
    }

    // uploads al final: su CASCADE limpia extracciones_v2 y ocr_benchmark_resultados.
    const r = await client.query('DELETE FROM uploads WHERE id = $1 RETURNING id', [id]);
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    await client.query('COMMIT');

    // Ficheros después del COMMIT: si la transacción falla, no queremos haber
    // borrado ya una imagen que sigue referenciada en BD. Al revés es
    // recuperable (fila sin fichero); en este orden, no.
    const ficheros = {
      original: await borrarFichero(snapshot.file_path, 'fichero original'),
      variante: await borrarFichero(variante.rows[0]?.ruta_variante, 'variante de contraste'),
    };

    auditLog('ADMIN_DELETE_FACTURA', {
      upload_id: id, snapshot, preview_id: previewId, purgadas, ficheros,
    }, req.user.userId, req.ip);
    logger.warn(`[Admin] Factura ${id} eliminada por ${req.user.email} — ` +
      `variante=${purgadas.variante} validaciones=${purgadas.validaciones} ` +
      `ficheros=${ficheros.original}/${ficheros.variante}`);
    res.json({ success: true, purgadas, ficheros });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Admin delete factura error:', err);
    res.status(500).json({ error: 'Error al eliminar la factura' });
  } finally {
    client.release();
  }
});

// ─── Catálogo de empresas (company_catalog) ───────────────────────────────────
app.get('/api/admin/catalog', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const r = await pool.query('SELECT * FROM company_catalog ORDER BY proveedor_nombre ASC');
    res.json({ catalog: r.rows });
  } catch (err) {
    logger.error('Catalog GET error:', err);
    res.status(500).json({ error: 'Error al obtener el catálogo' });
  }
});

app.post('/api/admin/catalog', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const { proveedor_nombre, proveedor_nif, notas } = req.body || {};
  if (!proveedor_nombre || !proveedor_nif) return res.status(400).json({ error: 'Nombre y NIF son obligatorios' });
  const cleanNifC = proveedor_nif.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cifCheck = validateSpanishTaxId(cleanNifC);
  if (!cifCheck.valid) return res.status(400).json({ error: `CIF/NIF inválido: ${cifCheck.reason}` });
  const nombreNorm = normalizeProveedorNombre(proveedor_nombre);
  try {
    const r = await pool.query(
      `INSERT INTO company_catalog (proveedor_nombre, proveedor_nombre_norm, proveedor_nif, notas, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (proveedor_nif) DO UPDATE
         SET proveedor_nombre = EXCLUDED.proveedor_nombre,
             proveedor_nombre_norm = EXCLUDED.proveedor_nombre_norm,
             notas = EXCLUDED.notas, updated_at = NOW()
       RETURNING id`,
      [proveedor_nombre.trim(), nombreNorm, cleanNifC, notas || null, req.user.userId]
    );
    auditLog('CATALOG_UPSERT', { nif: cleanNifC, nombre: proveedor_nombre }, req.user.userId, req.ip);
    res.json({ success: true, id: r.rows[0].id });
  } catch (err) {
    logger.error('Catalog POST error:', err);
    res.status(500).json({ error: 'Error al guardar en el catálogo' });
  }
});

app.delete('/api/admin/catalog/:id', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    await pool.query('DELETE FROM company_catalog WHERE id = $1', [id]);
    auditLog('CATALOG_DELETE', { catalog_id: id }, req.user.userId, req.ip);
    res.json({ success: true });
  } catch (err) {
    logger.error('Catalog DELETE error:', err);
    res.status(500).json({ error: 'Error al eliminar del catálogo' });
  }
});

// ─── Seguridad: gestión de blacklist/whitelist (equivalente htaccess) ─────────
app.get('/api/admin/security', authenticateToken, requireAdmin, (_req, res) => {
  try {
    const cfg = loadSecurityConfig();
    const safe = {
      time_restriction: cfg.time_restriction,
      ip_whitelist: (cfg.ip_whitelist || []).filter(v => !v.startsWith('_')),
      ip_blacklist: (cfg.ip_blacklist || []).filter(v => !v.startsWith('_')),
      auto_block: cfg.auto_block,
      max_users: cfg.max_users,
    };
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Error al leer configuración de seguridad' });
  }
});

function updateSecurityList(listName, action, ip, res, userId, reqIp) {
  try {
    backupSecurityConfig(); // backup antes de cada escritura
    const cfg = JSON.parse(fsSync.readFileSync(SECURITY_PATH, 'utf8'));
    const list = (cfg[listName] || []).filter(v => !v.startsWith('_'));
    if (action === 'add') {
      if (!list.includes(ip)) list.push(ip);
    } else {
      const idx = list.indexOf(ip);
      if (idx !== -1) list.splice(idx, 1);
    }
    cfg[listName] = list;
    fsSync.writeFileSync(SECURITY_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    _secCfg = null; // invalidar caché
    auditLog(`SECURITY_${listName.toUpperCase()}_${action.toUpperCase()}`, { ip }, userId, reqIp);
    res.json({ success: true, [listName]: list });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar configuración de seguridad' });
  }
}

app.post('/api/admin/security/blacklist', authenticateToken, requireAdmin, requireXHR, (req, res) => {
  const { ip } = req.body || {};
  if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'IP requerida' });
  updateSecurityList('ip_blacklist', 'add', ip.trim(), res, req.user.userId, req.ip);
});
app.delete('/api/admin/security/blacklist', authenticateToken, requireAdmin, requireXHR, (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ error: 'IP requerida' });
  updateSecurityList('ip_blacklist', 'remove', ip.trim(), res, req.user.userId, req.ip);
});
app.post('/api/admin/security/whitelist', authenticateToken, requireAdmin, requireXHR, (req, res) => {
  const { ip } = req.body || {};
  if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'IP requerida' });
  updateSecurityList('ip_whitelist', 'add', ip.trim(), res, req.user.userId, req.ip);
});
app.delete('/api/admin/security/whitelist', authenticateToken, requireAdmin, requireXHR, (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ error: 'IP requerida' });
  updateSecurityList('ip_whitelist', 'remove', ip.trim(), res, req.user.userId, req.ip);
});

app.get('/api/admin/security/blocked', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    // SEC-007: usar SCAN iterativo en lugar de KEYS para no bloquear Redis
    const blocked = [];
    let cursor = '0';
    do {
      const [next, keys] = await redisClient.scan(cursor, 'MATCH', 'sec:block:*', 'COUNT', '100');
      cursor = next;
      for (const k of keys) blocked.push({ ip: k.replace('sec:block:', '') });
    } while (cursor !== '0');
    res.json({ blocked });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener IPs bloqueadas' });
  }
});
app.delete('/api/admin/security/blocked', authenticateToken, requireAdmin, async (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ error: 'IP requerida' });
  try {
    await redisClient.del(`sec:block:${ip}`);
    await redisClient.del(`sec:count:${ip}`);
    auditLog('SECURITY_UNBLOCK', { ip }, req.user.userId, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al desbloquear IP' });
  }
});

app.patch('/api/admin/security/time', authenticateToken, requireAdmin, requireXHR, (req, res) => {
  const { enabled, start_hour, end_hour } = req.body || {};
  // SEC-012: si start_hour === end_hour, rechazar para evitar lockout total permanente
  const newStart = start_hour !== undefined ? parseInt(start_hour, 10) : null;
  const newEnd = end_hour !== undefined ? parseInt(end_hour, 10) : null;
  if (newStart !== null && newEnd !== null && newStart === newEnd) {
    return res.status(400).json({ error: 'start_hour y end_hour no pueden ser iguales (causaría bloqueo permanente del sitio).' });
  }
  try {
    backupSecurityConfig();
    const cfg = JSON.parse(fsSync.readFileSync(SECURITY_PATH, 'utf8'));
    if (enabled !== undefined) cfg.time_restriction.enabled = !!enabled;
    if (newStart !== null) cfg.time_restriction.start_hour = newStart;
    if (newEnd !== null) cfg.time_restriction.end_hour = newEnd;
    fsSync.writeFileSync(SECURITY_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    _secCfg = null;
    auditLog('SECURITY_TIME_UPDATE', { enabled, start_hour, end_hour }, req.user.userId, req.ip);
    res.json({ success: true, time_restriction: cfg.time_restriction });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar restricción horaria' });
  }
});

// ─── Admin: client_companies — whitelist de empresas clientes ─────────────────

app.get('/api/admin/client-companies', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT cc.id, cc.nombre, cc.cif, cc.codigo_cliente, cc.activa, cc.pendiente, cc.notas, cc.created_at, cc.updated_at,
             COUNT(DISTINCT u.id)::INT AS num_usuarios,
             COUNT(up.id)::INT AS total_facturas,
             MAX(up.uploaded_at) AS ultima_factura
      FROM client_companies cc
      LEFT JOIN users u ON UPPER(REPLACE(u.company_nif, ' ', '')) = UPPER(REPLACE(cc.cif, ' ', ''))
                       AND u.is_test IS NOT TRUE
      LEFT JOIN uploads up ON up.user_id = u.id
      WHERE cc.is_test IS NOT TRUE
      GROUP BY cc.id
      ORDER BY cc.pendiente DESC, cc.activa DESC, cc.nombre ASC
    `);
    res.json({ companies: r.rows });
  } catch (err) {
    logger.error('Admin client-companies GET error:', err);
    res.status(500).json({ error: 'Error al obtener empresas' });
  }
});

app.post('/api/admin/client-companies', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const { nombre, cif, notas, codigo_cliente } = req.body || {};
  if (!nombre || !cif) return res.status(400).json({ error: 'Nombre y CIF son obligatorios.' });
  const cleanNombre = String(nombre).trim().substring(0, 255);
  const cleanCif = String(cif).toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 20);
  if (cleanCif.length < 5) return res.status(400).json({ error: 'CIF inválido (mínimo 5 caracteres alfanuméricos).' });
  const cleanNotas = notas ? String(notas).trim().substring(0, 500) : null;
  const cleanCodigo = codigo_cliente ? String(codigo_cliente).trim().substring(0, 50) || null : null;
  try {
    const r = await pool.query(
      'INSERT INTO client_companies (nombre, cif, notas, codigo_cliente) VALUES ($1, $2, $3, $4) RETURNING *',
      [cleanNombre, cleanCif, cleanNotas, cleanCodigo]
    );
    auditLog('ADMIN_CREATE_CLIENT_COMPANY', { nombre: cleanNombre, cif: cleanCif, codigo_cliente: cleanCodigo }, req.user.userId, req.ip);
    logger.info(`[Admin] Nueva empresa cliente: ${cleanNombre} (${cleanCif}) por ${req.user.email}`);
    res.status(201).json({ company: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'client_companies_codigo_cliente_key') return res.status(409).json({ error: `El código de cliente "${cleanCodigo}" ya está en uso.` });
      return res.status(409).json({ error: `El CIF ${cleanCif} ya está registrado en el sistema.` });
    }
    logger.error('Admin client-companies POST error:', err);
    res.status(500).json({ error: 'Error al crear la empresa' });
  }
});

app.put('/api/admin/client-companies/:id', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, cif, activa, notas, codigo_cliente, pendiente } = req.body || {};
  const fields = [];
  const params = [];
  let p = 1;
  if (nombre !== undefined) { fields.push(`nombre = $${p++}`); params.push(String(nombre).trim().substring(0, 255)); }
  if (cif !== undefined) {
    const cleanCif = String(cif).toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 20);
    if (cleanCif.length < 5) return res.status(400).json({ error: 'CIF inválido.' });
    fields.push(`cif = $${p++}`); params.push(cleanCif);
  }
  if (activa !== undefined) { fields.push(`activa = $${p++}`); params.push(!!activa); }
  if (pendiente !== undefined) { fields.push(`pendiente = $${p++}`); params.push(!!pendiente); }
  if (notas !== undefined) { fields.push(`notas = $${p++}`); params.push(notas ? String(notas).trim().substring(0, 500) : null); }
  if (codigo_cliente !== undefined) { fields.push(`codigo_cliente = $${p++}`); params.push(codigo_cliente ? String(codigo_cliente).trim().substring(0, 50) || null : null); }
  if (fields.length === 0) return res.status(400).json({ error: 'Sin campos para actualizar.' });
  fields.push(`updated_at = NOW()`);
  params.push(id);
  try {
    const r = await pool.query(
      `UPDATE client_companies SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
    auditLog('ADMIN_UPDATE_CLIENT_COMPANY', { id, updates: req.body }, req.user.userId, req.ip);
    logger.info(`[Admin] Empresa cliente actualizada id=${id} por ${req.user.email}`);
    res.json({ company: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'client_companies_codigo_cliente_key') return res.status(409).json({ error: 'Ese código de cliente ya está en uso.' });
      return res.status(409).json({ error: 'Ese CIF ya existe en el sistema.' });
    }
    logger.error('Admin client-companies PUT error:', err);
    res.status(500).json({ error: 'Error al actualizar la empresa' });
  }
});

app.delete('/api/admin/client-companies/:id', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  // Opción A (2026-08-21): borrado completo en cascada con confirmación == CIF.
  // Sin usuarios → borrado simple (comportamiento original). Con usuarios → se
  // exige { confirmation: CIF } y se borran en una transacción: facturas,
  // usuarios y empresa (refresh_tokens/pw_reset por CASCADE; audit_logs queda
  // anonimizado por SET NULL).
  const confirmation = String((req.body || {}).confirmation || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const client = await pool.connect();
  try {
    const cc = await client.query('SELECT cif, nombre FROM client_companies WHERE id = $1', [id]);
    if (cc.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { cif, nombre } = cc.rows[0];
    const cleanCif = cif.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const usersRes = await client.query(
      `SELECT id, email FROM users WHERE UPPER(REPLACE(company_nif, ' ', '')) = $1`,
      [cleanCif]
    );
    const userIds = usersRes.rows.map((u) => u.id);

    let numFacturas = 0;
    if (userIds.length > 0) {
      const fc = await client.query('SELECT COUNT(*) FROM uploads WHERE user_id = ANY($1::int[])', [userIds]);
      numFacturas = parseInt(fc.rows[0].count, 10);
    }

    // Sin usuarios → borrado simple original
    if (userIds.length === 0) {
      await client.query('DELETE FROM client_companies WHERE id = $1', [id]);
      auditLog('ADMIN_DELETE_CLIENT_COMPANY', { id, cif, nombre }, req.user.userId, req.ip);
      logger.info(`[Admin] Empresa cliente eliminada: ${nombre} (${cif}) por ${req.user.email}`);
      return res.json({ success: true });
    }

    // Con usuarios: exigir confirmation == CIF para el borrado completo
    if (!confirmation) {
      return res.status(409).json({
        error: `Esta empresa tiene ${userIds.length} usuario(s) y ${numFacturas} factura(s). Para eliminarlo TODO definitivamente, confirma repitiendo la petición con el CIF de la empresa.`,
        num_usuarios: userIds.length,
        num_facturas: numFacturas,
        requiere_confirmacion: cleanCif
      });
    }
    if (confirmation !== cleanCif) {
      return res.status(400).json({ error: 'La confirmación no coincide con el CIF de la empresa. Escríbelo exactamente igual.' });
    }

    // ── Borrado completo transaccional ────────────────────────────────────────
    await client.query('BEGIN');
    const filesRes = await client.query(
      'SELECT id, file_path FROM uploads WHERE user_id = ANY($1::int[]) AND file_path IS NOT NULL',
      [userIds]
    );
    const delUp = await client.query('DELETE FROM uploads WHERE user_id = ANY($1::int[]) RETURNING id', [userIds]);
    // known_cifs.user_id no tiene ON DELETE action → anonimizar antes de borrar users
    await client.query('UPDATE known_cifs SET user_id = NULL WHERE user_id = ANY($1::int[])', [userIds]);
    const delUsers = await client.query('DELETE FROM users WHERE id = ANY($1::int[]) RETURNING id', [userIds]);
    await client.query('DELETE FROM client_companies WHERE id = $1 RETURNING id', [id]);
    await client.query('COMMIT');

    // Ficheros físicos best-effort fuera de la transacción (no bloquean la respuesta)
    const fsp = require('fs').promises;
    let ficherosBorrados = 0;
    for (const f of filesRes.rows) {
      try {
        const abs = f.file_path.startsWith('/') ? f.file_path : `/app/${f.file_path}`;
        await fsp.unlink(abs);
        ficherosBorrados++;
      } catch (e) {
        logger.warn(`[Admin] No se pudo borrar fichero físico upload=${f.id}: ${e.message}`);
      }
    }

    auditLog('ADMIN_DELETE_CLIENT_COMPANY_FORCED', {
      id, cif, nombre,
      usuarios_borrados: delUsers.rowCount,
      facturas_borradas: delUp.rowCount,
      ficheros_borrados: ficherosBorrados,
      emails_eliminados: usersRes.rows.map((u) => u.email)
    }, req.user.userId, req.ip);
    logger.warn(`[Admin] Empresa ELIMINADA COMPLETA: ${nombre} (${cif}) por ${req.user.email} — usuarios=${delUsers.rowCount} facturas=${delUp.rowCount} ficheros=${ficherosBorrados}`);
    res.json({
      success: true,
      usuarios_borrados: delUsers.rowCount,
      facturas_borradas: delUp.rowCount,
      ficheros_borrados: ficherosBorrados
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ya en rollback o sin tx */ }
    logger.error('Admin client-companies DELETE error:', err);
    res.status(500).json({ error: 'Error al eliminar la empresa' });
  } finally {
    client.release();
  }
});

// ─── Admin: APPROVAL FLOW — endpoints de aprobación/rechazo/vinculación de empresas ──────────────

// GET /api/admin/companies/pending — lista empresas pendientes con conteo de usuarios y sugerencias
app.get('/api/admin/companies/pending', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT cc.id, cc.nombre, cc.cif, cc.requested_by_email, cc.requested_at,
             cc.nombre_registrado, cc.matching_suggestions, cc.notas, cc.created_at,
             COUNT(u.id) AS num_users
      FROM client_companies cc
      LEFT JOIN users u ON UPPER(REPLACE(u.company_nif, ' ', '')) = UPPER(REPLACE(cc.cif, ' ', ''))
      WHERE cc.pendiente = true AND cc.is_test IS NOT TRUE
      GROUP BY cc.id
      ORDER BY cc.requested_at ASC NULLS LAST, cc.created_at ASC
    `);
    res.json({ companies: r.rows });
  } catch (err) {
    logger.error('[GET /admin/companies/pending] error:', err);
    res.status(500).json({ error: 'Error al obtener empresas pendientes' });
  }
});

// GET /api/admin/companies/:id/detail — detalle completo de una empresa (pendiente o activa)
app.get('/api/admin/companies/:id/detail', authenticateToken, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    const ccRes = await pool.query(`
      SELECT cc.*, linked.nombre AS linked_nombre, linked.cif AS linked_cif
      FROM client_companies cc
      LEFT JOIN client_companies linked ON linked.id = cc.linked_to_company_id
      WHERE cc.id = $1
    `, [id]);
    if (!ccRes.rows.length) return res.status(404).json({ error: 'Empresa no encontrada' });
    const cc = ccRes.rows[0];

    // Usuarios asociados
    const usersRes = await pool.query(
      `SELECT id, email, created_at FROM users WHERE UPPER(REPLACE(company_nif, ' ', '')) = UPPER(REPLACE($1, ' ', ''))`,
      [cc.cif]
    );

    // Uploads pendientes (upload_status = 'pending')
    const uploadsRes = await pool.query(
      `SELECT u.id, u.filename, u.proveedor_nombre, u.proveedor_nif, u.total_factura, u.uploaded_at, u.upload_status, us.email
       FROM uploads u
       JOIN users us ON us.id = u.user_id
       WHERE UPPER(REPLACE(us.company_nif, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
         AND u.upload_status = 'pending'
       ORDER BY u.uploaded_at DESC LIMIT 50`,
      [cc.cif]
    );

    // Recalcular sugerencias frescas si no hay o hay pocas
    let matchingSuggestions = cc.matching_suggestions || [];
    if (!matchingSuggestions.length) {
      matchingSuggestions = await findMatchingCompanies(cc.nombre_registrado || cc.nombre, cc.cif);
    }

    res.json({ company: cc, users: usersRes.rows, pending_uploads: uploadsRes.rows, matching_suggestions: matchingSuggestions });
  } catch (err) {
    logger.error('[GET /admin/companies/:id/detail] error:', err);
    res.status(500).json({ error: 'Error al obtener detalle de empresa' });
  }
});

// GET /api/admin/companies/:id/audit-log — historial de acciones sobre una empresa
app.get('/api/admin/companies/:id/audit-log', authenticateToken, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    const r = await pool.query(`
      SELECT cal.id, cal.action, cal.notes, cal.metadata, cal.created_at,
             u.email AS admin_email
      FROM company_audit_log cal
      LEFT JOIN users u ON u.id = cal.admin_id
      WHERE cal.company_id = $1
      ORDER BY cal.created_at DESC LIMIT 100
    `, [id]);
    res.json({ audit_log: r.rows });
  } catch (err) {
    logger.error('[GET /admin/companies/:id/audit-log] error:', err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// POST /api/admin/companies/:id/approve — aprobar empresa pendiente (transacción atómica)
app.post('/api/admin/companies/:id/approve', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  const { notes } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock para prevenir doble aprobación concurrente
    const ccRes = await client.query(
      `SELECT id, nombre, cif, pendiente FROM client_companies WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!ccRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Empresa no encontrada' }); }
    const cc = ccRes.rows[0];
    if (!cc.pendiente) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Esta empresa ya fue procesada' }); }

    // Activar empresa
    await client.query(
      `UPDATE client_companies SET pendiente = false, activa = true, reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
      [req.user.userId, id]
    );

    // Activar uploads en estado 'pending' → 'active' y asignar client_company_id
    // (consistencia FK: las facturas de empresas aprobadas quedan indexadas igual que
    //  las de cualquier empresa registrada, sin depender del JOIN por company_nif)
    const uplRes = await client.query(
      `UPDATE uploads SET upload_status = 'active', client_company_id = $1
       WHERE user_id IN (
         SELECT id FROM users WHERE UPPER(REPLACE(company_nif, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
       ) AND upload_status = 'pending'
       RETURNING id`,
      [id, cc.cif]
    );

    await client.query('COMMIT');

    await logCompanyAudit(id, req.user.userId, 'APPROVED', notes || null, { activated_uploads: uplRes.rows.length });
    auditLog('ADMIN_APPROVE_COMPANY', { company_id: id, nombre: cc.nombre, cif: cc.cif, uploads_activated: uplRes.rows.length }, req.user.userId, req.ip);
    logger.info(`[Admin] Empresa aprobada: ${cc.nombre} (${cc.cif}) por ${req.user.email}, ${uplRes.rows.length} uploads activados`);
    res.json({ success: true, company_id: id, nombre: cc.nombre, cif: cc.cif, uploads_activated: uplRes.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[POST /admin/companies/:id/approve] error:', err);
    res.status(500).json({ error: 'Error al aprobar empresa' });
  } finally {
    client.release();
  }
});

// POST /api/admin/companies/:id/reject — rechazar empresa pendiente
app.post('/api/admin/companies/:id/reject', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  const { reason, notes } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ccRes = await client.query(
      `SELECT id, nombre, cif, pendiente FROM client_companies WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!ccRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Empresa no encontrada' }); }
    const cc = ccRes.rows[0];
    if (!cc.pendiente) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Esta empresa ya fue procesada' }); }

    // Rechazar: pendiente=false, activa=false, guardar motivo
    await client.query(
      `UPDATE client_companies
       SET pendiente = false, activa = false,
           reviewed_by = $1, reviewed_at = NOW(),
           rejection_reason = $2
       WHERE id = $3`,
      [req.user.userId, reason || null, id]
    );

    // Poner uploads en cuarentena y asignar client_company_id (consistencia FK:
    // conserva trazabilidad a la empresa rechazada; las queries filtran por activa=true
    // así que no aparecen en el listado normal, pero el vínculo queda para auditoría o revinculación)
    const uplRes = await client.query(
      `UPDATE uploads SET upload_status = 'quarantine', client_company_id = $1
       WHERE user_id IN (
         SELECT id FROM users WHERE UPPER(REPLACE(company_nif, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
       ) AND upload_status = 'pending'
       RETURNING id`,
      [id, cc.cif]
    );

    await client.query('COMMIT');

    await logCompanyAudit(id, req.user.userId, 'REJECTED', notes || reason || null, { quarantined_uploads: uplRes.rows.length, reason });
    auditLog('ADMIN_REJECT_COMPANY', { company_id: id, nombre: cc.nombre, cif: cc.cif, reason }, req.user.userId, req.ip);
    logger.info(`[Admin] Empresa rechazada: ${cc.nombre} (${cc.cif}) por ${req.user.email}, motivo: ${reason || '(sin motivo)'}`);
    res.json({ success: true, nombre: cc.nombre, cif: cc.cif, quarantined_uploads: uplRes.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[POST /admin/companies/:id/reject] error:', err);
    res.status(500).json({ error: 'Error al rechazar empresa' });
  } finally {
    client.release();
  }
});

// POST /api/admin/companies/:id/link — vincular empresa pendiente a una empresa activa existente
// Reasigna todos los usuarios y uploads de la empresa pendiente a la empresa destino
app.post('/api/admin/companies/:id/link', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const sourceId = parseInt(req.params.id, 10);
  const targetId = parseInt(req.body?.target_company_id, 10);
  const { notes } = req.body || {};
  if (!Number.isInteger(sourceId) || sourceId <= 0) return res.status(400).json({ error: 'ID de empresa origen inválido' });
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'target_company_id inválido' });
  if (sourceId === targetId) return res.status(400).json({ error: 'Origen y destino no pueden ser la misma empresa' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock ambas empresas para prevenir conflictos concurrentes
    const srcRes = await client.query(`SELECT id, nombre, cif, pendiente FROM client_companies WHERE id = $1 FOR UPDATE`, [sourceId]);
    const tgtRes = await client.query(`SELECT id, nombre, cif, activa, pendiente FROM client_companies WHERE id = $1 FOR UPDATE`, [targetId]);

    if (!srcRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Empresa origen no encontrada' }); }
    if (!tgtRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Empresa destino no encontrada' }); }

    const src = srcRes.rows[0];
    const tgt = tgtRes.rows[0];

    if (!src.pendiente) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'La empresa origen ya fue procesada' }); }
    if (!tgt.activa || tgt.pendiente) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'La empresa destino debe estar activa' }); }

    const srcCifClean = src.cif.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const tgtCifClean = tgt.cif.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Migrar usuarios del CIF origen → CIF destino
    const usersRes = await client.query(
      `UPDATE users SET company_nif = $1, company_name = $2
       WHERE UPPER(REPLACE(company_nif, ' ', '')) = $3
       RETURNING id, email`,
      [tgt.cif, tgt.nombre, srcCifClean]
    );

    // Migrar uploads pendientes: upload_status → 'migrated', client_company_id → destino
    const uplRes = await client.query(
      `UPDATE uploads SET upload_status = 'active', client_company_id = $1
       WHERE user_id IN (SELECT id FROM users WHERE UPPER(REPLACE(company_nif, ' ', '')) = $2)
         AND upload_status IN ('pending', 'active')
       RETURNING id`,
      [targetId, tgtCifClean]
    );

    // Marcar empresa origen como vinculada (linked) y desactivarla
    await client.query(
      `UPDATE client_companies
       SET pendiente = false, activa = false,
           linked_to_company_id = $1,
           reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3`,
      [targetId, req.user.userId, sourceId]
    );

    await client.query('COMMIT');

    await logCompanyAudit(sourceId, req.user.userId, 'LINKED', notes || null, { target_company_id: targetId, target_cif: tgt.cif, migrated_users: usersRes.rows.length, migrated_uploads: uplRes.rows.length });
    await logCompanyAudit(targetId, req.user.userId, 'RECEIVED_LINK', notes || null, { source_company_id: sourceId, source_cif: src.cif, migrated_users: usersRes.rows.length });
    auditLog('ADMIN_LINK_COMPANIES', { source_id: sourceId, target_id: targetId, src_cif: src.cif, tgt_cif: tgt.cif, migrated_users: usersRes.rows.length }, req.user.userId, req.ip);
    logger.info(`[Admin] Empresa vinculada: ${src.nombre} → ${tgt.nombre} por ${req.user.email}. ${usersRes.rows.length} usuarios, ${uplRes.rows.length} uploads migrados`);
    res.json({ success: true, source: { nombre: src.nombre, cif: src.cif }, target: { nombre: tgt.nombre, cif: tgt.cif }, migrated_users: usersRes.rows.length, migrated_uploads: uplRes.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[POST /admin/companies/:id/link] error:', err);
    res.status(500).json({ error: 'Error al vincular empresas' });
  } finally {
    client.release();
  }
});

// ─── Admin: gestión de usuarios y empresas ────────────────────────────────────
app.get('/api/admin/users', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    // SANDBOX: ocultar usuarios de pruebas del listado del panel admin
    const r = await pool.query(`
      SELECT u.id, u.email, u.company_name, u.created_at,
             COUNT(up.id)::INT AS total_facturas,
             MAX(up.uploaded_at) AS ultima_factura,
             -- Acepta los dos formatos historicos de la columna: espanol
             -- ("1.234,56": el punto es separador de miles) e ingles ("1234.56":
             -- el punto es decimal). Si hay coma, el punto es de miles y se quita;
             -- si no hay coma, el valor ya esta en formato numerico. La regex
             -- anterior solo casaba el formato con punto, asi que TODAS las
             -- facturas guardadas con coma sumaban 0 sin avisar de nada.
             SUM(
               CASE WHEN setex_total_num(up.total_factura) IS NULL THEN 0
                    ELSE setex_total_num(up.total_factura) END
             )::NUMERIC(15,2) AS total_importe
      FROM users u
      LEFT JOIN uploads up ON up.user_id = u.id
      WHERE u.is_test IS NOT TRUE
      GROUP BY u.id
      ORDER BY u.company_name NULLS LAST, u.email
    `);
    res.json({ users: r.rows });
  } catch (err) {
    logger.error('Admin users error:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

app.put('/api/admin/users/:id', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  const { company_name } = req.body || {};
  const cleanName = company_name ? String(company_name).trim().substring(0, 255) : null;
  try {
    const r = await pool.query('UPDATE users SET company_name = $1 WHERE id = $2 RETURNING id', [cleanName, id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    auditLog('ADMIN_UPDATE_COMPANY_NAME', { user_id: id, company_name: cleanName }, req.user.userId, req.ip);
    logger.info(`[Admin] company_name="${cleanName}" para usuario ${id} actualizado por ${req.user.email}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Admin update user error:', err);
    res.status(500).json({ error: 'Error al actualizar la empresa' });
  }
});

// Start server
async function start() {
  // Cache JWT secret al arrancar — evita leer disco en cada request
  jwtSecretCached = await readSecret('jwt_secret');
  logger.info('JWT secret cargado en cache');

  await initDB();

  // Constraint UNIQUE para protección a nivel BD contra duplicados concurrentes
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_uploads_unique_invoice
      ON uploads(user_id, proveedor_nif, fecha_emision, total_factura)
      WHERE proveedor_nif IS NOT NULL AND fecha_emision IS NOT NULL AND total_factura IS NOT NULL
    `);
    logger.info('Unique index para duplicados creado/verificado');
  } catch (err) {
    logger.warn('No se pudo crear unique index (puede que ya exista):', err.message);
  }

  // MT-001: Migración known_cifs → company_catalog ELIMINADA (2026-04-10).
  // Este bloque promovía datos privados de usuarios al catálogo global en cada reinicio.
  // El company_catalog solo puede ser editado por admins desde el panel de administración.

  // Migración: añadir user_id a known_cifs si no existe
  try {
    await pool.query(`ALTER TABLE known_cifs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`);
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'known_cifs_proveedor_nombre_norm_proveedor_nif_key') THEN
          ALTER TABLE known_cifs DROP CONSTRAINT known_cifs_proveedor_nombre_norm_proveedor_nif_key;
        END IF;
      END $$;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS known_cifs_user_nombre_key
      ON known_cifs(user_id, proveedor_nombre_norm) WHERE user_id IS NOT NULL
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_known_cifs_user_nombre ON known_cifs(user_id, proveedor_nombre_norm)`);
    logger.info('[Migration] known_cifs user_id scoping OK');
  } catch (err) {
    logger.warn('[Migration] known_cifs:', err.message);
  }

  await initEmailTransporter();

  // ── Cleanup Scheduler ─────────────────────────────────────────────────────
  // Con 250 usuarios subiendo bastantes facturas, dos vectores de acumulación:
  //   1. refresh_tokens   — filas creadas en cada login + cada refresh (cada 15min)
  //   2. audit_logs       — eventos por cada operación (upload, login, etc.)
  //
  // Diseño profesional:
  //   • LIMIT en cada delete → transacciones cortas, sin bloquear la BD
  //   • Retención diferenciada: operacional 90d / seguridad 365d
  //   • Arranque diferido 60s → no compite con inicialización
  //   • Cada función es independiente y falla sin romper las demás

  /** Limpia refresh_tokens caducados y revocados.
   *  Con 250 usuarios activos: ~500-3000 filas/día → sin limpieza satura en semanas. */
  async function cleanRefreshTokens() {
    try {
      // Tokens expirados (caducaron hace >1h — 1h de gracia para peticiones en vuelo)
      const expiredRes = await pool.query(
        `DELETE FROM refresh_tokens
         WHERE id IN (
           SELECT id FROM refresh_tokens
           WHERE expires_at < NOW() - INTERVAL '1 hour'
           LIMIT 5000
         )`
      );
      // Tokens revocados hace >30 días (retenemos 30d para forense/detección de reuso)
      const revokedRes = await pool.query(
        `DELETE FROM refresh_tokens
         WHERE id IN (
           SELECT id FROM refresh_tokens
           WHERE revoked = true AND revoked_at < NOW() - INTERVAL '30 days'
           LIMIT 5000
         )`
      );
      const total = (expiredRes.rowCount || 0) + (revokedRes.rowCount || 0);
      if (total > 0) {
        logger.info(`[Cleanup] refresh_tokens: ${expiredRes.rowCount} expirados + ${revokedRes.rowCount} revocados eliminados`);
      }
    } catch (err) {
      logger.error('[Cleanup] Error limpiando refresh_tokens:', err.message);
    }
  }

  /** Limpia audit_logs con retención diferenciada:
   *  - Eventos operacionales (login OK, upload): 90 días
   *  - Eventos de seguridad (fallos, bloqueos): 365 días
   *  Con 250 usuarios activos: potencialmente 2000-5000 filas/día. */
  async function cleanAuditLogs() {
    // Acciones de seguridad — retención 1 año
    const SECURITY_ACTIONS = [
      'LOGIN_FAILED', 'LOGIN_BLOCKED', 'REGISTER_BLOCKED',
      'COMPANY_REJECTED', 'TOKEN_REUSE_DETECTED', 'UPLOAD_BLOCKED',
    ];
    const secPlaceholders = SECURITY_ACTIONS.map((_, i) => `$${i + 1}`).join(',');
    try {
      // Eventos operacionales → 90 días
      const opRes = await pool.query(
        `DELETE FROM audit_logs
         WHERE id IN (
           SELECT id FROM audit_logs
           WHERE created_at < NOW() - INTERVAL '90 days'
             AND action NOT IN (${secPlaceholders})
           LIMIT 1000
         )`,
        SECURITY_ACTIONS
      );
      // Eventos de seguridad → 365 días
      const secRes = await pool.query(
        `DELETE FROM audit_logs
         WHERE id IN (
           SELECT id FROM audit_logs
           WHERE created_at < NOW() - INTERVAL '365 days'
             AND action IN (${secPlaceholders})
           LIMIT 500
         )`,
        SECURITY_ACTIONS
      );
      const total = (opRes.rowCount || 0) + (secRes.rowCount || 0);
      if (total > 0) {
        logger.info(`[Cleanup] audit_logs: ${opRes.rowCount} operacionales + ${secRes.rowCount} seguridad eliminados`);
      }
    } catch (err) {
      logger.error('[Cleanup] Error limpiando audit_logs:', err.message);
    }
  }

  /** Arranque del scheduler de limpieza. */
  function startCleanupScheduler() {
    // Primera ejecución diferida 60s para no competir con el arranque del servidor
    setTimeout(async () => {
      logger.info('[Cleanup] Ejecutando limpieza inicial...');
      await cleanRefreshTokens();
      await cleanAuditLogs();
    }, 60_000);

    // RT cada 6 horas (250 usuarios generan ~500-3000 filas/día)
    setInterval(cleanRefreshTokens, 6 * 60 * 60 * 1000);
    // Audit logs cada 24 horas
    setInterval(cleanAuditLogs, 24 * 60 * 60 * 1000);

    logger.info('[Cleanup] Scheduler iniciado: RT cada 6h · audit_logs cada 24h');
  }

  startCleanupScheduler();

  // Limpieza horaria de archivos huérfanos (previews no confirmados)
  // H-001: función recursiva — cubre /app/uploads/{user}/ y /app/uploads/{user}/{nif}/
  async function cleanupOrphanFilesRecursive(dir, cutoffMs) {
    let deleted = 0;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return 0; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue; // Q10: prevenir loops infinitos en symlinks
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        deleted += await cleanupOrphanFilesRecursive(fullPath, cutoffMs);
        // Q1: borrar directorio vacío tras limpiar su contenido
        try {
          const remaining = await fs.readdir(fullPath);
          if (remaining.length === 0) await fs.rmdir(fullPath).catch(() => {});
        } catch {}
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat || stat.mtimeMs > cutoffMs) continue;
        const exists = await pool.query('SELECT 1 FROM uploads WHERE filename = $1', [entry.name]);
        if (exists.rows.length === 0) {
          await fs.unlink(fullPath).catch(() => {});
          deleted++;
        }
      }
    }
    return deleted;
  }

  setInterval(async () => {
    try {
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      const deleted = await cleanupOrphanFilesRecursive('/app/uploads', cutoff);
      if (deleted > 0) logger.info(`[Cleanup] ${deleted} archivo(s) huérfano(s) eliminados de uploads (recursive)`);
    } catch (err) {
      logger.warn('[Cleanup] Error en limpieza de uploads:', err.message);
    }
  }, 60 * 60 * 1000);

  // SANDBOX: purga periódica (cada 60s) de uploads/audit/tokens de usuarios is_test=true
  // No requiere cron del sistema; corre dentro del propio proceso Node.
  const { startTestCleanup } = require('./services/test-cleanup');
  startTestCleanup({ pool, logger, intervalMs: 60_000 });

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

start();
