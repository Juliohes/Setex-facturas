// Schema de /api/auth/register. Email + password + datos fiscales empresa.
// Coherente con validateSpanishTaxId (domain/validators/nif) — aquí solo
// validamos formato superficial; la verificación AEAT se hace en el service.
'use strict';

const { z } = require('zod');

const NIF_PATTERN = /^[A-Z0-9][0-9]{7}[A-Z0-9]$/i;

const registerSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(254)
      .email('Email inválido'),
    password: z
      .string()
      .min(10, 'La contraseña debe tener al menos 10 caracteres')
      .max(256)
      .refine((p) => /[A-Z]/.test(p), 'Debe contener al menos una mayúscula')
      .refine((p) => /[a-z]/.test(p), 'Debe contener al menos una minúscula')
      .refine((p) => /[0-9]/.test(p), 'Debe contener al menos un número'),
    company_nif: z
      .string()
      .trim()
      .toUpperCase()
      .regex(NIF_PATTERN, 'NIF/CIF con formato inválido'),
    company_name: z
      .string()
      .trim()
      .min(2, 'Nombre de empresa demasiado corto')
      .max(200),
    consent_rgpd: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar el tratamiento de datos' }) }),
  })
  .strict();

module.exports = { registerSchema, NIF_PATTERN };
