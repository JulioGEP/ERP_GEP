import { toMadridISOString } from './timezone';

export const VALID_SEDES = ['GEP Arganda', 'GEP Sabadell', 'In company'] as const;

export type TrainerRecord = {
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
  sede?: string[] | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  user_id: string | null;
};

export function normalizeTrainer(row: TrainerRecord) {
  const sedeValues = Array.isArray(row.sede) ? row.sede : [];
  const normalizedSede = sedeValues.filter(
    (value): value is string =>
      typeof value === 'string' && VALID_SEDES.includes(value as (typeof VALID_SEDES)[number]),
  );

  return {
    trainer_id: row.trainer_id,
    name: row.name,
    apellido: row.apellido,
    email: row.email,
    phone: row.phone,
    dni: row.dni,
    direccion: row.direccion,
    especialidad: row.especialidad,
    titulacion: row.titulacion,
    activo: Boolean(row.activo),
    sede: normalizedSede,
    created_at: toMadridISOString(row.created_at),
    updated_at: toMadridISOString(row.updated_at),
    user_id: row.user_id,
  };
}

