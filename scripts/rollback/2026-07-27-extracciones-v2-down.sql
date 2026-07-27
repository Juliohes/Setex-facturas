-- Rollback de la migración aditiva de la Fase 8 (PROMPT-PIPELINE-OCR-FACTURAS-V2.md)
-- Creada: 2026-07-27. Elimina ÚNICAMENTE la tabla extracciones_v2 y sus
-- índices — no toca ninguna tabla existente (uploads, ocr_benchmark_resultados,
-- ocr_shadow_validaciones, etc.), todas intactas.
--
-- Uso: docker exec -i <contenedor_postgres> psql -U <usuario> -d <bd> < 2026-07-27-extracciones-v2-down.sql
-- (requiere confirmación explícita antes de ejecutar contra producción — regla del proyecto)

DROP INDEX IF EXISTS idx_extracciones_v2_estado;
DROP INDEX IF EXISTS idx_extracciones_v2_upload;
DROP TABLE IF EXISTS extracciones_v2;
