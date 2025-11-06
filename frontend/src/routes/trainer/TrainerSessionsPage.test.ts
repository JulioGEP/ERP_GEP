import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrainerBudget } from '../../api/trainer';
import { buildTrainerSessionRows } from './TrainerSessionsPage';

const BASE_BUDGET: TrainerBudget = {
  dealId: 'deal-1',
  title: 'Budget 1',
  pipeline: null,
  sedeLabel: null,
  trainingAddress: null,
  comercial: null,
  createdAt: null,
  updatedAt: null,
  organizationName: null,
  sessions: [],
};

describe('buildTrainerSessionRows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores invalid session lists', () => {
    const invalidSessionsBudget = {
      ...BASE_BUDGET,
      dealId: 'deal-2',
      sessions: undefined,
    } as unknown as TrainerBudget;

    const nonArraySessionsBudget = {
      ...BASE_BUDGET,
      dealId: 'deal-3',
      sessions: { foo: 'bar' } as unknown as TrainerBudget['sessions'],
    } as TrainerBudget;

    const rows = buildTrainerSessionRows([invalidSessionsBudget, nonArraySessionsBudget]);

    expect(rows).toEqual([]);
  });

  it('flattens and sorts the sessions by start date', () => {
    const budgets: TrainerBudget[] = [
      {
        ...BASE_BUDGET,
        trainingAddress: 'Dirección general',
        sessions: [
          {
            id: 'b-session',
            title: 'Sesión B',
            estado: null,
            start: '2024-02-01T10:00:00Z',
            end: '2024-02-01T12:00:00Z',
            address: null,
            product: { id: 'prod-2', name: 'Producto B', code: 'PB' },
            deal: null,
          },
          {
            id: 'a-session',
            title: 'Sesión A',
            estado: null,
            start: '2024-01-10T09:00:00Z',
            end: '2024-01-10T11:00:00Z',
            address: 'Dirección específica',
            product: { id: 'prod-1', name: 'Producto A', code: 'PA' },
            deal: null,
          },
        ],
      },
    ];

    const rows = buildTrainerSessionRows(budgets);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'a-session',
      address: 'Dirección específica',
      product: 'Producto A',
    });
    expect(rows[1]).toMatchObject({
      id: 'b-session',
      address: 'Dirección general',
      product: 'Producto B',
    });
  });

  it('keeps the earliest duplicate session information', () => {
    const budgets: TrainerBudget[] = [
      {
        ...BASE_BUDGET,
        sessions: [
          {
            id: 'duplicate',
            title: 'Sesión tardía',
            estado: null,
            start: '2024-03-01T10:00:00Z',
            end: null,
            address: null,
            product: null,
            deal: null,
          },
        ],
      },
      {
        ...BASE_BUDGET,
        dealId: 'deal-2',
        sessions: [
          {
            id: 'duplicate',
            title: 'Sesión temprana',
            estado: null,
            start: '2024-01-15T08:00:00Z',
            end: null,
            address: 'Dirección temprana',
            product: { id: 'prod', name: 'Producto preferente', code: null },
            deal: null,
          },
        ],
      },
    ];

    const rows = buildTrainerSessionRows(budgets);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'duplicate',
      title: 'Sesión temprana',
      address: 'Dirección temprana',
      product: 'Producto preferente',
    });
  });
});

