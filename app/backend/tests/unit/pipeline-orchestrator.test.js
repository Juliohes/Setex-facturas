// tests/unit/pipeline-orchestrator.test.js
// Fase 10 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: orquestador en modo
// sombra. Mockea extractors/reextraction (red) — ingest/preprocess corren
// de verdad sobre una imagen sintética (sin red, rápido). confidence y
// observabilidad corren de verdad (puras, sin red).
'use strict';

const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('fs');
const extractors = require('../../src/pipeline/extractors');
const reextraction = require('../../src/pipeline/reextraction');
const preprocess = require('../../src/pipeline/preprocess');
const aprendizaje = require('../../src/pipeline/aprendizaje');
const tesseractAdapter = require('../../src/ocr/tesseract');
const { ejecutarPipelineV2Sombra } = require('../../src/pipeline/orchestrator');

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

function candidatoCanonico({ nif = 'B72327000', numeroFactura = '0001', total = '121,00' } = {}) {
  return {
    emisor: { nif, nombre: 'ACME SL' },
    receptor: { nif: 'B87654321', nombre: 'Cliente SL' },
    numero_factura: numeroFactura,
    fecha_emision: '01/01/2026',
    lineas_iva: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }],
    retencion_irpf: '0,00',
    total,
    moneda: 'EUR',
    es_factura_valida: true,
    _fuente: 'azure',
    _confianza: 0.95,
  };
}

