// GET/DELETE /api/admin/security/blocked — lista IPs auto-bloqueadas y permite unblock.
'use strict';

function makeAdminSecurityBlockedController({ autoBlockService, auditService } = {}) {
  if (!autoBlockService?.listBlocked) {
    throw new Error('admin security blocked.controller: "autoBlockService" required');
  }

  return {
    list: async function listBlockedController(req, res) {
      const items = await autoBlockService.listBlocked();
      res.json({ total: items.length, items });
    },
    remove: async function removeBlockedController(req, res) {
      const { ip } = req.query;
      if (!ip) return res.status(400).json({ error: 'query ip requerida' });
      const deleted = await autoBlockService.unblock(String(ip));
      await auditService?.log?.({
        action: 'ADMIN_SECURITY_UNBLOCK',
        userId: req.user.userId,
        ip: req.ip,
        details: { target_ip: ip, deleted },
      });
      res.json({ ok: true, ip, deleted });
    },
  };
}

module.exports = { makeAdminSecurityBlockedController };
