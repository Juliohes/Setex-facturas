// Utilidades IP: extracción fiable del cliente detrás de Traefik + normalización
// IPv4-mapeada IPv6 + match CIDR.
//
// Traefik pone la IP real en X-Forwarded-For. Express `req.ip` ya hace el trabajo
// si `app.set('trust proxy', ...)` está configurado — aquí exponemos un extractor
// directo para middlewares y logs donde solo tenemos `req`.
'use strict';

const net = require('node:net');

function normalizeIp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0];
    const ip = normalizeIp(first);
    if (ip) return ip;
  }
  return normalizeIp(req.ip) || normalizeIp(req.connection?.remoteAddress) || null;
}

function isValidIp(ip) {
  return net.isIP(String(ip || '')) !== 0;
}

function ipInCidr(ip, cidr) {
  if (!isValidIp(ip) || !cidr || !cidr.includes('/')) return false;
  const [network, bitsStr] = cidr.split('/');
  if (!isValidIp(network)) return false;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (net.isIPv6(ip) || net.isIPv6(network)) return ip === network;
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function ipv4ToInt(ip) {
  return ip
    .split('.')
    .reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

module.exports = { extractClientIp, isValidIp, ipInCidr, normalizeIp };
