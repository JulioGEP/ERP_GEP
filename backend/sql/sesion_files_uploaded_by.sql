ALTER TABLE sesion_files
    ADD COLUMN IF NOT EXISTS uploaded_by_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS uploaded_by_name VARCHAR(255);
