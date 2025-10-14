import type { DealSummary } from '../../types/deal';

export const YES_NO_CHOICES = ['Sí', 'No'] as const;
export const SEDE_OPTIONS = ['GEP Arganda', 'GEP Sabadell', 'In Company'] as const;

type YesNoChoice = (typeof YES_NO_CHOICES)[number];
type SedeOption = (typeof SEDE_OPTIONS)[number];

export type BudgetFilters = {
  title?: string | null;
  training_address?: string | null;
  org_id?: string | null;
  pipeline_id?: string | null;
  sede_label?: SedeOption | null;
  caes_label?: YesNoChoice | null;
  fundae_label?: YesNoChoice | null;
  hotel_label?: YesNoChoice | null;
  transporte?: YesNoChoice | null;
  person_id?: string | null;
  po?: string | null;
};

export type BudgetFilterKey = keyof BudgetFilters;

export type ActiveBudgetFilter = {
  key: BudgetFilterKey;
  label: string;
  value: string;
};

const FIELD_LABELS: Record<BudgetFilterKey, string> = {
  title: 'Título',
  training_address: 'Dirección',
  org_id: 'Organización',
  pipeline_id: 'Pipeline',
  sede_label: 'Sede',
  caes_label: 'CAES',
  fundae_label: 'FUNDAE',
  hotel_label: 'Hotel',
  transporte: 'Transporte',
  person_id: 'Contacto',
  po: 'PO',
};

function toSearchable(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed.toLowerCase();
}

function normalizeYesNo(value: string | null | undefined): 'si' | 'no' | null {
  if (value === null || value === undefined) return null;
  const normalized = value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/í/g, 'i');

  if (normalized === 'si' || normalized === 'yes' || normalized === 'true' || normalized === '1') {
    return 'si';
  }

  if (normalized === 'no' || normalized === 'false' || normalized === '0') {
    return 'no';
  }

  return null;
}

function matchesTextFilter(target: string | null | undefined, filter: string | null): boolean {
  const normalizedFilter = toSearchable(filter ?? null);
  if (!normalizedFilter) return true;

  const normalizedTarget = toSearchable(target ?? null);
  if (!normalizedTarget) return false;

  return normalizedTarget.includes(normalizedFilter);
}

function matchesYesNoFilter(target: string | null | undefined, filter: YesNoChoice | null | undefined): boolean {
  const normalizedFilter = normalizeYesNo(filter ?? null);
  if (!normalizedFilter) return true;

  const normalizedTarget = normalizeYesNo(target ?? null);
  if (!normalizedTarget) return false;

  return normalizedTarget === normalizedFilter;
}

function matchesExactText(target: string | null | undefined, filter: string | null): boolean {
  const normalizedFilter = toSearchable(filter ?? null);
  if (!normalizedFilter) return true;
  const normalizedTarget = toSearchable(target ?? null);
  if (!normalizedTarget) return false;
  return normalizedTarget === normalizedFilter;
}

export function cleanBudgetFilters(filters: BudgetFilters): BudgetFilters {
  const cleaned: BudgetFilters = {};

  if (typeof filters.title === 'string') {
    const value = filters.title.trim();
    if (value.length) cleaned.title = value;
  }

  if (typeof filters.training_address === 'string') {
    const value = filters.training_address.trim();
    if (value.length) cleaned.training_address = value;
  }

  if (typeof filters.org_id === 'string') {
    const value = filters.org_id.trim();
    if (value.length) cleaned.org_id = value;
  }

  if (typeof filters.pipeline_id === 'string') {
    const value = filters.pipeline_id.trim();
    if (value.length) cleaned.pipeline_id = value;
  }

  if (typeof filters.sede_label === 'string') {
    const value = filters.sede_label.trim();
    if (value.length) cleaned.sede_label = value as BudgetFilters['sede_label'];
  }

  if (typeof filters.caes_label === 'string') {
    const value = filters.caes_label.trim();
    if (value.length) cleaned.caes_label = value as BudgetFilters['caes_label'];
  }

  if (typeof filters.fundae_label === 'string') {
    const value = filters.fundae_label.trim();
    if (value.length) cleaned.fundae_label = value as BudgetFilters['fundae_label'];
  }

  if (typeof filters.hotel_label === 'string') {
    const value = filters.hotel_label.trim();
    if (value.length) cleaned.hotel_label = value as BudgetFilters['hotel_label'];
  }

  if (typeof filters.transporte === 'string') {
    const value = filters.transporte.trim();
    if (value.length) cleaned.transporte = value as BudgetFilters['transporte'];
  }

  if (typeof filters.person_id === 'string') {
    const value = filters.person_id.trim();
    if (value.length) cleaned.person_id = value;
  }

  if (typeof filters.po === 'string') {
    const value = filters.po.trim();
    if (value.length) cleaned.po = value;
  }

  return cleaned;
}

export function applyBudgetFilters(budgets: DealSummary[], filters: BudgetFilters): DealSummary[] {
  const hasFilters = Object.values(filters).some((value) => value !== null && value !== undefined && value !== '');
  if (!hasFilters) return budgets;

  return budgets.filter((budget) => {
    if (!matchesTextFilter(budget.title, filters.title ?? null)) return false;
    if (!matchesTextFilter(budget.training_address ?? null, filters.training_address ?? null)) return false;

    if (!matchesTextFilter(budget.organization?.org_id ?? null, filters.org_id ?? null)) return false;
    if (!matchesTextFilter(budget.pipeline_id ?? null, filters.pipeline_id ?? null)) return false;

    if (!matchesExactText(budget.sede_label ?? null, filters.sede_label ?? null)) return false;
    if (!matchesYesNoFilter(budget.caes_label ?? null, filters.caes_label ?? null)) return false;
    if (!matchesYesNoFilter(budget.fundae_label ?? null, filters.fundae_label ?? null)) return false;
    if (!matchesYesNoFilter(budget.hotel_label ?? null, filters.hotel_label ?? null)) return false;
    if (!matchesYesNoFilter(budget.transporte ?? null, filters.transporte ?? null)) return false;

    if (!matchesTextFilter(budget.person?.person_id ?? null, filters.person_id ?? null)) return false;
    if (!matchesTextFilter(budget.po ?? null, filters.po ?? null)) return false;

    return true;
  });
}

export function getActiveBudgetFilters(filters: BudgetFilters): ActiveBudgetFilter[] {
  const active: ActiveBudgetFilter[] = [];

  (Object.keys(filters) as BudgetFilterKey[]).forEach((key) => {
    const value = filters[key];

    if (value === null || value === undefined) return;
    if (typeof value === 'string' && value.trim().length === 0) return;

    const label = FIELD_LABELS[key];

    if (
      (key === 'caes_label' ||
        key === 'fundae_label' ||
        key === 'hotel_label' ||
        key === 'transporte') &&
      typeof value === 'string'
    ) {
      const normalized = normalizeYesNo(value);
      const display = normalized === 'si' ? 'Sí' : normalized === 'no' ? 'No' : value;
      active.push({ key, label, value: display });
      return;
    }

    if (typeof value === 'string') {
      active.push({ key, label, value });
      return;
    }
  });

  return active;
}
