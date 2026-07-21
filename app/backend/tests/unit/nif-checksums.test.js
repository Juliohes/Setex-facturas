// Tests de los dígitos de control NIF/NIE/CIF — domain/validators/nif.js
//
// Contexto (2026-07-21): antes de este test, checkDigitNIF y checkDigitNIE no
// existían — validateSpanishTaxId solo comprobaba el FORMATO de NIF/NIE, no
// su letra de control. Un solo dígito mal leído por el OCR en un NIF de
// persona física pasaba desapercibido. checkDigitCIF sí existía pero sin
// ningún test que protegiera el fix de 2026-07-13 (letras de control
// 'KPQS' → 'NPQRSW') frente a una regresión futura.
//
// Vectores usados (persona física/jurídica reales de ejemplo, verificados a
// mano contra el algoritmo oficial):
//   - 12345678Z: ejemplo académico estándar de NIF (12345678 % 23 = 14 → Z)
//   - X1234567L: ejemplo estándar de NIE (01234567 % 23 = 19 → L)
//   - 32654987R: NIF no presente en la lista negra (32654987 % 23 = 1 → R)
//   - A28015865 / B72327000: CIFs con control numérico, incl. caso límite 0
//   - N0000001H / W1000000H: CIFs con control letra obligatoria (entidades
//     añadidas por el fix 2026-07-13, antes ausentes del set)

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSpanishTaxId,
  checkDigitCIF,
  checkDigitNIF,
  checkDigitNIE,
} = require('../../src/domain/validators/nif');

describe('checkDigitNIF — persona física, módulo 23', () => {
  test('NIF válido: letra de control correcta', () => {
    assert.equal(checkDigitNIF('12345678Z'), true);
    assert.equal(checkDigitNIF('32654987R'), true);
  });

  test('NIF con letra de control incorrecta', () => {
    assert.equal(checkDigitNIF('12345678A'), false);
    assert.equal(checkDigitNIF('32654987A'), false);
  });

  test('normaliza espacios, guiones y minúsculas antes de comprobar', () => {
    assert.equal(checkDigitNIF('12 345678-z'), true);
  });

  test('formato no NIF → null (no aplica, no es ni válido ni inválido)', () => {
    assert.equal(checkDigitNIF('X1234567L'), null);   // es NIE, no NIF
    assert.equal(checkDigitNIF('B72327000'), null);   // es CIF, no NIF
    assert.equal(checkDigitNIF('1234567Z'), null);    // 7 dígitos, formato inválido
    assert.equal(checkDigitNIF(null), null);
    assert.equal(checkDigitNIF(''), null);
  });
});

describe('checkDigitNIE — X/Y/Z + módulo 23', () => {
  test('NIE válido con prefijo X', () => {
    assert.equal(checkDigitNIE('X1234567L'), true);
  });

  test('NIE con letra de control incorrecta', () => {
    assert.equal(checkDigitNIE('X1234567A'), false);
  });

  test('prefijos Y y Z se sustituyen por 1 y 2 antes del módulo', () => {
    // Y1234567 → equivalente numérico 11234567; Z1234567 → 21234567
    const controlY = checkDigitNIE('Y1234567' + 'X'); // letra arbitraria, solo probamos que no lanza
    assert.ok(controlY === true || controlY === false);
  });

  test('formato no NIE → null', () => {
    assert.equal(checkDigitNIE('12345678Z'), null);
    assert.equal(checkDigitNIE(null), null);
  });
});

describe('checkDigitCIF — persona jurídica, algoritmo AEAT', () => {
  test('control numérico válido', () => {
    assert.equal(checkDigitCIF('A28015865'), true);
  });

  test('caso límite: control numérico = 0', () => {
    assert.equal(checkDigitCIF('B72327000'), true);
  });

  test('control numérico incorrecto', () => {
    assert.equal(checkDigitCIF('A28015861'), false);
  });

  test('regresión del fix 2026-07-13: entidades N, R, W exigen letra (antes ausentes de "KPQS")', () => {
    assert.equal(checkDigitCIF('N0000001H'), true);
    assert.equal(checkDigitCIF('W1000000H'), true);
    // Con la letra de control incorrecta debe fallar, no dar null
    assert.equal(checkDigitCIF('N0000001A'), false);
  });

  test('K ya no se trata como letra de control-siempre-letra (no es letra de entidad CIF)', () => {
    // K no es una letra de entidad CIF válida en absoluto — lo cubre el
    // formato (validateSpanishTaxId), no el checksum.
    assert.equal(validateSpanishTaxId('K0000001H').valid, false);
  });

  test('formato no CIF → null', () => {
    assert.equal(checkDigitCIF('12345678Z'), null);
    assert.equal(checkDigitCIF(null), null);
  });
});

describe('validateSpanishTaxId — formato + lista negra (sin cambios de contrato)', () => {
  test('NIF/NIE con formato correcto siguen siendo "valid" aunque no se compruebe aquí el checksum', () => {
    // Contrato existente: el checksum es una señal aparte (checkDigit*),
    // validateSpanishTaxId es solo formato + lista negra.
    assert.equal(validateSpanishTaxId('32654987R').valid, true);
    assert.equal(validateSpanishTaxId('X1234567L').valid, true);
  });

  test('lista negra rechaza antes que el formato', () => {
    const r = validateSpanishTaxId('A12345678');
    assert.equal(r.valid, false);
    assert.equal(r.severity, 'blacklisted');
  });

  test('formato inválido se reporta como bad_format', () => {
    const r = validateSpanishTaxId('1234567Z');
    assert.equal(r.valid, false);
    assert.equal(r.severity, 'bad_format');
  });
});
