// src/pipeline/schema.js
// Fase 4.1 de PROMPT-PIPELINE-OCR-FACTURAS-V2.md: esquema canónico único
// para la extracción de facturas, validado con Zod (ya era dependencia del
// proyecto — sin añadir ninguna librería nueva).
//
// Formato NUEVO, solo para el pipeline v2 (pipeline/extractors.js y lo que
// venga después). El pipeline v1 (ocr/index.js) sigue con su shape libre
// de siempre — regla 4 del prompt: "no modifiques el contrato de ningún
// endpoint existente". Importes como string (no float), igual que hoy:
// evita perder precisión decimal y mantiene el formato español ("1.234,56").
'use strict';

const { z } = require('zod');

const LineaIvaSchema = z.object({
  base: z.string().nullable(),
  tipo: z.string().nullable(),
  cuota: z.string().nullable(),
});

const FacturaCanonicaSchema = z.object({
  emisor: z.object({ nombre: z.string().nullable(), nif: z.string().nullable() }),
  receptor: z.object({ nombre: z.string().nullable(), nif: z.string().nullable() }),
  numero_factura: z.string().nullable(),
  fecha_emision: z.string().nullable(),
  lineas_iva: z.array(LineaIvaSchema),
  retencion_irpf: z.string().nullable(),
  total: z.string().nullable(),
  moneda: z.string(),
  es_factura_valida: z.boolean(),
  // Metadatos de procedencia (Fase 4.1: "confianza y fuente por campo" —
  // hoy el pipeline solo emite confianza GLOBAL, no por campo individual,
  // igual que ya documenta domain/routing.js:204-206 — se deja aquí a
  // nivel de documento entero hasta que exista confianza por campo real).
  _fuente: z.string(),
  _confianza: z.number().min(0).max(1).nullable(),
});

module.exports = { FacturaCanonicaSchema, LineaIvaSchema };
