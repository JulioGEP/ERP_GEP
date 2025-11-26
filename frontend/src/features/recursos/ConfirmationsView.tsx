// frontend/src/features/recursos/ConfirmationsView.tsx
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import {
  RESOURCES_CONFIRMATIONS_QUERY_KEY,
  fetchResourcesConfirmations,
  type ResourcesConfirmationsResponse,
  type SessionConfirmationRow,
  type SessionPipelineType,
  type TrainerInviteStatus,
  type VariantConfirmationRow,
} from './confirmations.api';

export type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type ConfirmationsViewProps = {
  onNotify?: (toast: ToastParams) => void;
};

const STATUS_VARIANTS: Record<TrainerInviteStatus, { label: string; bg: string; text?: string }> = {
  PENDING: { label: 'Pendiente', bg: 'warning', text: 'dark' },
  CONFIRMED: { label: 'Confirmada', bg: 'success' },
  DECLINED: { label: 'Rechazada', bg: 'danger' },
};

const PIPELINE_LABELS: Record<SessionPipelineType, string> = {
  FORMACION_EMPRESA: 'Formación empresa',
  GEP_SERVICES: 'GEP Services',
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function normalizeDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function matchesDateRange(value: string | null, start: string, end: string): boolean {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return true;

  if (start) {
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    if (normalized < startDate) return false;
  }

  if (end) {
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);
    if (normalized > endDate) return false;
  }

  return true;
}

function StatusBadge({ status }: { status: TrainerInviteStatus }) {
  const config = STATUS_VARIANTS[status];
  return (
    <Badge bg={config.bg} text={config.text} pill>
      {config.label}
    </Badge>
  );
}

function TrainerCell({ name, email }: { name: string | null; email: string | null }) {
  return (
    <div>
      <div className="fw-semibold">{name ?? '—'}</div>
      <div className="text-muted small">{email ?? 'Sin email'}</div>
    </div>
  );
}

function SessionCell({ sessionTitle, pipelineLabel, dealId, productName }: SessionConfirmationRow) {
  return (
    <div>
      <div className="fw-semibold">{sessionTitle ?? 'Sesión sin nombre'}</div>
      <div className="text-muted small">
        {pipelineLabel ?? 'Pipeline sin nombre'} · {dealId ?? 'Sin deal'}
      </div>
      {productName ? <div className="text-muted small">{productName}</div> : null}
    </div>
  );
}

function VariantCell({ variantName, productName, site }: VariantConfirmationRow) {
  return (
    <div>
      <div className="fw-semibold">{variantName ?? 'Variante sin nombre'}</div>
      <div className="text-muted small">{productName ?? 'Sin producto asociado'}</div>
      <div className="text-muted small">{site ?? 'Sede por confirmar'}</div>
    </div>
  );
}

