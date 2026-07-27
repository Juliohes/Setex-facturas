// tests/unit/pipeline-ingest.test.js
// Fase 2 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: clasificador PDF nativo vs
// imagen/escaneado. Usa fixtures reales generadas con pdfkit (ver
// tests/fixtures/generar-fixtures-pdf.js) — no mocks de librería PDF, para
// que el test detecte de verdad si pdfjs-dist deja de parsear algo.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { clasificarDocumento, clasificarPDF, UMBRAL_CARACTERES_POR_PAGINA } = require('../../src/pipeline/ingest');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const PDF_NATIVO = fs.readFileSync(path.join(FIXTURES, 'pdf-nativo.pdf'));
const PDF_ESCANEADO = fs.readFileSync(path.join(FIXTURES, 'pdf-escaneado.pdf'));

describe('clasificarPDF', () => {
  test('PDF con texto real → pdf_nativo, con el texto extraído', async () => {
    const r = await clasificarPDF(PDF_NATIVO);
    assert.equal(r.tipo, 'pdf_nativo');
    assert.match(r.texto, /FACTURA/);
    assert.match(r.texto, /121,00/);
    assert.ok(r.caracteres_extraidos >= UMBRAL_CARACTERES_POR_PAGINA);
  });

  test('PDF sin ninguna capa de texto → pdf_escaneado', async () => {
    const r = await clasificarPDF(PDF_ESCANEADO);
    assert.equal(r.tipo, 'pdf_escaneado');
    assert.ok(r.caracteres_extraidos < UMBRAL_CARACTERES_POR_PAGINA);
  });

  test('buffer que no es un PDF válido → pdf_no_parseable, no lanza', async () => {
    const r = await clasificarPDF(Buffer.from('esto no es un PDF'));
    assert.equal(r.tipo, 'pdf_no_parseable');
    assert.ok(r.motivo);
  });
});

describe('clasificarDocumento', () => {
  test('mimeType application/pdf → delega en clasificarPDF', async () => {
    const r = await clasificarDocumento(PDF_NATIVO, 'application/pdf');
    assert.equal(r.tipo, 'pdf_nativo');
  });

  test('mimeType image/* → tipo imagen, sin analizar contenido', async () => {
    const r = await clasificarDocumento(Buffer.from('fake-jpeg-bytes'), 'image/jpeg');
    assert.equal(r.tipo, 'imagen');
  });

  test('mimeType desconocido → tipo desconocido, no lanza', async () => {
    const r = await clasificarDocumento(Buffer.from('x'), 'application/octet-stream');
    assert.equal(r.tipo, 'desconocido');
  });
});
