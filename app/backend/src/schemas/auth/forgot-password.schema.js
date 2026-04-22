// Schema de /api/auth/forgot-password. Solo email. El servicio responde 200
// idempotente independientemente de si el usuario existe (evita user enumeration).
'use strict';

const { z } = require('zod');

const forgotPasswordSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(254)
      .email('Email inválido'),
  })
  .strict();

module.exports = { forgotPasswordSchema };
