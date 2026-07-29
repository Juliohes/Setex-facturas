-- Rollback de la columna aditiva "campos_no_fiables" en uploads (2026-07-29,
-- feature de marcado manual de campos poco fiables en el panel admin).
-- Elimina ÚNICAMENTE esta columna — no toca ninguna otra columna ni fila
-- de uploads, ni ninguna otra tabla.
--
-- Uso: docker exec -i <contenedor_postgres> psql -U <usuario> -d <bd> < 2026-07-29-uploads-campos-no-fiables-down.sql
-- (requiere confirmación explícita antes de ejecutar contra producción — regla del proyecto)

ALTER TABLE uploads DROP COLUMN IF EXISTS campos_no_fiables;
