ALTER TABLE sesion_files
    ADD COLUMN IF NOT EXISTS trainer_expense BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS trainer_expense_trainer_id VARCHAR(255);
