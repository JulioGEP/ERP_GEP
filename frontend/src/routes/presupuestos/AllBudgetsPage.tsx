import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DealSummary } from '../../types/deal';
import { ApiError } from '../../api/client';
import { importDeal } from '../../features/presupuestos/api/deals.api';
import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { isMaterialPipeline } from '../materiales/MaterialsBudgetsPage';
import type { BudgetUpdateStatus } from '../../features/presupuestos/BudgetTable';

export type AllBudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle' | 'enableFallback'>;

const DEFAULT_ERROR_MESSAGE =
  'No se pudo actualizar el presupuesto. Inténtalo de nuevo más tarde.';

function normalizeId(value: string | null | undefined): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '';
  }
  if (value == null) return '';
  const normalized = String(value).trim();
  return normalized.length ? normalized : '';
}

function getBudgetId(budget: DealSummary): string | null {
  const candidates = [budget.dealId, budget.deal_id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);

  if (candidates.length) return candidates[0];
  return null;
}

export function AllBudgetsPage({
  tableLabels,
  canImport: _unusedCanImport,
  budgets,
  serverQueryOptions,
  ...rest
}: AllBudgetsPageProps) {
  const queryClient = useQueryClient();
  const [selectedBudgetIds, setSelectedBudgetIds] = useState<Set<string>>(new Set());
  const [statusById, setStatusById] = useState<Record<string, BudgetUpdateStatus>>({});
  const [runningAll, setRunningAll] = useState(false);

  const mergedLabels = useMemo(
    () => ({
      emptyTitle: 'No hay presupuestos disponibles.',
      emptyDescription: 'No se encontraron presupuestos que coincidan con los filtros aplicados.',
      ...(tableLabels ?? {}),
    }),
    [tableLabels],
  );

  const filteredBudgets = useMemo(
    () => budgets.filter((budget) => !isMaterialPipeline(budget)),
    [budgets],
  );

  const filteredServerQueryOptions = useMemo(() => {
    if (!serverQueryOptions?.fetcher) {
      return serverQueryOptions;
    }

    return {
      ...serverQueryOptions,
      fetcher: async (...args) => {
        const results = await serverQueryOptions.fetcher(...args);
        return results.filter((budget) => !isMaterialPipeline(budget));
      },
    } satisfies typeof serverQueryOptions;
  }, [serverQueryOptions]);

  const serverQueryKey = filteredServerQueryOptions?.queryKey ?? ['budget-table', 'all'];

  const importMutation = useMutation({
    mutationFn: (budgetId: string) => importDeal(budgetId),
  });

  useEffect(() => {
    const validIds = new Set(
      filteredBudgets
        .map((budget) => normalizeId(getBudgetId(budget)))
        .filter((id): id is string => Boolean(id)),
    );

    setSelectedBudgetIds((current) => new Set([...current].filter((id) => validIds.has(id))));

    setStatusById((current) => {
      const next: Record<string, BudgetUpdateStatus> = {};
      validIds.forEach((id) => {
        next[id] = current[id] ?? { state: 'idle' };
      });
      return next;
    });
  }, [filteredBudgets]);

  const updateStatus = useCallback((budgetId: string, status: Partial<BudgetUpdateStatus>) => {
    const id = normalizeId(budgetId);
    if (!id) return;

    setStatusById((current) => ({
      ...current,
      [id]: { ...current[id], ...status },
    }));
  }, []);

  const updateBudget = useCallback(
    async (budgetId: string) => {
      const id = normalizeId(budgetId);
      if (!id) return;

      updateStatus(id, { state: 'running', message: 'Actualizando...' });
      try {
        await importMutation.mutateAsync(id);
        updateStatus(id, { state: 'success', message: 'Actualizado' });
        queryClient.invalidateQueries({ queryKey: serverQueryKey });
      } catch (error) {
        const message = error instanceof ApiError ? error.message || DEFAULT_ERROR_MESSAGE : DEFAULT_ERROR_MESSAGE;
        updateStatus(id, { state: 'error', message });
      }
    },
    [importMutation, queryClient, serverQueryKey, updateStatus],
  );

  const handleToggleBudgetSelection = useCallback((budgetId: string) => {
    const id = normalizeId(budgetId);
    if (!id) return;

    setSelectedBudgetIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAllBudgets = useCallback((budgetIds: string[]) => {
    const normalizedIds = budgetIds.map((id) => normalizeId(id)).filter((id): id is string => Boolean(id));
    setSelectedBudgetIds((current) => {
      const hasAll = normalizedIds.every((id) => current.has(id));
      if (hasAll) {
        const next = new Set(current);
        normalizedIds.forEach((id) => next.delete(id));
        return next;
      }

      const next = new Set(current);
      normalizedIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const handleUpdateSelectedBudgets = useCallback(async () => {
    if (!selectedBudgetIds.size) return;
    setRunningAll(true);

    for (const id of selectedBudgetIds) {
      // eslint-disable-next-line no-await-in-loop
      await updateBudget(id);
    }

    setRunningAll(false);
  }, [selectedBudgetIds, updateBudget]);

  const getBudgetStatus = useCallback(
    (budgetId: string) => statusById[normalizeId(budgetId)] ?? { state: 'idle' },
    [statusById],
  );

  const selectionDisabled = runningAll || importMutation.isPending;

  const extraActions = (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <span className="text-muted small">Seleccionados: {selectedBudgetIds.size}</span>
      <Button
        size="lg"
        variant="outline-primary"
        onClick={handleUpdateSelectedBudgets}
        disabled={!selectedBudgetIds.size || selectionDisabled}
      >
        {selectionDisabled ? 'Actualizando…' : 'Actualizar todos'}
      </Button>
      {selectionDisabled && <Spinner animation="border" role="status" size="sm" />}
    </div>
  );

  return (
    <BudgetSectionLayout
      {...rest}
      title="Presupuestos · Todos"
      subtitle="Consulta todos los presupuestos de los diferentes embudos"
      enableFallback={false}
      budgets={filteredBudgets}
      tableLabels={mergedLabels}
      serverQueryOptions={filteredServerQueryOptions}
      canImport={false}
      selectableBudgets
      selectedBudgetIds={selectedBudgetIds}
      onSelectAllBudgets={handleSelectAllBudgets}
      onToggleBudgetSelection={handleToggleBudgetSelection}
      selectionStatusProvider={getBudgetStatus}
      selectionDisabled={selectionDisabled}
      extraActions={extraActions}
    />
  );
}
