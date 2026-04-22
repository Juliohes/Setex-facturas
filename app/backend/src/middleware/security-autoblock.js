// Middleware de auto-block basado en contador Redis por IP.
//
// Exceptúa /api/internal/* porque nginx auth_request solo tolera 200/401/403
// (un 429 haría nginx devolver 500 al cliente y dejar el sitio roto).
'use strict';

const { extractClientIp } = require('../lib/ip-utils');
const { ipInList } = require('./security-ip');

function makeSecurityAutoBlockMiddleware({ loadSecurityConfig, redisClient, logger }) {
  if (typeof loadSecurityConfig !== 'function') {
    throw new Error('security-autoblock: "loadSecurityConfig" must be a function');
  }
  if (!redisClient) {
    throw new Error('security-autoblock: "redisClient" required');
  }

  return async function securityAutoBlockMiddleware(req, res, next) {
    if (req.path.startsWith('/api/internal/')) return next();

    const cfg = loadSecurityConfig();
    if (!cfg?.auto_block?.enabled) return next();

    const ip = extractClientIp(req);
    if (!ip) return next();
    if (ipInList(ip, cfg.ip_whitelist)) return next();

    const {
      max_requests = 400,
      window_seconds = 300,
      block_duration_minutes = 60,
    } = cfg.auto_block;

    const blockKey = `sec:block:${ip}`;
    const countKey = `sec:count:${ip}`;

    try {
      const blocked = await redisClient.get(blockKey);
      if (blocked) {
        return res
          .status(429)
          .json({ error: 'Acceso bloqueado temporalmente por exceso de solicitudes. Inténtalo en 1 hora.' });
      }

      const count = await redisClient.incr(countKey);
      if (count === 1) await redisClient.expire(countKey, window_seconds);
      if (count > max_requests) {
        const dur = block_duration_minutes * 60;
        await redisClient.setex(blockKey, dur, new Date().toISOString());
        logger?.warn?.('[Security] Auto-block activado', {
          ip,
          count,
          window_seconds,
          block_duration_minutes,
        });
        return res
          .status(429)
          .json({ error: 'Acceso bloqueado temporalmente por exceso de solicitudes. Inténtalo en 1 hora.' });
      }

      next();
    } catch (err) {
      // Fail-open: si Redis no responde NO bloqueamos tráfico legítimo.
      // Telemetry queda registrada; si Redis está caído, seguridad depende del rate-limit de capa Express.
      logger?.warn?.('[Security] Auto-block redis error — fail-open', { message: err.message });
      next();
    }
  };
}

module.exports = { makeSecurityAutoBlockMiddleware };
