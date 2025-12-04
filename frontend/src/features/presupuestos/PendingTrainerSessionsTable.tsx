import { createPortal } from 'react-dom';
import { useMemo } from 'react';
import { Alert, Badge, Spinner, Table } from 'react-bootstrap';
import type { DealSummary, DealSummarySession } from '../../types/deal';
import { SESSION_ESTADOS, type SessionEstado } from '../../api/sessions.types';
import {
  FilterToolbar,
  type FilterDefinition,
  type FilterOption,
} from '../../components/table/FilterToolbar';
import { splitFilterValue } from '../../components/table/filterUtils';
import { useTableFilterState } from '../../hooks/useTableFilterState';

const dateFormatter = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });

function normalizePipelineKey(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ALLOWED_PIPELINES = new Set<string>([
  normalizePipelineKey('Formación Empresa'),
  normalizePipelineKey('Formación Empresas'),
  normalizePipelineKey('GEP Services'),
]);

const SESSION_ESTADOS_SET = new Set<string>(SESSION_ESTADOS);

const SESSION_ESTADO_LABELS: Record<SessionEstado, string> = {
  BORRADOR: 'Borrador',
  PLANIFICADA: 'Planificada',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada',
  FINALIZADA: 'Finalizada',
};

const SESSION_ESTADO_VARIANTS: Record<SessionEstado, string> = {
  BORRADOR: 'secondary',
  PLANIFICADA: 'success',
  SUSPENDIDA: 'warning',
  CANCELADA: 'danger',
  FINALIZADA: 'primary',
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeSessionEstado(value: string | null | undefined): SessionEstado | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized.length) return null;
  return SESSION_ESTADOS_SET.has(normalized) ? (normalized as SessionEstado) : null;
}

function hasAssignedValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasAssignedValue(item));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return hasAssignedValue(
      record.trainer_id ?? record.trainerId ?? record.id ?? record.bombero_id ?? record.bomberoId ?? record.firefighter_id,
    );
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return false;
    const normalized = trimmed.toLowerCase();
    return normalized !== '0' && normalized !== 'null' && normalized !== 'undefined';
  }

  return false;
}

function hasTrainer(session: DealSummarySession): boolean {
  if (hasAssignedValue((session as any).trainer_id)) {
    return true;
  }

  if (hasAssignedValue((session as any).trainer_ids)) {
    return true;
  }

  if (hasAssignedValue((session as any).trainers)) {
    return true;
  }

  return false;
}

function hasFirefighter(session: DealSummarySession): boolean {
  if (
    hasAssignedValue((session as any).firefighter_id) ||
    hasAssignedValue((session as any).firefighter_ids) ||
    hasAssignedValue((session as any).bombero_id) ||
    hasAssignedValue((session as any).bombero_ids) ||
    hasAssignedValue((session as any).firefighters) ||
    hasAssignedValue((session as any).bomberos)
  ) {
    return true;
  }

  const hasDynamicFirefighterField = Object.entries(session as unknown as Record<string, unknown>).some(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey.includes('bombero') && !normalizedKey.includes('firefighter')) {
      return false;
    }
    return hasAssignedValue(value);
  });

  return hasDynamicFirefighterField;
}

function getPipelineLabel(budget: DealSummary): string {
  return budget.pipeline_label?.trim() || budget.pipeline_id?.toString().trim() || '—';
}

function isFinalizedSession(session: DealSummarySession): boolean {
  if (typeof session.estado !== 'string') return false;
  return session.estado.trim().toUpperCase() === 'FINALIZADA';
}

function getSessionName(session: DealSummarySession): string {
  const rawName = (session as any).nombre_cache ?? (session as any).nombre;
  if (typeof rawName === 'string' && rawName.trim().length) {
    return rawName.trim();
  }
  return 'Sesión sin nombre';
}

export type PendingTrainerSessionsTableProps = {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelectSession?: (budget: DealSummary, sessionId: string | null) => void;
  filtersContainer?: HTMLElement | null;
};

type PendingSessionRow = {
  id: string;
  dealId: string;
  organization: string;
  sessionName: string;
  pipeline: string;
  startDate: Date;
  sessionId: string | null;
  estado: SessionEstado | null;
  budget: DealSummary;
};

const FILTER_DEFINITIONS: FilterDefinition[] = [
  { key: 'empresa', label: 'Empresa', type: 'select', placeholder: 'Selecciona empresas' },
  {
    key: 'ocultar_empresa',
    label: 'Ocultar empresa',
    type: 'select',
    placeholder: 'Empresas a ocultar',
  },
  {
    key: 'fecha',
    label: 'Fecha',
    type: 'select',
    placeholder: 'Selecciona un rango',
    options: [
      { value: 'next_7', label: '7 días vista' },
      { value: 'next_15', label: '15 días vista' },
      { value: 'this_month', label: 'Este mes' },
      { value: 'next_month', label: 'Mes siguiente' },
    ],
  },
  {
    key: 'estado',
    label: 'Estado',
    type: 'select',
    placeholder: 'Selecciona estados',
  },
];

