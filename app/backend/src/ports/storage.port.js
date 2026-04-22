// Contrato del puerto de almacenamiento de ficheros (uploads de facturas).
// Hoy el adapter es filesystem local (adapters/storage/fs.adapter.js, Round 10).
// Preparado para adapter S3/B2 futuro sin tocar services.
'use strict';

/**
 * @typedef {Object} StoredFile
 * @property {string} key                    Identificador lógico (no path de disco)
 * @property {string} absolutePath           Path de disco cuando aplique
 * @property {number} sizeBytes
 * @property {string} mimeType
 */

/**
 * @typedef {Object} StoragePort
 * @property {string} name
 * @property {() => Promise<boolean>} healthcheck
 * @property {(key: string, buffer: Buffer, mimeType: string) => Promise<StoredFile>} put
 * @property {(key: string) => Promise<Buffer>} get
 * @property {(key: string) => Promise<boolean>} remove
 * @property {(key: string) => Promise<boolean>} exists
 * @property {(key: string) => string} resolvePath   Devuelve path disco — solo si el adapter local lo permite
 */

function assertStoragePort(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('StoragePort: candidate must be an object');
  }
  const required = ['name', 'healthcheck', 'put', 'get', 'remove', 'exists', 'resolvePath'];
  for (const field of required) {
    if (candidate[field] === undefined) {
      throw new Error(`StoragePort: missing "${field}"`);
    }
  }
  return candidate;
}

module.exports = { assertStoragePort };
