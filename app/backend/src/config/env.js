// Validación de variables de entorno con Zod-lite (sin dependencia extra por ahora).
// En Fase 3 migrar a Zod real cuando se instale la dependencia.
// Fallamos RÁPIDO al arranque si alguna variable crítica está mal.
'use strict';

function readIntEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`ENV ${name}="${raw}" no es un entero válido`);
  return n;
}

function readBoolEnv(name, def = false) {
  const raw = process.env[name];
  if (raw === undefined) return def;
  return raw === 'true' || raw === '1';
}

function readStringEnv(name, def = null, required = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (required) throw new Error(`ENV ${name} es obligatoria y no está definida`);
    return def;
  }
  return raw;
}

const env = {
  NODE_ENV: readStringEnv('NODE_ENV', 'production'),
  PORT: readIntEnv('PORT', 3000),
  UPLOAD_RATE_LIMIT: readIntEnv('UPLOAD_RATE_LIMIT', 30),
  POSTGRES_HOST: readStringEnv('POSTGRES_HOST', 'postgres'),
  POSTGRES_PORT: readIntEnv('POSTGRES_PORT', 5432),
  POSTGRES_DB: readStringEnv('POSTGRES_DB', 'setex_db'),
  POSTGRES_USER: readStringEnv('POSTGRES_USER', 'setex_user'),
  REDIS_URL: readStringEnv('REDIS_URL', 'redis://redis:6379'),
  SMTP_HOST: readStringEnv('SMTP_HOST', 'smtp.gmail.com'),
  SMTP_PORT: readIntEnv('SMTP_PORT', 587),
  SMTP_SECURE: readBoolEnv('SMTP_SECURE', false),
};

function isProduction() { return env.NODE_ENV === 'production'; }
function isStaging() { return env.NODE_ENV === 'staging'; }

module.exports = { env, isProduction, isStaging };
