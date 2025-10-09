// frontend/src/features/recursos/mobileUnits.constants.ts
export const MOBILE_UNIT_SEDE_OPTIONS = [
  'GEP Arganda',
  'GEP Sabadell',
  'In Company',
] as const;

export const MOBILE_UNIT_TIPO_OPTIONS = ['Formación', 'Preventivo', 'PCI', 'Remolque'] as const;

export type MobileUnitSedeOption = (typeof MOBILE_UNIT_SEDE_OPTIONS)[number];
export type MobileUnitTipoOption = (typeof MOBILE_UNIT_TIPO_OPTIONS)[number];
