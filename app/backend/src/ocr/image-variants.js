// src/ocr/image-variants.js
// Generación de variantes de imagen para comparar precisión de lectura OCR.
//
// Contexto (2026-07-22, petición de Julio): las fotos de factura a veces
// generan errores de lectura evitables con mejor contraste. En vez de
// sustituir la imagen original enviada a la IA, se genera una SEGUNDA
// variante (contraste local + brillo/saturación reducidos) y se compara
// qué lee la IA en cada una — sin cambiar el flujo real del usuario.
//
// Decisión técnica: CLAHE (Contrast Limited Adaptive Histogram Equalization)
// en vez de un contraste global simple. Julio señaló explícitamente que las
// sombras son el problema de un filtro de contraste ingenuo (estirar el
// histograma global amplifica también el ruido de las zonas en sombra).
// CLAHE mejora el contraste POR TESELAS (regiones locales), limitando la
// amplificación (maxSlope) — penaliza mucho menos las sombras porque cada
// zona de la imagen se ecualiza con su propio histograma local, no el de
// toda la imagen. Referencia: https://en.wikipedia.org/wiki/Adaptive_histogram_equalization
'use strict';

const sharp = require('sharp');
const fs = require('fs').promises;

// Tamaño de tesela CLAHE en píxeles (no nº de teselas — ver sharp ClaheOptions).
// 100x100 es razonable para imágenes de factura redimensionadas a ~1536px de
// ancho (mismo orden de magnitud que image_max_resolution en features.json):
// suficientes teselas para contraste local real, sin fragmentar tanto que
// amplifique ruido de compresión JPEG. CALIBRAR con dataset real si hiciera
// falta (mismo criterio que otros umbrales empíricos del proyecto).
const CLAHE_TILE_SIZE = 100;
const CLAHE_MAX_SLOPE = 3; // valor por defecto documentado de sharp/libvips

/**
 * Genera una variante de la imagen optimizada para lectura por IA: contraste
 * local (CLAHE) + brillo y saturación reducidos. Devuelve un Buffer JPEG.
 *
 * @param {Buffer} bufferOriginal - imagen original (cualquier formato soportado por sharp)
 * @returns {Promise<Buffer>}
 */
// Por debajo de este tamaño de lado, CLAHE deja de tener sentido (no hay
// suficientes píxeles para calcular un histograma local útil) — se aplica
// solo brillo/saturación en ese caso extremo (fotos degeneradas, no debería
// ocurrir nunca con una factura real).
const CLAHE_LADO_MINIMO = 16;

async function generarVarianteContraste(bufferOriginal) {
  const rotada = sharp(bufferOriginal).rotate(); // aplica orientación EXIF antes de medir/transformar
  const metadata = await rotada.metadata();
  const ladoMenor = Math.min(metadata.width || 0, metadata.height || 0);

  let pipeline = rotada.modulate({ brightness: 0.85, saturation: 0.15 });

  if (ladoMenor >= CLAHE_LADO_MINIMO) {
    // sharp/libvips lanza "hist_local: window too large" si la tesela CLAHE
    // es mayor que la propia imagen — se acota al menor lado disponible.
    const tileSize = Math.min(CLAHE_TILE_SIZE, ladoMenor);
    pipeline = pipeline.clahe({ width: tileSize, height: tileSize, maxSlope: CLAHE_MAX_SLOPE });
  }

  return pipeline.jpeg({ quality: 90 }).toBuffer();
}

/**
 * Genera la variante y la escribe a disco junto al fichero original
 * (mismo directorio, sufijo `.variante-contraste.jpg`), para poder mostrarla
 * después en el panel admin sin regenerarla cada vez.
 *
 * @param {string} rutaOriginal - ruta absoluta del fichero original ya subido
 * @returns {Promise<string>} ruta absoluta del fichero de la variante
 */
async function generarYGuardarVariante(rutaOriginal) {
  const bufferOriginal = await fs.readFile(rutaOriginal);
  const bufferVariante = await generarVarianteContraste(bufferOriginal);
  const rutaVariante = `${rutaOriginal}.variante-contraste.jpg`;
  await fs.writeFile(rutaVariante, bufferVariante);
  return rutaVariante;
}

module.exports = { generarVarianteContraste, generarYGuardarVariante, CLAHE_TILE_SIZE, CLAHE_MAX_SLOPE };
