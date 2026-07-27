#!/usr/bin/env node
// Genera las fixtures usadas por la sección "corregirPerspectivaSiConfiable"
// de tests/unit/pipeline-preprocess.test.js. Sintéticas a propósito — no se
// versionan facturas reales de clientes (RGPD).
// Ejecutar solo si hay que regenerarlas: node tests/fixtures/generar-fixtures-perspectiva.js
'use strict';

const sharp = require('sharp');
const path = require('path');

(async () => {
  // "Documento" blanco con borde negro y texto, rotado 12° sobre fondo gris
  // — simula una foto de factura hecha en ángulo sobre una mesa.
  const papel = await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{
      input: Buffer.from(`<svg width='400' height='600'><rect x='0' y='0' width='400' height='600' fill='white' stroke='black' stroke-width='8'/><text x='40' y='60' font-size='30'>FACTURA</text><line x1='30' y1='100' x2='370' y2='100' stroke='black' stroke-width='4'/></svg>`),
      top: 0, left: 0,
    }])
    .png()
    .toBuffer();

  await sharp(papel)
    .rotate(12, { background: { r: 120, g: 120, b: 120 } })
    .resize({ width: 700, height: 900, fit: 'contain', background: { r: 120, g: 120, b: 120 } })
    .jpeg({ quality: 95 })
    .toFile(path.join(__dirname, 'documento-inclinado.jpg'));

  // Fondo uniforme sin ningún documento — no debe detectarse ningún contorno.
  await sharp({ create: { width: 700, height: 900, channels: 3, background: { r: 120, g: 120, b: 120 } } })
    .jpeg({ quality: 90 })
    .toFile(path.join(__dirname, 'sin-documento.jpg'));

  console.log('Fixtures de perspectiva generadas en tests/fixtures/.');
})();
