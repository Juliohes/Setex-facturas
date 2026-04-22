// GET /api/admin/security — devuelve config actual + listas IP + estado blocked.
'use strict';

function makeAdminSecurityConfigController({ ipListManager, autoBlockService } = {}) {
  if (!ipListManager?.load) throw new Error('admin security config.controller: "ipListManager" required');

  return async function adminSecurityConfigController(req, res) {
    const cfg = ipListManager.load();
    const blockedCount = autoBlockService?.countBlocked
      ? await autoBlockService.countBlocked().catch(() => 0)
      : 0;

    res.json({
      time_restriction: cfg.time_restriction,
      ip_whitelist: cfg.ip_whitelist,
      ip_blacklist: cfg.ip_blacklist,
      auto_block: cfg.auto_block,
      max_users: cfg.max_users,
      blocked_count: blockedCount,
    });
  };
}

module.exports = { makeAdminSecurityConfigController };
