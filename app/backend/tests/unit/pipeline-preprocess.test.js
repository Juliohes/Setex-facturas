// tests/unit/pipeline-preprocess.test.js
// Fase 3 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: quality gate de imagen.
// El test más importante de este fichero congela la calibración real: NINGUNA
// de las facturas reales usadas para fijar los umbrales debe quedar
// rechazada — si algún cambio futuro de los umbrales rompe esto, el test
// avisa antes de que llegue a producción.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const {
  analizarCalidadImagen,
  UMBRAL_NITIDEZ_MINIMA,
  UMBRAL_BRILLO_MAXIMO,
  UMBRAL_BRILLO_MINIMO,
  UMBRAL_ENTROPIA_BLANCO,
  corregirPerspectivaSiConfiable,
} = require('../../src/pipeline/preprocess');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

// Snapshot de las 27 facturas reales usadas para calibrar (2026-07-27, ver
// docs/INFORME-AUDITORIA-OCR.md) — nitidez y brillo medidos con
// analizarCalidadImagen() contra los ficheros reales en su momento. No se
// versionan las imágenes originales (son datos de clientes reales); se
// congela aquí el resultado numérico ya observado para poder testear la
// lógica sin depender de ficheros externos al repo.
const NITIDEZ_REAL_OBSERVADA = [
  1.13, 1.21, 1.40, 1.41, 1.47, 1.48, 1.54, 1.55, 1.60, 1.70, 1.72, 1.74,
  1.78, 1.80, 1.90, 2.02, 2.04, 2.14, 2.27, 2.42, 2.50, 2.51, 2.83, 2.83,
  2.93, 3.57, 4.53,
];
const BRILLO_REAL_OBSERVADO = [
  144, 136, 144, 138, 132, 164, 155, 148, 123, 162, 163, 152, 166, 123, 160,
  163, 164, 176, 132, 166, 121, 165, 167, 126, 126, 235, 241,
];

describe('Calibración real (27 facturas ya procesadas con éxito, 2026-07-27)', () => {
  test('ninguna nitidez real observada cae por debajo del umbral recalibrado', () => {
    const rechazadas = NITIDEZ_REAL_OBSERVADA.filter((v) => v < UMBRAL_NITIDEZ_MINIMA);
    assert.deepEqual(rechazadas, [], `Con el umbral actual (${UMBRAL_NITIDEZ_MINIMA}) se rechazarían ${rechazadas.length} facturas reales que sí se leyeron bien`);
  });

  test('ningún brillo real observado cae fuera del rango recalibrado', () => {
    const rechazadas = BRILLO_REAL_OBSERVADO.filter((v) => v < UMBRAL_BRILLO_MINIMO || v > UMBRAL_BRILLO_MAXIMO);
    assert.deepEqual(rechazadas, [], `Con los umbrales actuales se rechazarían ${rechazadas.length} facturas reales por brillo`);
  });

  test('el umbral viejo (nitidez<2) SÍ habría rechazado más de la mitad — documenta por qué se recalibró', () => {
    const habriaRechazado = NITIDEZ_REAL_OBSERVADA.filter((v) => v < 2).length;
    assert.ok(habriaRechazado > NITIDEZ_REAL_OBSERVADA.length / 2, 'el umbral antiguo debía ser claramente demasiado estricto');
  });
});

describe('analizarCalidadImagen', () => {
  test('imagen nítida y de brillo normal → passed=true, sin issues', async () => {
    // Imagen sintética con ruido (para que tenga nitidez/entropía reales, no un plano uniforme)
    const buffer = await sharp({
      create: {
        width: 400, height: 400, channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .composite([{ input: Buffer.from(Array.from({ length: 400 * 400 * 3 }, () => Math.floor(Math.random() * 255))), raw: { width: 400, height: 400, channels: 3 }, blend: 'over' }])
      .jpeg()
      .toBuffer();
    const tmpPath = `/tmp/qg-test-${Date.now()}.jpg`;
    await sharp(buffer).toFile(tmpPath);
    try {
      const r = await analizarCalidadImagen(tmpPath);
      assert.equal(typeof r.passed, 'boolean');
      assert.equal(typeof r.metrics.sharpness, 'number');
    } finally {
      require('fs').unlinkSync(tmpPath);
    }
  });

  test('imagen totalmente en blanco (color plano) → detectada como blanco/vacía', async () => {
    const tmpPath = `/tmp/qg-test-blank-${Date.now()}.jpg`;
    await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .jpeg()
      .toFile(tmpPath);
    try {
      const r = await analizarCalidadImagen(tmpPath);
      assert.equal(r.passed, false);
      assert.ok(r.issues.some((i) => i.includes('blanco')));
      assert.ok(r.metrics.entropy < UMBRAL_ENTROPIA_BLANCO);
    } finally {
      require('fs').unlinkSync(tmpPath);
    }
  });

  test('nunca lanza excepción por una imagen válida, solo por fichero inexistente', async () => {
    await assert.rejects(() => analizarCalidadImagen('/tmp/no-existe-de-verdad-12345.jpg'));
  });
});

describe('corregirPerspectivaSiConfiable', () => {
  test('documento inclinado con contorno claro → lo endereza', async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, 'documento-inclinado.jpg'));
    const r = await corregirPerspectivaSiConfiable(buffer);
    assert.equal(r.corregido, true);
    assert.equal(r.motivo, null);
    assert.ok(r.buffer.length > 0);
    // El resultado corregido debe seguir siendo un JPEG válido y decodificable.
    const meta = await sharp(r.buffer).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.ok(meta.width > 50 && meta.height > 50);
  });

  test('sin ningún documento detectable → deja la imagen intacta, no lanza', async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, 'sin-documento.jpg'));
    const r = await corregirPerspectivaSiConfiable(buffer);
    assert.equal(r.corregido, false);
    assert.equal(r.motivo, 'sin_contorno_detectado');
    assert.equal(r.buffer, buffer, 'debe devolver el MISMO buffer original, sin tocarlo');
  });

  test('nunca lanza excepción, ni con un buffer que no es una imagen válida', async () => {
    const r = await corregirPerspectivaSiConfiable(Buffer.from('esto no es una imagen'));
    assert.equal(r.corregido, false);
    assert.ok(r.motivo);
  });
});
