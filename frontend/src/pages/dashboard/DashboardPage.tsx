// frontend/src/pages/dashboard/DashboardPage.tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Spinner, Stack } from 'react-bootstrap';
import { fetchDashboardMetrics, type DashboardMetrics } from '../../api/dashboard';
import type { ApiError } from '../../api/client';

const QUERY_KEY = ['dashboard', 'metrics'] as const;

const EMPTY_METRICS: DashboardMetrics = {
  sessions: { borrador: 0, suspendida: 0, porFinalizar: 0 },
  followUp: {
    caesPorTrabajar: 0,
    fundaePorTrabajar: 0,
    hotelPorTrabajar: 0,
    poPorTrabajar: 0,
    transportePorTrabajar: 0,
  },
  generatedAt: null,
};

type MetricCardProps = {
  title: string;
  value: number;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'secondary';
  description?: string;
};

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

function MetricCard({ title, value, accent = 'primary', description }: MetricCardProps) {
  return (
    <Card className="h-100 border-0 shadow-sm">
      <Card.Body className="d-flex flex-column gap-2">
        <span className="text-uppercase text-muted fw-semibold small">{title}</span>
        <span className={`display-6 fw-bold text-${accent}`}>{formatNumber(value)}</span>
        {description ? <span className="text-muted small">{description}</span> : null}
      </Card.Body>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<
    DashboardMetrics,
    ApiError
  >({
    queryKey: QUERY_KEY,
    queryFn: fetchDashboardMetrics,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const hasMetrics = Boolean(data);
  const metrics = data ?? EMPTY_METRICS;

  const lastUpdatedLabel = useMemo(() => formatUpdatedAt(metrics.generatedAt), [
    metrics.generatedAt,
  ]);

  return (
    <Stack gap={4}>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h1 className="h3 mb-1">Dashboard</h1>
          <p className="text-muted mb-0">
            Información clave para priorizar el trabajo pendiente y planificar las formaciones.
          </p>
        </div>
        <div className="d-flex flex-column flex-sm-row align-items-sm-center gap-2">
          {lastUpdatedLabel ? (
            <small className="text-muted">Actualizado: {lastUpdatedLabel}</small>
          ) : null}
          <Button
            variant="outline-primary"
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching}
          >
            {isFetching ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  className="me-2"
                />
                Actualizando...
              </>
            ) : (
              'Actualizar datos'
            )}
          </Button>
        </div>
      </div>

      {isError ? (
        <Alert variant="danger">
          No se pudieron cargar las métricas del dashboard.
          {error?.message ? <div className="mt-1 small">{error.message}</div> : null}
        </Alert>
      ) : null}

      {isLoading && !hasMetrics ? (
        <div className="py-5 text-center">
          <Spinner animation="border" role="status" />
          <p className="text-muted mt-3 mb-0">Cargando métricas...</p>
        </div>
      ) : null}

      {hasMetrics ? (
        <Stack gap={5}>
          <section>
            <h2 className="h5 mb-3">Sesiones</h2>
            <Row xs={1} md={3} className="g-4">
              <Col>
                <MetricCard
                  title="En borrador"
                  value={metrics.sessions.borrador}
                  accent="primary"
                  description="Sesiones aún pendientes de confirmar y planificar."
                />
              </Col>
              <Col>
                <MetricCard
                  title="Suspendidas"
                  value={metrics.sessions.suspendida}
                  accent="warning"
                  description="Sesiones pausadas que requieren revisar la replanificación."
                />
              </Col>
              <Col>
                <MetricCard
                  title="Por finalizar"
                  value={metrics.sessions.porFinalizar}
                  accent="danger"
                  description="Sesiones realizadas que todavía no se han marcado como finalizadas."
                />
              </Col>
            </Row>
          </section>

          <section>
            <h2 className="h5 mb-3">Presupuestos con gestiones pendientes</h2>
            <Row xs={1} sm={2} lg={3} xxl={5} className="g-4">
              <Col>
                <MetricCard
                  title="CAES por trabajar"
                  value={metrics.followUp.caesPorTrabajar}
                  accent="info"
                  description="Presupuestos con CAES pendiente de validar."
                />
              </Col>
              <Col>
                <MetricCard
                  title="FUNDAE por trabajar"
                  value={metrics.followUp.fundaePorTrabajar}
                  accent="primary"
                  description="Presupuestos con FUNDAE pendiente de validar."
                />
              </Col>
              <Col>
                <MetricCard
                  title="Hotel por trabajar"
                  value={metrics.followUp.hotelPorTrabajar}
                  accent="secondary"
                  description="Reservas de hotel que aún deben gestionarse."
                />
              </Col>
              <Col>
                <MetricCard
                  title="PO por trabajar"
                  value={metrics.followUp.poPorTrabajar}
                  accent="warning"
                  description="Pedidos de compra (PO) pendientes de validación."
                />
              </Col>
              <Col>
                <MetricCard
                  title="Transporte por trabajar"
                  value={metrics.followUp.transportePorTrabajar}
                  accent="danger"
                  description="Logística de transporte pendiente de confirmar."
                />
              </Col>
            </Row>
          </section>
        </Stack>
      ) : null}

      {!isLoading && !hasMetrics && !isError ? (
        <p className="text-muted mb-0">No hay métricas disponibles en este momento.</p>
      ) : null}
    </Stack>
  );
}

