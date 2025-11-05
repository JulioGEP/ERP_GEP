// frontend/src/pages/dashboard/DashboardPage.tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Spinner, Stack } from 'react-bootstrap';
import { fetchDashboardMetrics, type DashboardMetrics } from '../../api/dashboard';
import type { ApiError } from '../../api/client';

const QUERY_KEY = ['dashboard', 'metrics'] as const;

const EMPTY_METRICS: DashboardMetrics = {
  sessions: { borrador: 0, suspendida: 0, porFinalizar: 0, formacionAbiertaSinAsignar: 0 },
  followUp: {
    caesPorTrabajar: 0,
    fundaePorTrabajar: 0,
    hotelPorTrabajar: 0,
    poPorTrabajar: 0,
    transportePorTrabajar: 0,
  },
  generatedAt: null,
  tendencias: {
    sesionesVsVariantes: [],
  },
};

const NETLIFY_BASE_URL = 'https://erpgep.netlify.app';

const SESSION_CALENDAR_PATH = `${NETLIFY_BASE_URL}/calendario/por_sesiones`;
const UNWORKED_BUDGETS_PATH = `${NETLIFY_BASE_URL}/presupuestos/sintrabajar`;

const SESSION_DRAFTS_URL = `${SESSION_CALENDAR_PATH}?calendar-sessions__filter__estado=BORRADOR`;
const SESSION_SUSPENDED_URL = `${SESSION_CALENDAR_PATH}?calendar-sessions__filter__estado=SUSPENDIDA`;
const SESSION_PENDING_COMPLETION_URL =
  `${SESSION_CALENDAR_PATH}?calendar-sessions__filter__por_finalizar=S%C3%AD&calendar-sessions__filter__estado=PLANIFICADA`;
const OPEN_TRAINING_UNASSIGNED_VARIANTS_URL = (() => {
  const params = new URLSearchParams();
  params.set('calendar-sessions__filter__deal_pipeline_id', 'Formación Abierta');
  params.set('calendar-sessions__filter__trainer', 'Sin formador');
  params.set('calendar-sessions__filter__room', 'Sin sala asignada');
  return `${SESSION_CALENDAR_PATH}?${params.toString()}`;
})();

const BUDGETS_PENDING_CAES_URL =
  `${UNWORKED_BUDGETS_PATH}?budgets-table__filter__caes_label=S%C3%AD&budgets-table__filter__caes_val=Pendiente`;
const BUDGETS_PENDING_FUNDAE_URL =
  `${UNWORKED_BUDGETS_PATH}?budgets-table__filter__fundae_label=S%C3%AD&budgets-table__filter__fundae_val=Pendiente`;
const BUDGETS_PENDING_HOTEL_URL =
  `${UNWORKED_BUDGETS_PATH}?budgets-table__filter__hotel_label=S%C3%AD&budgets-table__filter__hotel_val=Pendiente`;
const BUDGETS_PENDING_PO_URL =
  `${UNWORKED_BUDGETS_PATH}?budgets-table__filter__po=S%C3%AD&budgets-table__filter__po_val=Pendiente`;
const BUDGETS_PENDING_TRANSPORT_URL =
  `${UNWORKED_BUDGETS_PATH}?budgets-table__filter__transporte=S%C3%AD&budgets-table__filter__transporte_val=Pendiente`;