describe('ejecutarPipelineV2Sombra', () => {
  let tmpPath, mExtraccion;

  beforeEach(async () => {
    tmpPath = `/tmp/orch-test-${Date.now()}.jpg`;
    await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 200, b: 200 } },
    }).composite([{
      input: Buffer.from(Array.from({ length: 400 * 400 * 3 }, () => Math.floor(Math.random() * 255))),
      raw: { width: 400, height: 400, channels: 3 }, blend: 'over',
    }]).jpeg().toFile(tmpPath);
  });
  afterEach(() => { fs.unlinkSync(tmpPath); if (mExtraccion) mExtraccion.mock.restore(); });

  test('camino feliz: ambos motores OK, sin disputas → devuelve registro con estado', async () => {
    const A = candidatoCanonico();
    const B = candidatoCanonico();
    mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
      azure: { motor: 'azure', ok: true, campos: A, tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
      gemini_flash: { motor: 'gemini_flash', ok: true, campos: B, tiempo_ms: 150, coste_estimado_usd: 0.006 },
    }));

    const r = await ejecutarPipelineV2Sombra({ uploadId: 1, filePath: tmpPath, mimeType: 'image/jpeg', context: {}, cfg: {}, logger: NOOP_LOGGER });
    assert.ok(r);
    assert.equal(r.upload_id, 1);
    assert.equal(r.disputas.length, 0);
    assert.equal(r.estado, 'auto_aprobada');
    assert.ok(r.coste_estimado_usd > 0);
  });

  test('un motor falla → el otro se usa igualmente, sin disputas', async () => {
    const B = candidatoCanonico();
    mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
      azure: { motor: 'azure', ok: false, error: 'HTTP 429', coste_estimado_usd: null },
      gemini_flash: { motor: 'gemini_flash', ok: true, campos: B, tiempo_ms: 150, coste_estimado_usd: 0.006 },
    }));
    const r = await ejecutarPipelineV2Sombra({ uploadId: 2, filePath: tmpPath, mimeType: 'image/jpeg', context: {}, cfg: {}, logger: NOOP_LOGGER });
    assert.ok(r);
    assert.equal(r.campos_canonicos.total, '121,00');
  });

  test('ambos motores fallan → devuelve null, no lanza', async () => {
    mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
      azure: { motor: 'azure', ok: false, error: 'HTTP 500' },
      gemini_flash: { motor: 'gemini_flash', ok: false, error: 'HTTP 500' },
    }));
    const r = await ejecutarPipelineV2Sombra({ uploadId: 3, filePath: tmpPath, mimeType: 'image/jpeg', context: {}, cfg: {}, logger: NOOP_LOGGER });
    assert.equal(r, null);
  });

  test('disputa + azure con bounding_boxes → re-extracción dirigida resuelve y reduce las disputas finales', async () => {
    const A = candidatoCanonico({ numeroFactura: '0001' });
    const B = candidatoCanonico({ numeroFactura: '0002' }); // discrepan, sin validación propia → disputa
    mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
      azure: { motor: 'azure', ok: true, campos: A, tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: { paginas: [{ pagina: 1, ancho: 400, alto: 400, unidad: 'pixel' }], numero_factura: { pagina: 1, poligono: [10, 10, 50, 10, 50, 20, 10, 20] } } },
      gemini_flash: { motor: 'gemini_flash', ok: true, campos: B, tiempo_ms: 150, coste_estimado_usd: 0.006 },
    }));
    const mReextraccion = mock.method(reextraction, 'reextraerCamposDirigidos', async () => ([
      { campo: 'numero_factura', resuelto: true, valor: '0001', fuente: 'gemini_flash_dirigido' },
    ]));
    try {
      const r = await ejecutarPipelineV2Sombra({ uploadId: 4, filePath: tmpPath, mimeType: 'image/jpeg', context: {}, cfg: {}, logger: NOOP_LOGGER });
      assert.ok(r);
      assert.equal(r.disputas.length, 0, 'la re-extracción debía resolver la única disputa');
      assert.equal(r.campos_canonicos.numero_factura, '0001');
    } finally {
      mReextraccion.mock.restore();
    }
  });

  test('disputa sin bounding_boxes de azure → no intenta re-extracción, la disputa queda para revisión humana', async () => {
    const A = candidatoCanonico({ numeroFactura: '0001' });
    const B = candidatoCanonico({ numeroFactura: '0002' });
    mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
      azure: { motor: 'azure', ok: true, campos: A, tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
      gemini_flash: { motor: 'gemini_flash', ok: true, campos: B, tiempo_ms: 150, coste_estimado_usd: 0.006 },
    }));
    const r = await ejecutarPipelineV2Sombra({ uploadId: 5, filePath: tmpPath, mimeType: 'image/jpeg', context: {}, cfg: {}, logger: NOOP_LOGGER });
    assert.ok(r);
    assert.equal(r.disputas.length, 1);
    assert.equal(r.estado, 'pendiente_revision');
  });

  test('un fallo interno inesperado (p.ej. fichero no existe) → nunca lanza, devuelve null', async () => {
    const r = await ejecutarPipelineV2Sombra({ uploadId: 6, filePath: '/tmp/no-existe-de-verdad-999.jpg', mimeType: 'image/jpeg', context: {}, cfg: {}, logger: NOOP_LOGGER });
    assert.equal(r, null);
  });

  // ── Gap "variantes de imagen en v2" (2026-07-28) ──────────────────────────
  describe('variante de contraste (ocr_extraccion_v2_variantes_enabled)', () => {
    let mVariante, mExtraccionVariantes;
    afterEach(() => {
      if (mVariante) mVariante.mock.restore();
      if (mExtraccionVariantes) mExtraccionVariantes.mock.restore();
    });

    test('flag apagado (default) → NUNCA genera la variante ni duplica llamadas', async () => {
      let llamadas = 0;
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => {
        llamadas++;
        return {
          azure: { motor: 'azure', ok: true, campos: candidatoCanonico(), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
          gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico(), tiempo_ms: 150, coste_estimado_usd: 0.006 },
        };
      });
      mVariante = mock.method(preprocess, 'generarVarianteContrasteParaExtraccion', async () => { throw new Error('no debería llamarse'); });

      const r = await ejecutarPipelineV2Sombra({ uploadId: 10, filePath: tmpPath, mimeType: 'image/jpeg', context: {}, cfg: {}, logger: NOOP_LOGGER });
      assert.ok(r);
      assert.equal(r.variante, 'estandar');
      assert.equal(llamadas, 1, 'con el flag apagado solo debe extraer una vez');
    });

    test('la variante contraste tiene MENOS disputas → gana ella y así queda registrado', async () => {
      mVariante = mock.method(preprocess, 'generarVarianteContrasteParaExtraccion', async () => Buffer.from('fake-jpeg'));
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async (rutaLlamada) => {
        // La ruta estándar es tmpPath; cualquier otra ruta es la variante temporal.
        if (rutaLlamada === tmpPath) {
          const A = candidatoCanonico({ numeroFactura: '0001' });
          const B = candidatoCanonico({ numeroFactura: '0002' }); // discrepan sin validación → disputa
          return {
            azure: { motor: 'azure', ok: true, campos: A, tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
            gemini_flash: { motor: 'gemini_flash', ok: true, campos: B, tiempo_ms: 150, coste_estimado_usd: 0.006 },
          };
        }
        const igual = candidatoCanonico({ numeroFactura: '0001' });
        return {
          azure: { motor: 'azure', ok: true, campos: igual, tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
          gemini_flash: { motor: 'gemini_flash', ok: true, campos: igual, tiempo_ms: 150, coste_estimado_usd: 0.006 },
        };
      });

      const r = await ejecutarPipelineV2Sombra({
        uploadId: 11, filePath: tmpPath, mimeType: 'image/jpeg', context: {},
        cfg: { ocr_extraccion_v2_variantes_enabled: true }, logger: NOOP_LOGGER,
      });
      assert.ok(r);
      assert.equal(r.variante, 'contraste');
      assert.equal(r.disputas.length, 0);
      assert.ok(r.coste_estimado_usd > 0.0015 + 0.006, 'el coste debe incluir AMBOS intentos, no solo el ganador');
    });

    test('si falla generar la variante, sigue con la estándar (fail-safe)', async () => {
      let llamadas = 0;
      mVariante = mock.method(preprocess, 'generarVarianteContrasteParaExtraccion', async () => { throw new Error('sharp explotó'); });
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => {
        llamadas++;
        return {
          azure: { motor: 'azure', ok: true, campos: candidatoCanonico(), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
          gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico(), tiempo_ms: 150, coste_estimado_usd: 0.006 },
        };
      });
      const r = await ejecutarPipelineV2Sombra({
        uploadId: 12, filePath: tmpPath, mimeType: 'image/jpeg', context: {},
        cfg: { ocr_extraccion_v2_variantes_enabled: true }, logger: NOOP_LOGGER,
      });
      assert.ok(r);
      assert.equal(r.variante, 'estandar');
      assert.equal(llamadas, 1, 'si la variante falla al generarse, no debe intentar extraer sobre ella');
    });
  });

  // ── Gap "aprendizaje continuo" (2026-07-28) — proveedor conocido ──────────
  describe('proveedor conocido (ocr_extraccion_v2_aprendizaje_enabled)', () => {
    let mAprendizaje;
    afterEach(() => { if (mAprendizaje) mAprendizaje.mock.restore(); });

    test('NIF conocido → sustituye el nombre leído por el ya confirmado', async () => {
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
        azure: { motor: 'azure', ok: true, campos: candidatoCanonico(), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
        gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico(), tiempo_ms: 150, coste_estimado_usd: 0.006 },
      }));
      mAprendizaje = mock.method(aprendizaje, 'buscarProveedorConocido', async () => ({
        nombre: 'ACME DISTRIBUCIONES SL (nombre confirmado)', fuente: 'known_cifs', confirmaciones: 4,
      }));

      const r = await ejecutarPipelineV2Sombra({
        uploadId: 20, filePath: tmpPath, mimeType: 'image/jpeg', context: { invoice_type: 'compra', userId: 1 },
        cfg: { ocr_extraccion_v2_aprendizaje_enabled: true }, logger: NOOP_LOGGER, pool: {},
      });
      assert.ok(r);
      assert.equal(r.campos_canonicos.emisor.nombre, 'ACME DISTRIBUCIONES SL (nombre confirmado)');
      assert.deepEqual(r.aprendizaje_aplicado, { fuente: 'known_cifs', confirmaciones: 4 });
    });

    test('sin coincidencia conocida → deja el nombre tal cual leyó la IA', async () => {
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
        azure: { motor: 'azure', ok: true, campos: candidatoCanonico(), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
        gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico(), tiempo_ms: 150, coste_estimado_usd: 0.006 },
      }));
      mAprendizaje = mock.method(aprendizaje, 'buscarProveedorConocido', async () => null);

      const r = await ejecutarPipelineV2Sombra({
        uploadId: 21, filePath: tmpPath, mimeType: 'image/jpeg', context: { invoice_type: 'compra', userId: 1 },
        cfg: { ocr_extraccion_v2_aprendizaje_enabled: true }, logger: NOOP_LOGGER, pool: {},
      });
      assert.ok(r);
      assert.equal(r.campos_canonicos.emisor.nombre, 'ACME SL');
      assert.equal(r.aprendizaje_aplicado, null);
    });

    test('fallo al buscar (BD caída) → no rompe el pipeline, sigue sin aprendizaje', async () => {
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
        azure: { motor: 'azure', ok: true, campos: candidatoCanonico(), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
        gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico(), tiempo_ms: 150, coste_estimado_usd: 0.006 },
      }));
      mAprendizaje = mock.method(aprendizaje, 'buscarProveedorConocido', async () => { throw new Error('conexión perdida'); });

      const r = await ejecutarPipelineV2Sombra({
        uploadId: 22, filePath: tmpPath, mimeType: 'image/jpeg', context: { invoice_type: 'compra', userId: 1 },
        cfg: { ocr_extraccion_v2_aprendizaje_enabled: true }, logger: NOOP_LOGGER, pool: {},
      });
      assert.ok(r, 'el pipeline no debe devolver null solo porque el aprendizaje falle');
      assert.equal(r.campos_canonicos.emisor.nombre, 'ACME SL');
    });
  });

  // ── Gap "aprendizaje continuo" (2026-07-28) — Tesseract anti-alucinación ──
  describe('verificación cruzada Tesseract (ocr_extraccion_v2_tesseract_enabled)', () => {
    let mTesseract;
    afterEach(() => { if (mTesseract) mTesseract.mock.restore(); });

    test('el NIF propuesto NO aparece en el texto bruto → se marca como alucinación sospechosa', async () => {
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
        azure: { motor: 'azure', ok: true, campos: candidatoCanonico({ nif: 'B72327000' }), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
        gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico({ nif: 'B72327000' }), tiempo_ms: 150, coste_estimado_usd: 0.006 },
      }));
      mTesseract = mock.method(tesseractAdapter, 'reconocerTextoBruto', async () => ({
        ok: true, textoBruto: 'este texto no contiene ningún NIF parecido', processing_time_s: 2,
      }));

      const r = await ejecutarPipelineV2Sombra({
        uploadId: 30, filePath: tmpPath, mimeType: 'image/jpeg', context: {},
        cfg: { ocr_extraccion_v2_tesseract_enabled: true }, logger: NOOP_LOGGER,
      });
      assert.ok(r);
      assert.ok(r.alucinaciones_sospechosas.includes('emisor.nif'));
    });

    test('el NIF SÍ aparece en el texto bruto → nada sospechoso', async () => {
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
        azure: { motor: 'azure', ok: true, campos: candidatoCanonico({ nif: 'B72327000' }), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
        gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico({ nif: 'B72327000' }), tiempo_ms: 150, coste_estimado_usd: 0.006 },
      }));
      mTesseract = mock.method(tesseractAdapter, 'reconocerTextoBruto', async () => ({
        ok: true,
        textoBruto: 'ACME SL CIF B72327000 Cliente SL CIF B87654321 factura 0001 base 100,00 total 121,00',
        processing_time_s: 2,
      }));

      const r = await ejecutarPipelineV2Sombra({
        uploadId: 31, filePath: tmpPath, mimeType: 'image/jpeg', context: {},
        cfg: { ocr_extraccion_v2_tesseract_enabled: true }, logger: NOOP_LOGGER,
      });
      assert.ok(r);
      assert.equal(r.alucinaciones_sospechosas.length, 0);
    });

    test('Tesseract falla → no bloquea el pipeline, sin alucinaciones marcadas', async () => {
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
        azure: { motor: 'azure', ok: true, campos: candidatoCanonico(), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
        gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico(), tiempo_ms: 150, coste_estimado_usd: 0.006 },
      }));
      mTesseract = mock.method(tesseractAdapter, 'reconocerTextoBruto', async () => ({ ok: false, error: 'no se pudo cargar el modelo' }));

      const r = await ejecutarPipelineV2Sombra({
        uploadId: 32, filePath: tmpPath, mimeType: 'image/jpeg', context: {},
        cfg: { ocr_extraccion_v2_tesseract_enabled: true }, logger: NOOP_LOGGER,
      });
      assert.ok(r);
      assert.equal(r.alucinaciones_sospechosas.length, 0);
    });

    test('flag apagado (default) → ni se llama a Tesseract', async () => {
      mExtraccion = mock.method(extractors, 'ejecutarExtraccionV2Paralelo', async () => ({
        azure: { motor: 'azure', ok: true, campos: candidatoCanonico(), tiempo_ms: 100, coste_estimado_usd: 0.0015, bounding_boxes: null },
        gemini_flash: { motor: 'gemini_flash', ok: true, campos: candidatoCanonico(), tiempo_ms: 150, coste_estimado_usd: 0.006 },
      }));
      mTesseract = mock.method(tesseractAdapter, 'reconocerTextoBruto', async () => { throw new Error('no debería llamarse'); });

      const r = await ejecutarPipelineV2Sombra({ uploadId: 33, filePath: tmpPath, mimeType: 'image/jpeg', context: {}, cfg: {}, logger: NOOP_LOGGER });
      assert.ok(r);
      assert.equal(r.alucinaciones_sospechosas.length, 0);
    });
  });
});
