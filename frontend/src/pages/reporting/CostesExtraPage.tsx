import { useEffect, useMemo, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Alert, Button, Card, Form, Spinner, Table } from 'react-bootstrap';

import { isApiError } from '../../api/client';
import {
  fetchTrainerExtraCosts,
  saveTrainerExtraCost,
  type TrainerExtraCostFieldKey,
  type TrainerExtraCostFilters,
  type TrainerExtraCostRecord,
  type TrainerExtraCostSavePayload,
} from '../../features/reporting/api';

const COST_FIELD_DEFINITIONS: ReadonlyArray<{
  key: TrainerExtraCostFieldKey;
  label: string;
}> = [
  { key: 'precioCosteFormacion', label: 'Coste formación (€)' },
  { key: 'precioCostePreventivo', label: 'Coste preventivo (€)' },
  { key: 'dietas', label: 'Dietas (€)' },
  { key: 'kilometraje', label: 'Kilometraje (€)' },
  { key: 'pernocta', label: 'Pernocta (€)' },
  { key: 'nocturnidad', label: 'Nocturnidad (€)' },
  { key: 'festivo', label: 'Festivo (€)' },
  { key: 'horasExtras', label: 'Horas extras (€)' },
  { key: 'gastosExtras', label: 'Otros gastos (€)' },
];

const DEFAULT_COST_FIELD_VALUES: Partial<Record<TrainerExtraCostFieldKey, number>> = {
  precioCosteFormacion: 15,
  precioCostePreventivo: 15,
};

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type CostDraft = {
  fields: Record<TrainerExtraCostFieldKey, string>;
  dirty: boolean;
  invalid: boolean;
};

type CostMutationVariables = {
  key: string;
  payload: TrainerExtraCostSavePayload;
};

function formatNumberInput(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0.00';
  }
  return value.toFixed(2);
}

function parseInputToNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return 0;
  }
  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function createDraftFromItem(item: TrainerExtraCostRecord): CostDraft {
  const fields = {} as Record<TrainerExtraCostFieldKey, string>;
  for (const definition of COST_FIELD_DEFINITIONS) {
    const baseValue = Number.isFinite(item.costs[definition.key])
      ? item.costs[definition.key]
      : DEFAULT_COST_FIELD_VALUES[definition.key] ?? 0;
    fields[definition.key] = formatNumberInput(baseValue ?? 0);
  }
  return {
    fields,
    dirty: false,
    invalid: false,
  } satisfies CostDraft;
}

function evaluateDraft(
  item: TrainerExtraCostRecord,
  fields: Record<TrainerExtraCostFieldKey, string>,
): { dirty: boolean; invalid: boolean } {
  let dirty = false;
  let invalid = false;

  for (const definition of COST_FIELD_DEFINITIONS) {
    const parsed = parseInputToNumber(fields[definition.key]);
    if (parsed === null) {
      invalid = true;
      continue;
    }
    const baseValue = Number.isFinite(item.costs[definition.key])
      ? item.costs[definition.key]
      : DEFAULT_COST_FIELD_VALUES[definition.key] ?? 0;
    if (Math.abs(parsed - baseValue) > 0.005) {
      dirty = true;
    }
  }

  return { dirty, invalid };
}

function buildTrainerDisplayName(item: TrainerExtraCostRecord): string {
  const parts = [item.trainerName, item.trainerLastName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);
  return parts.length ? parts.join(' ') : item.trainerId;
}

function formatAssignmentLabel(value: 'session' | 'variant'): string {
  return value === 'session' ? 'Sesión' : 'Formación abierta';
}

