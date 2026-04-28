// Middleware de seguridad por IP: whitelist/blacklist + restricción horaria.
// Equivalente moderno a las reglas .htaccess que vivían en nginx.
//
// Contrato de `loadSecurityConfig` (ver services/security/ip-list-manager en Round 14):
//   () => { time_restriction, ip_whitelist, ip_blacklist, auto_block, max_users }
'use strict';

const { extractClientIp, ipInCidr } = require('../lib/ip-utils');

function ipInList(ip, list) {
  if (!ip || !Array.isArray(list)) return false;
  return list.some((range) => {
    if (!range || typeof range !== 'string' || range.startsWith('_')) return false;
    if (!range.includes('/')) return ip === range;
    return ipInCidr(ip, range);
  });
}

function isRestrictedHour(cfg) {
  const r = cfg?.time_restriction;
  if (!r?.enabled) return false;
  const { start_hour = 0, end_hour = 6, timezone = 'Europe/Madrid' } = r;
  if (start_hour === end_hour) return false; // config inválida → no aplicar (evita lockout total)
  let h;
  try {
    h = parseInt(
      new Intl.DateTimeFormat('es-ES', { timeZone: timezone, hour: 'numeric', hour12: false })
        .format(new Date()),
      10
    );
  } catch {
    h = new Date().getUTCHours();
  }
  return start_hour < end_hour ? h >= start_hour && h < end_hour : h >= start_hour || h < end_hour;
}

function makeSecurityIpMiddleware({ loadSecurityConfig, logger }) {
  if (typeof loadSecurityConfig !== 'function') {
    throw new Error('security-ip: "loadSecurityConfig" must be a function');
  }

  return function securityIpMiddleware(req, res, next) {
    const cfg = loadSecurityConfig();
    const ip = extractClientIp(req);

    if (ip && ipInList(ip, cfg.ip_whitelist)) return next();

    if (ip && ipInList(ip, cfg.ip_blacklist)) {
      logger?.warn?.('[Security] IP bloqueada (blacklist)', { ip, method: req.method, path: req.path });
      return res.status(403).json({ error: 'Acceso denegado.' });
    }

    if (isRestrictedHour(cfg)) {
      logger?.info?.('[Security] Acceso bloqueado por horario', { ip, method: req.method, path: req.path });
      return res.status(403).end();
    }

    next();
  };
}

module.exports = { makeSecurityIpMiddleware, ipInList, isRestrictedHour };
