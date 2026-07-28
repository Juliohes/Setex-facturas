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
const fs = require('fs').promises;
// Acceso por propiedad (no desestructurado): permite mockear en tests.
const imageVariants = require('../ocr/image-variants');

// ── Fase 3.2/3.3: deskew + corrección de perspectiva ────────────────────────
// Reutiliza el MISMO algoritmo de detección de contorno de papel que ya usa
// la cámara del móvil (jscanify v1.4.0, MIT, ver frontend/src/jscanify.js:
// findPaperContour/getCornerPoints — código transcrito abajo TAL CUAL, solo
// adaptado para recibir `cv` como parámetro en vez de global) — así el
// criterio de "qué es el papel" es consistente en cliente y servidor.
//
// Motor: @techstark/opencv-js (WASM, Apache-2.0, mismo API que OpenCV.js).
// El opencv.js vendorizado en el frontend (8.98 MB) es un build SOLO para
// navegador (usa document.createElement('canvas'), cv.imread/cv.imshow) —
// probado en este entorno, falla con "document is not defined" en Node. No
// se fuerza con un shim de DOM (jsdom+canvas nativo reintroduciría
// exactamente el riesgo de dependencias nativas en Alpine que se evitó en
// la Fase 2). @techstark/opencv-js carga limpio en Node puro (verificado)
// y expone findContours/minAreaRect/warpPerspective igual que en navegador.
let cvReadyPromise = null;
function cargarOpenCV() {
  if (!cvReadyPromise) cvReadyPromise = require('@techstark/opencv-js');
  return cvReadyPromise;
}

// Umbral de confianza (Fase 3.3 del prompt: "SOLO si se detectan las 4
// esquinas con confianza alta; si no, deja la imagen como está — mejor no
// tocar que deformar"). El contorno detectado debe cubrir al menos esta
// fracción del área total de la imagen para considerarse "el documento" y
// no ruido/sombra/objeto de fondo.
const UMBRAL_AREA_MINIMA_CONTORNO = 0.25;

