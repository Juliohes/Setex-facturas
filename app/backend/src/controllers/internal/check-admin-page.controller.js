// GET /api/internal/check-admin-page — endpoint usado por nginx auth_request
// en `location = /admin-facturas.html`. Verifica:
//   1) hora no bloqueada (igual que check-access),
//   2) cookie httpOnly `setex_admin` presente,
//   3) JWT válido + payload.type === 'admin_page' && payload.is_admin === true,
//   4) tokenVerificationService valida token_version + is_admin en BD con
//      timeout fail-secure 500ms.
//
// Sin cookie / cookie inválida → 403 → nginx redirige a /?next=admin.
// BD caída / timeout → 503 fail-secure (denegar antes que servir admin a un
// usuario que no podemos verificar — incidente Round 16 prevention).
'use strict';

const { isRestrictedHour } = require('../../services/security/restricted-hour.service');

function makeInternalCheckAdminPageController({
  ipListManager,
  tokenVerificationService,
  logger,
} = {}) {
  if (!ipListManager?.load) {
    throw new Error('internal check-admin-page.controller: "ipListManager" required');
  }
  if (!tokenVerificationService?.verify) {
    throw new Error('internal check-admin-page.controller: "tokenVerificationService" required');
  }

  return async function internalCheckAdminPageController(req, res) {
    const cfg = ipListManager.load();
    if (isRestrictedHour(cfg)) return res.status(403).end();

    const adminToken = req.cookies?.setex_admin;
    if (!adminToken) return res.status(403).end();

    const result = await tokenVerificationService.verify(adminToken);
    if (!result.ok) {
      if (result.reason === 'db_unavailable') return res.status(503).end();
      return res.status(403).end();
    }

    const { user } = result;
    if (user.type !== 'admin_page' || !user.is_admin) {
      return res.status(403).end();
    }
    return res.status(200).end();
  };
}

module.exports = { makeInternalCheckAdminPageController };
