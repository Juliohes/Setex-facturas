// Image controller — GET /api/facturas/:id/imagen. Devuelve la imagen original
// de una factura del usuario. Guard: solo el dueño puede verla.
'use strict';

const path = require('node:path');
const fs = require('node:fs');

function makeImageController({ uploadsRepo, storageBase = '/app/uploads', logger } = {}) {
  if (!uploadsRepo?.findById) {
    throw new Error('image.controller: "uploadsRepo.findById" required');
  }

  return async function imageController(req, res) {
    const userId = req.user?.userId;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id inválido' });
    }

    const upload = await uploadsRepo.findById(id);
    if (!upload || upload.user_id !== userId) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const filePath = upload.file_path && path.resolve(upload.file_path);
    if (!filePath || !filePath.startsWith(path.resolve(storageBase))) {
      logger?.warn?.('image.controller: path fuera de storageBase', { id, filePath });
      return res.status(404).json({ error: 'No encontrado' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    res.setHeader('Content-Type', upload.mimetype || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  };
}

module.exports = { makeImageController };
