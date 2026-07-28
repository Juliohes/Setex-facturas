-- Rollback de las columnas aditivas "variante", "alucinaciones_sospechosas"
-- y "aprendizaje_aplicado" en extracciones_v2 (2026-07-28, gaps "variantes
-- de imagen" + "aprendizaje continuo" del pipeline OCR v2).
-- Elimina ÚNICAMENTE estas 3 columnas — no toca ninguna otra columna ni
-- fila de extracciones_v2, ni ninguna otra tabla.
--
-- Uso: docker exec -i <contenedor_postgres> psql -U <usuario> -d <bd> < 2026-07-28-extracciones-v2-aprendizaje-down.sql
-- (requiere confirmación explícita antes de ejecutar contra producción — regla del proyecto)

ALTER TABLE extracciones_v2 DROP COLUMN IF EXISTS variante;
ALTER TABLE extracciones_v2 DROP COLUMN IF EXISTS alucinaciones_sospechosas;
ALTER TABLE extracciones_v2 DROP COLUMN IF EXISTS aprendizaje_aplicado;
