// PUT /api/admin/users/:id — actualiza is_admin y/o company fields del usuario.
// Guard: admin no puede quitarse a sí mismo privilegios (previene lockout).
'use strict';

function makeAdminUsersUpdateController({ usersRepo, auditService } = {}) {
  if (!usersRepo?.adminUpdate) {
    throw new Error('admin users update.controller: "usersRepo.adminUpdate" required');
  }

  return async function adminUsersUpdateController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

    const allowed = ['is_admin', 'company_name', 'company_nif'];
    const updates = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.is_admin === false && id === req.user.userId) {
      return res.status(400).json({
        error: 'No puedes quitarte privilegios a ti mismo desde este endpoint',
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Sin cambios válidos' });
    }

    const updated = await usersRepo.adminUpdate(id, updates);
    if (!updated) return res.status(404).json({ error: 'Usuario no encontrado' });

    await auditService?.log?.({
      action: 'ADMIN_USER_UPDATED',
      userId: req.user.userId,
      ip: req.ip,
      details: { target_user_id: id, fields: Object.keys(updates) },
    });

    res.json({ ok: true, user: updated });
  };
}

module.exports = { makeAdminUsersUpdateController };
