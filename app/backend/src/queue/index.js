// src/queue/index.js
// Conexión Redis para seguridad (sec:block:*, sec:count:*) y previews OCR (preview:*).
// BullMQ eliminado: el procesamiento ya no es asíncrono — las facturas se guardan
// directamente en PostgreSQL al confirmar, sin pasar por Drive ni Sheets.
'use strict';

const IORedis = require('ioredis');
const fsSync = require('fs');

// HAL-008: leer contraseña Redis desde Docker secret si está disponible.
// Si no hay secret (desarrollo local), usa REDIS_URL tal cual.
function buildRedisUrl() {
  let url = process.env.REDIS_URL || 'redis://localhost:6379';

  // Si ya viene con contraseña en la URL (redis://:pass@host) no sobreescribir
  if (url.includes('@')) return url;

  try {
    const pass = fsSync.readFileSync('/run/secrets/redis_password', 'utf8').trim();
    if (pass) {
      // Insertar contraseña: redis://host:port → redis://:pass@host:port
      url = url.replace(/^redis:\/\//, `redis://:${pass}@`);
    }
  } catch {}

  return url;
}

const REDIS_URL = buildRedisUrl();

// Conexión con maxRetriesPerRequest:null para compatibilidad con cualquier uso async
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on('error', (err) => {
  // No crashear el proceso si Redis tiene problemas temporales
  if (err.message && !err.message.includes('ECONNREFUSED')) {
    console.error('[Redis] Error de conexión:', err.message);
  }
});

module.exports = { connection, REDIS_URL };
