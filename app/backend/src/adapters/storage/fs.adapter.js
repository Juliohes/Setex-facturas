// Adapter filesystem de StoragePort. Backing en disco local (/app/uploads).
// Futuro S3/B2: crear s3.adapter.js con mismo contrato y swapear en factory.
'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const { assertStoragePort } = require('../../ports/storage.port');

function createFsStorageAdapter({ baseDir = '/app/uploads', logger } = {}) {
  const resolvedBase = path.resolve(baseDir);

  function resolvePath(key) {
    const safe = path.resolve(resolvedBase, key);
    if (!safe.startsWith(resolvedBase + path.sep) && safe !== resolvedBase) {
      throw new Error(`fs.adapter: path fuera de baseDir: ${key}`);
    }
    return safe;
  }

  const adapter = {
    name: 'fs',
    async healthcheck() {
      try {
        await fs.access(resolvedBase);
        return true;
      } catch {
        return false;
      }
    },
    async put(key, buffer, mimeType) {
      const full = resolvePath(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, buffer);
      return {
        key,
        absolutePath: full,
        sizeBytes: buffer.length,
        mimeType,
      };
    },
    async get(key) {
      return fs.readFile(resolvePath(key));
    },
    async remove(key) {
      try {
        await fs.unlink(resolvePath(key));
        return true;
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    },
    async exists(key) {
      try {
        await fs.access(resolvePath(key));
        return true;
      } catch {
        return false;
      }
    },
    resolvePath,
  };

  return assertStoragePort(adapter);
}

module.exports = { createFsStorageAdapter };
