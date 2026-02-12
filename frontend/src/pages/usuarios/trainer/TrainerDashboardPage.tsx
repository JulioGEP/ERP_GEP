// frontend/src/pages/usuarios/trainer/TrainerDashboardPage.tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Spinner, Stack, Table } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { fetchTrainerDashboard } from '../../../api/trainer-dashboard';
import type { TrainerDashboardResponse } from '../../../api/trainer-dashboard';
import { fetchTrainerSessions } from '../../../api/trainer-sessions';

const QUERY_KEY = ['trainer', 'dashboard'] as const;
const TRAINER_SESSIONS_QUERY_KEY = ['trainer', 'sessions'] as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-ES').format(value);
}

function formatUpdatedAt(value: string | null): string | null {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return null;
  }
}

function MobileUnitsList({ units }: { units: TrainerDashboardResponse['sessions'][number]['mobileUnits'] }) {
  if (!units.length) {
    return <span className="text-muted">—</span>;
  }

  const formatted = units
    .map((unit) => {
      const parts: string[] = [];
      if (unit.name) parts.push(unit.name);
      if (unit.plate) parts.push(unit.plate);
      return parts.join(' · ') || unit.id;
    })
    .join(', ');

  return <span>{formatted}</span>;
}

function formatVariantDate(value: string | null): string | null {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date);
  } catch {
    return null;
  }
}

function VariantMobileUnit({
  unit,
}: {
  unit: TrainerDashboardResponse['variants'][number]['mobileUnit'];
}) {
  if (!unit) {
    return <span className="text-muted">—</span>;
  }

  const parts: string[] = [];
  if (unit.name) parts.push(unit.name);
  if (unit.plate) parts.push(unit.plate);
  if (!parts.length) parts.push(unit.id);

  return <span>{parts.join(' · ')}</span>;
}

