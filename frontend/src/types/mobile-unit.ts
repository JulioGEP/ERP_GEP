// frontend/src/types/mobile-unit.ts
export type MobileUnit = {
  unidad_id: string;
  name: string;
  matricula: string;
  tipo: string[];
  sede: string[];
  activo: boolean;
  itv: string | null;
  revision: string | null;
  tipo_seguro: string | null;
  vigencia_seguro: string | null;
  created_at: string | null;
  updated_at: string | null;
};
