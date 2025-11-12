-- backend/sql/session_files_author.sql
-- Añade la columna author a sesion_files y asegura fechas para documentos existentes.

ALTER TABLE sesion_files
  ADD COLUMN IF NOT EXISTS author varchar(255);

UPDATE sesion_files
SET added_at = COALESCE(added_at, updated_at, NOW())
WHERE added_at IS NULL;
