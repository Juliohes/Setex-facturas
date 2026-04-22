// List-mine controller — GET /api/mis-facturas. Devuelve las últimas N facturas
// del usuario (default 50 de los últimos 7 días).
'use strict';

function makeListMineController({ uploadsRepo } = {}) {
  if (!uploadsRepo?.listRecentByUser) {
    throw new Error('list-mine.controller: "uploadsRepo.listRecentByUser" required');
  }

  return async function listMineController(req, res) {
    const userId = req.user?.userId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const days = Math.min(parseInt(req.query.days, 10) || 7, 90);

    const rows = await uploadsRepo.listRecentByUser({ userId, limit, days });
    res.json({ total: rows.length, items: rows });
  };
}

module.exports = { makeListMineController };
