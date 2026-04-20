// Rate limiters centralizados — express-rate-limit
// Cada limitador es una instancia reutilizable. Para rutas de escritura sensibles
// (auth, upload, confirm) usamos ventanas de 15min + thresholds distintos por tipo.
// Defense in depth: Nginx aplica rate limit a nivel capa 4; estos son capa 7.
'use strict';

const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
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