type MetricCardProps = {
  title: string;
  value: number;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'secondary';
  description?: string;
  href?: string;
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

function MetricCard({ title, value, accent = 'primary', description, href }: MetricCardProps) {
  const card = (
    <Card className="h-100 border-0 shadow-sm">
      <Card.Body className="d-flex flex-column gap-2">
        <span className="text-uppercase text-muted fw-semibold small">{title}</span>
        <span className={`display-6 fw-bold text-${accent}`}>{formatNumber(value)}</span>
        {description ? <span className="text-muted small">{description}</span> : null}
      </Card.Body>
    </Card>
  );

  if (!href) {
    return card;
  }

  return (
    <a className="text-decoration-none text-reset d-block h-100" href={href}>
      {card}
    </a>
  );
}

type SessionsVariantsChartProps = {
  data: DashboardMetrics['tendencias']['sesionesVsVariantes'];
};

function SessionsVariantsChart({ data }: SessionsVariantsChartProps) {
  const chartHeight = 60;
  const chartWidth = 100;
  const padding = { top: 10, right: 4, bottom: 16, left: 10 } as const;
  const contentWidth = chartWidth - padding.left - padding.right;
  const contentHeight = chartHeight - padding.top - padding.bottom;
  const hasMultiplePoints = data.length > 1;
  const maxValue = data.reduce((max, point) => {
    return Math.max(max, point.totalSesiones, point.totalVariantesFormacionAbierta);
  }, 0);
  const safeMax = maxValue > 0 ? maxValue : 1;

  const getX = (index: number) => {
    if (!hasMultiplePoints) {
      return padding.left + contentWidth / 2;
    }
    const ratio = index / (data.length - 1);
    return padding.left + ratio * contentWidth;
  };

  const getY = (value: number) => {
    const ratio = value / safeMax;
    return padding.top + (1 - ratio) * contentHeight;
  };

  const buildPoints = (accessor: (point: SessionsVariantsChartProps['data'][number]) => number) =>
    data
      .map((point, index) => `${getX(index).toFixed(2)},${getY(accessor(point)).toFixed(2)}`)
      .join(' ');

  const sessionsPoints = buildPoints((point) => point.totalSesiones);
  const variantsPoints = buildPoints((point) => point.totalVariantesFormacionAbierta);

  const yTicks: number[] = [];
  if (maxValue <= 5) {
    for (let value = 0; value <= maxValue; value += 1) {
      yTicks.push(value);
    }
  } else {
    const divisions = 4;
    for (let step = 0; step <= divisions; step += 1) {
      const value = Math.round((maxValue / divisions) * step);
      if (!yTicks.includes(value)) {
        yTicks.push(value);
      }
    }
    if (!yTicks.includes(maxValue)) {
      yTicks.push(maxValue);
    }
  }
  yTicks.sort((a, b) => a - b);

  const seenXLabels = new Set<number>();
  const dateFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
  const xTickIndexes = (() => {
    const indexes = new Set<number>();
    if (data.length) {
      indexes.add(0);
      indexes.add(data.length - 1);
    }
    data.forEach((point, index) => {
      const date = new Date(`${point.fecha}T00:00:00`);
      if (date.getDay() === 1) {
        indexes.add(index);
      }
    });
    const sorted = Array.from(indexes).sort((a, b) => a - b);
    if (sorted.length <= 6) return sorted;
    const step = Math.ceil(sorted.length / 6);
    return sorted.filter((_, idx) => idx % step === 0 || idx === sorted.length - 1);
  })();

  const legendItems = [
    { label: 'Total sesiones', color: 'var(--bs-primary)' },
    { label: 'Variantes Formación Abierta', color: 'var(--bs-success)' },
  ];

  if (!data.length) {
    return <p className="text-muted mb-0">No hay datos disponibles para el periodo seleccionado.</p>;
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex flex-wrap gap-3 align-items-center">
        {legendItems.map((item) => (
          <div key={item.label} className="d-flex align-items-center gap-2 small text-muted">
            <span
              aria-hidden="true"
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '999px',
                backgroundColor: item.color,
                display: 'inline-block',
              }}
            />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="w-100" style={{ minHeight: '220px' }}>
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="Tendencia diaria de sesiones y variantes de Formación Abierta"
          className="w-100 h-100"
        >
          <line
            x1={padding.left}
            y1={padding.top + contentHeight}
            x2={padding.left + contentWidth}
            y2={padding.top + contentHeight}
            stroke="var(--bs-border-color)"
            strokeWidth={0.5}
          />
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={padding.top + contentHeight}
            stroke="var(--bs-border-color)"
            strokeWidth={0.5}
          />
          {yTicks.map((value) => {
            const y = getY(value);
            return (
              <g key={value}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + contentWidth}
                  y2={y}
                  stroke="var(--bs-border-color)"
                  strokeWidth={0.2}
                  strokeDasharray="1.5 2"
                />
                <text
                  x={padding.left - 1}
                  y={y + 2.5}
                  textAnchor="end"
                  fontSize={3.2}
                  fill="var(--bs-secondary-color)"
                >
                  {formatNumber(value)}
                </text>
              </g>
            );
          })}
          {hasMultiplePoints ? (
            <polyline
              points={sessionsPoints}
              fill="none"
              stroke="var(--bs-primary)"
              strokeWidth={1.4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {hasMultiplePoints ? (
            <polyline
              points={variantsPoints}
              fill="none"
              stroke="var(--bs-success)"
              strokeWidth={1.4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {data.map((point, index) => (
            <g key={point.fecha}>
              <circle
                cx={getX(index)}
                cy={getY(point.totalSesiones)}
                r={1.6}
                fill="var(--bs-primary)"
              />
              <circle
                cx={getX(index)}
                cy={getY(point.totalVariantesFormacionAbierta)}
                r={1.6}
                fill="var(--bs-success)"
              />
            </g>
          ))}
          {xTickIndexes.map((index) => {
            const x = getX(index);
            if (seenXLabels.has(index)) {
              return null;
            }
            seenXLabels.add(index);
            const date = new Date(`${data[index].fecha}T00:00:00`);
            const label = dateFormatter.format(date);
            return (
              <text
                key={`x-${index}`}
                x={x}
                y={chartHeight - 2}
                textAnchor="middle"
                fontSize={3.2}
                fill="var(--bs-secondary-color)"
              >
                {label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
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
            <Row xs={1} md={2} xl={4} className="g-4">
              <Col>
                <MetricCard
                  title="En borrador"
                  value={metrics.sessions.borrador}
                  accent="primary"
                  description="Sesiones aún pendientes de confirmar y planificar."
                  href={SESSION_DRAFTS_URL}
                />
              </Col>
              <Col>
                <MetricCard
                  title="Suspendidas"
                  value={metrics.sessions.suspendida}
                  accent="warning"
                  description="Sesiones pausadas que requieren revisar la replanificación."
                  href={SESSION_SUSPENDED_URL}
                />
              </Col>
              <Col>
                <MetricCard
                  title="Por finalizar"
                  value={metrics.sessions.porFinalizar}
                  accent="danger"
                  description="Sesiones realizadas que todavía no se han marcado como finalizadas."
                  href={SESSION_PENDING_COMPLETION_URL}
                />
              </Col>
              <Col>
                <MetricCard
                  title="Variantes sin recursos"
                  value={metrics.sessions.formacionAbiertaSinAsignar}
                  accent="info"
                  description="Formación Abierta sin formador ni sala asignada."
                  href={OPEN_TRAINING_UNASSIGNED_VARIANTS_URL}
                />
              </Col>
            </Row>
          </section>

          <section>
            <h2 className="h5 mb-3">Tendencia de sesiones y Formación Abierta</h2>
            <Card className="border-0 shadow-sm">
              <Card.Body className="d-flex flex-column gap-3">
                <p className="text-muted small mb-0">
                  Evolución diaria de las sesiones planificadas y de las variantes de Formación Abierta
                  en un periodo de dos semanas atrás y tres semanas hacia adelante.
                </p>
                <SessionsVariantsChart data={metrics.tendencias.sesionesVsVariantes} />
              </Card.Body>
            </Card>
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
                  href={BUDGETS_PENDING_CAES_URL}
                />
              </Col>
              <Col>
                <MetricCard
                  title="FUNDAE por trabajar"
                  value={metrics.followUp.fundaePorTrabajar}
                  accent="primary"
                  description="Presupuestos con FUNDAE pendiente de validar."
                  href={BUDGETS_PENDING_FUNDAE_URL}
                />
              </Col>
              <Col>
                <MetricCard
                  title="Hotel por trabajar"
                  value={metrics.followUp.hotelPorTrabajar}
                  accent="secondary"
                  description="Reservas de hotel que aún deben gestionarse."
                  href={BUDGETS_PENDING_HOTEL_URL}
                />
              </Col>
              <Col>
                <MetricCard
                  title="PO por trabajar"
                  value={metrics.followUp.poPorTrabajar}
                  accent="warning"
                  description="Pedidos de compra (PO) pendientes de validación."
                  href={BUDGETS_PENDING_PO_URL}
                />
              </Col>
              <Col>
                <MetricCard
                  title="Transporte por trabajar"
                  value={metrics.followUp.transportePorTrabajar}
                  accent="danger"
                  description="Logística de transporte pendiente de confirmar."
                  href={BUDGETS_PENDING_TRANSPORT_URL}
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

