// Loader de config/features.json con defaults seguros. El fichero está montado
// como volumen en el container → cambios requieren solo reload, no rebuild.
// El cache en memoria se refresca vía reloadFeatures() (expuesto para tests
// y para el endpoint admin de hot-reload).
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  ocr_enabled: true,
  ocr_mode: 'dual',
  ocr_primary_engine: 'openai',
  image_max_resolution: 1536,
  image_jpeg_quality: 85,
});

const FEATURES_PATH = path.join(__dirname, 'features.json');

let cached = null;

function loadFeatures({ logger = null } = {}) {
  try {
    const raw = fs.readFileSync(FEATURES_PATH, 'utf8');
    cached = { ...DEFAULTS, ...JSON.parse(raw) };
    return cached;
  } catch (err) {
    logger?.warn?.('features.json load failed — using defaults', { message: err.message });
    cached = { ...DEFAULTS };
    return cached;
  }
}

function getFeatures() {
  return cached || loadFeatures();
}

function reloadFeatures(opts) {
  cached = null;
  return loadFeatures(opts);
}

module.exports = { loadFeatures, getFeatures, reloadFeatures, DEFAULTS };
