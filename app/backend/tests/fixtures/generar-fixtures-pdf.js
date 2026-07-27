#!/usr/bin/env node
// Genera las fixtures de PDF usadas por tests/unit/pipeline-ingest.test.js.
// Requiere pdfkit (devDependency, solo para generar fixtures — nunca se usa
// en producción). Ejecutar solo si hay que regenerar las fixtures:
//   node tests/fixtures/generar-fixtures-pdf.js
'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function generar(rutaSalida, texto) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [200, 150] });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => { fs.writeFileSync(rutaSalida, Buffer.concat(chunks)); resolve(); });
    doc.on('error', reject);
    if (texto) doc.fontSize(10).text(texto);
    doc.end();
  });
}

(async () => {
  await generar(path.join(__dirname, 'pdf-nativo.pdf'), 'FACTURA NUM 0001\nPROVEEDOR ACME SL\nTOTAL 121,00 EUR');
  await generar(path.join(__dirname, 'pdf-escaneado.pdf'), null);
  console.log('Fixtures generadas en tests/fixtures/.');
})();
