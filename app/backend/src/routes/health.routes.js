// Health routes — liveness + readiness.
//
//   GET /health           — 200 si proceso vivo (sin deps)
//   GET /health/ready     — 200/503 según ping BD + Redis + disco
//
// Used by:
//  - watchdog cron cada 5 min
//  - deploy workflows post-swap
//  - Traefik/k8s readiness probe (si se migra)
'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');

function makeHealthRoutes({ db, cache, logger } = {}) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), pid: process.pid });
  });

  router.get(
    '/health/ready',
    asyncHandler(async (req, res) => {
      const checks = await Promise.allSettled([
        db?.healthcheck?.() ?? Promise.resolve(null),
        cache?.healthcheck?.() ?? Promise.resolve(null),
      ]);
      const [dbCheck, cacheCheck] = checks;
      const ok = dbCheck.status === 'fulfilled' && dbCheck.value !== false
        && cacheCheck.status === 'fulfilled' && cacheCheck.value !== false;

      const body = {
        status: ok ? 'ok' : 'degraded',
        db: dbCheck.status === 'fulfilled' ? dbCheck.value : 'error',
        cache: cacheCheck.status === 'fulfilled' ? cacheCheck.value : 'error',
        timestamp: new Date().toISOString(),
      };
      if (!ok) logger?.warn?.('health/ready degraded', body);
      res.status(ok ? 200 : 503).json(body);
    })
  );

  return router;
}

module.exports = { makeHealthRoutes };
