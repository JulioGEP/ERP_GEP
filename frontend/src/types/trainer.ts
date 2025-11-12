// frontend/src/types/trainer.ts
export type Trainer = {
  trainer_id: string;
  name: string;
  apellido: string | null;
  email: string | null;
  phone: string | null;
  dni: string | null;
  direccion: string | null;
  especialidad: string | null;
  titulacion: string | null;
  activo: boolean;
  sede: string[];
  created_at: string | null;
  updated_at: string | null;
};

export type TrainerDocumentType =
  | 'curriculum_vitae'
  | 'personales'
  | 'certificados'
  | 'otros';

export type TrainerDocument = {
  id: string;
  trainer_id: string;
  document_type: TrainerDocumentType;
  document_type_label: string;
  file_name: string;
  original_file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  drive_file_id: string | null;
  drive_file_name: string;
  drive_web_view_link: string | null;
  uploaded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};
