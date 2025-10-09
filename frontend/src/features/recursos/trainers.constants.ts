// frontend/src/features/recursos/trainers.constants.ts
export const SEDE_OPTIONS = ['GEP Arganda', 'GEP Sabadell', 'In company'] as const;

export type SedeOption = (typeof SEDE_OPTIONS)[number];
