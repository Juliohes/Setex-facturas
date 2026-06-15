// Rate limiters centralizados — express-rate-limit
// Cada limitador es una instancia reutilizable. Para rutas de escritura sensibles
// (auth, upload, confirm) usamos ventanas de 15min + thresholds distintos por tipo.
// Defense in depth: Nginx aplica rate limit a nivel capa 4; estos son capa 7.
'use strict';

const rateLimit = require('express-rate-limit');

// El rate-limit de auth se cuenta por EMAIL, no por IP. Razón: tras Traefik+nginx
// el `req.ip` que ve Express es siempre la IP de la red interna Docker (172.22.x.x),
// con lo cual un único contador por IP bloqueaba a TODOS los usuarios cuando alguien
// fallaba muchos intentos. Al usar el email como clave, los intentos fallidos
// bloquean exclusivamente a ese email — el resto de usuarios siguen pudiendo entrar.
// Fallback a IP cuando la petición no trae email (p.ej. /reset-password con token).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  keyGenerator: (req) => {
    const raw = (req.body && typeof req.body.email === 'string') ? req.body.email : '';
    const email = raw.trim().toLowerCase();
    return email ? `email:${email}` : `ip:${req.ip || 'unknown'}`;
  },
  message: { error: 'Demasiados intentos para este usuario. Espera unos minutos e inténtalo de nuevo.' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.UPLOAD_RATE_LIMIT) || 30,
  standardHeaders: true,
  message: { error: 'Demasiados envíos. Espera unos minutos e inténtalo de nuevo.' }
});

const confirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  message: { error: 'Demasiadas solicitudes. Espera unos minutos.' }
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  message: { error: 'Demasiadas peticiones de refresco. Espera un momento.' }
});

// VIES: consulta servicio externo UE, sus rate limits aplican a nivel servicio.
// Limitador local para evitar que un usuario malintencionado agote la cuota.
const viesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: { error: 'Demasiadas consultas VIES. Espera un minuto.' }
});

module.exports = {
  authLimiter,
  uploadLimiter,
  confirmLimiter,
  refreshLimiter,
  viesLimiter,
};
