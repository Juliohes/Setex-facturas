// POST|DELETE /api/admin/security/{blacklist,whitelist} — añade o quita IP
// de la lista. Un único controller genera 4 handlers parametrizados.
'use strict';

function makeAdminSecurityListUpdateController({ ipListManager, autoBlockService, auditService } = {}) {
  if (!ipListManager?.addToList || !ipListManager?.removeFromList) {
    throw new Error('admin security list-update.controller: "ipListManager" required');
  }

  function make({ listName, action }) {
    return async function handler(req, res) {
      const { ip } = req.body || {};
      if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'ip string requerida' });
      const size = action === 'add'
        ? ipListManager.addToList(listName, ip)
        : ipListManager.removeFromList(listName, ip);

      // Si se añade a whitelist, desbloquear IP por si acaso
      if (listName === 'ip_whitelist' && action === 'add' && autoBlockService?.unblock) {
        await autoBlockService.unblock(ip.trim()).catch(() => {});
      }

      await auditService?.log?.({
        action: `ADMIN_SECURITY_${listName.toUpperCase()}_${action.toUpperCase()}`,
        userId: req.user.userId,
        ip: req.ip,
        details: { target_ip: ip },
      });

      res.json({ ok: true, list: listName, action, size });
    };
  }

  return {
    addBlacklist: make({ listName: 'ip_blacklist', action: 'add' }),
    removeBlacklist: make({ listName: 'ip_blacklist', action: 'remove' }),
    addWhitelist: make({ listName: 'ip_whitelist', action: 'add' }),
    removeWhitelist: make({ listName: 'ip_whitelist', action: 'remove' }),
  };
}

module.exports = { makeAdminSecurityListUpdateController };
