// Lectura de Docker Secrets desde /run/secrets/ con fallback a variables de entorno.
// Única puerta de entrada para credenciales. NUNCA logear los valores.
'use strict';

const fs = require('fs');
const path = require('path');

const SECRETS_DIR = '/run/secrets';

function readSecret(name, { required = false } = {}) {
  // 1. Docker secret
  const secretPath = path.join(SECRETS_DIR, name);
  try {
    const value = fs.readFileSync(secretPath, 'utf8').trim();
    if (value) return value;
  } catch { /* pasa a fallback */ }

  // 2. Variable de entorno como fallback
  const envName = name.toUpperCase();
  const envValue = process.env[envName];
  if (envValue) return envValue.trim();

  if (required) {
    throw new Error(`Secret "${name}" no encontrado en /run/secrets/${name} ni en ENV ${envName}`);
  }
  return null;
}

function readSecretCached() {
  const cache = new Map();
  return (name, opts) => {
    if (cache.has(name)) return cache.get(name);
    const v = readSecret(name, opts);
    cache.set(name, v);
    return v;
  };
}

module.exports = { readSecret, readSecretCached };
