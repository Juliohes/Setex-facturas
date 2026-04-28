// Schema de /api/auth/login. Email + password. Normaliza email a minúsculas.
'use strict';

const { z } = require('zod');

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Email demasiado corto')
    .max(254, 'Email demasiado largo')
    .email('Email inválido'),
  password: z
    .string()
    .min(1, 'Password requerida')
    .max(256, 'Password demasiado larga'),
});

module.exports = { loginSchema };
