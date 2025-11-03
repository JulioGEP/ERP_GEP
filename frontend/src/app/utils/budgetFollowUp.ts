import type { DealSummary } from '../../types/deal';

function isAffirmativeLabel(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase() === 'si';
}

function isConfirmed(value: unknown): boolean {
  return value === true;
}

export function hasPendingExternalFollowUp(budget: DealSummary): boolean {
  const pairs: Array<[unknown, unknown]> = [
    [budget.fundae_label, budget.fundae_val],
    [budget.caes_label, budget.caes_val],
    [budget.hotel_label, budget.hotel_val],
    [budget.transporte, budget.transporte_val],
    [budget.po, budget.po_val],
  ];

  return pairs.some(([label, confirmation]) => isAffirmativeLabel(label) && !isConfirmed(confirmation));
}