export default function CostesExtraPage() {
  const [filters, setFilters] = useState<{ startDate: string; endDate: string }>(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      startDate: formatDateForInput(startOfMonth),
      endDate: formatDateForInput(endOfMonth),
    };
  });

  const hasInvalidRange = Boolean(
    filters.startDate && filters.endDate && filters.startDate > filters.endDate,
  );

  const appliedFilters = useMemo<TrainerExtraCostFilters>(() => {
    if (hasInvalidRange) {
      return {};
    }
    return {
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
    };
  }, [filters.endDate, filters.startDate, hasInvalidRange]);

  const queryKey = useMemo(
    () => [
      'reporting',
      'costes-extra',
      appliedFilters.startDate ?? null,
      appliedFilters.endDate ?? null,
    ],
    [appliedFilters.endDate, appliedFilters.startDate],
  );

  const queryClient = useQueryClient();

  const extraCostsQuery = useQuery({
    queryKey,
    queryFn: () => fetchTrainerExtraCosts(appliedFilters),
    enabled: !hasInvalidRange,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const [drafts, setDrafts] = useState<Record<string, CostDraft>>({});

  const items = hasInvalidRange ? [] : extraCostsQuery.data ?? [];

  useEffect(() => {
    if (!items.length) {
      setDrafts({});
      return;
    }
    setDrafts((prev) => {
      const allowedKeys = new Set(items.map((item) => item.key));
      const next: Record<string, CostDraft> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (allowedKeys.has(key)) {
          next[key] = value;
        }
      }
      return next;
    });
  }, [items]);

  const numberFormatter = useMemo(() => new Intl.NumberFormat('es-ES'), []);
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [],
  );

  const saveMutation = useMutation({
    mutationFn: async (variables: CostMutationVariables) => {
      const result = await saveTrainerExtraCost(variables.payload);
      return { ...variables, result };
    },
    onSuccess: ({ key }) => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['reporting', 'costes-extra'] });
    },
  });

  const mutationError = saveMutation.isError ? saveMutation.error : null;

  const renderContent = () => {
    if (hasInvalidRange) {
      return (
        <Alert variant="warning">
          La fecha de inicio no puede ser posterior a la fecha de fin. Ajusta el rango para ver los
          resultados.
        </Alert>
      );
    }

    if (extraCostsQuery.isLoading) {
      return (
        <div className="py-5 d-flex justify-content-center">
          <Spinner animation="border" role="status" />
        </div>
      );
    }

    if (extraCostsQuery.isError) {
      const error = extraCostsQuery.error;
      const message = isApiError(error)
        ? error.message
        : 'No se pudo cargar la información de costes extra.';
      return <Alert variant="danger">{message}</Alert>;
    }

    if (!items.length) {
      return <Alert variant="info">No hay registros de costes extra disponibles.</Alert>;
    }

    return (
      <div className="table-responsive">
        <Table striped bordered hover>
          <thead>
            <tr>
              <th style={{ minWidth: '220px' }}>Formador</th>
              <th style={{ minWidth: '260px' }}>Asignación</th>
              {COST_FIELD_DEFINITIONS.map((definition) => (
                <th key={definition.key} className="text-end" style={{ minWidth: '140px' }}>
                  {definition.label}
                </th>
              ))}
              <th style={{ width: '120px' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const trainerDisplayName = buildTrainerDisplayName(item);
              const baseDraft = drafts[item.key] ?? createDraftFromItem(item);
              const saving =
                saveMutation.isPending && saveMutation.variables?.key === item.key;

              const handleFieldChange = (
                fieldKey: TrainerExtraCostFieldKey,
                nextValue: string,
              ) => {
                setDrafts((prev) => {
                  const current = prev[item.key] ?? createDraftFromItem(item);
                  const nextFields = { ...current.fields, [fieldKey]: nextValue };
                  const { dirty, invalid } = evaluateDraft(item, nextFields);
                  return {
                    ...prev,
                    [item.key]: {
                      fields: nextFields,
                      dirty,
                      invalid,
                    },
                  };
                });
              };

              const draft = drafts[item.key] ?? baseDraft;
              const { dirty, invalid } = draft;

              const scheduledStart = item.scheduledStart
                ? dateTimeFormatter.format(new Date(item.scheduledStart))
                : null;
              const scheduledEnd = item.scheduledEnd
                ? dateTimeFormatter.format(new Date(item.scheduledEnd))
                : null;

              const handleSave = () => {
                const currentDraft = drafts[item.key] ?? createDraftFromItem(item);
                const costs: Record<TrainerExtraCostFieldKey, number> = {} as Record<
                  TrainerExtraCostFieldKey,
                  number
                >;
                for (const definition of COST_FIELD_DEFINITIONS) {
                  const parsed = parseInputToNumber(currentDraft.fields[definition.key]);
                  costs[definition.key] = parsed ?? 0;
                }

                const payload: TrainerExtraCostSavePayload = {
                  trainerId: item.trainerId,
                  costs,
                };

                if (item.assignmentType === 'session' && item.sessionId) {
                  payload.sessionId = item.sessionId;
                } else if (item.assignmentType === 'variant' && item.variantId) {
                  payload.variantId = item.variantId;
                }

                saveMutation.mutate({ key: item.key, payload });
              };

              return (
                <tr key={item.key}>
                  <td className="align-middle">
                    <div className="fw-semibold">{trainerDisplayName}</div>
                    {trainerDisplayName !== item.trainerId ? (
                      <div className="text-muted small">ID: {item.trainerId}</div>
                    ) : null}
                  </td>
                  <td className="align-middle">
                    <div className="fw-semibold">
                      {formatAssignmentLabel(item.assignmentType)}: {item.sessionName ?? item.variantName ?? '—'}
                    </div>
                    {item.dealTitle ? (
                      <div className="text-muted small">{item.dealTitle}</div>
                    ) : null}
                    {item.productName ? (
                      <div className="text-muted small">Producto: {item.productName}</div>
                    ) : null}
                    {item.site ? (
                      <div className="text-muted small">Ubicación: {item.site}</div>
                    ) : null}
                    {scheduledStart ? (
                      <div className="text-muted small">
                        Inicio planificado: {scheduledStart}
                        {scheduledEnd ? ` · Fin: ${scheduledEnd}` : ''}
                      </div>
                    ) : null}
                  </td>
                  {COST_FIELD_DEFINITIONS.map((definition) => (
                    <td key={definition.key} className="align-middle">
                      <Form.Control
                        type="text"
                        inputMode="decimal"
                        value={draft.fields[definition.key]}
                        onChange={(event) => handleFieldChange(definition.key, event.currentTarget.value)}
                        disabled={saving}
                        className="text-end"
                      />
                    </td>
                  ))}
                  <td className="align-middle">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSave}
                      disabled={!dirty || invalid || saving}
                    >
                      {saving ? 'Guardando…' : 'Guardar'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    );
  };

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Costes Extra
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Gestiona los importes adicionales asociados a cada formador por sesión o formación abierta.
          </p>
          <Form className="mb-3">
            <div className="d-flex gap-3 flex-wrap align-items-end">
              <Form.Group controlId="costes-extra-start" className="mb-0">
                <Form.Label>Fecha de inicio</Form.Label>
                <Form.Control
                  type="date"
                  value={filters.startDate}
                  max={filters.endDate || undefined}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    setFilters((prev) => ({ ...prev, startDate: nextValue }));
                  }}
                />
              </Form.Group>
              <Form.Group controlId="costes-extra-end" className="mb-0">
                <Form.Label>Fecha de fin</Form.Label>
                <Form.Control
                  type="date"
                  value={filters.endDate}
                  min={filters.startDate || undefined}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    setFilters((prev) => ({ ...prev, endDate: nextValue }));
                  }}
                />
              </Form.Group>
              <div className="ms-auto text-end">
                <span className="text-muted d-block small">Registros mostrados</span>
                <span className="fw-semibold h5 mb-0">{numberFormatter.format(items.length)}</span>
              </div>
            </div>
          </Form>
          {mutationError ? (
            <Alert variant="danger">
              {isApiError(mutationError)
                ? mutationError.message
                : 'No se pudieron guardar los costes extra.'}
            </Alert>
          ) : null}
          {renderContent()}
        </Card.Body>
      </Card>
    </section>
  );
}
