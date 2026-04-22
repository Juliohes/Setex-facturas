// GET /api/me/export — RGPD art. 15 (acceso) + 20 (portabilidad).
// Devuelve toda la información personal del usuario (perfil + uploads) en JSON.
// El contenido incluye ocr_result raw y metadatos; se excluye password_hash.
'use strict';

function makeExportRgpdController({ usersRepo, auditService, logger } = {}) {
  if (!usersRepo?.exportUserData) {
    throw new Error('export-rgpd.controller: "usersRepo.exportUserData" required');
  }

  return async function exportRgpdController(req, res) {
    const userId = req.user.userId;
    const data = await usersRepo.exportUserData(userId);
    if (!data) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { password_hash, ...safeUser } = data.user;

    await auditService?.log?.({
      action: 'RGPD_EXPORT',
      userId,
      details: { uploads_count: data.uploads.length },
      ip: req.ip,
    });

    res.setHeader('Content-Disposition', `attachment; filename="setex-export-${userId}.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      generated_at: new Date().toISOString(),
      user: safeUser,
      uploads: data.uploads,
    });
  };
}

module.exports = { makeExportRgpdController };
