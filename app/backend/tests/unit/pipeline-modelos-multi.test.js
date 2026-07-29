// tests/unit/pipeline-modelos-multi.test.js
// Extracción y arbitraje N-modelos (2026-07-29): extractors.ejecutarExtraccionV2Multi
// + arbiter.arbitrarFacturaMulti. Mockea los motores (cero red real).
'use strict';

const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const gemini = require('../../src/ocr/gemini');
const mistral = require('../../src/ocr/mistral');
const {
  ejecutarExtraccionV2Multi,
  ejecutarExtractorPorNombre,
  MOTORES_SOPORTADOS,
} = require('../../src/pipeline/extractors');
const { arbitrarFacturaMulti } = require('../../src/pipeline/arbiter');

const CIF_VALIDO = 'B72327000';
const CIF_INVALIDO = 'B72327008';

// Resultado {motor, ok, campos} canónico para alimentar el árbitro.
function res(motor, over = {}) {
  return {
    motor, ok: true, tiempo_ms: 10, coste_estimado_usd: 0.005,
    campos: {
      emisor: { nombre: over.emisorNombre ?? 'ACME SL', nif: over.emisorNif ?? CIF_VALIDO },
      receptor: { nombre: 'Cliente SL', nif: 'B87654321' },
      numero_factura: over.numero ?? '0001',
      fecha_emision: over.fecha ?? '01/01/2026',
      lineas_iva: [{ base: over.base ?? '100,00', tipo: '21,0', cuota: over.cuota ?? '21,00' }],
      retencion_irpf: '0,00',
      total: over.total ?? '121,00',
      moneda: 'EUR',
      es_factura_valida: true,
      _fuente: motor,
      _confianza: over.conf ?? 0.9,
    },
  };
}

// Shape crudo que devuelve un motor v1 (lo normaliza ejecutarExtractor).
const MOTOR_RAW_OK = {
  success: true, es_factura_valida: true, confidence: 0.9, tokens_used: 900,
  campos: {
    numero_factura: '0001', fecha_emision: '01/01/2026',
    proveedor_nombre: 'ACME SL', proveedor_nif: CIF_VALIDO,
    receptor_nombre: 'Cliente SL', receptor_nif: 'B87654321',
    base_imponible: '100,00', iva_porcentaje: '21,0', cuota_iva: '21,00',
    lineas_iva: [{ base: '100,00', porcentaje: '21,0', cuota: '21,00' }],
    cuota_irpf: '0,00', total: '121,00', moneda: 'EUR',
  },
};

describe('arbitrarFacturaMulti — casos de cardinalidad', () => {
  test('0 motores válidos → sin_resultado', async () => {
    const r = await arbitrarFacturaMulti([{ motor: 'gemini_flash', ok: false }, { motor: 'mistral', ok: false }]);
    assert.equal(r.sin_resultado, true);
    assert.equal(r.campos, null);
  });

  test('1 motor válido → gana sin arbitraje', async () => {
    const r = await arbitrarFacturaMulti([res('mistral'), { motor: 'gemini_flash', ok: false }]);
    assert.equal(r.sin_resultado, undefined);
    assert.equal(r.disputas.length, 0);
    assert.deepEqual(r.motores_usados, ['mistral']);
    assert.equal(r.campos.emisor.nif, CIF_VALIDO);
  });

  test('2 motores coincidentes → sin disputas, delega en el árbitro pairwise', async () => {
    const r = await arbitrarFacturaMulti([res('gemini_flash'), res('mistral')]);
    assert.equal(r.disputas.length, 0);
    assert.deepEqual(r.motores_usados, ['gemini_flash', 'mistral']);
  });

  test('2 motores: NIF discrepa → gana el de checksum válido (regla probada)', async () => {
    const r = await arbitrarFacturaMulti([
      res('gemini_flash', { emisorNif: CIF_VALIDO }),
      res('mistral', { emisorNif: CIF_INVALIDO }),
    ]);
    assert.equal(r.campos.emisor.nif, CIF_VALIDO);
    assert.equal(r.disputas.find((d) => d.campo === 'emisor.nif'), undefined);
  });
});

describe('arbitrarFacturaMulti — torneo 3-4 motores', () => {
  test('3 motores idénticos → sin disputas, usa los 3', async () => {
    const r = await arbitrarFacturaMulti([res('gemini_flash'), res('mistral'), res('openai')]);
    assert.equal(r.disputas.length, 0);
    assert.equal(r.motores_usados.length, 3);
    assert.ok(r.motivo.includes('torneo'));
  });

  test('3 motores: un 3er motor rompe un empate 1-1 en numero_factura (campo sin validador)', async () => {
    // m0 y m1 discrepan en numero_factura (sin validador → disputa en ronda 1,
    // queda null); m2 aporta un valor concreto → la ronda 2 lo acepta.
    const r = await arbitrarFacturaMulti([
      res('gemini_flash', { numero: 'AAA' }),
      res('mistral', { numero: 'BBB' }),
      res('openai', { numero: 'CCC' }),
    ]);
    assert.equal(r.campos.numero_factura, 'CCC');
  });

  test('4 motores con uno caído → arbitra con los 3 válidos', async () => {
    const r = await arbitrarFacturaMulti([
      res('gemini_flash'), { motor: 'mistral', ok: false, error: 'timeout' }, res('openai'), res('gemini_pro'),
    ]);
    assert.equal(r.disputas.length, 0);
    assert.equal(r.motores_usados.length, 3);
    assert.ok(!r.motores_usados.includes('mistral'));
  });
});

describe('ejecutarExtractorPorNombre / ejecutarExtraccionV2Multi', () => {
  afterEach(() => mock.restoreAll());

  test('motor no soportado → ok:false, nunca lanza', async () => {
    const r = await ejecutarExtractorPorNombre('paddleocr', '/tmp/x.jpg', 'image/jpeg', {}, {}, null);
    assert.equal(r.ok, false);
    assert.match(r.error, /no soportado/);
  });

  test('MOTORES_SOPORTADOS incluye los 5 esperados', () => {
    for (const m of ['azure', 'gemini_flash', 'gemini_pro', 'openai', 'mistral']) {
      assert.ok(MOTORES_SOPORTADOS.includes(m), `falta ${m}`);
    }
  });

  test('multi con 2 motores → mapa con ambos, normalizados a canónico', async () => {
    mock.method(gemini, 'extractInvoice', async () => MOTOR_RAW_OK);
    mock.method(mistral, 'extractInvoice', async () => MOTOR_RAW_OK);
    const mapa = await ejecutarExtraccionV2Multi(['gemini_flash', 'mistral'], '/tmp/x.jpg', 'image/jpeg', {}, {}, null);
    assert.deepEqual(Object.keys(mapa).sort(), ['gemini_flash', 'mistral']);
    assert.equal(mapa.gemini_flash.ok, true);
    assert.equal(mapa.mistral.campos.emisor.nif, CIF_VALIDO);
  });

  test('multi: un motor cae, el otro sigue (aislamiento de fallos)', async () => {
    mock.method(gemini, 'extractInvoice', async () => MOTOR_RAW_OK);
    mock.method(mistral, 'extractInvoice', async () => { throw new Error('503 upstream'); });
    const mapa = await ejecutarExtraccionV2Multi(['gemini_flash', 'mistral'], '/tmp/x.jpg', 'image/jpeg', {}, {}, null);
    assert.equal(mapa.gemini_flash.ok, true);
    assert.equal(mapa.mistral.ok, false);
  });
});
