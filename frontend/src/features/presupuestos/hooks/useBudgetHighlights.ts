import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DealSummary } from '../../../types/deal';
import { useCurrentUserIdentity } from '../useCurrentUserIdentity';

export type BudgetHighlight = 'new' | 'updated';

type SeenMap = Record<string, number>;

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBudgetId(budget: DealSummary): string | null {
  const candidates = [budget.dealId, budget.deal_id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);

  return candidates.length ? candidates[0] : null;
}

function resolveBudgetTimestamp(budget: DealSummary): number | null {
  return (
    parseTimestamp(budget.updated_at ?? null) ??
    parseTimestamp((budget as any)?.updatedAt ?? null) ??
    parseTimestamp(budget.created_at ?? null) ??
    parseTimestamp((budget as any)?.createdAt ?? null)
  );
}

export function useBudgetHighlights(budgets: DealSummary[]) {
  const { userId } = useCurrentUserIdentity();
  const storageKey = `budget-highlights:${userId}`;
  const [seenMap, setSeenMap] = useState<SeenMap>(() => {
    if (typeof window === 'undefined') {
      return {};
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        return {};
      }
      const parsed = JSON.parse(stored);
      return parsed && typeof parsed === 'object' ? (parsed as SeenMap) : {};
    } catch (error) {
      console.warn('[budget-highlights] No se pudo leer del localStorage', error);
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(seenMap));
    } catch (error) {
      console.warn('[budget-highlights] No se pudo guardar en localStorage', error);
    }
  }, [seenMap, storageKey]);

  useEffect(() => {
    if (!budgets.length) {
      return;
    }
    if (Object.keys(seenMap).length > 0) {
      return;
    }

    const baseline: SeenMap = {};
    budgets.forEach((budget) => {
      const id = getBudgetId(budget);
      const ts = id ? resolveBudgetTimestamp(budget) : null;
      if (id && ts !== null) {
        baseline[id] = ts;
      }
    });

    if (Object.keys(baseline).length > 0) {
      setSeenMap(baseline);
    }
  }, [budgets, seenMap]);

  const highlights = useMemo(() => {
    const entries = new Map<string, BudgetHighlight>();
    budgets.forEach((budget) => {
      const id = getBudgetId(budget);
      if (!id) {
        return;
      }
      const updatedAt = resolveBudgetTimestamp(budget);
      if (updatedAt === null) {
        return;
      }

      const lastSeen = seenMap[id];
      if (lastSeen === undefined) {
        entries.set(id, 'new');
        return;
      }
      if (lastSeen < updatedAt) {
        entries.set(id, 'updated');
      }
    });
    return entries as ReadonlyMap<string, BudgetHighlight>;
  }, [budgets, seenMap]);

  const markAsSeen = useCallback(
    (budget: DealSummary) => {
      const id = getBudgetId(budget);
      if (!id) return;

      const updatedAt = resolveBudgetTimestamp(budget);
      const timestamp = updatedAt ?? Date.now();
      setSeenMap((current) => ({ ...current, [id]: timestamp }));
    },
    [setSeenMap],
  );

  return { highlights, markAsSeen };
}
