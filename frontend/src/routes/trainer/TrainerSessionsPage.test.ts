import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrainerBudget } from '../../api/trainer';
import { enhanceBudgets } from './TrainerSessionsPage';

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

describe('enhanceBudgets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles missing or invalid session lists safely', () => {
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

    const [first, second] = enhanceBudgets([invalidSessionsBudget, nonArraySessionsBudget]);

    expect(first.sessionCount).toBe(0);
    expect(first.nextSession).toBeNull();
    expect(second.sessionCount).toBe(0);
    expect(second.nextSession).toBeNull();
  });

  it('returns the next upcoming session when available', () => {
    const budgets: TrainerBudget[] = [
      {
        ...BASE_BUDGET,
        sessions: [
          {
            id: 'past',
            title: 'Sesión pasada',
            estado: null,
            start: '2023-12-20T09:00:00Z',
            end: null,
            deal: null,
          },
          {
            id: 'future',
            title: 'Sesión futura',
            estado: null,
            start: '2024-01-03T10:00:00Z',
            end: null,
            deal: null,
          },
        ],
      },
    ];

    const [summary] = enhanceBudgets(budgets);

    expect(summary.sessionCount).toBe(2);
    expect(summary.nextSession?.title).toBe('Sesión futura');
    expect(summary.nextSession?.start).toBe('2024-01-03T10:00:00Z');
  });
});

