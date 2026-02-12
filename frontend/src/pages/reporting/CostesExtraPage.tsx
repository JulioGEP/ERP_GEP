import { useEffect, useMemo, useRef, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Collapse, Form, Spinner, Table } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';

import { isApiError } from '../../api/client';
import {
  DEFAULT_TRAINER_EXTRA_COST_VALUES,
  fetchTrainerExtraCosts,
  saveTrainerExtraCost,
  type TrainerExtraCostFieldKey,
  type TrainerExtraCostFilters,
  type TrainerExtraCostRecord,
  type TrainerExtraCostSavePayload,
} from '../../features/reporting/api';
import { exportToExcel } from '../../shared/export/exportToExcel';

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

const NON_HIGHLIGHT_COST_KEYS = new Set<TrainerExtraCostFieldKey>([
  'precioCosteFormacion',
  'precioCostePreventivo',
]);

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfIsoWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function buildWeekRange(reference: Date) {
  const start = startOfIsoWeek(reference);
  const end = addDays(start, 6);

  return {
    startDate: formatDateForInput(start),
    endDate: formatDateForInput(end),
  } as const;
}

function buildMonthRange(reference: Date) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);

  return {
    startDate: formatDateForInput(start),
    endDate: formatDateForInput(end),
  } as const;
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

function hasNonZeroValue(value: string): boolean {
  const parsed = parseInputToNumber(value);
  return parsed !== null && Math.abs(parsed) > 0.005;
}

function createDraftFromItem(item: TrainerExtraCostRecord): CostDraft {
  const fields = {} as Record<TrainerExtraCostFieldKey, string>;
  for (const definition of COST_FIELD_DEFINITIONS) {
    const baseValue = Number.isFinite(item.costs[definition.key])
      ? item.costs[definition.key]
      : DEFAULT_TRAINER_EXTRA_COST_VALUES[definition.key] ?? 0;
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
      : DEFAULT_TRAINER_EXTRA_COST_VALUES[definition.key] ?? 0;
    if (Math.abs(parsed - baseValue) > 0.005) {
      dirty = true;
    }
  }

  return { dirty, invalid };
}

