// tests/unit/pipeline-arbiter.test.js
// Fase 5 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: árbitro por campo.
// Cubre las 4 reglas del prompt (5.2 a-d): coinciden / gana el que pasa
// validación / empate → árbitro / disputa persistente → revisión humana.
'use strict';

const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');
const openai = require('../../src/ocr/openai');
const {
  arbitrarFactura,
  resolverIdentificador,
  resolverCampoSimple,
  coinciden,
  validarCorreccionHumana,
} = require('../../src/pipeline/arbiter');

// NIF/CIF reales válidos (checksum correcto) usados en los tests existentes
// del proyecto (nif-checksums.test.js) — B72327000 es un CIF con dígito de
// control válido; B72327008 es el mismo número con el dígito cambiado (inválido).
const CIF_VALIDO = 'B72327000';
const CIF_INVALIDO = 'B72327008'; // mismo número, dígito de control roto

function candidato({ nifEmisor = CIF_VALIDO, nombreEmisor = 'ACME SL', numeroFactura = '0001', fecha = '01/01/2026', base = '100,00', tipo = '21,0', cuota = '21,00', total = '121,00' } = {}) {
  return {
    emisor: { nif: nifEmisor, nombre: nombreEmisor },
    receptor: { nif: 'B87654321', nombre: 'Cliente SL' },
    numero_factura: numeroFactura,
    fecha_emision: fecha,
    lineas_iva: [{ base, tipo, cuota }],
    retencion_irpf: '0,00',
    total,
    moneda: 'EUR',
    es_factura_valida: true,
  };
}

describe('coinciden', () => {
  test('ignora mayúsculas, espacios y separador decimal', () => {
    assert.equal(coinciden(' b72327000 ', 'B72327000'), true);
    assert.equal(coinciden('121,00', '121.00'), true);
  });
  test('null contra null → coinciden; null contra valor → no', () => {
    assert.equal(coinciden(null, null), true);
    assert.equal(coinciden(null, '100,00'), false);
  });
});

describe('resolverIdentificador (regla 5.2.a/b)', () => {
  test('coinciden → acepta sin disputa', () => {
    const r = resolverIdentificador('emisor.nif', CIF_VALIDO, 'azure', CIF_VALIDO, 'gemini_flash');
    assert.equal(r.en_disputa, false);
    assert.equal(r.valor, CIF_VALIDO);
  });

  test('discrepan, solo uno pasa checksum → gana el válido', () => {
    const r = resolverIdentificador('emisor.nif', CIF_VALIDO, 'azure', CIF_INVALIDO, 'gemini_flash');
    assert.equal(r.en_disputa, false);
    assert.equal(r.valor, CIF_VALIDO);
    assert.equal(r.fuente, 'azure');
  });

  test('discrepan, ninguno pasa checksum → en_disputa con ambos candidatos', () => {
    const r = resolverIdentificador('emisor.nif', CIF_INVALIDO, 'azure', 'X0000000Z', 'gemini_flash');
    assert.equal(r.en_disputa, true);
    assert.deepEqual(r.candidatos, { azure: CIF_INVALIDO, gemini_flash: 'X0000000Z' });
  });
});

describe('resolverCampoSimple (sin validación determinista propia)', () => {
  test('coinciden → acepta', () => {
    const r = resolverCampoSimple('numero_factura', '0001', 'azure', '0001', 'gemini_flash');
    assert.equal(r.en_disputa, false);
  });
  test('discrepan → en_disputa (necesita árbitro o revisión humana)', () => {
    const r = resolverCampoSimple('numero_factura', '0001', 'azure', '0002', 'gemini_flash');
    assert.equal(r.en_disputa, true);
  });
  // Incidente real 2026-07-29: Azure DI no reconoce numero_factura en formato
  // "26#XXXX" y devuelve null, mientras Gemini sí lo lee -- antes se trataba
  // como discrepancia y el campo se perdía (quedaba null tras arbitraje).
  test('un motor no encuentra nada (null) y el otro sí → acepta el valor concreto sin disputa', () => {
    const r = resolverCampoSimple('numero_factura', null, 'azure', '26#3854', 'gemini_flash');
    assert.equal(r.en_disputa, false);
    assert.equal(r.valor, '26#3854');
    assert.equal(r.fuente, 'gemini_flash');
  });
  test('un motor no encuentra nada (null) y el otro sí, en el otro orden → acepta igual', () => {
    const r = resolverCampoSimple('numero_factura', '26#3854', 'azure', null, 'gemini_flash');
    assert.equal(r.en_disputa, false);
    assert.equal(r.valor, '26#3854');
    assert.equal(r.fuente, 'azure');
  });
  test('ambos null → coinciden en ausencia, sin disputa', () => {
    const r = resolverCampoSimple('numero_factura', null, 'azure', null, 'gemini_flash');
    assert.equal(r.en_disputa, false);
    assert.equal(r.valor, null);
  });
});

