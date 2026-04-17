// src/config/index.js
// Carga features.json. Cambios en features.json NO requieren rebuild (volume-mounted).
'use strict';

let config;
try {
  config = require('./features.json');
} catch (err) {
  console.error('WARN: Cannot load config/features.json:', err.message);
  config = {
    ocr_enabled: true,
    ocr_mode: 'dual',
    ocr_primary_engine: 'openai',
    image_max_resolution: 1536,
    image_jpeg_quality: 85,
  };
}

module.exports = config;