/** Transcripción literal de jscanify findPaperContour (MIT) — cv por parámetro. */
function encontrarContornoPapel(cv, img) {
  const imgGray = new cv.Mat();
  cv.Canny(img, imgGray, 50, 200);
  const imgBlur = new cv.Mat();
  cv.GaussianBlur(imgGray, imgBlur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
  const imgThresh = new cv.Mat();
  cv.threshold(imgBlur, imgThresh, 0, 255, cv.THRESH_OTSU);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(imgThresh, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  let maxArea = 0;
  let maxContourIndex = -1;
  for (let i = 0; i < contours.size(); ++i) {
    const contourArea = cv.contourArea(contours.get(i));
    if (contourArea > maxArea) { maxArea = contourArea; maxContourIndex = i; }
  }
  const maxContour = maxContourIndex >= 0 ? contours.get(maxContourIndex) : null;

  imgGray.delete(); imgBlur.delete(); imgThresh.delete(); contours.delete(); hierarchy.delete();
  return maxContour;
}

/** Transcripción literal de jscanify getCornerPoints (MIT) — cv por parámetro. */
function obtenerEsquinas(cv, contour) {
  const rect = cv.minAreaRect(contour);
  const center = rect.center;
  const distancia = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

  let topLeftCorner, topLeftCornerDist = 0;
  let topRightCorner, topRightCornerDist = 0;
  let bottomLeftCorner, bottomLeftCornerDist = 0;
  let bottomRightCorner, bottomRightCornerDist = 0;

  for (let i = 0; i < contour.data32S.length; i += 2) {
    const point = { x: contour.data32S[i], y: contour.data32S[i + 1] };
    const dist = distancia(point, center);
    if (point.x < center.x && point.y < center.y) {
      if (dist > topLeftCornerDist) { topLeftCorner = point; topLeftCornerDist = dist; }
    } else if (point.x > center.x && point.y < center.y) {
      if (dist > topRightCornerDist) { topRightCorner = point; topRightCornerDist = dist; }
    } else if (point.x < center.x && point.y > center.y) {
      if (dist > bottomLeftCornerDist) { bottomLeftCorner = point; bottomLeftCornerDist = dist; }
    } else if (point.x > center.x && point.y > center.y) {
      if (dist > bottomRightCornerDist) { bottomRightCorner = point; bottomRightCornerDist = dist; }
    }
  }
  return { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner };
}

/**
 * Corrige perspectiva (y, como subcaso, cualquier inclinación/deskew) SOLO
 * si se detecta el contorno del papel con confianza alta (área mínima +
 * las 4 esquinas presentes). Si no, devuelve la imagen intacta —
 * "mejor no tocar que deformar" (Fase 3.3 del prompt).
 *
 * @param {Buffer} buffer imagen original (cualquier formato que sharp lea)
 * @returns {Promise<{corregido: boolean, buffer: Buffer, motivo: string|null}>}
 */
async function corregirPerspectivaSiConfiable(buffer) {
  let mat = null;
  let contour = null;
  try {
    const cv = await cargarOpenCV();
    const { data, info } = await sharp(buffer)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    mat = cv.matFromImageData({ data: new Uint8ClampedArray(data), width: info.width, height: info.height });
    contour = encontrarContornoPapel(cv, mat);
    if (!contour) return { corregido: false, buffer, motivo: 'sin_contorno_detectado' };

    const areaContorno = cv.contourArea(contour);
    const areaImagen = info.width * info.height;
    if (areaContorno / areaImagen < UMBRAL_AREA_MINIMA_CONTORNO) {
      return { corregido: false, buffer, motivo: 'contorno_demasiado_pequeno' };
    }

    const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = obtenerEsquinas(cv, contour);
    if (!topLeftCorner || !topRightCorner || !bottomLeftCorner || !bottomRightCorner) {
      return { corregido: false, buffer, motivo: 'esquinas_incompletas' };
    }

    // Tamaño destino = dimensiones reales del documento detectado (media de
    // los dos lados opuestos), no las de la imagen original — el documento
    // fotografiado en ángulo no comparte proporción con el encuadre.
    const anchoDestino = Math.round((distanciaPuntos(topLeftCorner, topRightCorner) + distanciaPuntos(bottomLeftCorner, bottomRightCorner)) / 2);
    const altoDestino = Math.round((distanciaPuntos(topLeftCorner, bottomLeftCorner) + distanciaPuntos(topRightCorner, bottomRightCorner)) / 2);
    if (anchoDestino < 50 || altoDestino < 50) {
      return { corregido: false, buffer, motivo: 'documento_demasiado_pequeno' };
    }

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      topLeftCorner.x, topLeftCorner.y,
      topRightCorner.x, topRightCorner.y,
      bottomLeftCorner.x, bottomLeftCorner.y,
      bottomRightCorner.x, bottomRightCorner.y,
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, anchoDestino, 0, 0, altoDestino, anchoDestino, altoDestino,
    ]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const warped = new cv.Mat();
    cv.warpPerspective(mat, warped, M, new cv.Size(anchoDestino, altoDestino), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    const salidaBuffer = await sharp(Buffer.from(warped.data), {
      raw: { width: warped.cols, height: warped.rows, channels: warped.channels() },
    }).jpeg({ quality: 90 }).toBuffer();

    srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();
    return { corregido: true, buffer: salidaBuffer, motivo: null };
  } catch (err) {
    return { corregido: false, buffer, motivo: `error: ${err.message}` };
  } finally {
    if (mat) mat.delete();
    if (contour) contour.delete();
  }
}

function distanciaPuntos(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

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

// Gap "variantes de imagen en v2" (2026-07-28): reutiliza EXACTAMENTE la
// misma función CLAHE que ya usa el panel Benchmark IA (ocr/image-variants.js)
// — no se reimplementa contraste local, se conecta la ya existente al
// pipeline v2 real. Solo activo tras ocr_extraccion_v2_variantes_enabled
// (features.json, default false): duplica el nº de llamadas de extracción
// por factura (una por variante), coste real a decidir explícitamente.
async function generarVarianteContrasteParaExtraccion(filePath) {
  const bufferOriginal = await fs.readFile(filePath);
  return imageVariants.generarVarianteContraste(bufferOriginal);
}

module.exports = {
  analizarCalidadImagen,
  generarVarianteContrasteParaExtraccion,
  UMBRAL_NITIDEZ_MINIMA,
  UMBRAL_BRILLO_MAXIMO,
  UMBRAL_BRILLO_MINIMO,
  UMBRAL_ENTROPIA_BLANCO,
  UMBRAL_STDEV_BLANCO,
  ANCHO_MEDICION,
  corregirPerspectivaSiConfiable,
  encontrarContornoPapel,
  obtenerEsquinas,
  UMBRAL_AREA_MINIMA_CONTORNO,
};
