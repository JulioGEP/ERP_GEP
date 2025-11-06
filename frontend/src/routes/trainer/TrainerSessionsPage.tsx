import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Spinner, Table } from 'react-bootstrap';
import { fetchTrainerBudgets } from '../../api/trainer';
import type { TrainerBudget } from '../../api/trainer';
import { TRAINER_BUDGETS_QUERY_KEY } from './queryKeys';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_TIME_FORMATTER.format(date);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Se produjo un error desconocido.';
  }
  if (typeof error === 'string' && error.trim().length) {
    return error.trim();
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Se produjo un error desconocido.';
  }
}

function toTimestamp(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

export type TrainerSessionRow = {
  id: string;
  title: string | null;
  start: string | null;
  end: string | null;
  address: string | null;
  product: string | null;
};

export function buildTrainerSessionRows(budgets: TrainerBudget[]): TrainerSessionRow[] {
  const map = new Map<string, TrainerSessionRow>();

  budgets.forEach((budget) => {
    const sessions = Array.isArray(budget.sessions) ? budget.sessions : [];
    sessions.forEach((session) => {
      const rawId = typeof session.id === 'string' ? session.id : '';
      const id = rawId.trim();
      if (!id) return;

      const existing = map.get(id);
      if (existing) {
        // Keep the earliest session data if duplicated across deals.
        const existingTime = toTimestamp(existing.start);
        const candidateTime = toTimestamp(session.start);
        if (candidateTime >= existingTime) {
          return;
        }
      }

      map.set(id, {
        id,
        title: session.title ?? null,
        start: session.start ?? null,
        end: session.end ?? null,
        address: session.address ?? budget.trainingAddress ?? null,
        product: session.product?.name ?? session.product?.code ?? null,
      });
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    const diff = toTimestamp(a.start) - toTimestamp(b.start);
    if (diff !== 0) return diff;
    const titleA = (a.title ?? '').toLocaleLowerCase();
    const titleB = (b.title ?? '').toLocaleLowerCase();
    if (titleA && titleB) return titleA.localeCompare(titleB);
    if (titleA) return -1;
    if (titleB) return 1;
    return 0;
  });
}

export function TrainerSessionsPage() {
  const budgetsQuery = useQuery({ queryKey: TRAINER_BUDGETS_QUERY_KEY, queryFn: fetchTrainerBudgets });

  if (budgetsQuery.isLoading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  if (budgetsQuery.error) {
    return <Alert variant="danger">{getErrorMessage(budgetsQuery.error)}</Alert>;
  }

  const sessions = useMemo(() => buildTrainerSessionRows(budgetsQuery.data ?? []), [budgetsQuery.data]);

  if (!sessions.length) {
    return (
      <Alert variant="info" className="mb-0">
        Todavía no tienes sesiones asignadas.
      </Alert>
    );
  }

  return (
    <section className="d-grid gap-4">
      <header className="d-grid gap-2">
        <h1 className="h3 fw-bold mb-0">Sesiones asignadas</h1>
        <p className="text-muted mb-0">Consulta las sesiones de formación que tienes programadas.</p>
      </header>

      <Table responsive hover className="shadow-sm">
        <thead>
          <tr>
            <th>SESIÓN</th>
            <th>FECHA INICIO</th>
            <th>FECHA FIN</th>
            <th>DIRECCIÓN</th>
            <th>FORMACIÓN</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const start = formatDate(session.start);
            const end = formatDate(session.end);
            return (
              <tr key={session.id}>
                <td>{session.title ?? '—'}</td>
                <td>{start ?? '—'}</td>
                <td>{end ?? '—'}</td>
                <td>{session.address ?? '—'}</td>
                <td>{session.product ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </section>
  );
}

