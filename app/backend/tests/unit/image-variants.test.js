// Tests de ocr/image-variants.js — generación de la variante de contraste (CLAHE).
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { generarVarianteContraste } = require('../../src/ocr/image-variants');

/** Genera una imagen sintética simple (degradado con una franja oscura) para probar el filtro. */
async function imagenSintetica() {
  return sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 180, g: 180, b: 180 } },
  })
    .composite([{
      input: await sharp({ create: { width: 200, height: 60, channels: 3, background: { r: 40, g: 40, b: 40 } } }).png().toBuffer(),
      top: 70, left: 0,
    }])
    .jpeg()
    .toBuffer();
}

describe('generarVarianteContraste', () => {
  test('devuelve un Buffer JPEG válido, decodificable, mismas dimensiones', async () => {
    const original = await imagenSintetica();
    const variante = await generarVarianteContraste(original);
    assert.ok(Buffer.isBuffer(variante));
    const meta = await sharp(variante).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 200);
    assert.equal(meta.height, 200);
  });

  test('reduce la saturación media respecto al original (imagen con color)', async () => {
    const coloreada = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 40, b: 40 } },
    }).jpeg().toBuffer();
    const variante = await generarVarianteContraste(coloreada);

    const statsOriginal = await sharp(coloreada).stats();
    const statsVariante = await sharp(variante).stats();
    // Con saturación reducida, la diferencia entre canales R y G/B debe encogerse.
    const spreadOriginal = statsOriginal.channels[0].mean - statsOriginal.channels[1].mean;
    const spreadVariante = statsVariante.channels[0].mean - statsVariante.channels[1].mean;
    assert.ok(Math.abs(spreadVariante) < Math.abs(spreadOriginal), `spread variante (${spreadVariante}) debería ser menor que original (${spreadOriginal})`);
  });

  test('no lanza excepción con una imagen mínima (1x1)', async () => {
    const minima = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 100, g: 100, b: 100 } } }).jpeg().toBuffer();
    const variante = await generarVarianteContraste(minima);
    assert.ok(Buffer.isBuffer(variante));
  });
});
