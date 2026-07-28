-- Rollback de la migración aditiva "modo" en extracciones_v2 (2026-07-28,
-- gap 1 del plan de cierre sobre el pipeline OCR v2 existente).
-- Elimina ÚNICAMENTE la columna modo y su índice — no toca ninguna otra
-- columna ni fila de extracciones_v2, ni ninguna otra tabla.
--
-- Uso: docker exec -i <contenedor_postgres> psql -U <usuario> -d <bd> < 2026-07-28-extracciones-v2-modo-down.sql
-- (requiere confirmación explícita antes de ejecutar contra producción — regla del proyecto)

DROP INDEX IF EXISTS idx_extracciones_v2_modo;
ALTER TABLE extracciones_v2 DROP COLUMN IF EXISTS modo;
