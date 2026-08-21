// Test del indicador de progreso de captura (frontend/src/progreso.js).
//
// Garantiza los criterios F2, F4 y F8 del plan
// docs/plans/PLAN-INDICADOR-PROGRESO-CAPTURA-V1.md:
//   1. El porcentaje NUNCA llega a 100 sin respuesta real del servidor (F2).
//   2. Las frases rotan y aparecen ≥3 distintas en procesos largos (F4).
//   3. El núcleo respeta fases/rangos definidos.
//   4. completado() devuelve 100 solo cuando se invoca (respuesta real).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crearNucleoProgreso, FASES } = require('../../../frontend/src/progreso');

// Reloj simulado determinista
function relojFalso() {
  let ahora = 0;
  return {
    ahora: () => ahora,
    avanzar: (ms) => { ahora += ms; }
  };
}

test('el porcentaje nunca llega a 100 sin completar() (F2)', () => {
  const reloj = relojFalso();
  const nucleo = crearNucleoProgreso({ ahora: reloj.ahora, duracionTotal: 1000 });
  // Simular 10 minutos sin respuesta: debe seguir < 100
  for (let i = 0; i < 600; i++) {
    reloj.avanzar(1000);
    const estado = nucleo.estado();
    assert.ok(estado.porcentaje >= 0 && estado.porcentaje < 100,
      `porcentaje ${estado.porcentaje} fuera de rango [0,99]`);
  }
});

test('el progreso avanza de forma monótona y empieza en 0', () => {
  const reloj = relojFalso();
  const nucleo = crearNucleoProgreso({ ahora: reloj.ahora, duracionTotal: 45000 });
  assert.equal(nucleo.estado().porcentaje, 0);
  let anterior = 0;
  for (let i = 0; i < 45; i++) {
    reloj.avanzar(1000);
    const pct = nucleo.estado().porcentaje;
    assert.ok(pct >= anterior, `regresión de progreso: ${anterior} → ${pct}`);
    anterior = pct;
  }
  assert.equal(anterior, 99); // asíntota exacta al cap con duracionTotal alcanzada
});

test('completado() devuelve 100 (solo con respuesta real)', () => {
  const nucleo = crearNucleoProgreso({ ahora: () => 0 });
  assert.equal(nucleo.completado().porcentaje, 100);
});

test('las frases rotan: ≥3 distintas en un proceso de >6s equivalentes (F4)', () => {
  const reloj = relojFalso();
  const nucleo = crearNucleoProgreso({
    ahora: reloj.ahora,
    duracionTotal: 12000,      // proceso "largo" comprimido para el test
    intervaloFrase: 1500
  });
  const frasesVistas = new Set();
  for (let i = 0; i < 12; i++) {
    reloj.avanzar(1500);
    frasesVistas.add(nucleo.estado().frase);
  }
  assert.ok(frasesVistas.size >= 3,
    `se esperaban ≥3 frases distintas, vistas: ${frasesVistas.size} (${[...frasesVistas].join(' | ')})`);
});

test('cada frase pertenece a la fase del porcentaje actual', () => {
  const reloj = relojFalso();
  const nucleo = crearNucleoProgreso({ ahora: reloj.ahora, duracionTotal: 9000, intervaloFrase: 500 });
  for (let i = 0; i < 18; i++) {
    reloj.avanzar(500);
    const { porcentaje, frase } = nucleo.estado();
    const fase = FASES.find(f => porcentaje < f.hasta) || FASES[FASES.length - 1];
    assert.ok(fase.frases.includes(frase),
      `frase "${frase}" no pertenece a la fase del %${porcentaje}`);
  }
});

test('las frases rotan dentro de una misma fase larga', () => {
  const reloj = relojFalso();
  // duracionTotal grande: todo el test queda dentro de la primera fase (<15%)
  const nucleo = crearNucleoProgreso({ ahora: reloj.ahora, duracionTotal: 600000, intervaloFrase: 2500 });
  const frases = new Set();
  for (let i = 0; i < 6; i++) {
    reloj.avanzar(2500);
    frases.add(nucleo.estado().frase);
  }
  const fase1Frases = FASES[0].frases.length;
  assert.equal(frases.size, Math.min(6, fase1Frases),
    'la rotación dentro de fase debe ciclar todas sus frases');
});
