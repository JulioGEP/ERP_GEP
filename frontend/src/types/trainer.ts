// frontend/src/types/trainer.ts
import type { ResourceAvailability } from './resource-conflict';

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
  availability?: ResourceAvailability;
};
