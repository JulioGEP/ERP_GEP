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
  contrato_fijo: boolean;
  nomina: number | null;
  revision_medica_caducidad: string | null;
  epis_caducidad: string | null;
  dni_caducidad: string | null;
  carnet_conducir_caducidad: string | null;
  certificado_bombero_caducidad: string | null;
  activo: boolean;
  sede: string[];
  created_at: string | null;
  updated_at: string | null;
};

export type TrainerDocument = {
  id: string;
  trainer_id: string;
  document_type: string;
  document_type_label?: string | null;
  file_name: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_web_view_link: string | null;
  uploaded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};
