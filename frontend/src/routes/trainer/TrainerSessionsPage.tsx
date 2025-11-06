import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Spinner, Table } from 'react-bootstrap';
import { fetchTrainerBudgets } from '../../api/trainer';
import type { TrainerBudget } from '../../api/trainer';
import { TRAINER_BUDGETS_QUERY_KEY } from './queryKeys';

const DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
});

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_ONLY_FORMATTER.format(date);
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_FORMATTER.format(date);
}

export type BudgetSummary = TrainerBudget & {
  sessionCount: number;
  nextSession: { title: string | null; start: string | null } | null;
};

export function enhanceBudgets(budgets: TrainerBudget[]): BudgetSummary[] {
  const now = Date.now();
  return budgets.map((budget) => {
    const sessions = Array.isArray(budget.sessions) ? budget.sessions : [];
    const sessionCount = sessions.length;
    const nextSession =
      sessions.find((session) => {
        if (!session.start) return false;
        const time = new Date(session.start).getTime();
        return Number.isFinite(time) && time >= now;
      }) ?? sessions[0] ?? null;

    const normalizedNextSession =
      nextSession && (nextSession.title || nextSession.start)
        ? { title: nextSession.title, start: nextSession.start }
        : null;

    return { ...budget, sessionCount, nextSession: normalizedNextSession };
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
    return <Alert variant="danger">No se pudo cargar el listado de presupuestos.</Alert>;
  }

  const budgets = useMemo(() => enhanceBudgets(budgetsQuery.data ?? []), [budgetsQuery.data]);

  if (!budgets.length) {
    return (
      <Alert variant="info" className="mb-0">
        Todavía no tienes presupuestos asignados.
      </Alert>
    );
  }

  return (
    <section className="d-grid gap-4">
      <header className="d-grid gap-2">
        <h1 className="h3 fw-bold mb-0">Presupuestos asignados</h1>
        <p className="text-muted mb-0">
          Revisa las sesiones vinculadas a cada presupuesto y prepara tus próximas formaciones.
        </p>
      </header>

      <div className="d-none d-lg-block">
        <Table responsive hover className="shadow-sm">
          <thead>
            <tr>
              <th>Presupuesto</th>
              <th>Negocio</th>
              <th>Próxima sesión</th>
              <th className="text-center">Sesiones</th>
              <th>Actualizado</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((budget) => {
              const nextSessionDate = formatDateTime(budget.nextSession?.start ?? null);
              return (
                <tr key={budget.dealId}>
                  <td>
                    <div className="fw-semibold">{budget.title ?? budget.dealId}</div>
                    <div className="text-muted small">ID: {budget.dealId}</div>
                  </td>
                  <td>
                    <div className="fw-semibold">{budget.pipeline ?? '—'}</div>
                    <div className="text-muted small">{budget.sedeLabel ?? budget.trainingAddress ?? '—'}</div>
                  </td>
                  <td>
                    {nextSessionDate ? (
                      <div className="d-flex flex-column">
                        <span className="fw-semibold">{nextSessionDate}</span>
                        {budget.nextSession?.title ? (
                          <span className="text-muted small">{budget.nextSession.title}</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted">Sin fecha</span>
                    )}
                  </td>
                  <td className="text-center fw-semibold">{budget.sessionCount}</td>
                  <td>{formatDate(budget.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      <div className="d-grid gap-3 d-lg-none">
        {budgets.map((budget) => {
          const nextSessionDate = formatDateTime(budget.nextSession?.start ?? null);
          return (
            <Card key={budget.dealId} className="shadow-sm border-0">
              <Card.Body className="d-flex flex-column gap-2">
                <div>
                  <span className="text-uppercase text-muted small fw-semibold">Presupuesto</span>
                  <h2 className="h5 fw-bold mb-0">{budget.title ?? budget.dealId}</h2>
                  <span className="text-muted small">ID: {budget.dealId}</span>
                </div>
                <div className="d-flex flex-column gap-1">
                  <span className="text-muted">
                    <strong>Negocio:</strong> {budget.pipeline ?? '—'}
                  </span>
                  <span className="text-muted">
                    <strong>Ubicación:</strong> {budget.sedeLabel ?? budget.trainingAddress ?? '—'}
                  </span>
                </div>
                <div className="d-flex flex-column gap-1">
                  <span className="text-muted">
                    <strong>Sesiones:</strong> {budget.sessionCount}
                  </span>
                  <span className="text-muted">
                    <strong>Actualizado:</strong> {formatDate(budget.updatedAt) ?? '—'}
                  </span>
                </div>
                <div className="d-flex flex-column gap-1">
                  <span className="text-muted">
                    <strong>Próxima sesión:</strong> {nextSessionDate ?? 'Sin fecha'}
                  </span>
                  {budget.nextSession?.title ? (
                    <span className="text-muted small">{budget.nextSession.title}</span>
                  ) : null}
                </div>
              </Card.Body>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

