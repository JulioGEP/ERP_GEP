// frontend/src/types/mobile-unit.ts
import type { ResourceAvailability } from './resource-conflict';

export type MobileUnit = {
  unidad_id: string;
  name: string;
  matricula: string;
  tipo: string[];
  sede: string[];
  created_at: string | null;
  updated_at: string | null;
  availability?: ResourceAvailability;
};
