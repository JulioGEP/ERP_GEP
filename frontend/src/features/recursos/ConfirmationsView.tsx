// frontend/src/features/recursos/ConfirmationsView.tsx
import { useEffect, useMemo } from 'react';
import { Alert, Badge, Button, Spinner, Table } from 'react-bootstrap';
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

  const summary = useMemo(() => {
    const countByStatus = (rows: Array<{ status: TrainerInviteStatus }>) => ({
      pending: rows.filter((row) => row.status === 'PENDING').length,
      confirmed: rows.filter((row) => row.status === 'CONFIRMED').length,
      declined: rows.filter((row) => row.status === 'DECLINED').length,
    });
    const sessions = countByStatus(sessionInvites);
    const variants = countByStatus(variantInvites);
    return {
      pending: sessions.pending + variants.pending,
      confirmed: sessions.confirmed + variants.confirmed,
      declined: sessions.declined + variants.declined,
      sessions,
      variants,
    };
  }, [sessionInvites, variantInvites]);

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
            {sessionInvites.length === 0 ? (
              <p className="text-muted fst-italic mt-3">No hay confirmaciones registradas para sesiones.</p>
            ) : (
              <div className="table-responsive mt-3">
                <Table striped hover responsive className="align-middle">
                  <thead>
                    <tr>
                      <th>Sesión</th>
                      <th>Pipeline</th>
                      <th>Formador</th>
                      <th>Estado</th>
                      <th>Enviado</th>
                      <th>Respuesta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionInvites.map((invite) => (
                      <tr key={invite.inviteId}>
                        <td>
                          <SessionCell {...invite} />
                        </td>
                        <td>{PIPELINE_LABELS[invite.pipelineType]}</td>
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
              <h2 className="h5 mb-0">Formación abierta (Variantes)</h2>
              <Badge bg="warning" text="dark">
                Pendientes: {summary.variants.pending}
              </Badge>
            </div>
            {variantInvites.length === 0 ? (
              <p className="text-muted fst-italic mt-3">No hay confirmaciones registradas para variantes.</p>
            ) : (
              <div className="table-responsive mt-3">
                <Table striped hover responsive className="align-middle">
                  <thead>
                    <tr>
                      <th>Variante</th>
                      <th>Formador</th>
                      <th>Estado</th>
                      <th>Formación</th>
                      <th>Enviado</th>
                      <th>Respuesta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variantInvites.map((invite) => (
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
