// GET /api/me/settings — preferencias usuario (auto_confirm_enabled hoy).
'use strict';

function makeSettingsGetController({ usersRepo } = {}) {
  if (!usersRepo?.findById) throw new Error('settings-get.controller: "usersRepo" required');

  return async function settingsGetController(req, res) {
    const user = await usersRepo.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      auto_confirm_enabled: user.auto_confirm_enabled !== false,
    });
  };
}

module.exports = { makeSettingsGetController };
