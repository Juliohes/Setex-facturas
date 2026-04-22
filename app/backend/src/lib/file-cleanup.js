// Cleanup seguro de ficheros temporales de uploads. Todos los paths se resuelven
// con path.resolve() y se valida que estén dentro del baseDir antes de borrar —
// mitigación anti path-traversal si el caller pasa un nombre controlado por user.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function isInside(baseDir, filePath) {
  const resolvedBase = path.resolve(baseDir) + path.sep;
  const resolvedFile = path.resolve(filePath);
  return resolvedFile === path.resolve(baseDir) || resolvedFile.startsWith(resolvedBase);
}

async function safeUnlink(baseDir, filePath, logger = null) {
  if (!baseDir || !filePath) return false;
  if (!isInside(baseDir, filePath)) {
    logger?.warn?.('file-cleanup: path fuera de baseDir — se ignora', {
      baseDir,
      filePath,
    });
    return false;
  }
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    logger?.warn?.('file-cleanup: unlink falló', { filePath, code: err.code });
    return false;
  }
}

async function cleanupOlderThan(baseDir, maxAgeMs, logger = null) {
  let removed = 0;
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(baseDir, entry.name);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) {
          const ok = await safeUnlink(baseDir, full, logger);
          if (ok) removed += 1;
        }
      } catch (err) {
        logger?.debug?.('file-cleanup: stat falló', { full, code: err.code });
      }
    }
  } catch (err) {
    logger?.warn?.('file-cleanup: readdir falló', { baseDir, code: err.code });
  }
  return removed;
}

module.exports = { safeUnlink, cleanupOlderThan, isInside };
