import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Form, ListGroup, Spinner, Stack } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import type { DealSummary } from '../../types/deal';
import { importDeal, fetchDeals } from '../presupuestos/api/deals.api';

const OPEN_TRAINING_PIPELINE_LABEL = 'Formación Abierta';
const OPEN_TRAINING_BUDGETS_QUERY_KEY = ['open-training-budgets'];

type UpdateState = 'idle' | 'running' | 'success' | 'error';

type BudgetUpdateStatus = {
  state: UpdateState;
  message?: string;
  warnings?: string[];
};

const STATUS_VARIANTS: Record<UpdateState, string> = {
  idle: 'secondary',
  running: 'info',
  success: 'success',
  error: 'danger',
};

const STATUS_LABELS: Record<UpdateState, string> = {
  idle: 'Pendiente',
  running: 'Actualizando',
  success: 'Actualizado',
  error: 'Error',
};

const DEFAULT_ERROR_MESSAGE = 'No se ha podido actualizar el presupuesto. Inténtalo de nuevo más tarde.';

function normalizeId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';
}

function isOpenTrainingPipeline(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value
    .normalize('NFD')
    .replace(/\u0300-\u036f/g, '')
    .trim()
    .toLowerCase();
  return normalized.includes('formacion abierta');
}

function isOpenTrainingBudget(deal: DealSummary): boolean {
  return (
    isOpenTrainingPipeline(deal.pipeline_label) ||
    isOpenTrainingPipeline(deal.pipeline_id ? String(deal.pipeline_id) : null)
  );
}

