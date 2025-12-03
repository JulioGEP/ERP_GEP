import { createPortal } from 'react-dom';
import { useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Spinner, Table } from 'react-bootstrap';
import {
  FilterToolbar,
  type FilterDefinition,
  type FilterOption,
} from '../../components/table/FilterToolbar';
import { FILTER_MULTI_VALUE_SEPARATOR, splitFilterValue } from '../../components/table/filterUtils';
import { useTableFilterState } from '../../hooks/useTableFilterState';
import { fetchUnplannedSessions, type UnplannedSessionSummary } from './api/sessions.api';

const queryConfig = {
  queryKey: ['sessions', 'unplanned'],
  queryFn: fetchUnplannedSessions,
  staleTime: 5 * 60 * 1000,
};

const FILTER_DEFINITIONS: FilterDefinition[] = [
  { key: 'presupuesto', label: 'Presupuesto', placeholder: 'ID de presupuesto' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'sesion', label: 'Sesión' },
  { key: 'formacion', label: 'Formación' },
  { key: 'negocio', label: 'Negocio', type: 'select' },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function buildSessionFilters(session: UnplannedSessionSummary) {
  const productTags = Array.isArray(session.productTags) ? session.productTags : [];
  const pipeline = session.pipeline?.trim() ?? '';

  const values: Record<string, string> = {
    presupuesto: String(session.dealId ?? ''),
    empresa: session.organizationName?.trim() ?? '',
    sesion: session.sessionName?.trim() ?? '',
    formacion: productTags.join(` ${FILTER_MULTI_VALUE_SEPARATOR} `),
    negocio: pipeline,
  };

  const normalized: Record<string, string> = {};
  Object.entries(values).forEach(([key, value]) => {
    normalized[key] = normalizeText(value);
  });

  return { values, normalized };
}

function applyFilters(
  sessions: UnplannedSessionSummary[],
  filters: Record<string, string>,
  search: string,
  { includeFormation = true, definitions = FILTER_DEFINITIONS }: { includeFormation?: boolean; definitions?: FilterDefinition[] } = {},
) {
  const filterEntries = Object.entries(filters)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length && value.length);

  const normalizedSearch = normalizeText(search);

  const filtered = sessions.filter((session) => {
    const prepared = buildSessionFilters(session);

    if (filterEntries.length) {
      const match = filterEntries.every(([key, value]) => {
        const definition = definitions.find((definition) => definition.key === key);
        if (!definition) return true;
        const target = prepared.values[key] ?? '';

        if (definition.type === 'select') {
          const selected = splitFilterValue(value);
          if (!selected.length) return true;
          const targetValue = target.trim();
          if (!targetValue.length) return false;
          return selected.some((candidate) => candidate === targetValue);
        }

        const normalizedValue = normalizeText(value);
        if (!normalizedValue.length) return true;
        const targetValue = prepared.normalized[key] ?? '';
        return targetValue.includes(normalizedValue);
      });

      if (!match) return false;
    }

    if (!normalizedSearch.length) {
      return true;
    }

    const searchTarget = includeFormation
      ? `${prepared.values.presupuesto} ${prepared.values.empresa} ${prepared.values.sesion} ${prepared.values.formacion} ${prepared.values.negocio}`
      : `${prepared.values.presupuesto} ${prepared.values.empresa} ${prepared.values.sesion} ${prepared.values.negocio}`;
    return normalizeText(searchTarget).includes(normalizedSearch);
  });

  return filtered;
}

