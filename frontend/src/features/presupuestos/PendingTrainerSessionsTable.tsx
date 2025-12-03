import { useMemo } from 'react';
import { Alert, Spinner, Table } from 'react-bootstrap';
import type { DealSummary, DealSummarySession } from '../../types/deal';

type PendingTrainerSessionsTableProps = {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
};

type PendingSessionRow = {
  id: string;
  budgetId: string;
  organization: string;
  sessionName: string;
  pipeline: string;
  startDate: string | null;
  endDate: string | null;
};

const ALLOWED_PIPELINE_KEYS = new Set<string>([
  normalizePipelineKey('Formación Empresa'),
  normalizePipelineKey('Formación Empresas'),
  normalizePipelineKey('GEP Services'),
]);

function normalizePipelineKey(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasAssignedTrainer(session: DealSummarySession): boolean {
  const ids: string[] = [];

  if (Array.isArray(session.trainer_ids)) {
    ids.push(...session.trainer_ids);
  }

  if (hasValue(session.trainer_id)) {
    ids.push(session.trainer_id);
  }

  return ids.some((id) => hasValue(id));
}

function hasCompleteDates(session: DealSummarySession): boolean {
  return hasValue(session.fecha_inicio_utc) && hasValue(session.fecha_fin_utc);
}

function getBudgetId(budget: DealSummary): string | null {
  const id = budget.deal_id ?? budget.dealId ?? null;
  if (!id) return null;
  const text = String(id).trim();
  return text.length ? text : null;
}

function getOrganizationName(budget: DealSummary): string {
  const name = budget.organization?.name ?? '';
  const trimmed = name.trim();
  return trimmed.length ? trimmed : '—';
}

function getPipelineLabel(budget: DealSummary): string {
  const label = budget.pipeline_label ?? budget.pipeline_id ?? null;
  const trimmed = (label ?? '').trim();
  return trimmed.length ? trimmed : '—';
}

function getSessionName(session: DealSummarySession): string {
  const name = session.nombre ?? null;
  if (hasValue(name)) return name.trim();
  return 'Sesión sin nombre';
}

function normalizeSessionRow(budget: DealSummary, session: DealSummarySession): PendingSessionRow | null {
  const budgetId = getBudgetId(budget);
  if (!budgetId) return null;

  if (!ALLOWED_PIPELINE_KEYS.has(normalizePipelineKey(budget.pipeline_label ?? budget.pipeline_id))) {
    return null;
  }

  if (hasValue(budget.w_id_variation)) {
    return null;
  }

  if (!hasCompleteDates(session) || hasAssignedTrainer(session)) {
    return null;
  }

  const sessionName = getSessionName(session);
  const pipeline = getPipelineLabel(budget);
  const organization = getOrganizationName(budget);

  return {
    id: `${budgetId}-${session.id ?? sessionName}`,
    budgetId,
    organization,
    sessionName,
    pipeline,
    startDate: session.fecha_inicio_utc,
    endDate: session.fecha_fin_utc ?? null,
  };
}

export function PendingTrainerSessionsTable({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
}: PendingTrainerSessionsTableProps) {
  const rows = useMemo<PendingSessionRow[]>(() => {
    const results: PendingSessionRow[] = [];

    budgets.forEach((budget) => {
      const sessions = Array.isArray(budget.sessions) ? budget.sessions : [];
      sessions.forEach((session) => {
        const normalized = normalizeSessionRow(budget, session);
        if (normalized) {
          results.push(normalized);
        }
      });
    });

    results.sort((a, b) => {
      const startA = a.startDate ? new Date(a.startDate).getTime() : Number.POSITIVE_INFINITY;
      const startB = b.startDate ? new Date(b.startDate).getTime() : Number.POSITIVE_INFINITY;
      if (Number.isFinite(startA) || Number.isFinite(startB)) {
        if (!Number.isFinite(startA)) return 1;
        if (!Number.isFinite(startB)) return -1;
        if (startA !== startB) return startA - startB;
      }

      if (a.budgetId !== b.budgetId) {
        return a.budgetId.localeCompare(b.budgetId, 'es', { sensitivity: 'base' });
      }

      return a.sessionName.localeCompare(b.sessionName, 'es', { sensitivity: 'base' });
    });

    return results;
  }, [budgets]);

  if (isLoading) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">Cargando sesiones pendientes…</p>
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron cargar las sesiones.';
    return (
      <Alert variant="danger" className="rounded-4 shadow-sm d-flex flex-column flex-md-row gap-3">
        <div className="flex-grow-1">
          <p className="fw-semibold mb-1">Error al cargar las sesiones pendientes</p>
          <p className="mb-0 small">{message}</p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="btn btn-outline-dark btn-sm" onClick={onRetry}>
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
        <p className="mb-0 small">No se encontraron sesiones sin formador asignado con fechas definidas.</p>
      </div>
    );
  }

  return (
    <section className="d-grid gap-2">
      {isFetching ? (
        <div className="d-flex align-items-center gap-2 text-muted small">
          <Spinner animation="border" size="sm" />
          <span>Actualizando…</span>
        </div>
      ) : null}

      <div className="rounded-4 shadow-sm bg-white overflow-hidden">
        <div className="table-responsive">
          <Table hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th scope="col">Presu</th>
                <th scope="col">Empresa</th>
                <th scope="col">Sesión</th>
                <th scope="col">Negocio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="fw-semibold">#{row.budgetId}</td>
                  <td>{row.organization}</td>
                  <td>{row.sessionName}</td>
                  <td>{row.pipeline}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </section>
  );
}
