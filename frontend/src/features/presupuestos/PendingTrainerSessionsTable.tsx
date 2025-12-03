import { useMemo } from 'react';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import type { DealSummary, DealSummarySession } from '../../types/deal';

const ALLOWED_PIPELINE_KEYS = new Set<string>([
  normalizePipelineKey('Formación Empresa'),
  normalizePipelineKey('Formación Empresas'),
  normalizePipelineKey('GEP Services'),
]);

type PendingTrainerSessionsTableProps = {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
};

type PendingSessionRow = {
  budgetId: string;
  organization: string;
  sessionName: string;
  pipelineLabel: string;
  sessionId: string;
};

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

function hasTrainer(session: DealSummarySession | null | undefined): boolean {
  if (!session) return false;

  const trainerIds = Array.isArray(session.trainer_ids) ? session.trainer_ids : [];
  if (trainerIds.some((id) => typeof id === 'string' && id.trim().length > 0)) {
    return true;
  }

  const trainerId = typeof session.trainer_id === 'string' ? session.trainer_id.trim() : '';
  return trainerId.length > 0;
}

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildSessionName(session: DealSummarySession): string {
  const name = typeof session.nombre_cache === 'string' ? session.nombre_cache.trim() : '';
  if (name.length) return name;

  const fallbackDate = typeof session.fecha === 'string' ? session.fecha.trim() : '';
  if (fallbackDate.length) return fallbackDate;

  const startDate = typeof session.fecha_inicio_utc === 'string' ? session.fecha_inicio_utc.trim() : '';
  if (startDate.length) return startDate;

  return 'Sesión sin nombre';
}

export function PendingTrainerSessionsTable({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
}: PendingTrainerSessionsTableProps) {
  const rows = useMemo<PendingSessionRow[]>(() => {
    if (!Array.isArray(budgets) || budgets.length === 0) {
      return [];
    }

    const sessionRows: PendingSessionRow[] = [];

    budgets.forEach((deal) => {
      const pipelineKey = [deal.pipeline_label, deal.pipeline_id]
        .map((value) => normalizePipelineKey(value))
        .find((key) => key.length > 0);

      if (!pipelineKey || !ALLOWED_PIPELINE_KEYS.has(pipelineKey)) {
        return;
      }

      const hasVariant = typeof deal.w_id_variation === 'string' && deal.w_id_variation.trim().length > 0;
      if (hasVariant) {
        return;
      }

      const sessions = Array.isArray(deal.sessions) ? deal.sessions : [];
      if (!sessions.length) {
        return;
      }

      const organization = (deal.organization?.name ?? '').trim() || '—';
      const pipelineLabel = (deal.pipeline_label ?? deal.pipeline_id ?? '').trim() || '—';
      const budgetId = deal.deal_id;

      sessions.forEach((session, index) => {
        if (!session) return;

        if (!hasValue(session.fecha_inicio_utc) || !hasValue(session.fecha_fin_utc)) {
          return;
        }

        if (hasTrainer(session)) {
          return;
        }

        sessionRows.push({
          budgetId,
          organization,
          pipelineLabel,
          sessionName: buildSessionName(session),
          sessionId: session.id ?? `${budgetId}-session-${index}`,
        });
      });
    });

    return sessionRows;
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
    const message = error instanceof Error ? error.message : 'No se pudieron cargar los datos.';
    return (
      <Alert variant="danger" className="rounded-4 shadow-sm d-flex flex-column gap-3">
        <div>
          <p className="fw-semibold mb-1">Error al cargar las sesiones</p>
          <p className="mb-0 small">{message}</p>
        </div>
        <div>
          <Button variant="outline-danger" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      </Alert>
    );
  }

  if (!rows.length) {
    return (
      <div className="text-center py-4 text-muted bg-white rounded-4 shadow-sm">
        <p className="mb-1 fw-semibold">No hay sesiones pendientes.</p>
        <p className="mb-0 small">
          No se encontraron sesiones con fecha de inicio y fin sin formador asignado.
        </p>
      </div>
    );
  }

  return (
    <div className="d-grid gap-2">
      {isFetching ? (
        <div className="d-flex align-items-center gap-2 text-muted small justify-content-end">
          <Spinner animation="border" size="sm" />
          <span>Actualizando…</span>
        </div>
      ) : null}

      <div className="rounded-4 shadow-sm bg-white overflow-hidden">
        <div className="table-responsive">
          <Table hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th scope="col" style={{ width: 120 }}>Presu</th>
                <th scope="col">Empresa</th>
                <th scope="col">Sesión</th>
                <th scope="col" style={{ width: 180 }}>Negocio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.budgetId}-${row.sessionId}`}>
                  <td className="text-uppercase fw-semibold">{row.budgetId}</td>
                  <td>{row.organization}</td>
                  <td>{row.sessionName}</td>
                  <td>{row.pipelineLabel}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
