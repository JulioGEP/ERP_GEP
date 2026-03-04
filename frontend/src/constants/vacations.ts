import type { VacationType } from '../api/userVacations';

export const VACATION_TYPE_ORDER: VacationType[] = [
  'V',
  'L',
  'A',
  'T',
  'M',
  'H',
  'F',
  'R',
  'P',
  'J',
  'I',
  'N',
  'C',
  'O',
  'Y',
];

export const VACATION_TYPE_INFO: Record<
  VacationType,
  { label: string; fullLabel: string; color: string }
> = {
  V: { label: 'Vacaciones', fullLabel: 'Vacaciones', color: '#2563eb' },
  L: { label: 'Festivo local', fullLabel: 'Festivo local', color: '#65a30d' },
  A: { label: 'Día aniversario', fullLabel: 'Día aniversario', color: '#e11d48' },
  T: { label: 'Teletrabajo', fullLabel: 'Teletrabajo', color: '#7c3aed' },
  M: {
    label: 'Matrimonio',
    fullLabel: 'Matrimonio o registro de pareja de hecho',
    color: '#f97316',
  },
  H: {
    label: 'Accidente',
    fullLabel: 'Accidente, enfermedad, hospitalización o intervención de un familiar',
    color: '#ef4444',
  },
  F: { label: 'Fallecimiento', fullLabel: 'Fallecimiento de un familiar', color: '#0ea5e9' },
  R: { label: 'Traslado', fullLabel: 'Traslado del domicilio habitual', color: '#0f766e' },
  P: { label: 'Visita Médica o Exámenes', fullLabel: 'Visita Médica o Exámenes', color: '#a855f7' },
  J: { label: 'Citación judicial', fullLabel: 'Citación judicial', color: '#8b5cf6' },
  I: { label: 'Incapacidad', fullLabel: 'Incapacidad temporal', color: '#475569' },
  N: { label: 'Festivos nacionales', fullLabel: 'Festivos nacionales', color: '#facc15' },
  C: { label: 'Fiesta autonómica', fullLabel: 'Fiesta autonómica', color: '#14b8a6' },
  O: { label: 'Compensación horas', fullLabel: 'Compensación horas', color: '#d946ef' },
  Y: { label: 'Año anterior', fullLabel: 'Vacaciones año anterior', color: '#0891b2' },
};

export const VACATION_TYPE_LABELS: Record<VacationType, string> = Object.fromEntries(
  Object.entries(VACATION_TYPE_INFO).map(([key, info]) => [key, info.label]),
) as Record<VacationType, string>;

export const VACATION_TYPE_FULL_LABELS: Record<VacationType, string> = Object.fromEntries(
  Object.entries(VACATION_TYPE_INFO).map(([key, info]) => [key, info.fullLabel]),
) as Record<VacationType, string>;

export const VACATION_TYPE_COLORS: Record<VacationType, string> = Object.fromEntries(
  Object.entries(VACATION_TYPE_INFO).map(([key, info]) => [key, info.color]),
) as Record<VacationType, string>;

export const VACATION_TAG_OPTIONS: Array<{ value: VacationType | ''; label: string }> = [
  { value: '', label: 'Sin categoría' },
  ...VACATION_TYPE_ORDER.map((value) => ({
    value,
    label: VACATION_TYPE_LABELS[value],
  })),
];

const FALLBACK_VACATION_COLORS = ['#0ea5e9', '#a855f7', '#f97316', '#14b8a6', '#e11d48', '#65a30d', '#475569'];

export function isKnownVacationType(type: string): type is VacationType {
  return type in VACATION_TYPE_INFO;
}

function getFallbackColor(type: string): string {
  const normalized = type.trim().toUpperCase();
  if (!normalized.length) return FALLBACK_VACATION_COLORS[0];

  const hash = Array.from(normalized).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return FALLBACK_VACATION_COLORS[hash % FALLBACK_VACATION_COLORS.length];
}

export function getVacationTypeVisual(type: string): { label: string; fullLabel: string; color: string } {
  const normalized = type.trim().toUpperCase();
  if (isKnownVacationType(normalized)) {
    return VACATION_TYPE_INFO[normalized];
  }

  return {
    label: normalized || type,
    fullLabel: normalized || type,
    color: getFallbackColor(normalized || type),
  };
}
