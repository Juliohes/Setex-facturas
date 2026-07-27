// src/pipeline/preprocess.js
// Fase 3 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: "quality gate" de entrada —
// nitidez, brillo, blanco — ANTES de que la imagen llegue a ningún motor OCR.
//
// Ya existía una versión de esto (server.js:analyzeImageQuality) desde el
// COMMIT INICIAL del proyecto — pero nunca se llamó desde ningún sitio
// (código muerto desde el día 1, marcado @deprecated ahí, no se borra —
// regla 6 del prompt). Al probarla contra datos reales para esta fase se
// descubrió por qué probablemente nunca se conectó: su umbral de nitidez
// (`< 2`) habría rechazado MÁS DE LA MITAD de las facturas reales que sí se
// leyeron bien.
//
// Recalibrado 2026-07-27 sobre las 27 facturas reales ya procesadas con
// éxito en producción (rango de nitidez observado: 1.13–4.53, mediana 1.80;
// brillo: 121–241; entropía: 2.57–7.52 — ver docs/INFORME-AUDITORIA-OCR.md).
// Los umbrales nuevos quedan con margen de seguridad amplio por debajo/
// encima de lo peor visto en datos reales: deben cazar solo casos
// catastróficos, no "por debajo de la media".
'use strict';

const sharp = require('sharp');

const UMBRAL_NITIDEZ_MINIMA = 0.6;   // antes 2 en el código muerto original — recalibrado, ver cabecera
const UMBRAL_BRILLO_MAXIMO = 245;    // antes 225
const UMBRAL_BRILLO_MINIMO = 30;     // sin cambios: sin evidencia real de que esté mal (ninguna de las 27 fotos se acerca)
const UMBRAL_ENTROPIA_BLANCO = 1.0;  // sin cambios: la entropía mínima real observada (2.57) queda muy por encima
const UMBRAL_STDEV_BLANCO = 5;       // sin cambios

// La calibración se hizo MIDIENDO tras este mismo resize (no antes) — los
// umbrales solo son válidos a esta resolución de medición. Es independiente
// del resize que usa el pipeline real para ENVIAR la imagen a los motores
// OCR (1536px, ver ocr/*.js optimizeImage) — aquí solo se mide, nunca se
// reescala la imagen que se envía a nadie.
const ANCHO_MEDICION = 1024;

/**
 * Analiza nitidez/brillo/blanco de una imagen. Nunca lanza por una imagen
 * válida pero de mala calidad — eso se refleja en `passed`/`issues`, no en
 * una excepción. Solo lanza si el fichero no se puede leer/decodificar.
 */
async function analizarCalidadImagen(filePath) {
  const stats = await sharp(filePath)
    .resize({ width: ANCHO_MEDICION, height: ANCHO_MEDICION, fit: 'inside', withoutEnlargement: true })
    .stats();

  const channels = stats.channels;
  const channelCount = Math.min(channels.length, 3);

  const sharpnessScore = stats.sharpness;
  const isBlurry = sharpnessScore < UMBRAL_NITIDEZ_MINIMA;

  const brightness = channelCount >= 3
    ? 0.299 * channels[0].mean + 0.587 * channels[1].mean + 0.114 * channels[2].mean
    : channels[0].mean;
  const isTooDark = brightness < UMBRAL_BRILLO_MINIMO;
  const isTooBright = brightness > UMBRAL_BRILLO_MAXIMO;

  const avgStdev = channels.slice(0, channelCount).reduce((sum, ch) => sum + ch.stdev, 0) / channelCount;
  const isBlank = stats.entropy < UMBRAL_ENTROPIA_BLANCO && avgStdev < UMBRAL_STDEV_BLANCO;

  const issues = [];
  if (isBlurry) issues.push('La imagen está borrosa o desenfocada');
  if (isTooDark) issues.push('La imagen está demasiado oscura');
  if (isTooBright) issues.push('La imagen está sobreexpuesta (demasiado clara)');
  if (isBlank) issues.push('La imagen parece estar en blanco o vacía');

  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      sharpness: Math.round(sharpnessScore * 100) / 100,
      brightness: Math.round(brightness),
      entropy: Math.round(stats.entropy * 100) / 100,
      avgStdev: Math.round(avgStdev * 10) / 10,
    },
  };
}

module.exports = {
  analizarCalidadImagen,
  UMBRAL_NITIDEZ_MINIMA,
  UMBRAL_BRILLO_MAXIMO,
  UMBRAL_BRILLO_MINIMO,
  UMBRAL_ENTROPIA_BLANCO,
  UMBRAL_STDEV_BLANCO,
  ANCHO_MEDICION,
};