describe('arbitrarFactura — casos completos', () => {
  test('todo coincide → sin disputas, campo a campo aceptado', async () => {
    const A = candidato(); const B = candidato();
    const r = await arbitrarFactura(
      { motor: 'azure', ok: true, campos: A },
      { motor: 'gemini_flash', ok: true, campos: B },
    );
    assert.equal(r.disputas.length, 0);
    assert.equal(r.campos.total, '121,00');
  });

  test('NIF discrepa: uno con checksum válido, otro no → gana el válido, SIN necesidad de árbitro', async () => {
    const A = candidato({ nifEmisor: CIF_VALIDO });
    const B = candidato({ nifEmisor: CIF_INVALIDO });
    const r = await arbitrarFactura(
      { motor: 'azure', ok: true, campos: A },
      { motor: 'gemini_flash', ok: true, campos: B },
    );
    assert.equal(r.disputas.length, 0);
    assert.equal(r.campos.emisor.nif, CIF_VALIDO);
    assert.equal(r.decisiones['emisor.nif'].fuente, 'azure');
  });

  test('bloque financiero: uno cuadra aritméticamente, el otro no → gana el que cuadra', async () => {
    const A = candidato({ base: '100,00', tipo: '21,0', cuota: '21,00', total: '121,00' }); // cuadra
    const B = candidato({ base: '100,00', tipo: '21,0', cuota: '30,00', total: '130,00' }); // NO cuadra (30 ≠ 21)
    const r = await arbitrarFactura(
      { motor: 'azure', ok: true, campos: A },
      { motor: 'gemini_flash', ok: true, campos: B },
    );
    assert.equal(r.disputas.length, 0);
    assert.equal(r.campos.total, '121,00');
  });

  test('numero_factura discrepa sin validación propia, sin filePath (no se invoca árbitro) → en_disputa', async () => {
    const A = candidato({ numeroFactura: '0001' });
    const B = candidato({ numeroFactura: '0002' });
    const r = await arbitrarFactura(
      { motor: 'azure', ok: true, campos: A },
      { motor: 'gemini_flash', ok: true, campos: B },
    );
    assert.equal(r.disputas.length, 1);
    assert.equal(r.disputas[0].campo, 'numero_factura');
  });

  test('discrepan y hay filePath → invoca al árbitro (openai), desempata si coincide con uno de los dos', async () => {
    const A = candidato({ numeroFactura: '0001' });
    const B = candidato({ numeroFactura: '0002' });
    const m = mock.method(openai, 'extractInvoice', async () => ({
      success: true, es_factura_valida: true, confidence: 0.9,
      campos: { ...A, numero_factura: '0001', proveedor_nombre: A.emisor.nombre, proveedor_nif: A.emisor.nif, receptor_nombre: A.receptor.nombre, receptor_nif: A.receptor.nif, base_imponible: '100,00', iva_porcentaje: '21,0', cuota_iva: '21,00', total: '121,00', lineas_iva: A.lineas_iva, cuota_irpf: '0,00' },
    }));
    process.env.OPENAI_API_KEY = 'test-key-000000';
    try {
      const r = await arbitrarFactura(
        { motor: 'azure', ok: true, campos: A },
        { motor: 'gemini_flash', ok: true, campos: B },
        { filePath: '/tmp/fake.jpg', mimeType: 'image/jpeg' },
      );
      assert.equal(openai.extractInvoice.mock.callCount(), 1);
      assert.equal(r.disputas.length, 0, 'el árbitro debía desempatar a favor de azure (0001)');
      assert.equal(r.campos.numero_factura, '0001');
    } finally {
      m.mock.restore();
    }
  });

  test('el árbitro aporta un 3er valor distinto → la disputa persiste (regla 5.2.d)', async () => {
    const A = candidato({ numeroFactura: '0001' });
    const B = candidato({ numeroFactura: '0002' });
    const m = mock.method(openai, 'extractInvoice', async () => ({
      success: true, es_factura_valida: true, confidence: 0.9,
      campos: { ...A, numero_factura: '9999', proveedor_nombre: A.emisor.nombre, proveedor_nif: A.emisor.nif, receptor_nombre: A.receptor.nombre, receptor_nif: A.receptor.nif, base_imponible: '100,00', iva_porcentaje: '21,0', cuota_iva: '21,00', total: '121,00', lineas_iva: A.lineas_iva, cuota_irpf: '0,00' },
    }));
    process.env.OPENAI_API_KEY = 'test-key-000000';
    try {
      const r = await arbitrarFactura(
        { motor: 'azure', ok: true, campos: A },
        { motor: 'gemini_flash', ok: true, campos: B },
        { filePath: '/tmp/fake.jpg', mimeType: 'image/jpeg' },
      );
      assert.equal(r.disputas.length, 1, 'debe seguir en disputa — cae a revisión humana');
      assert.equal(r.disputas[0].campo, 'numero_factura');
    } finally {
      m.mock.restore();
    }
  });

  test('un motor falla del todo → el otro gana sin arbitraje', async () => {
    const B = candidato();
    const r = await arbitrarFactura(
      { motor: 'azure', ok: false, error: 'HTTP 429' },
      { motor: 'gemini_flash', ok: true, campos: B },
    );
    assert.equal(r.disputas.length, 0);
    assert.equal(r.campos.total, '121,00');
    assert.match(r.motivo, /azure falló/);
  });

  test('ambos motores fallan → sin_resultado, cae a recaptura/revisión', async () => {
    const r = await arbitrarFactura(
      { motor: 'azure', ok: false, error: 'HTTP 500' },
      { motor: 'gemini_flash', ok: false, error: 'HTTP 500' },
    );
    assert.equal(r.sin_resultado, true);
    assert.equal(r.campos, null);
  });
});

