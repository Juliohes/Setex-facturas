// GET /api/me/profile — devuelve perfil del usuario autenticado.
'use strict';

function makeProfileGetController({ usersRepo } = {}) {
  if (!usersRepo?.findById) throw new Error('profile-get.controller: "usersRepo.findById" required');

  return async function profileGetController(req, res) {
    const user = await usersRepo.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      id: user.id,
      email: user.email,
      company_name: user.company_name,
      company_nif: user.company_nif,
      is_admin: user.is_admin === true,
      auto_confirm_enabled: user.auto_confirm_enabled !== false,
      created_at: user.created_at,
    });
  };
}

module.exports = { makeProfileGetController };