type DateRangeFilter = {
  start: number;
  end: number;
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function getDateRange(value: string): DateRangeFilter | null {
  const normalized = value.trim().toLowerCase();
  const today = startOfDay(new Date());
  const tomorrow = startOfDay(new Date(today.getTime() + 24 * 60 * 60 * 1000));

  switch (normalized) {
    case 'next_7': {
      const end = endOfDay(new Date(tomorrow.getTime() + 6 * 24 * 60 * 60 * 1000));
      return { start: tomorrow.getTime(), end: end.getTime() };
    }
    case 'next_15': {
      const end = endOfDay(new Date(tomorrow.getTime() + 14 * 24 * 60 * 60 * 1000));
      return { start: tomorrow.getTime(), end: end.getTime() };
    }
    case 'this_month': {
      const monthStart = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
      const nextMonthStart = startOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 1));
      const monthEnd = endOfDay(new Date(nextMonthStart.getTime() - 1));
      return { start: monthStart.getTime(), end: monthEnd.getTime() };
    }
    case 'next_month': {
      const nextMonthStart = startOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 1));
      const followingMonthStart = startOfDay(new Date(today.getFullYear(), today.getMonth() + 2, 1));
      const nextMonthEnd = endOfDay(new Date(followingMonthStart.getTime() - 1));
      return { start: nextMonthStart.getTime(), end: nextMonthEnd.getTime() };
    }
    default:
      return null;
  }
}

