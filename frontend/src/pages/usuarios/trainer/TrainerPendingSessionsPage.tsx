import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Spinner, Stack, Table } from 'react-bootstrap';
import {
  fetchTrainerSessions,
  type TrainerSessionDetail,
  type TrainerSessionsDateEntry,
} from '../../../api/trainer-sessions';

const QUERY_KEY = ['trainer', 'sessions'] as const;

type PendingSessionRow = {
  session: TrainerSessionDetail;
  dateEntry: TrainerSessionsDateEntry;
  sortValue: number;
};

function toTimestamp(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function computeSortValue(session: TrainerSessionDetail, dateEntry: TrainerSessionsDateEntry): number {
  const start = toTimestamp(session.startDate);
  if (start !== null) return start;
  const end = toTimestamp(session.endDate);
  if (end !== null) return end;
  const fallback = dateEntry.date ? new Date(`${dateEntry.date}T00:00:00Z`) : null;
  if (fallback && !Number.isNaN(fallback.getTime())) {
    return fallback.getTime();
  }
  return Number.MAX_SAFE_INTEGER;
}

function formatDatePart(value: string | null, options: Intl.DateTimeFormatOptions): string | null {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-ES', options).format(date);
  } catch {
    return null;
  }
}

function formatFallbackDate(value: string | null): string | null {
  if (!value) return null;
  try {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date);
  } catch {
    return null;
  }
}

function formatSessionDateRange(
  session: TrainerSessionDetail,
  dateEntry: TrainerSessionsDateEntry,
): { label: string; tooltip: string } {
  const startDate = formatDatePart(session.startDate, { dateStyle: 'full', timeZone: 'Europe/Madrid' });
  const endDate = formatDatePart(session.endDate, { dateStyle: 'full', timeZone: 'Europe/Madrid' });
  const startTime = formatDatePart(session.startDate, { timeStyle: 'short', timeZone: 'Europe/Madrid' });
  const endTime = formatDatePart(session.endDate, { timeStyle: 'short', timeZone: 'Europe/Madrid' });

  if (startDate && startTime && endDate && endTime) {
    if (startDate === endDate) {
      const label = `${startDate}, ${startTime} – ${endTime}`;
      return { label, tooltip: label };
    }
    const label = `${startDate}, ${startTime} – ${endDate}, ${endTime}`;
    return { label, tooltip: label };
  }

  if (startDate && startTime) {
    const label = `${startDate}, ${startTime}`;
    return { label, tooltip: label };
  }

  if (startDate) {
    return { label: startDate, tooltip: startDate };
  }

  if (endDate && endTime) {
    const label = `${endDate}, ${endTime}`;
    return { label, tooltip: label };
  }

  if (endDate) {
    return { label: endDate, tooltip: endDate };
  }

  const fallback = formatFallbackDate(dateEntry.date);
  if (fallback) {
    return { label: fallback, tooltip: fallback };
  }

  return { label: 'Pendiente de programar', tooltip: 'Pendiente de programar' };
}

