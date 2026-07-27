// tests/unit/pipeline-reextraction.test.js
// Fase 7 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: re-extracción dirigida.
// Mockea global.fetch (Gemini/OpenAI) — cero red real.
'use strict';

const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('fs');
const {
  calcularRecorte,
  recortarZona,
  reextraerCampoDirigido,
  reextraerCamposDirigidos,
  MAX_CAMPOS_POR_DOCUMENTO,
} = require('../../src/pipeline/reextraction');

describe('calcularRecorte', () => {
  test('escala el polígono de la página de Azure a la resolución real y añade margen', () => {
    // Página analizada por Azure: 1000×1000. Imagen real a recortar: 2000×2000 (2x).
    const poligono = [400, 400, 600, 400, 600, 500, 400, 500]; // caja 200×100 en espacio Azure
    const r = calcularRecorte(poligono, { ancho: 1000, alto: 1000 }, { width: 2000, height: 2000 });
    // Escalado ×2: caja real 800,800 → 1200,1000. Con margen 15%: ancho=400*2=800→margen 60px
    assert.ok(r.left < 800 && r.left > 700, `left inesperado: ${r.left}`);
    assert.ok(r.width > 400, `width inesperado: ${r.width}`);
  });

  test('nunca se sale de los límites de la imagen (clamping)', () => {
    const poligono = [0, 0, 50, 0, 50, 50, 0, 50]; // esquina superior izquierda
    const r = calcularRecorte(poligono, { ancho: 100, alto: 100 }, { width: 100, height: 100 });
    assert.ok(r.left >= 0);
    assert.ok(r.top >= 0);
    assert.ok(r.left + r.width <= 100);
    assert.ok(r.top + r.height <= 100);
  });
});

describe('recortarZona', () => {
  test('recorta y amplía una imagen real a un JPEG válido', async () => {
    const tmpPath = `/tmp/reext-test-${Date.now()}.jpg`;
    await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toFile(tmpPath);
    try {
      const buffer = await recortarZona(
        tmpPath,
        { pagina: 1, poligono: [1, 1, 3, 1, 3, 2, 1, 2] },
        [{ pagina: 1, ancho: 8, alto: 6, unidad: 'inch' }],
      );
      const meta = await sharp(buffer).metadata();
      assert.equal(meta.format, 'jpeg');
      assert.ok(meta.width >= 500, 'debe ampliarse a un ancho mínimo legible');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });
});

describe('reextraerCampoDirigido (fetch mockeado, sin red real)', () => {
  let tmpPath, fetchMock;

  beforeEach(async () => {
    tmpPath = `/tmp/reext-campo-${Date.now()}.jpg`;
    await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toFile(tmpPath);
    process.env.GEMINI_API_KEY = 'test-key-000000';
    process.env.OPENAI_API_KEY = 'test-key-000000';
  });
  afterEach(() => { fs.unlinkSync(tmpPath); if (fetchMock) fetchMock.mock.restore(); });

  const boundingBox = { pagina: 1, poligono: [1, 1, 3, 1, 3, 2, 1, 2] };
  const paginasInfo = [{ pagina: 1, ancho: 8, alto: 6, unidad: 'inch' }];

  test('sin bounding box → resuelto:false inmediato, sin llamar a nadie', async () => {
    const r = await reextraerCampoDirigido('total', tmpPath, null, paginasInfo, {}, null);
    assert.equal(r.resuelto, false);
    assert.match(r.motivo, /sin bounding box/);
  });

  test('Gemini responde con éxito → resuelto:true, fuente gemini_flash_dirigido', async () => {
    fetchMock = mock.method(global, 'fetch', async () => ({
      ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ valor: '121,00' }) }] } }] }),
    }));
    const r = await reextraerCampoDirigido('total', tmpPath, boundingBox, paginasInfo, {}, null);
    assert.equal(r.resuelto, true);
    assert.equal(r.valor, '121,00');
    assert.equal(r.fuente, 'gemini_flash_dirigido');
  });

  test('Gemini falla del todo → cae a OpenAI, resuelto:true con fuente openai_dirigido', async () => {
    let llamadas = 0;
    fetchMock = mock.method(global, 'fetch', async (url) => {
      llamadas++;
      if (String(url).includes('generativelanguage')) return { ok: false, status: 500, text: async () => 'error' };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ valor: '121,00' }) } }] }) };
    });
    const r = await reextraerCampoDirigido('total', tmpPath, boundingBox, paginasInfo, {}, null);
    assert.equal(r.resuelto, true);
    assert.equal(r.fuente, 'openai_dirigido');
  });

  test('ambos motores fallan del todo → resuelto:false, nunca lanza', async () => {
    fetchMock = mock.method(global, 'fetch', async () => ({ ok: false, status: 500, text: async () => 'error' }));
    const r = await reextraerCampoDirigido('total', tmpPath, boundingBox, paginasInfo, {}, null);
    assert.equal(r.resuelto, false);
  });
});

describe('reextraerCamposDirigidos (límite por documento + traducción de nombres)', () => {
  test(`respeta el límite de ${MAX_CAMPOS_POR_DOCUMENTO} campos por documento`, async () => {
    const disputas = [
      { campo: 'emisor.nif' }, { campo: 'receptor.nif' }, { campo: 'total' },
      { campo: 'cuota_iva' }, { campo: 'base_imponible' }, { campo: 'numero_factura' }, // 6 disputas
    ];
    const r = await reextraerCamposDirigidos(disputas, '/tmp/no-hace-falta.jpg', {}, {}, null);
    assert.equal(r.length, 6);
    const descartados = r.filter((x) => x.motivo?.includes('límite'));
    assert.equal(descartados.length, 6 - MAX_CAMPOS_POR_DOCUMENTO);
  });

  test('campo sin traducción a azure.js (p.ej. nombre) → resuelto:false explícito', async () => {
    const r = await reextraerCamposDirigidos([{ campo: 'emisor.nombre' }], '/tmp/no-hace-falta.jpg', {}, {}, null);
    assert.equal(r[0].resuelto, false);
    assert.match(r[0].motivo, /sin bounding box posible/);
  });
});