function getSortTimestamp(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function buildTrainerDisplayName(item: TrainerExtraCostRecord): string {
  const parts = [item.trainerName, item.trainerLastName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);
  return parts.length ? parts.join(' ') : item.trainerId;
}

function normalizeTrainerName(value: string | null): string {
  if (!value) {
    return '';
  }
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizePipelineLabel(value: string | null): string {
  if (!value) {
    return '';
  }
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function formatAssignmentLabel(value: 'session' | 'variant'): string {
  return value === 'session' ? 'Sesión' : 'Formación abierta';
}

function resolveSessionCategory(item: TrainerExtraCostRecord): { label: string; variant: string } | null {
  const pipelineLabel = normalizePipelineLabel(item.pipelineLabel ?? null);
  if (pipelineLabel === 'formacion abierta') {
    return { label: 'Formación Abierta', variant: 'warning' };
  }
  if (pipelineLabel === 'formacion empresa' || pipelineLabel === 'formacion empresas') {
    return { label: 'Formación Empresa', variant: 'success' };
  }
  if (pipelineLabel === 'gep services' || pipelineLabel === 'preventivos') {
    return { label: 'Preventivo', variant: 'danger' };
  }
  if (item.assignmentType === 'variant') {
    return { label: 'Formación Abierta', variant: 'warning' };
  }

  const hasFormacion = (item.costs.precioCosteFormacion ?? 0) > 0;
  const hasPreventivo = (item.costs.precioCostePreventivo ?? 0) > 0;

  if (hasPreventivo) {
    return { label: 'Preventivo', variant: 'danger' };
  }
  if (hasFormacion) {
    return { label: 'Formación Empresa', variant: 'success' };
  }
  return null;
}

function isUnassignedTrainerName(name: string | null, lastName: string | null): boolean {
  const normalizedParts = [name, lastName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);
  if (!normalizedParts.length) {
    return false;
  }
  return normalizedParts.join(' ').toLowerCase() === 'sin asignar';
}

export default function CostesExtraPage() {
  const today = useMemo(() => new Date(), []);
  const [searchParams] = useSearchParams();
  const trainerIdFilter = useMemo(() => {
    const raw = searchParams.get('trainerId');
    return raw ? raw.trim() : null;
  }, [searchParams]);
  const trainerNameFilter = useMemo(() => {
    const raw = searchParams.get('trainerName');
    return raw ? raw.trim() : null;
  }, [searchParams]);
  const trainerLastNameFilter = useMemo(() => {
    const raw = searchParams.get('trainerLastName');
    return raw ? raw.trim() : null;
  }, [searchParams]);
  const trainerFullNameFilter = useMemo(() => {
    const parts = [trainerNameFilter, trainerLastNameFilter].filter(
      (value): value is string => Boolean(value?.length),
    );
    return parts.length ? parts.join(' ') : null;
  }, [trainerLastNameFilter, trainerNameFilter]);
  const normalizedTrainerNameFilter = useMemo(() => {
    if (!trainerFullNameFilter) {
      return null;
    }
    return normalizeTrainerName(trainerFullNameFilter);
  }, [trainerFullNameFilter]);

  const initialFilters = useMemo(() => {
    const startDate = searchParams.get('startDate') ?? '';
    const endDate = searchParams.get('endDate') ?? '';
    if (startDate || endDate) {
      return {
        startDate,
        endDate,
      };
    }
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      startDate: formatDateForInput(startOfMonth),
      endDate: formatDateForInput(endOfMonth),
    };
  }, [searchParams]);

  const [filters, setFilters] = useState<{ startDate: string; endDate: string }>(initialFilters);
  const [selectedTrainerIds, setSelectedTrainerIds] = useState<string[]>(
    trainerIdFilter ? [trainerIdFilter] : [],
  );
  const [isTrainerDropdownOpen, setIsTrainerDropdownOpen] = useState(false);
  const trainerDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialFilters]);

  useEffect(() => {
    setSelectedTrainerIds(trainerIdFilter ? [trainerIdFilter] : []);
  }, [trainerIdFilter]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!isTrainerDropdownOpen) return;
      const target = event.target as Node | null;
      if (trainerDropdownRef.current && target && !trainerDropdownRef.current.contains(target)) {
        setIsTrainerDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isTrainerDropdownOpen]);

  const quickRanges = useMemo(
    () => [
      { label: 'Semana pasada', range: buildWeekRange(addDays(today, -7)) },
      { label: 'Mes pasado', range: buildMonthRange(new Date(today.getFullYear(), today.getMonth() - 1, 1)) },
      { label: 'Mes actual', range: buildMonthRange(today) },
      { label: 'Esta semana', range: buildWeekRange(today) },
    ],
    [today],
  );

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

  const itemsWithQueryFilters = useMemo(() => {
    if (hasInvalidRange) {
      return [] as TrainerExtraCostRecord[];
    }
    const source = extraCostsQuery.data ?? [];
    let filtered = source.filter(
      (item) => !isUnassignedTrainerName(item.trainerName, item.trainerLastName),
    );
    if (!filtered.length) {
      return filtered;
    }
    if (trainerIdFilter) {
      filtered = filtered.filter(
        (item) => item.trainerId === trainerIdFilter || item.trainerUserId === trainerIdFilter,
      );
    } else if (normalizedTrainerNameFilter) {
      filtered = filtered.filter((item) => {
        const fullName = `${item.trainerName ?? ''} ${item.trainerLastName ?? ''}`;
        return normalizeTrainerName(fullName) === normalizedTrainerNameFilter;
      });
    }
    return [...filtered].sort((a, b) => {
      const timeA = getSortTimestamp(a.scheduledStart);
      const timeB = getSortTimestamp(b.scheduledStart);
      if (timeA === timeB) {
        return a.key.localeCompare(b.key);
      }
      return timeA < timeB ? -1 : 1;
    });
  }, [extraCostsQuery.data, hasInvalidRange, normalizedTrainerNameFilter, trainerIdFilter]);

  const trainerOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ id: string; label: string }> = [];
    for (const item of itemsWithQueryFilters) {
      if (seen.has(item.trainerId)) {
        continue;
      }
      seen.add(item.trainerId);
      options.push({
        id: item.trainerId,
        label: buildTrainerDisplayName(item),
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [itemsWithQueryFilters]);

  const items = useMemo(() => {
    if (!selectedTrainerIds.length) {
      return itemsWithQueryFilters;
    }
    return itemsWithQueryFilters.filter((item) =>
      selectedTrainerIds.some(
        (selectedId) => item.trainerId === selectedId || item.trainerUserId === selectedId,
      ),
    );
  }, [itemsWithQueryFilters, selectedTrainerIds]);

  const trainerFilterLabel = useMemo(() => {
    if (selectedTrainerIds.length) {
      const selectedLabels = trainerOptions
        .filter((option) => selectedTrainerIds.includes(option.id))
        .map((option) => option.label);
      if (selectedLabels.length === 1) {
        return selectedLabels[0];
      }
      if (selectedLabels.length > 1) {
        return `${selectedLabels.length} formadores`;
      }
    }

    if (!trainerIdFilter) {
      return trainerFullNameFilter;
    }

    if (items.length) {
      return buildTrainerDisplayName(items[0]);
    }
    return trainerNameFilter || trainerIdFilter;
  }, [items, selectedTrainerIds, trainerFullNameFilter, trainerIdFilter, trainerNameFilter, trainerOptions]);

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
  const hoursFormatter = useMemo(
    () =>
      new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
      }),
    [],
  );
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [],
  );

  const periodLabel = useMemo(() => {
    if (filters.startDate && filters.endDate) {
      return `${filters.startDate}_a_${filters.endDate}`;
    }
    if (filters.startDate) {
      return `desde_${filters.startDate}`;
    }
    if (filters.endDate) {
      return `hasta_${filters.endDate}`;
    }
    return 'completo';
  }, [filters.endDate, filters.startDate]);

  const canDownload =
    !hasInvalidRange &&
    !extraCostsQuery.isLoading &&
    !extraCostsQuery.isError &&
    items.length > 0;

  const handleDownload = () => {
    if (!canDownload) {
      return;
    }

    const headerRow = [
      'Fecha',
      'Formador',
      'ID formador',
      'Tipo de asignación',
      'Nombre asignación',
      'Negocio',
      'Producto',
      'Ubicación',
      'Inicio planificado',
      'Fin planificado',
      'Documentos',
      'Horas',
      ...COST_FIELD_DEFINITIONS.map((definition) => definition.label),
    ];

    const rows = items.map((item) => {
      const draft = drafts[item.key] ?? createDraftFromItem(item);
      const assignmentLabel = formatAssignmentLabel(item.assignmentType);
      const trainingDate = item.scheduledStart
        ? dateFormatter.format(new Date(item.scheduledStart))
        : '';
      const scheduledStart = item.scheduledStart
        ? dateTimeFormatter.format(new Date(item.scheduledStart))
        : '';
      const scheduledEnd = item.scheduledEnd
        ? dateTimeFormatter.format(new Date(item.scheduledEnd))
        : '';

      const documentLabel = item.trainerExpenseDocuments.length
        ? item.trainerExpenseDocuments
            .map((doc) => {
              const name = doc.name ?? 'Documento';
              return doc.url ? `${name}: ${doc.url}` : name;
            })
            .join('\n')
        : '';

      const workedHours =
        typeof item.workedHours === 'number' ? Number(item.workedHours.toFixed(2)) : '';

      const costValues = COST_FIELD_DEFINITIONS.map((definition) => {
        const parsed = parseInputToNumber(draft.fields[definition.key]);
        return parsed ?? draft.fields[definition.key];
      });

      return [
        trainingDate,
        buildTrainerDisplayName(item),
        item.trainerId,
        assignmentLabel,
        item.sessionName ?? item.variantName ?? '',
        item.dealTitle ?? '',
        item.productName ?? '',
        item.site ?? '',
        scheduledStart,
        scheduledEnd,
        documentLabel,
        workedHours,
        ...costValues,
      ];
    });

    exportToExcel({
      rows: [headerRow, ...rows],
      fileName: `costes_extra_${periodLabel}.xlsx`,
      sheetName: 'Costes Extra',
      auditEvent: {
        action: 'reporting.costes_extra.export',
        details: {
          period: periodLabel,
          itemCount: items.length,
        },
      },
    });
  };

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
              <th style={{ minWidth: '120px' }}>Fecha</th>
              <th style={{ minWidth: '220px' }}>Formador</th>
              <th style={{ minWidth: '260px' }}>Asignación</th>
              <th style={{ minWidth: '200px' }}>Documentos</th>
              <th style={{ minWidth: '120px' }} className="text-end">
                Horas
              </th>
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
              const trainingDateLabel = item.scheduledStart
                ? dateFormatter.format(new Date(item.scheduledStart))
                : '—';
              const sessionCategory = resolveSessionCategory(item);

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
                  <td className="align-middle">{trainingDateLabel}</td>
                  <td className="align-middle">
                    <div className="fw-semibold">{trainerDisplayName}</div>
                    {trainerDisplayName !== item.trainerId ? (
                      <div className="text-muted small">ID: {item.trainerId}</div>
                    ) : null}
                  </td>
                  <td className="align-middle">
                    <div className="fw-semibold d-flex align-items-center gap-2 flex-wrap">
                      <span>
                        {formatAssignmentLabel(item.assignmentType)}: {item.sessionName ?? item.variantName ?? '—'}
                      </span>
                      {sessionCategory ? (
                        <Badge bg={sessionCategory.variant} className="text-uppercase">
                          {sessionCategory.label}
                        </Badge>
                      ) : null}
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
                  <td className="align-middle">
                    {item.trainerExpenseDocuments.length ? (
                      <div className="d-flex flex-column gap-1">
                        {item.trainerExpenseDocuments.map((doc) => (
                          doc.url ? (
                            <a
                              key={doc.id}
                              href={doc.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-decoration-none"
                            >
                              {doc.name ?? 'Documento'}
                            </a>
                          ) : (
                            <span key={doc.id} className="text-muted">
                              {doc.name ?? 'Documento'}
                            </span>
                          )
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">Sin documentos</span>
                    )}
                  </td>
                  <td className="align-middle text-end">
                    {typeof item.workedHours === 'number'
                      ? hoursFormatter.format(item.workedHours)
                      : '—'}
                  </td>
                  {COST_FIELD_DEFINITIONS.map((definition) => (
                    <td key={definition.key} className="align-middle">
                      <Form.Control
                        type="text"
                        inputMode="decimal"
                        value={draft.fields[definition.key]}
                        onChange={(event) => handleFieldChange(definition.key, event.currentTarget.value)}
                        disabled={saving}
                        className={`text-end ${
                          !NON_HIGHLIGHT_COST_KEYS.has(definition.key) &&
                          hasNonZeroValue(draft.fields[definition.key])
                            ? 'bg-warning-subtle border-warning'
                            : ''
                        }`}
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
          {trainerFilterLabel ? (
            <Alert variant="info" className="py-2">
              Mostrando sesiones del formador <strong>{trainerFilterLabel}</strong> para el periodo seleccionado.
            </Alert>
          ) : null}
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
              <div className="d-flex flex-column gap-2">
                <Form.Label className="mb-0">Filtros rápidos</Form.Label>
                <div className="d-flex flex-wrap gap-2">
                  {quickRanges.map((quickRange) => {
                    const isActive =
                      filters.startDate === quickRange.range.startDate &&
                      filters.endDate === quickRange.range.endDate;
                    return (
                      <Button
                        key={quickRange.label}
                        variant={isActive ? 'primary' : 'outline-secondary'}
                        size="sm"
                        onClick={() => setFilters(quickRange.range)}
                      >
                        {quickRange.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <Form.Group controlId="costes-extra-trainers" className="mb-0">
                <Form.Label>Formadores</Form.Label>
                <div ref={trainerDropdownRef} className="position-relative" style={{ minWidth: '240px' }}>
                  <Button
                    variant="outline-secondary"
                    className="w-100 d-flex align-items-center justify-content-between text-start"
                    onClick={() => setIsTrainerDropdownOpen((prev) => !prev)}
                    aria-expanded={isTrainerDropdownOpen}
                    aria-controls="costes-extra-trainer-options"
                  >
                    <span>
                      {selectedTrainerIds.length
                        ? `${selectedTrainerIds.length} seleccionados`
                        : 'Selecciona formadores'}
                    </span>
                    <span className="ms-2">▾</span>
                  </Button>
                  <Collapse in={isTrainerDropdownOpen}>
                    <div
                      id="costes-extra-trainer-options"
                      className="border rounded p-2 mt-2"
                      style={{ maxHeight: '240px', overflowY: 'auto' }}
                    >
                      {trainerOptions.length ? (
                        trainerOptions.map((trainer) => {
                          const isChecked = selectedTrainerIds.includes(trainer.id);
                          return (
                            <Form.Check
                              key={trainer.id}
                              id={`costes-extra-trainer-${trainer.id}`}
                              type="checkbox"
                              label={trainer.label}
                              checked={isChecked}
                              onChange={(event) => {
                                const { checked } = event.currentTarget;
                                setSelectedTrainerIds((prev) => {
                                  if (checked) {
                                    return Array.from(new Set([...prev, trainer.id]));
                                  }
                                  return prev.filter((trainerId) => trainerId !== trainer.id);
                                });
                              }}
                            />
                          );
                        })
                      ) : (
                        <span className="text-muted small">No hay formadores en el rango seleccionado.</span>
                      )}
                    </div>
                  </Collapse>
                </div>
              </Form.Group>
              <div className="ms-auto text-end">
                <span className="text-muted d-block small">Registros mostrados</span>
                <span className="fw-semibold h5 mb-0">{numberFormatter.format(items.length)}</span>
                <div className="mt-2">
                  <Button type="button" onClick={handleDownload} disabled={!canDownload}>
                    Descargar
                  </Button>
                </div>
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
