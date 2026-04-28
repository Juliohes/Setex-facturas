// GET /api/admin/system-health — diagnóstico enriquecido (BD, Redis, disco, pool).
'use strict';

const fs = require('node:fs/promises');

function makeAdminSystemHealthController({ db, cache, pool, uploadsDir = '/app/uploads' } = {}) {
  return async function adminSystemHealthController(req, res) {
    const dbOk = db?.healthcheck ? await db.healthcheck().catch(() => false) : null;
    const cacheOk = cache?.healthcheck ? await cache.healthcheck().catch(() => false) : null;

    let diskUsage = null;
    try {
      const stat = await fs.stat(uploadsDir);
      diskUsage = { uploads_dir: uploadsDir, accessed_at: stat.atime };
    } catch (err) {
      diskUsage = { uploads_dir: uploadsDir, error: err.message };
    }

    const memory = process.memoryUsage();

    res.json({
      status: dbOk && cacheOk ? 'ok' : 'degraded',
      db: dbOk,
      cache: cacheOk,
      pool: pool ? {
        total: pool.totalCount?.() ?? pool.totalCount ?? null,
        idle: pool.idleCount?.() ?? pool.idleCount ?? null,
        waiting: pool.waitingCount?.() ?? pool.waitingCount ?? null,
      } : null,
      memory: {
        rss_mb: Math.round(memory.rss / 1024 / 1024),
        heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
      },
      disk: diskUsage,
      uptime_s: Math.round(process.uptime()),
      node: process.version,
      pid: process.pid,
    });
  };
}

module.exports = { makeAdminSystemHealthController };
