export const DOCUMENT_TYPES = [
  { value: 'curriculum_vitae', label: 'Curriculum Vitae' },
  { value: 'personales', label: 'Personal' },
  { value: 'certificados', label: 'Certificados' },
  { value: 'gasto', label: 'Gasto' },
  { value: 'parking_peaje_kilometraje', label: 'Parking / Peaje / Kilometraje' },
  { value: 'dietas', label: 'Dietas' },
  { value: 'otros', label: 'Otros' },
] as const;

export type DocumentTypeValue = (typeof DOCUMENT_TYPES)[number]['value'];
