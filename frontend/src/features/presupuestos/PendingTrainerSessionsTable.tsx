import { useMemo } from 'react';
import { Alert, Badge, Spinner, Table } from 'react-bootstrap';
import type { DealSummary, DealSummarySession } from '../../types/deal';
import { SESSION_ESTADOS, type SessionEstado } from '../../api/sessions.types';

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

  const hasDynamicFirefighterField = Object.entries(session as Record<string, unknown>).some(([key, value]) => {
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

export function PendingTrainerSessionsTable({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelectSession,
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
        const estado = normalizeSessionEstado(session.estado);

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
      <div className="d-flex justify-content-between align-items-center px-3 px-md-4 py-3 border-bottom">
        <div>
          <h2 className="h5 mb-1">Sesiones sin formador ({rows.length})</h2>
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
            {rows.map((row) => (
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
