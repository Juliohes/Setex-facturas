// Password service — bcrypt cost 12 (mínimo recomendado 2026).
// Cuando la carga lo permita, migrar a Argon2id (memory=64MB, iter=3, paral=4).
'use strict';

const bcrypt = require('bcrypt');

const BCRYPT_COST = 12;

async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('Password debe ser string de al menos 8 caracteres');
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword, BCRYPT_COST };