export function PendingTrainerSessionsTable({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelectSession,
  filtersContainer,
}: PendingTrainerSessionsTableProps) {
  const rows = useMemo<PendingSessionRow[]>(() => {
    const list: PendingSessionRow[] = [];

    budgets.forEach((budget) => {
      const normalizedPipeline = normalizePipelineKey(budget.pipeline_label ?? budget.pipeline_id ?? null);
      if (!ALLOWED_PIPELINES.has(normalizedPipeline)) {
        return;
      }

      if (typeof budget.w_id_variation === 'string' && budget.w_id_variation.trim().length) {
        return;
      }

      if (!Array.isArray(budget.sessions)) {
        return;
      }

      budget.sessions.forEach((session) => {
        if (!session) return;

        if (isFinalizedSession(session)) {
          return;
        }

        const estado = normalizeSessionEstado(session.estado);
        if (estado === 'PLANIFICADA') {
          return;
        }

        const startDate = parseDate(session.fecha_inicio_utc ?? session.fecha);
        const endDate = parseDate(session.fecha_fin_utc);
        if (!startDate || !endDate) {
          return;
        }

        if (hasTrainer(session) || hasFirefighter(session)) {
          return;
        }

        const sessionName = getSessionName(session);
        const sessionId =
          typeof session.id === 'string' && session.id.trim().length
            ? session.id.trim()
            : session.id != null
            ? String(session.id).trim()
            : null;
        const organization = budget.organization?.name?.trim() || '—';
        const pipeline = getPipelineLabel(budget);
        const dealId = budget.deal_id;

        list.push({
          id: `${dealId}-${session.id ?? sessionName}-${startDate.getTime()}`,
          dealId,
          organization,
          sessionName,
          pipeline,
          startDate,
          sessionId,
          estado,
          budget,
        });
      });
    });

    list.sort((a, b) => {
      const diff = a.startDate.getTime() - b.startDate.getTime();
      if (diff !== 0) return diff;
      const dealComparison = a.dealId.localeCompare(b.dealId, 'es', { numeric: true, sensitivity: 'base' });
      if (dealComparison !== 0) return dealComparison;
      return a.sessionName.localeCompare(b.sessionName, 'es', { sensitivity: 'base' });
    });

    return list;
  }, [budgets]);

  const { filters, searchValue, setSearchValue, setFilterValue, clearFilter, clearAllFilters, setFiltersAndSearch } =
    useTableFilterState({ tableKey: 'pending-trainer-sessions' });

  const organizationOptions = useMemo<FilterOption[]>(() => {
    const seen = new Set<string>();
    const values: string[] = [];

    rows.forEach((row) => {
      const label = row.organization.trim();
      if (!label.length) return;
      const key = label.toLocaleLowerCase('es-ES');
      if (seen.has(key)) return;
      seen.add(key);
      values.push(label);
    });

    return values
      .filter((value) => value.length)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
      .map((value) => ({ value, label: value }));
  }, [rows]);

  const estadoOptions = useMemo<FilterOption[]>(
    () =>
      SESSION_ESTADOS.map((value) => ({
        value,
        label: SESSION_ESTADO_LABELS[value],
      })),
    [],
  );

  const filterDefinitions = useMemo<FilterDefinition[]>(
    () =>
      FILTER_DEFINITIONS.map((definition) => {
        if (definition.key === 'empresa' || definition.key === 'ocultar_empresa') {
          return { ...definition, options: organizationOptions } satisfies FilterDefinition;
        }
        if (definition.key === 'estado') {
          return { ...definition, options: estadoOptions } satisfies FilterDefinition;
        }
        return definition;
      }),
    [estadoOptions, organizationOptions],
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = normalizeText(searchValue);

    const selectedCompanies = splitFilterValue(filters.empresa ?? '');
    const hiddenCompanies = splitFilterValue(filters.ocultar_empresa ?? '');
    const selectedEstados = splitFilterValue(filters.estado ?? '').map((estado) => estado.trim().toUpperCase());
    const dateRange = getDateRange(filters.fecha ?? '');

    return rows.filter((row) => {
      if (selectedCompanies.length) {
        const matches = selectedCompanies.some((company) => company === row.organization);
        if (!matches) return false;
      }

      if (hiddenCompanies.length) {
        const shouldHide = hiddenCompanies.some((company) => company === row.organization);
        if (shouldHide) return false;
      }

      if (selectedEstados.length) {
        if (!row.estado) return false;
        const normalizedEstado = row.estado.trim().toUpperCase();
        const matchesEstado = selectedEstados.some((estado) => estado === normalizedEstado);
        if (!matchesEstado) return false;
      }

      if (dateRange) {
        const timestamp = row.startDate.getTime();
        if (timestamp < dateRange.start || timestamp > dateRange.end) {
          return false;
        }
      }

      if (!normalizedSearch.length) {
        return true;
      }

      const searchTarget = normalizeText(
        `${row.dealId} ${row.organization} ${row.sessionName} ${row.pipeline} ${row.estado ?? ''}`,
      );
      return searchTarget.includes(normalizedSearch);
    });
  }, [filters.estado, filters.fecha, filters.empresa, filters.ocultar_empresa, rows, searchValue]);

  const filterToolbar = (
    <FilterToolbar
      filters={filterDefinitions}
      activeFilters={filters}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      onFilterChange={setFilterValue}
      onRemoveFilter={clearFilter}
      onClearAll={clearAllFilters}
      resultCount={filteredRows.length}
      isServerBusy={isFetching}
      viewStorageKey="pending-trainer-sessions"
      onApplyFilterState={({ filters: nextFilters, searchValue: nextSearch }) => setFiltersAndSearch(nextFilters, nextSearch)}
    />
  );

  const toolbarPortal = filtersContainer ? createPortal(filterToolbar, filtersContainer) : null;

  if (isLoading) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">Cargando sesiones pendientes…</p>
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron cargar las sesiones pendientes.';
    return (
      <Alert variant="danger" className="rounded-4 shadow-sm">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <h2 className="h6 mb-2">Error al cargar la tabla</h2>
            <p className="mb-0 text-muted">{message}</p>
          </div>
          <button type="button" className="btn btn-outline-danger" onClick={onRetry}>
            Reintentar
          </button>
        </div>
      </Alert>
    );
  }

  if (!rows.length) {
    return (
      <div className="text-center py-4 text-muted bg-white rounded-4 shadow-sm">
        <p className="mb-1 fw-semibold">No hay sesiones pendientes.</p>
        <p className="mb-0 small">Solo se muestran sesiones con fechas definidas y sin formador asignado.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-4 shadow-sm">
      {toolbarPortal}
      <div className="d-flex justify-content-between align-items-center px-3 px-md-4 py-3 border-bottom">
        <div>
          <h2 className="h5 mb-1">Sesiones sin formador ({filteredRows.length})</h2>
          <p className="text-muted small mb-0">Form. Empresa y GEP Services con fecha de inicio y fin asignadas.</p>
        </div>
        {isFetching ? <Spinner animation="border" size="sm" role="status" /> : null}
      </div>

      <div className="table-responsive" style={{ maxHeight: '620px', overflowY: 'auto' }}>
        <Table hover responsive className="mb-0 align-middle">
          <thead className="table-light">
            <tr>
              <th scope="col" style={{ minWidth: 120 }}>Presu</th>
              <th scope="col" style={{ minWidth: 180 }}>Empresa</th>
              <th scope="col" style={{ minWidth: 220 }}>Sesión</th>
              <th scope="col" style={{ minWidth: 140 }}>Estado</th>
              <th scope="col" style={{ minWidth: 160 }}>Negocio</th>
              <th scope="col" style={{ minWidth: 150 }}>Fecha de inicio</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr
                key={row.id}
                role="button"
                style={{ cursor: onSelectSession ? 'pointer' : undefined }}
                onClick={() => onSelectSession?.(row.budget, row.sessionId)}
              >
                <td>
                  <Badge bg="primary" className="text-uppercase">
                    {row.dealId}
                  </Badge>
                </td>
                <td>{row.organization}</td>
                <td>{row.sessionName}</td>
                <td>
                  {row.estado ? (
                    <Badge bg={SESSION_ESTADO_VARIANTS[row.estado]} className="text-uppercase">
                      {SESSION_ESTADO_LABELS[row.estado]}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{row.pipeline}</td>
                <td>{dateFormatter.format(row.startDate)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