export function ConfirmationsView({ onNotify }: ConfirmationsViewProps) {
  const query = useQuery<ResourcesConfirmationsResponse, Error>({
    queryKey: RESOURCES_CONFIRMATIONS_QUERY_KEY,
    queryFn: fetchResourcesConfirmations,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (query.isError && onNotify) {
      onNotify({
        variant: 'danger',
        message: query.error?.message ?? 'No se pudieron cargar las confirmaciones.',
      });
    }
  }, [onNotify, query.error, query.isError]);

  const isLoading = query.isLoading;
  const isRefreshing = query.isFetching && !query.isLoading;
  const sessionInvites = query.data?.sessionInvites ?? [];
  const variantInvites = query.data?.variantInvites ?? [];
  const generatedAt = query.data?.generatedAt ?? null;

  const [selectedStatuses, setSelectedStatuses] = useState<TrainerInviteStatus[]>([
    'PENDING',
    'CONFIRMED',
    'DECLINED',
  ]);
  const [selectedTrainers, setSelectedTrainers] = useState<string[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hidePastSessions, setHidePastSessions] = useState(true);

  const trainerOptions = useMemo(() => {
    const options = new Map<string, string>();
    const addOption = (invite: { trainerId: string | null; trainerEmail: string | null; trainerName: string | null }) => {
      const key = invite.trainerId ?? invite.trainerEmail ?? invite.trainerName ?? '';
      if (!key) return;
      const label = invite.trainerName ?? invite.trainerEmail ?? 'Formador sin nombre';
      options.set(key, label);
    };

    sessionInvites.forEach(addOption);
    variantInvites.forEach(addOption);

    return Array.from(options.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [sessionInvites, variantInvites]);

  const sessionOptions = useMemo(
    () =>
      Array.from(
        sessionInvites.reduce((acc, invite) => {
          acc.set(invite.sessionId, invite.sessionTitle ?? 'Sesión sin nombre');
          return acc;
        }, new Map<string, string>()),
      )
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
    [sessionInvites],
  );

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const filteredSessionInvites = useMemo(
    () =>
      sessionInvites.filter((invite) => {
        if (!selectedStatuses.includes(invite.status)) return false;

        const sessionDate = normalizeDateOnly(invite.startDate);
        if (
          hidePastSessions &&
          invite.status === 'CONFIRMED' &&
          sessionDate &&
          today &&
          sessionDate < today
        ) {
          return false;
        }

        if (!matchesDateRange(invite.startDate, startDate, endDate)) return false;

        if (selectedTrainers.length) {
          const key = invite.trainerId ?? invite.trainerEmail ?? invite.trainerName ?? '';
          if (!key || !selectedTrainers.includes(key)) return false;
        }

        if (selectedSessions.length && !selectedSessions.includes(invite.sessionId)) return false;

        return true;
      }),
    [endDate, hidePastSessions, selectedSessions, selectedStatuses, selectedTrainers, sessionInvites, startDate, today],
  );

  const filteredVariantInvites = useMemo(
    () =>
      variantInvites.filter((invite) => {
        if (!selectedStatuses.includes(invite.status)) return false;

        if (!matchesDateRange(invite.date, startDate, endDate)) return false;

        if (selectedTrainers.length) {
          const key = invite.trainerId ?? invite.trainerEmail ?? invite.trainerName ?? '';
          if (!key || !selectedTrainers.includes(key)) return false;
        }

        return true;
      }),
    [endDate, selectedStatuses, selectedTrainers, startDate, variantInvites],
  );

  const summary = useMemo(() => {
    const countByStatus = (rows: Array<{ status: TrainerInviteStatus }>) => ({
      pending: rows.filter((row) => row.status === 'PENDING').length,
      confirmed: rows.filter((row) => row.status === 'CONFIRMED').length,
      declined: rows.filter((row) => row.status === 'DECLINED').length,
    });
    const sessions = countByStatus(filteredSessionInvites);
    const variants = countByStatus(filteredVariantInvites);
    return {
      pending: sessions.pending + variants.pending,
      confirmed: sessions.confirmed + variants.confirmed,
      declined: sessions.declined + variants.declined,
      sessions,
      variants,
    };
  }, [filteredSessionInvites, filteredVariantInvites]);

  return (
    <div className="py-3">
      <div className="d-flex flex-wrap justify-content-between gap-3 align-items-start">
        <div>
          <h1 className="h3 mb-1">Confirmaciones de formadores</h1>
          <p className="text-muted mb-0">
            Seguimiento del estado de las invitaciones enviadas a formadores para sesiones y formación abierta.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          {isRefreshing ? (
            <>
              <Spinner animation="border" size="sm" role="status" />
              <span className="text-muted small">Actualizando…</span>
            </>
          ) : null}
          <Button
            variant="outline-primary"
            size="sm"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            Actualizar
          </Button>
        </div>
      </div>

      <div className="d-flex flex-wrap gap-3 align-items-center mt-3">
        <div className="text-muted small">Última actualización: {formatDateTime(generatedAt)}</div>
        <Badge bg="warning" text="dark">
          Pendientes: {summary.pending}
        </Badge>
        <Badge bg="success">Confirmadas: {summary.confirmed}</Badge>
        <Badge bg="danger">Rechazadas: {summary.declined}</Badge>
      </div>

      <div className="mt-4 border rounded p-3 bg-light">
        <div className="d-flex flex-wrap justify-content-between gap-3 mb-3 align-items-center">
          <h2 className="h6 mb-0">Filtros</h2>
          <div className="d-flex flex-wrap gap-2">
            <Button
              variant={hidePastSessions ? 'primary' : 'outline-primary'}
              size="sm"
              active={hidePastSessions}
              onClick={() => setHidePastSessions((value) => !value)}
            >
              Ocultar pasadas
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => {
                setSelectedStatuses(['PENDING', 'CONFIRMED', 'DECLINED']);
                setSelectedTrainers([]);
                setSelectedSessions([]);
                setStartDate('');
                setEndDate('');
                setHidePastSessions(true);
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        </div>

        <div className="row g-3">
          <div className="col-12 col-lg-3">
            <Form.Group controlId="filter-status">
              <Form.Label className="fw-semibold">Estado</Form.Label>
              <div className="d-flex flex-wrap gap-2">
                {(
                  [
                    { value: 'PENDING', label: 'Pendiente' },
                    { value: 'CONFIRMED', label: 'Confirmada' },
                    { value: 'DECLINED', label: 'Rechazada' },
                  ] as const
                ).map(({ value, label }) => (
                  <Form.Check
                    key={value}
                    inline
                    type="checkbox"
                    id={`status-${value}`}
                    label={label}
                    checked={selectedStatuses.includes(value)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelectedStatuses((current) => {
                        if (checked) {
                          if (current.includes(value as TrainerInviteStatus)) return current;
                          return [...current, value as TrainerInviteStatus];
                        }
                        return current.filter((status) => status !== value);
                      });
                    }}
                  />
                ))}
              </div>
            </Form.Group>
          </div>

          <div className="col-12 col-lg-3">
            <Form.Group controlId="filter-dates">
              <Form.Label className="fw-semibold">Fecha</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  aria-label="Fecha inicio"
                />
                <Form.Control
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  aria-label="Fecha fin"
                />
              </div>
              <div className="text-muted small mt-1">Filtra por fecha de sesión o variante.</div>
            </Form.Group>
          </div>

          <div className="col-12 col-lg-3">
            <Form.Group controlId="filter-trainers">
              <Form.Label className="fw-semibold">Formadores</Form.Label>
              <Form.Select
                multiple
                value={selectedTrainers}
                onChange={(event) =>
                  setSelectedTrainers(Array.from(event.target.selectedOptions, (option) => option.value))
                }
              >
                {trainerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>

          <div className="col-12 col-lg-3">
            <Form.Group controlId="filter-sessions">
              <Form.Label className="fw-semibold">Sesiones</Form.Label>
              <Form.Select
                multiple
                value={selectedSessions}
                onChange={(event) =>
                  setSelectedSessions(Array.from(event.target.selectedOptions, (option) => option.value))
                }
              >
                {sessionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>
        </div>
      </div>

      {query.isError ? (
        <Alert variant="danger" className="mt-3">
          {query.error?.message ?? 'No se pudieron cargar las confirmaciones.'}
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="text-center py-5">
          <Spinner animation="border" role="status" />
          <div className="text-muted mt-3">Cargando confirmaciones…</div>
        </div>
      ) : (
        <>
          <section className="mt-4">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h2 className="h5 mb-0">Sesiones (Formación empresa / GEP Services)</h2>
              <Badge bg="warning" text="dark">
                Pendientes: {summary.sessions.pending}
              </Badge>
            </div>
            {filteredSessionInvites.length === 0 ? (
              <p className="text-muted fst-italic mt-3">No hay confirmaciones registradas para sesiones.</p>
            ) : (
              <div className="table-responsive mt-3">
                <Table striped hover responsive className="align-middle">
                  <thead>
                    <tr>
                      <th>Sesión</th>
                      <th>Pipeline</th>
                      <th>Fecha</th>
                      <th>Formador</th>
                      <th>Estado</th>
                      <th>Enviado</th>
                      <th>Respuesta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessionInvites.map((invite) => (
                      <tr key={invite.inviteId}>
                        <td>
                          <SessionCell {...invite} />
                        </td>
                        <td>{PIPELINE_LABELS[invite.pipelineType]}</td>
                        <td>{formatDateTime(invite.startDate)}</td>
                        <td>
                          <TrainerCell name={invite.trainerName} email={invite.trainerEmail} />
                        </td>
                        <td>
                          <StatusBadge status={invite.status} />
                        </td>
                        <td>{formatDateTime(invite.sentAt)}</td>
                        <td>{formatDateTime(invite.respondedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </section>

          <section className="mt-4">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h2 className="h5 mb-0">Formación abierta</h2>
              <Badge bg="warning" text="dark">
                Pendientes: {summary.variants.pending}
              </Badge>
            </div>
            {filteredVariantInvites.length === 0 ? (
              <p className="text-muted fst-italic mt-3">No hay confirmaciones registradas para variantes.</p>
            ) : (
              <div className="table-responsive mt-3">
                <Table striped hover responsive className="align-middle">
                  <thead>
                    <tr>
                      <th>Formación Abierta</th>
                      <th>Formador</th>
                      <th>Estado</th>
                      <th>Formación</th>
                      <th>Enviado</th>
                      <th>Respuesta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVariantInvites.map((invite) => (
                      <tr key={invite.inviteId}>
                        <td>
                          <VariantCell {...invite} />
                        </td>
                        <td>
                          <TrainerCell name={invite.trainerName} email={invite.trainerEmail} />
                        </td>
                        <td>
                          <StatusBadge status={invite.status} />
                        </td>
                        <td>{formatDateTime(invite.date)}</td>
                        <td>{formatDateTime(invite.sentAt)}</td>
                        <td>{formatDateTime(invite.respondedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
