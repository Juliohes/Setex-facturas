// Schema de /api/auth/reset-password. Token + nueva password con mismos requisitos
// que register. El token viaja en el body (no query) para evitar filtración en logs.
'use strict';

const { z } = require('zod');

const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(20, 'Token inválido')
      .max(256),
    password: z
      .string()
      .min(10, 'La contraseña debe tener al menos 10 caracteres')
      .max(256)
      .refine((p) => /[A-Z]/.test(p), 'Debe contener al menos una mayúscula')
      .refine((p) => /[a-z]/.test(p), 'Debe contener al menos una minúscula')
      .refine((p) => /[0-9]/.test(p), 'Debe contener al menos un número'),
  })
  .strict();

module.exports = { resetPasswordSchema };