export default function TrainerPendingSessionsPage() {
  const sessionsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchTrainerSessions,
    staleTime: 5 * 60 * 1000,
  });

  const pendingSessions = useMemo<PendingSessionRow[]>(() => {
    const dates = sessionsQuery.data?.dates ?? [];
    const rows: PendingSessionRow[] = [];
    dates.forEach((dateEntry) => {
      dateEntry.sessions.forEach((session) => {
        if (session.trainerInviteStatus === 'PENDING') {
          rows.push({
            session,
            dateEntry,
            sortValue: computeSortValue(session, dateEntry),
          });
        }
      });
    });
    return rows.sort((a, b) => {
      if (a.sortValue === b.sortValue) {
        return a.session.sessionTitle?.localeCompare(b.session.sessionTitle ?? '') ?? 0;
      }
      return a.sortValue - b.sortValue;
    });
  }, [sessionsQuery.data?.dates]);

  const pendingCount = pendingSessions.length;

  return (
    <Stack gap={4} className="trainer-pending-sessions-page">
      <Card className="shadow-sm border-0">
        <Card.Body>
          <Stack gap={3}>
            <div>
              <h1 className="h3 fw-bold mb-0">Sesiones pendientes</h1>
              <p className="text-muted mb-0">
                Gestiona aquí las sesiones que todavía están pendientes de tu confirmación.
              </p>
            </div>
            <div className="d-flex flex-column flex-md-row gap-2 align-items-md-center">
              <div className="fw-semibold">Pendientes de respuesta: {sessionsQuery.isLoading ? '—' : pendingCount}</div>
              <div className="ms-md-auto">
                <Button
                  variant="outline-primary"
                  onClick={() => sessionsQuery.refetch()}
                  disabled={sessionsQuery.isFetching}
                >
                  Actualizar
                </Button>
              </div>
            </div>
          </Stack>
        </Card.Body>
      </Card>

      {sessionsQuery.isLoading ? (
        <Card className="shadow-sm border-0">
          <Card.Body className="d-flex align-items-center gap-2">
            <Spinner animation="border" role="status" />
            <span>Cargando invitaciones pendientes…</span>
          </Card.Body>
        </Card>
      ) : null}

      {sessionsQuery.isError ? (
        <Alert variant="danger" className="d-flex flex-column flex-md-row align-items-md-center gap-3">
          <div>
            <div className="fw-semibold">No se pudieron cargar tus invitaciones pendientes.</div>
            <div className="small text-muted">Inténtalo de nuevo más tarde.</div>
          </div>
          <div className="ms-md-auto">
            <Button
              variant="outline-danger"
              onClick={() => sessionsQuery.refetch()}
              disabled={sessionsQuery.isFetching}
            >
              Reintentar
            </Button>
          </div>
        </Alert>
      ) : null}

      {!sessionsQuery.isLoading && !sessionsQuery.isError ? (
        <Card className="shadow-sm border-0">
          <Card.Body className="p-0">
            {pendingSessions.length ? (
              <div className="table-responsive">
                <Table hover responsive className="mb-0">
                  <thead className="text-uppercase small text-muted">
                    <tr>
                      <th className="fw-semibold">Fecha y hora</th>
                      <th className="fw-semibold">Sesión</th>
                      <th className="fw-semibold">Cliente</th>
                      <th className="fw-semibold">Ubicación</th>
                      <th className="fw-semibold text-end">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingSessions.map(({ session, dateEntry }) => {
                      const dateDisplay = formatSessionDateRange(session, dateEntry);
                      const inviteUrl = session.trainerInviteToken
                        ? session.trainerInviteType === 'VARIANT'
                          ? `/public/formadores/variantes/${session.trainerInviteToken}`
                          : `/public/formadores/sesiones/${session.trainerInviteToken}`
                        : null;
                      return (
                        <tr key={`${session.sessionId}-${session.trainerInviteToken ?? 'no-token'}`}>
                          <td className="align-middle" title={dateDisplay.tooltip}>
                            {dateDisplay.label}
                          </td>
                          <td className="align-middle">
                            <div className="fw-semibold">
                              {session.sessionTitle ?? 'Sesión'}
                            </div>
                            {session.formationName ? (
                              <div className="text-muted small">{session.formationName}</div>
                            ) : null}
                          </td>
                          <td className="align-middle">
                            {session.organizationName ?? <span className="text-muted">—</span>}
                          </td>
                          <td className="align-middle">
                            {session.address ?? <span className="text-muted">Pendiente</span>}
                          </td>
                          <td className="align-middle text-end">
                            {inviteUrl ? (
                              <Button
                                href={inviteUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                size="sm"
                              >
                                Revisar invitación
                              </Button>
                            ) : (
                              <span className="text-muted small">Token no disponible</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            ) : (
              <div className="px-3 px-md-4 py-5 text-center text-muted">
                No tienes sesiones pendientes de confirmar.
              </div>
            )}
          </Card.Body>
        </Card>
      ) : null}
    </Stack>
  );
}
