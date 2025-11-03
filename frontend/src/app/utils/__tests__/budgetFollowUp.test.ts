import { describe, expect, it } from 'vitest';
import type { DealSummary } from '../../../types/deal';
import { hasPendingExternalFollowUp } from '../budgetFollowUp';

function createBudget(overrides: Partial<DealSummary> = {}): DealSummary {
  return {
    deal_id: '1',
    dealId: '1',
    title: 'Presupuesto 1',
    pipeline_label: null,
    pipeline_id: null,
    training_address: null,
    sede_label: null,
    caes_label: null,
    caes_val: null,
    fundae_label: null,
    fundae_val: null,
    hotel_label: null,
    hotel_val: null,
    transporte: null,
    transporte_val: null,
    po: null,
    po_val: null,
    tipo_servicio: null,
    mail_invoice: null,
    comercial: null,
    a_fecha: null,
    w_id_variation: null,
    presu_holded: null,
    modo_reserva: null,
    hours: null,
    organization: null,
    person: null,
    products: [],
    productNames: [],
    sessions: [],
    studentNames: [],
    ...overrides,
  };
}

describe('hasPendingExternalFollowUp', () => {
  it('returns true when an affirmative label lacks confirmation', () => {
    const budget = createBudget({ fundae_label: 'Sí', fundae_val: false });
    expect(hasPendingExternalFollowUp(budget)).toBe(true);
  });

  it('returns true when confirmation is missing for an affirmative label', () => {
    const budget = createBudget({ hotel_label: 'Si', hotel_val: null });
    expect(hasPendingExternalFollowUp(budget)).toBe(true);
  });

  it('returns false when no affirmative labels require follow-up', () => {
    const budget = createBudget({ caes_label: 'No', caes_val: false });
    expect(hasPendingExternalFollowUp(budget)).toBe(false);
  });

  it('returns false when confirmation is explicitly true', () => {
    const budget = createBudget({ transporte: 'sí', transporte_val: true });
    expect(hasPendingExternalFollowUp(budget)).toBe(false);
  });
});
