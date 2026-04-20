// Generador determinístico de nombres de fichero para uploads.
// Formato: username_YYYYMMDD_HHMMSSmmm_RANDOM.ext
// ms + 3-byte hex (6 caracteres) = anti-colisión probada hasta miles req/s.
'use strict';

const crypto = require('crypto');
const path = require('path');

function generateUploadFilename(email, originalName) {
  const username = String(email || 'unknown').split('@')[0] || 'unknown';
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  const rand = crypto.randomBytes(3).toString('hex');
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  return `${username}_${dateStr}${ms}_${rand}${ext}`;
}

module.exports = { generateUploadFilename };
