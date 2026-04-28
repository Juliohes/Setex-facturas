// POST /api/me/settings — actualiza preferencias del usuario.
'use strict';

function makeSettingsUpdateController({ usersRepo, auditService } = {}) {
  if (!usersRepo?.setAutoConfirm) {
    throw new Error('settings-update.controller: "usersRepo.setAutoConfirm" required');
  }

  return async function settingsUpdateController(req, res) {
    const userId = req.user?.userId;
    const { auto_confirm_enabled } = req.body || {};
    if (typeof auto_confirm_enabled !== 'boolean') {
      return res.status(400).json({ error: 'auto_confirm_enabled boolean requerido' });
    }
    await usersRepo.setAutoConfirm(userId, auto_confirm_enabled);
    await auditService?.log?.({
      action: 'SETTINGS_UPDATED',
      userId,
      details: { auto_confirm_enabled },
      ip: req.ip,
    });
    res.json({ ok: true, auto_confirm_enabled });
  };
}

module.exports = { makeSettingsUpdateController };
