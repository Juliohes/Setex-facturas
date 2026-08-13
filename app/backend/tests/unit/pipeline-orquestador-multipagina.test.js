// tests/unit/pipeline-orquestador-multipagina.test.js
// Orquestador multipágina (2026-08-13): extrae N páginas y fusiona. Mockea la
// extracción (cero red) para verificar el cableado extracción→fusión→estado.
'use strict';

const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const extractors = require('../../src/pipeline/extractors');
const { ejecutarPipelineMultipagina } = require('../../src/pipeline/orquestador-multipagina');

const NOOP = { info() {}, warn() {}, error() {} };
const CIF_VALIDO = 'B72327000';

function canonico(over = {}) {
  return {
    emisor: { nombre: over.emisorNombre ?? null, nif: over.emisorNif ?? null },
    receptor: { nombre: null, nif: null },
    numero_factura: over.numero ?? null,
    fecha_emision: over.fecha ?? null,
    lineas_iva: over.lineas ?? [],
    retencion_irpf: null,
    total: over.total ?? null,
    moneda: 'EUR',
    es_factura_valida: true,
    _fuente: 'gemini_flash',
    _confianza: 0.9,
  };
}

// Mockea ejecutarExtraccionV2Multi para que cada página devuelva 2 motores
// coincidentes con el canónico que toca (por orden de llamada).
function mockPorPagina(canonicosPorLlamada) {
  let i = 0;
  return mock.method(extractors, 'ejecutarExtraccionV2Multi', async () => {
    const c = canonicosPorLlamada[i++];
    const r = (motor) => ({ motor, ok: true, tiempo_ms: 10, coste_estimado_usd: 0.006, campos: c });
    return { gemini_flash: r('gemini_flash'), mistral: r('mistral') };
  });
}

const CFG = {
  ocr_extraccion_v2_modelos_base: ['gemini_flash', 'mistral'],
  ocr_extraccion_v2_arbitro_bloqueante: false,
};

describe('ejecutarPipelineMultipagina', () => {
  afterEach(() => mock.restoreAll());

  test('2 páginas (fiscal + importes) → factura fusionada, sin faltantes', async () => {
    mockPorPagina([
      canonico({ numero: 'F-1', fecha: '13/08/2026', emisorNombre: 'ACME', emisorNif: CIF_VALIDO }),
      canonico({ lineas: [{ base: '100,00', tipo: '21,0', cuota: '21,00' }], total: '121,00' }),
    ]);
    const paginas = [
      { pagina: 1, filePath: '/tmp/p1.jpg', mimeType: 'image/jpeg' },
      { pagina: 2, filePath: '/tmp/p2.jpg', mimeType: 'image/jpeg' },
    ];
    const r = await ejecutarPipelineMultipagina(paginas, {}, CFG, NOOP);
    assert.equal(r.campos.numero_factura, 'F-1');
    assert.equal(r.campos.total, '121,00');
    assert.equal(r.camposFaltantes.length, 0);
    assert.equal(r.paginas_validas, 2);
    assert.notEqual(r.estado, 'ilegible');
  });

  test('falta la página de importes → estado pendiente_revision y total en faltantes', async () => {
    mockPorPagina([
      canonico({ numero: 'F-1', fecha: '13/08/2026', emisorNombre: 'ACME', emisorNif: CIF_VALIDO }),
    ]);
    const r = await ejecutarPipelineMultipagina(
      [{ pagina: 1, filePath: '/tmp/p1.jpg', mimeType: 'image/jpeg' }], {}, CFG, NOOP,
    );
    assert.ok(r.camposFaltantes.some((c) => c.clave === 'total'));
    assert.equal(r.estado, 'pendiente_revision');
  });

  test('una página falla la extracción, la otra salva la factura', async () => {
    let i = 0;
    mock.method(extractors, 'ejecutarExtraccionV2Multi', async () => {
      i++;
      if (i === 1) return { gemini_flash: { motor: 'gemini_flash', ok: false }, mistral: { motor: 'mistral', ok: false } };
      const c = canonico({ numero: 'F-9', fecha: '13/08/2026', emisorNif: CIF_VALIDO, lineas: [{ base: '10,00', tipo: '21,0', cuota: '2,10' }], total: '12,10' });
      const r = (m) => ({ motor: m, ok: true, tiempo_ms: 10, coste_estimado_usd: 0.006, campos: c });
      return { gemini_flash: r('gemini_flash'), mistral: r('mistral') };
    });
    const r = await ejecutarPipelineMultipagina([
      { pagina: 1, filePath: '/tmp/p1.jpg', mimeType: 'image/jpeg' },
      { pagina: 2, filePath: '/tmp/p2.jpg', mimeType: 'image/jpeg' },
    ], {}, CFG, NOOP);
    assert.equal(r.paginas_validas, 1);
    assert.equal(r.campos.numero_factura, 'F-9');
  });

  test('todas las páginas fallan → estado ilegible, sin campos', async () => {
    mock.method(extractors, 'ejecutarExtraccionV2Multi', async () => ({
      gemini_flash: { motor: 'gemini_flash', ok: false }, mistral: { motor: 'mistral', ok: false },
    }));
    const r = await ejecutarPipelineMultipagina([
      { pagina: 1, filePath: '/tmp/p1.jpg', mimeType: 'image/jpeg' },
    ], {}, CFG, NOOP);
    assert.equal(r.estado, 'ilegible');
    assert.equal(r.campos, null);
  });
});
