// Contrato del puerto OCR. Cualquier adapter en adapters/ocr/* debe cumplir
// exactamente esta forma. Los tests tests/contracts/ocr-port.test.js verifican
// LSP: sustituir openai por azure por gemini debe ser transparente para
// services/invoices/ocr-orchestration.service.
'use strict';

/**
 * @typedef {Object} OcrInput
 * @property {string} filePath               Ruta absoluta al fichero de imagen/PDF
 * @property {string} mimeType               JPEG|PNG|PDF
 * @property {string} [userCompanyNif]       NIF de la empresa del usuario (hint)
 * @property {string} [requestId]            Correlation id para logs
 */

/**
 * @typedef {Object} OcrLineaIva
 * @property {number} porcentaje             0, 4, 10, 21, ...
 * @property {number|null} base              EUR sin IVA
 * @property {number|null} cuota             EUR cuota IVA
 * @property {number|null} total             EUR total del tramo
 * @property {Array<{descripcion: string, importe: number|null}>} [productos]
 */

/**
 * @typedef {Object} OcrResult
 * @property {string} engine                         Identificador del adapter ('openai'|'azure'|...)
 * @property {string|null} emisor_nombre
 * @property {string|null} emisor_nif
 * @property {string|null} receptor_nombre
 * @property {string|null} receptor_nif
 * @property {string|null} numero_factura
 * @property {string|null} fecha                     ISO 8601 YYYY-MM-DD
 * @property {number|null} base_imponible
 * @property {number|null} cuota_iva
 * @property {number|null} total
 * @property {number|null} irpf_pct
 * @property {number|null} irpf_cuota
 * @property {'mono'|'multi'|'ambiguo'} tramos_iva   Decisión early-branch
 * @property {Array<OcrLineaIva>} lineas_iva
 * @property {number} confidence                     0..1
 * @property {number} duration_ms
 * @property {Object} [raw]                          Payload original del motor (solo debug)
 */

/**
 * @typedef {Object} OcrPort
 * @property {string} name                                  Identificador del adapter
 * @property {() => Promise<boolean>} healthcheck           true si la API responde
 * @property {(input: OcrInput) => Promise<OcrResult>} extract  Extracción principal
 */

// Sentinel para verificar en runtime que un objeto cumple el contrato.
function assertOcrPort(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('OcrPort: candidate must be an object');
  }
  if (typeof candidate.name !== 'string' || !candidate.name) {
    throw new Error('OcrPort: "name" must be a non-empty string');
  }
  if (typeof candidate.healthcheck !== 'function') {
    throw new Error('OcrPort: "healthcheck" must be a function');
  }
  if (typeof candidate.extract !== 'function') {
    throw new Error('OcrPort: "extract" must be a function');
  }
  return candidate;
}

module.exports = { assertOcrPort };
