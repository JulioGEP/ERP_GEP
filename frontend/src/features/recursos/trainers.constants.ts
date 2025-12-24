// frontend/src/features/recursos/trainers.constants.ts
export const SEDE_OPTIONS = ['GEP Arganda', 'GEP Sabadell', 'In company'] as const;

export const TRAINER_DOCUMENT_TYPES = [
  { value: 'curriculum_vitae', label: 'Curriculum Vitae' },
  { value: 'personales', label: 'Personales' },
  { value: 'certificados', label: 'Certificados' },
  { value: 'gasto', label: 'Gasto' },
  { value: 'otros', label: 'Otros' },
] as const;

export type SedeOption = (typeof SEDE_OPTIONS)[number];
export type TrainerDocumentTypeValue = (typeof TRAINER_DOCUMENT_TYPES)[number]['value'];