export function OpenTrainingBulkUpdateView() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusById, setStatusById] = useState<Record<string, BudgetUpdateStatus>>({});
  const [runningAll, setRunningAll] = useState(false);

  const openTrainingBudgetsQuery = useQuery({
    queryKey: OPEN_TRAINING_BUDGETS_QUERY_KEY,
    queryFn: async () => {
      const deals = await fetchDeals();
      return deals.filter(isOpenTrainingBudget);
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const budgets: DealSummary[] = useMemo(() => {
    const source = openTrainingBudgetsQuery.data ?? [];
    return [...source].sort((a, b) => normalizeId(a.deal_id).localeCompare(normalizeId(b.deal_id)));
  }, [openTrainingBudgetsQuery.data]);

  const allSelected = budgets.length > 0 && selectedIds.size === budgets.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < budgets.length;

  useEffect(() => {
    if (!budgets.length) {
      setSelectedIds(new Set());
      return;
    }

    setStatusById((current) => {
      const next: Record<string, BudgetUpdateStatus> = {};
      for (const budget of budgets) {
        const id = normalizeId(budget.deal_id);
        next[id] = current[id] ?? { state: 'idle' };
      }
      return next;
    });
  }, [budgets]);

  const updateStatus = useCallback((budgetId: string, update: Partial<BudgetUpdateStatus>) => {
    setStatusById((current) => ({
      ...current,
      [budgetId]: { ...current[budgetId], ...update },
    }));
  }, []);

  const importMutation = useMutation({
    mutationFn: (budgetId: string) => importDeal(budgetId),
  });

  const updateBudget = useCallback(
    async (budgetId: string) => {
      const id = normalizeId(budgetId);
      if (!id) return;

      updateStatus(id, { state: 'running', message: 'Actualizando...' });
      try {
        const result = await importMutation.mutateAsync(id);
        const warnings = (result.warnings ?? []).filter((warning) => warning.trim().length > 0);
        updateStatus(id, { state: 'success', message: 'Actualizado', warnings });
        queryClient.invalidateQueries({ queryKey: OPEN_TRAINING_BUDGETS_QUERY_KEY });
      } catch (error: unknown) {
        const message = error instanceof ApiError ? error.message || DEFAULT_ERROR_MESSAGE : DEFAULT_ERROR_MESSAGE;
        updateStatus(id, { state: 'error', message, warnings: [] });
      }
    },
    [importMutation, queryClient, updateStatus],
  );

  const handleToggleSelect = useCallback((budgetId: string) => {
    const id = normalizeId(budgetId);
    if (!id) return;

    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((current) => {
      if (budgets.length === 0) return new Set();
      if (current.size === budgets.length) {
        return new Set();
      }
      return new Set(budgets.map((budget) => normalizeId(budget.deal_id)));
    });
  }, [budgets]);

  const handleUpdateAll = useCallback(async () => {
    if (!selectedIds.size) return;
    setRunningAll(true);

    for (const id of selectedIds) {
      await updateBudget(id);
    }

    setRunningAll(false);
  }, [selectedIds, updateBudget]);

  const isLoading = openTrainingBudgetsQuery.isLoading;
  const isFetching = openTrainingBudgetsQuery.isFetching;
  const error = openTrainingBudgetsQuery.error;

  return (
    <Stack gap={4}>
      <div className="d-flex flex-column gap-1">
        <p className="text-uppercase text-muted fw-semibold mb-0">Recursos</p>
        <h1 className="h3 text-uppercase mb-0">Actualizar en bucle</h1>
        <p className="text-muted mb-0">
          Actualiza los presupuestos del embudo de formación abierta de uno en uno, ya sea manualmente o
          seleccionándolos y ejecutando la actualización en cadena.
        </p>
      </div>

      <Card>
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex flex-wrap gap-3 align-items-center">
            <Form.Check
              type="checkbox"
              id="open-training-select-all"
              label="Seleccionar todos"
              checked={allSelected}
              ref={(element) => {
                if (element) {
                  element.indeterminate = someSelected;
                }
              }}
              onChange={handleToggleSelectAll}
              disabled={isLoading || isFetching || !budgets.length}
            />

            <div className="d-flex gap-2 flex-wrap align-items-center">
              <Button
                variant="primary"
                onClick={handleUpdateAll}
                disabled={!selectedIds.size || runningAll || importMutation.isPending}
              >
                Actualizar todos
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => openTrainingBudgetsQuery.refetch()}
                disabled={isLoading || isFetching}
              >
                Actualizar listado
              </Button>
              {(isFetching || runningAll || importMutation.isPending) && (
                <Spinner animation="border" role="status" size="sm" />
              )}
            </div>
          </div>

          {error && (
            <Alert variant="danger" className="mb-0">
              No se pudo cargar el listado de presupuestos. Inténtalo de nuevo más tarde.
            </Alert>
          )}

          {!error && !isLoading && budgets.length === 0 && (
            <Alert variant="secondary" className="mb-0">
              No hay presupuestos en el pipeline de formación abierta.
            </Alert>
          )}

          {isLoading && (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner animation="border" role="status" size="sm" /> Cargando presupuestos...
            </div>
          )}

          {!isLoading && budgets.length > 0 && (
            <ListGroup variant="flush" className="border rounded">
              {budgets.map((budget) => {
                const id = normalizeId(budget.deal_id);
                const status = statusById[id] ?? { state: 'idle' };
                const isRunning = status.state === 'running';

                return (
                  <ListGroup.Item key={id} className="d-flex flex-column gap-2">
                    <div className="d-flex flex-wrap gap-3 align-items-center justify-content-between">
                      <div className="d-flex flex-wrap gap-2 align-items-center">
                        <Form.Check
                          type="checkbox"
                          id={`select-${id}`}
                          checked={selectedIds.has(id)}
                          onChange={() => handleToggleSelect(id)}
                          disabled={runningAll}
                        />
                        <div className="d-flex flex-column">
                          <div className="d-flex flex-wrap align-items-center gap-2">
                            <span className="fw-semibold">Presupuesto {id}</span>
                            <Badge bg={STATUS_VARIANTS[status.state]}>{STATUS_LABELS[status.state]}</Badge>
                          </div>
                          <div className="text-muted small">
                            {budget.title}
                            {budget.organization?.name ? ` · ${budget.organization.name}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="d-flex gap-2 align-items-center">
                        {status.message && status.state !== 'idle' && (
                          <span className="text-muted small">{status.message}</span>
                        )}
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => updateBudget(id)}
                          disabled={isRunning || runningAll || importMutation.isPending}
                        >
                          {isRunning ? 'Actualizando…' : 'Actualizar'}
                        </Button>
                      </div>
                    </div>

                    {status.warnings && status.warnings.length > 0 && (
                      <Alert variant="warning" className="mb-0">
                        <div className="fw-semibold">Avisos</div>
                        <ul className="mb-0 ps-3">
                          {status.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </Alert>
                    )}

                    {status.state === 'error' && status.message && (
                      <Alert variant="danger" className="mb-0">
                        {status.message}
                      </Alert>
                    )}
                  </ListGroup.Item>
                );
              })}
            </ListGroup>
          )}
        </Card.Body>
      </Card>
    </Stack>
  );
}

export default OpenTrainingBulkUpdateView;
