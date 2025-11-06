import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Row, Spinner, Stack } from 'react-bootstrap';
import { fetchTrainerMetrics, fetchTrainerProfile } from '../../api/trainer';
import type { TrainerMetrics } from '../../api/trainer';
import { TRAINER_METRICS_QUERY_KEY, TRAINER_PROFILE_QUERY_KEY } from './queryKeys';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-ES').format(value);
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'full',
  timeStyle: 'short',
});

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_TIME_FORMATTER.format(date);
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="h-100 shadow-sm border-0">
      <Card.Body className="d-flex flex-column gap-2">
        <span className="text-uppercase text-muted fw-semibold small">{label}</span>
        <span className="display-6 fw-bold text-primary mb-0">{formatNumber(value)}</span>
      </Card.Body>
    </Card>
  );
}

function NextSessionCard({ metrics }: { metrics: TrainerMetrics }) {
  const next = metrics.nextSession;
  if (!next) {
    return (
      <Card className="h-100 shadow-sm border-0">
        <Card.Body className="d-flex flex-column justify-content-center align-items-start gap-2">
          <span className="text-uppercase text-muted fw-semibold small">Próxima sesión</span>
          <span className="fw-semibold">Sin sesiones próximas asignadas.</span>
        </Card.Body>
      </Card>
    );
  }

  const sessionDate = formatDateTime(next.start);
  const dealTitle = next.deal?.title ?? next.deal?.id ?? 'Presupuesto';

  return (
    <Card className="h-100 shadow-sm border-0">
      <Card.Body className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <span className="text-uppercase text-muted fw-semibold small">Próxima sesión</span>
          <h2 className="h5 fw-bold mb-0">{next.title ?? 'Sesión asignada'}</h2>
        </div>
        <Stack direction="vertical" gap={2} className="text-muted">
          {sessionDate ? <span>{sessionDate}</span> : null}
          {dealTitle ? <span>Presupuesto: {dealTitle}</span> : null}
          {next.estado ? <span className="badge bg-primary-subtle text-primary">Estado: {next.estado}</span> : null}
        </Stack>
      </Card.Body>
    </Card>
  );
}

export function TrainerDashboardPage() {
  const profileQuery = useQuery({ queryKey: TRAINER_PROFILE_QUERY_KEY, queryFn: fetchTrainerProfile });
  const metricsQuery = useQuery({ queryKey: TRAINER_METRICS_QUERY_KEY, queryFn: fetchTrainerMetrics });

  const isLoading = profileQuery.isLoading || metricsQuery.isLoading;
  const hasError = profileQuery.error || metricsQuery.error;

  const trainerName = useMemo(() => {
    const profile = profileQuery.data;
    if (!profile) return 'Formador';
    const parts = [profile.name, profile.apellido].map((value) => (value ?? '').trim()).filter(Boolean);
    if (parts.length) {
      return parts.join(' ');
    }
    if (profile.email) {
      return profile.email;
    }
    return 'Formador';
  }, [profileQuery.data]);

  const metrics = metricsQuery.data;

  return (
    <section className="d-grid gap-4">
      <header className="d-grid gap-2">
        <h1 className="h3 fw-bold mb-0">Bienvenido, {trainerName}</h1>
        <p className="text-muted mb-0">
          Consulta de un vistazo las métricas de tus sesiones asignadas y mantente al día de tu próxima formación.
        </p>
      </header>

      {hasError ? (
        <Alert variant="danger">
          No se pudieron cargar los datos del formador. Inténtalo de nuevo más tarde.
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="d-flex justify-content-center py-5">
          <Spinner animation="border" role="status" />
        </div>
      ) : null}

      {!isLoading && metrics ? (
        <Row className="g-3">
          <Col xs={12} sm={6} xl={3}>
            <MetricCard label="Sesiones planificadas" value={metrics.plannedSessions} />
          </Col>
          <Col xs={12} sm={6} xl={3}>
            <MetricCard label="Sesiones asignadas" value={metrics.totalAssignedSessions} />
          </Col>
          <Col xs={12} sm={6} xl={3}>
            <MetricCard label="Próximas sesiones" value={metrics.upcomingSessions} />
          </Col>
          <Col xs={12} sm={6} xl={3}>
            <NextSessionCard metrics={metrics} />
          </Col>
        </Row>
      ) : null}
    </section>
  );
}