export default function TrainerDashboardPage() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchTrainerDashboard(),
    staleTime: 5 * 60 * 1000,
  });
  const trainerSessionsQuery = useQuery({
    queryKey: TRAINER_SESSIONS_QUERY_KEY,
    queryFn: fetchTrainerSessions,
    staleTime: 5 * 60 * 1000,
  });

  const updatedAt = useMemo(() => formatUpdatedAt(query.data?.generatedAt ?? null), [query.data?.generatedAt]);
  const pendingConfirmationsFromSessions = useMemo(() => {
    const dates = trainerSessionsQuery.data?.dates;
    if (!dates) return null;
    let count = 0;
    dates.forEach((dateEntry) => {
      dateEntry.sessions.forEach((session) => {
        if (session.trainerInviteStatus === 'PENDING') {
          count += 1;
        }
      });
    });
    return count;
  }, [trainerSessionsQuery.data?.dates]);
  const pendingConfirmationsFromDashboard = query.data?.metrics.pendingConfirmations;
  const pendingConfirmationsNumber =
    pendingConfirmationsFromSessions ?? (typeof pendingConfirmationsFromDashboard === 'number' ? pendingConfirmationsFromDashboard : null);
  const pendingConfirmations = pendingConfirmationsNumber ?? 0;

  const handleSessionNavigation = (sessionId: string) => {
    navigate('/usuarios/trainer/sesiones', { state: { trainerSessionId: sessionId } });
  };

  const handleVariantNavigation = (variantId: string) => {
    navigate('/usuarios/trainer/sesiones', { state: { trainerVariantId: variantId } });
  };

  return (
    <Stack gap={4} className="trainer-dashboard">

      {query.isLoading ? (
        <div className="d-flex justify-content-center py-5" aria-live="polite">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Cargando…</span>
          </Spinner>
        </div>
      ) : query.isError ? (
        <Alert variant="danger" className="d-flex flex-column flex-md-row align-items-md-center gap-3">
          <div>
            <div className="fw-semibold">No se pudieron cargar los datos del panel.</div>
            <div className="small text-muted">Inténtalo de nuevo más tarde.</div>
          </div>
          <div className="ms-md-auto">
            <Button variant="outline-danger" onClick={() => query.refetch()} disabled={query.isFetching}>
              Reintentar
            </Button>
          </div>
        </Alert>
      ) : query.data ? (
        <Stack gap={4}>
          <Card className="shadow-sm border-0">
            <Card.Body className="d-flex flex-column flex-md-row align-items-start align-items-md-center gap-3">
              <div className="flex-grow-1">
                <div className="d-flex align-items-center gap-2">
                  <span className="text-uppercase text-muted small fw-semibold">Sesiones asignadas</span>
                  <Button
                    variant={pendingConfirmations ? 'outline-warning' : 'outline-secondary'}
                    size="sm"
                    className="text-nowrap"
                    onClick={() => navigate('/usuarios/trainer/pendientes')}
                    disabled={!query.data}
                  >
                    Pendientes: {pendingConfirmationsNumber === null ? '—' : formatNumber(pendingConfirmationsNumber)}
                  </Button>
                </div>
                <div className="display-6 fw-bold text-primary">{formatNumber(query.data.metrics.totalAssigned)}</div>
                <div className="text-muted small">
                  Formaciones Empresa: {formatNumber(query.data.metrics.companySessions)} · Preventivos:{' '}
                  {formatNumber(query.data.metrics.gepServicesSessions)} · Formación Abierta:
                  {` ${formatNumber(query.data.metrics.openTrainingVariants)}`}
                </div>
              </div>
              <div className="d-flex flex-column align-items-start align-items-md-end gap-1">
                <Button variant="outline-primary" onClick={() => query.refetch()} disabled={query.isFetching}>
                  Actualizar
                </Button>
                {updatedAt ? <span className="text-muted small">Última actualización: {updatedAt}</span> : null}
              </div>
            </Card.Body>
          </Card>

          <Card className="shadow-sm border-0">
            <Card.Body className="p-0">
              <div className="d-flex justify-content-between align-items-center px-3 px-md-4 py-3 border-bottom">
                <div>
                  <span className="text-uppercase text-muted small fw-semibold">Sesiones</span>
                  <h2 className="h5 mb-0">Planificación asignada</h2>
                </div>
                <div>
                  <Button size="sm" variant="outline-secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
                    Refrescar
                  </Button>
                </div>
              </div>
              {query.data.sessions.length ? (
                <div className="table-responsive">
                  <Table hover responsive className="mb-0">
                    <thead className="text-uppercase small text-muted">
                      <tr>
                        <th className="fw-semibold">Nº Presupuesto</th>
                        <th className="fw-semibold">Título de la sesión</th>
                        <th className="fw-semibold">Formación</th>
                        <th className="fw-semibold">Dirección</th>
                        <th className="fw-semibold">Unidad móvil</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.sessions.map((session) => (
                        <tr
                          key={session.sessionId}
                          role="button"
                          tabIndex={0}
                          className="table-row-action"
                          onClick={() => handleSessionNavigation(session.sessionId)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleSessionNavigation(session.sessionId);
                            }
                          }}
                        >
                          <td className="align-middle text-nowrap">{session.budgetNumber ?? <span className="text-muted">—</span>}</td>
                          <td className="align-middle">{session.sessionTitle ?? <span className="text-muted">—</span>}</td>
                          <td className="align-middle">{session.productName ?? <span className="text-muted">—</span>}</td>
                          <td className="align-middle">{session.address ?? <span className="text-muted">—</span>}</td>
                          <td className="align-middle">
                            <MobileUnitsList units={session.mobileUnits} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <div className="px-3 px-md-4 py-5 text-center text-muted">
                  No tienes sesiones asignadas en este momento.
                </div>
              )}
              <div className="px-3 px-md-4 py-3 border-top">
                <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-lg-between gap-2">
                  <div>
                    <span className="text-uppercase text-muted small fw-semibold">Formación abierta</span>
                  </div>
                  <div className="text-muted small">
                    Total: {formatNumber(query.data.metrics.openTrainingVariants)}
                  </div>
                </div>
              </div>
              {query.data.variants.length ? (
                <div className="table-responsive">
                  <Table hover responsive className="mb-0">
                    <thead className="text-uppercase small text-muted">
                      <tr>
                        <th className="fw-semibold">Formación</th>
                        <th className="fw-semibold">Sede</th>
                        <th className="fw-semibold">Fecha</th>
                        <th className="fw-semibold">Unidad móvil</th>
                        <th className="fw-semibold text-end">Alumnos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.variants.map((variant) => (
                        <tr
                          key={variant.variantId}
                          role="button"
                          tabIndex={0}
                          className="table-row-action"
                          onClick={() => handleVariantNavigation(variant.variantId)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleVariantNavigation(variant.variantId);
                            }
                          }}
                        >
                          <td className="align-middle">{variant.productName ?? <span className="text-muted">—</span>}</td>
                          <td className="align-middle">{variant.site ?? <span className="text-muted">—</span>}</td>
                          <td className="align-middle">
                            {formatVariantDate(variant.date) ?? <span className="text-muted">—</span>}
                          </td>
                          <td className="align-middle">
                            <VariantMobileUnit unit={variant.mobileUnit} />
                          </td>
                          <td className="align-middle text-end">{formatNumber(variant.studentCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <div className="px-3 px-md-4 py-5 text-center text-muted">
                  No tienes formaciones abiertas asignadas en este momento.
                </div>
              )}
            </Card.Body>
          </Card>
        </Stack>
      ) : null}
    </Stack>
  );
}
