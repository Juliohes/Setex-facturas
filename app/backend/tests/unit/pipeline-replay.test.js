// tests/unit/pipeline-replay.test.js
// Gap 2 del plan de cierre sobre el pipeline v2 existente (2026-07-28):
// reprocesar facturas ya confirmadas, en modo solo-lectura respecto a v1.
// Mockea orchestrator.ejecutarPipelineV2Sombra (red) — replay.js en sí es
// pura orquestación de fichero+BD, sin llamadas a IA propias.
'use strict';

const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const orchestrator = require('../../src/pipeline/orchestrator');
const { replayFactura } = require('../../src/pipeline/replay');

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

function registroFalso(overrides = {}) {
  return {
    upload_id: 1,
    campos_canonicos: { emisor: { nif: 'B72327000' }, total: '121,00' },
    confianzas: {},
    disputas: [],
    score_global: 0.95,
    estado: 'auto_aprobada',
    version_pipeline: 'v2',
    coste_estimado_usd: 0.008,
    latencia_ms: 3200,
    ...overrides,
  };
}

function poolFalso() {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; },
  };
}

describe('replayFactura', () => {
  let tmpPath, mPipeline;

  beforeEach(() => { tmpPath = `/tmp/replay-test-${Date.now()}.jpg`; fs.writeFileSync(tmpPath, 'contenido-fake'); });
  afterEach(() => { fs.unlinkSync(tmpPath); if (mPipeline) mPipeline.mock.restore(); });

  test('camino feliz: procesa, inserta con modo=replay, devuelve ok', async () => {
    mPipeline = mock.method(orchestrator, 'ejecutarPipelineV2Sombra', async () => registroFalso());
    const pool = poolFalso();

    const r = await replayFactura(
      { id: 42, file_path: tmpPath, mimetype: 'image/jpeg', invoice_type: 'compra' },
      { pool, logger: NOOP_LOGGER, cfg: {} }
    );

    assert.equal(r.ok, true);
    assert.equal(r.registro.estado, 'auto_aprobada');
    assert.equal(pool.queries.length, 1);
    assert.match(pool.queries[0].sql, /INSERT INTO extracciones_v2/);
    assert.match(pool.queries[0].sql, /'replay'/);
  });

  test('el pipeline no produce resultado (null) → ok:false, sin insertar', async () => {
    mPipeline = mock.method(orchestrator, 'ejecutarPipelineV2Sombra', async () => null);
    const pool = poolFalso();

    const r = await replayFactura(
      { id: 43, file_path: tmpPath, mimetype: 'image/jpeg', invoice_type: 'compra' },
      { pool, logger: NOOP_LOGGER, cfg: {} }
    );

    assert.equal(r.ok, false);
    assert.match(r.error, /no produjo resultado/);
    assert.equal(pool.queries.length, 0);
  });

  test('fichero original ya no existe en disco → ok:false, no lanza excepción', async () => {
    const pool = poolFalso();
    const r = await replayFactura(
      { id: 44, file_path: '/tmp/no-existe-jamas-12345.jpg', mimetype: 'image/jpeg', invoice_type: 'compra' },
      { pool, logger: NOOP_LOGGER, cfg: {} }
    );
    assert.equal(r.ok, false);
    assert.equal(pool.queries.length, 0);
  });

  test('el pipeline lanza una excepción → capturada, no propaga, ok:false', async () => {
    mPipeline = mock.method(orchestrator, 'ejecutarPipelineV2Sombra', async () => { throw new Error('fallo simulado de red'); });
    const pool = poolFalso();

    const r = await replayFactura(
      { id: 45, file_path: tmpPath, mimetype: 'image/jpeg', invoice_type: 'compra' },
      { pool, logger: NOOP_LOGGER, cfg: {} }
    );

    assert.equal(r.ok, false);
    assert.match(r.error, /fallo simulado de red/);
  });

  test('nunca escribe en la tabla uploads (solo lectura respecto a v1)', async () => {
    mPipeline = mock.method(orchestrator, 'ejecutarPipelineV2Sombra', async () => registroFalso());
    const pool = poolFalso();

    await replayFactura(
      { id: 46, file_path: tmpPath, mimetype: 'image/jpeg', invoice_type: 'compra' },
      { pool, logger: NOOP_LOGGER, cfg: {} }
    );

    const tocaUploads = pool.queries.some((q) => /UPDATE\s+uploads|INSERT INTO uploads|DELETE FROM uploads/i.test(q.sql));
    assert.equal(tocaUploads, false);
  });
});