function ProductTags({ tags }: { tags: string[] }) {
  if (!tags.length) {
    return <span className="text-muted">—</span>;
  }

  return (
    <div className="d-flex flex-wrap gap-2">
      {tags.map((tag) => (
        <Badge key={tag} bg="secondary" className="text-bg-secondary bg-opacity-25 text-secondary-emphasis">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function renderRow(
  session: UnplannedSessionSummary,
  onSelect?: (session: UnplannedSessionSummary) => void,
  options: { includeFormation?: boolean } = {},
) {
  const sessionLabel = session.sessionName?.trim() || 'Sesión sin nombre';
  const pipelineLabel = session.pipeline?.trim() || '—';
  const organizationLabel = session.organizationName?.trim() || '—';
  const includeFormation = options.includeFormation ?? true;

  const handleClick = () => {
    onSelect?.(session);
  };

  return (
    <tr
      key={session.id}
      role="button"
      style={onSelect ? { cursor: 'pointer' } : undefined}
      onClick={handleClick}
    >
      <td className="fw-semibold">{session.dealId}</td>
      <td>{organizationLabel}</td>
      <td>{sessionLabel}</td>
      {includeFormation ? (
        <td>
          <ProductTags tags={session.productTags} />
        </td>
      ) : null}
      <td>
        <Badge bg="info" className="text-bg-info bg-opacity-25 text-info-emphasis">
          {pipelineLabel}
        </Badge>
      </td>
    </tr>
  );
}

export function UnplannedSessionsTable(props?: {
  onSelectSession?: (session: UnplannedSessionSummary) => void;
  filtersContainer?: HTMLElement | null;
  viewStorageKey?: string;
  onStateChange?: (state: { visible: number; total: number; fetching: boolean }) => void;
  allowedPipelines?: string[];
  showFormationColumn?: boolean;
}) {
  const query = useQuery(queryConfig);
  const { filters, searchValue, setFilterValue, setSearchValue, clearFilter, clearAllFilters, setFiltersAndSearch } =
    useTableFilterState({ tableKey: 'unplanned-sessions' });

  const includeFormation = props?.showFormationColumn ?? true;
  const allowedPipelines = useMemo(() => {
    const entries = props?.allowedPipelines ?? [];
    if (!entries.length) return null;
    return new Set(entries.map((entry) => normalizeText(entry)));
  }, [props?.allowedPipelines]);

  const sessions = useMemo(() => {
    const data = query.data ?? [];
    if (!allowedPipelines) return data;
    return data.filter((session) => {
      const pipeline = normalizeText(session.pipeline ?? '');
      if (!pipeline.length) return false;
      return allowedPipelines.has(pipeline);
    });
  }, [allowedPipelines, query.data]);

  const pipelineOptions = useMemo<FilterOption[]>(() => {
    const seen = new Set<string>();
    sessions.forEach((session) => {
      const pipeline = session.pipeline?.trim();
      if (pipeline) {
        seen.add(pipeline);
      }
    });
    return Array.from(seen)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
      .map((value) => ({ value, label: value }));
  }, [sessions]);

  const filtersWithOptions = useMemo<FilterDefinition[]>(() => {
    return FILTER_DEFINITIONS.filter((definition) => includeFormation || definition.key !== 'formacion').map(
      (definition) =>
        definition.key === 'negocio'
          ? {
              ...definition,
              options: pipelineOptions,
            }
          : definition,
    );
  }, [includeFormation, pipelineOptions]);

  const filteredSessions = useMemo(
    () => applyFilters(sessions, filters, searchValue, { includeFormation, definitions: filtersWithOptions }),
    [filtersWithOptions, includeFormation, sessions, filters, searchValue],
  );

  const filterToolbar = (
    <FilterToolbar
      filters={filtersWithOptions}
      activeFilters={filters}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      onFilterChange={setFilterValue}
      onRemoveFilter={clearFilter}
      onClearAll={clearAllFilters}
      resultCount={filteredSessions.length}
      isServerBusy={query.isFetching}
      viewStorageKey={props?.viewStorageKey}
      onApplyFilterState={({ filters: nextFilters, searchValue: nextSearch }) =>
        setFiltersAndSearch(nextFilters, nextSearch)
      }
    />
  );

  const toolbarPortal = props?.filtersContainer ? createPortal(filterToolbar, props.filtersContainer) : null;

  useEffect(() => {
    props?.onStateChange?.({ visible: filteredSessions.length, total: sessions.length, fetching: query.isFetching });
  }, [filteredSessions.length, props, query.isFetching, sessions.length]);

  if (query.isLoading) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">Cargando sesiones sin agendar…</p>
      </div>
    );
  }

  if (query.error) {
    const message = query.error instanceof Error ? query.error.message : 'No se pudieron cargar las sesiones sin agendar.';
    return (
      <Alert variant="danger" className="rounded-4 shadow-sm">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <h2 className="h6 mb-2">Error al cargar la tabla</h2>
            <p className="mb-0 text-muted">{message}</p>
          </div>
          <button type="button" className="btn btn-outline-danger" onClick={() => query.refetch()}>
            Reintentar
          </button>
        </div>
      </Alert>
    );
  }

  if (!sessions.length) {
    return (
      <div className="bg-white rounded-4 shadow-sm">
        {toolbarPortal}
        <div className="d-flex justify-content-between align-items-center px-3 px-md-4 py-3 border-bottom">
          <h2 className="h5 mb-0">Sesiones en la tabla: 0</h2>
          {query.isFetching ? <Spinner animation="border" size="sm" role="status" /> : null}
        </div>
        <Alert variant="info" className="m-3 mb-0">
          <p className="mb-0">No hay sesiones pendientes de agendar en Formación Empresa o GEP Services.</p>
        </Alert>
      </div>
    );
  }

  if (filteredSessions.length === 0) {
    return (
      <div className="bg-white rounded-4 shadow-sm">
        {toolbarPortal}
        <div className="px-3 px-md-4 py-3 border-bottom d-flex justify-content-between align-items-center">
          <h2 className="h5 mb-0">Sesiones sin agendar</h2>
          {query.isFetching ? <Spinner animation="border" size="sm" role="status" /> : null}
        </div>
        <Alert variant="info" className="m-3 mb-0">
          <p className="mb-0">No hay sesiones que coincidan con los filtros actuales.</p>
        </Alert>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-4 shadow-sm">
      {toolbarPortal}
      <div className="d-flex justify-content-between align-items-center px-3 px-md-4 py-3 border-bottom">
        <h2 className="h5 mb-0">Sesiones en la tabla: {filteredSessions.length}</h2>
        {query.isFetching ? <Spinner animation="border" size="sm" role="status" /> : null}
      </div>

      <div className="table-responsive">
        <Table hover responsive className="mb-0 align-middle">
          <thead className="table-light">
            <tr>
              <th scope="col" style={{ minWidth: 120 }}>Presu</th>
              <th scope="col" style={{ minWidth: 180 }}>Empresa</th>
              <th scope="col" style={{ minWidth: 200 }}>Sesión</th>
              {includeFormation ? <th scope="col" style={{ minWidth: 240 }}>Formación</th> : null}
              <th scope="col" style={{ minWidth: 170 }}>Negocio</th>
            </tr>
          </thead>
          <tbody>
            {filteredSessions.map((session) =>
              renderRow(session, props?.onSelectSession, { includeFormation }),
            )}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
