// PATCH /api/admin/security/time — edita la sub-config time_restriction
// (enabled, start_hour, end_hour). Atomic write con backup vía
// ipListManager.save() (mismo mecanismo que list-update).
//
// 400 si start_hour === end_hour (lockout permanente prevention).
// 200 con la nueva time_restriction.
'use strict';

function makeAdminSecurityTimeController({ ipListManager, auditService, logger } = {}) {
  if (!ipListManager?.updateTimeRestriction) {
    throw new Error('admin security time.controller: "ipListManager" required');
  }

  return async function adminSecurityTimeController(req, res) {
    const { enabled, start_hour, end_hour } = req.body || {};
    try {
      const next = ipListManager.updateTimeRestriction({ enabled, start_hour, end_hour });
      await auditService?.log?.({
        action: 'SECURITY_TIME_UPDATE',
        details: { enabled, start_hour, end_hour },
        userId: req.user.userId,
        ip: req.ip,
      });
      return res.json({ success: true, time_restriction: next });
    } catch (err) {
      if (err.code === 'INVALID_RANGE') {
        return res.status(400).json({ error: err.message });
      }
      logger?.error?.('[security/time] update error:', err.message || err);
      return res.status(500).json({ error: 'Error al actualizar restricción horaria' });
    }
  };
}

module.exports = { makeAdminSecurityTimeController };
