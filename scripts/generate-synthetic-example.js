#!/usr/bin/env node
// scripts/generate-synthetic-example.js — Gap 3 del plan de cierre sobre el
// pipeline v2 (2026-07-28). Genera la ÚNICA factura sintética de ejemplo que
// SÍ se sube a git en eval/facturas/ (el resto son facturas reales de
// clientes, excluidas por .gitignore — RGPD). Sirve para que cualquiera que
// clone el repo vea el formato exacto de ground_truth.json sin depender de
// datos reales.
//
// Uso: node scripts/generate-synthetic-example.js
// (no requiere Docker ni BD — genera la imagen en el propio host con sharp,
// ya dependencia del proyecto backend)
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('/opt/setex/prod/app/backend/node_modules/sharp');

const DEST = path.join(__dirname, '..', 'app', 'backend', 'eval', 'facturas', 'sintetica-ejemplo');

const SVG = `
<svg width="900" height="1200" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="1200" fill="white"/>
  <text x="50" y="80" font-size="34" font-family="sans-serif" font-weight="bold">FACTURA DE EJEMPLO SINTÉTICA</text>
  <text x="50" y="140" font-size="22" font-family="sans-serif">Emisor: ACME DISTRIBUCIONES SL</text>
  <text x="50" y="175" font-size="22" font-family="sans-serif">NIF Emisor: B72327000</text>
  <text x="50" y="230" font-size="22" font-family="sans-serif">Receptor: CLIENTE DE PRUEBA SL</text>
  <text x="50" y="265" font-size="22" font-family="sans-serif">NIF Receptor: B87654321</text>
  <text x="50" y="320" font-size="22" font-family="sans-serif">Nº Factura: EJEMPLO-0001</text>
  <text x="50" y="355" font-size="22" font-family="sans-serif">Fecha: 01/01/2026</text>
  <text x="50" y="420" font-size="22" font-family="sans-serif">Base imponible: 100,00 EUR</text>
  <text x="50" y="455" font-size="22" font-family="sans-serif">IVA 21%: 21,00 EUR</text>
  <text x="50" y="490" font-size="22" font-family="sans-serif">Total: 121,00 EUR</text>
</svg>`;

const GROUND_TRUTH = {
  origen: 'sintetica',
  tipo_documento: 'foto_buena',
  nota: 'Ejemplo de formato — NO representa ninguna factura ni cliente real. Generado por scripts/generate-synthetic-example.js.',
  campos: {
    'emisor.nombre': { valor: 'ACME DISTRIBUCIONES SL', estado: 'legible', verificado: true },
    'emisor.nif': { valor: 'B72327000', estado: 'legible', verificado: true },
    'receptor.nombre': { valor: 'CLIENTE DE PRUEBA SL', estado: 'legible', verificado: true },
    'receptor.nif': { valor: 'B87654321', estado: 'legible', verificado: true },
    numero_factura: { valor: 'EJEMPLO-0001', estado: 'legible', verificado: true },
    fecha_emision: { valor: '01/01/2026', estado: 'legible', verificado: true },
    desglose_iva: [
      { base: { valor: '100,00', estado: 'legible', verificado: true },
        tipo: { valor: '21,0', estado: 'legible', verificado: true },
        cuota: { valor: '21,00', estado: 'legible', verificado: true } },
    ],
    retencion_irpf: { valor: null, estado: 'ausente', verificado: true },
    total: { valor: '121,00', estado: 'legible', verificado: true },
  },
};

async function run() {
  fs.mkdirSync(DEST, { recursive: true });
  await sharp(Buffer.from(SVG)).jpeg({ quality: 90 }).toFile(path.join(DEST, 'documento.jpg'));
  fs.writeFileSync(path.join(DEST, 'ground_truth.json'), JSON.stringify(GROUND_TRUTH, null, 2));
  console.log(`Ejemplo sintético generado en ${DEST}`);
}

run().catch((err) => { console.error('Error:', err.message); process.exit(1); });