// Gap 1 del plan de cierre sobre el pipeline v2 existente (2026-07-28):
// el PATCH de corrección humana aceptaba cualquier valor a ciegas. Estas
// pruebas cubren la misma validación determinista que ya usa el árbitro,
// reutilizada aquí — nunca una segunda regla distinta.
describe('validarCorreccionHumana', () => {
  test('NIF/CIF con dígito de control inválido → rechazado', () => {
    const r = validarCorreccionHumana('emisor.nif', CIF_INVALIDO, candidato());
    assert.equal(r.ok, false);
    assert.match(r.motivo, /control/i);
  });

  test('NIF/CIF con dígito de control válido → aceptado', () => {
    const r = validarCorreccionHumana('emisor.nif', CIF_VALIDO, candidato());
    assert.equal(r.ok, true);
  });

  test('NIF/CIF con formato imposible (ni NIF, ni NIE, ni CIF) → rechazado', () => {
    const r = validarCorreccionHumana('receptor.nif', '1234', candidato());
    assert.equal(r.ok, false);
    assert.match(r.motivo, /formato/i);
  });

  test('corrección financiera que rompe base×tipo=cuota → rechazada', () => {
    // base 100€ al 21% debería dar 21,00€ de cuota, no 50,00€
    const r = validarCorreccionHumana('cuota_iva', '50,00', candidato());
    assert.equal(r.ok, false);
  });

  test('corrección financiera coherente con el resto → aceptada', () => {
    // base 100 + cuota 21 - retención 5 = 116 — con IRPF del 5%, el total
    // coherente es 116,00, no los 121,00 por defecto de candidato()
    const base = candidato();
    base.retencion_irpf = '5,00';
    const r = validarCorreccionHumana('total', '116,00', base);
    assert.equal(r.ok, true);
  });

  test('campo sin validación propia (numero_factura, fecha_emision, nombres) → siempre aceptado', () => {
    const r = validarCorreccionHumana('numero_factura', 'CUALQUIERA-123', candidato());
    assert.equal(r.ok, true);
  });
});
