CREATE TABLE IF NOT EXISTS public.trainer_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id text NOT NULL,
    document_type varchar(32) NOT NULL,
    file_name varchar(255) NOT NULL,
    original_file_name varchar(255),
    mime_type varchar(191),
    file_size integer,
    drive_file_id varchar(128),
    drive_file_name varchar(255) NOT NULL,
    drive_web_view_link text,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT trainer_documents_trainer_fk
        FOREIGN KEY (trainer_id)
        REFERENCES public.trainers(trainer_id)
        ON DELETE CASCADE
        ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_trainer_documents_trainer_id
    ON public.trainer_documents(trainer_id);
