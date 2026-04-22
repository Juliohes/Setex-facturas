// DELETE /api/me/account — RGPD art. 17 (derecho al olvido).
// Borra usuario + uploads + audit_logs en transacción. Irreversible.
'use strict';

const { withTransaction } = require('../../repositories/base.repo');

function makeDeleteAccountController({ usersRepo, pool, auditService, logger } = {}) {
  if (!usersRepo?.deleteWithUploads) {
    throw new Error('delete-account.controller: "usersRepo.deleteWithUploads" required');
  }
  if (!pool) throw new Error('delete-account.controller: "pool" required');

  return async function deleteAccountController(req, res) {
    const userId = req.user.userId;
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE MY ACCOUNT') {
      return res.status(400).json({
        error: 'Para confirmar escribe literalmente "DELETE MY ACCOUNT" en el campo confirm',
      });
    }

    const deleted = await withTransaction(pool, (client) =>
      usersRepo.deleteWithUploads(userId, client)
    );

    await auditService?.log?.({
      action: 'RGPD_DELETE',
      userId: null,
      details: { erased_user_email: deleted?.email, erased_user_id: userId },
      ip: req.ip,
    }).catch(() => {});

    res.clearCookie('rt', { path: '/api/auth' });
    res.json({ ok: true, message: 'Cuenta eliminada. Gracias por usar SETEX.' });
  };
}

module.exports = { makeDeleteAccountController };
