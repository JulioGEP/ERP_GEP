// frontend/src/pages/dashboard/DashboardPage.tsx
import { useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Spinner, Stack } from 'react-bootstrap';
import { fetchDashboardMetrics, type DashboardMetrics } from '../../api/dashboard';
import type { ApiError } from '../../api/client';

const QUERY_KEY = ['dashboard', 'metrics'] as const;

const EMPTY_METRICS: DashboardMetrics = {
  sessions: { borrador: 0, sinFormador: 0, suspendida: 0, porFinalizar: 0 },
  followUp: {
    caesPorTrabajar: 0,
    fundaePorTrabajar: 0,
    hotelPorTrabajar: 0,
    poPorTrabajar: 0,
    transportePorTrabajar: 0,
  },
  generatedAt: null,
  sessionsTimeline: { startDate: null, endDate: null, points: [] },
};

const NETLIFY_BASE_URL = 'https://erpgep.netlify.app';

const ALL_BUDGETS_PATH = `${NETLIFY_BASE_URL}/presupuestos/todos`;
const UNPLANNED_BUDGETS_PATH = `${NETLIFY_BASE_URL}/presupuestos/sinplanificar`;
const UNWORKED_BUDGETS_PATH = `${NETLIFY_BASE_URL}/presupuestos/sintrabajar`;

const SESSION_DRAFTS_URL = `${UNPLANNED_BUDGETS_PATH}?budgets-table__filter__session_estado=BORRADOR`;
const SESSION_SUSPENDED_URL = `${ALL_BUDGETS_PATH}?budgets-table__filter__session_estado=SUSPENDIDA`;
const encodeBudgetsQueryValue = (value: string) =>
  encodeURIComponent(value).replace(/%20/g, '+');

const SESSION_PENDING_COMPLETION_URL = `${ALL_BUDGETS_PATH}?budgets-table__filter__session_estado=PLANIFICADA`;

const SESSION_FORMACION_ABIERTA_URL = `${UNPLANNED_BUDGETS_PATH}?budgets-table__filter__negocio=${encodeBudgetsQueryValue(
  'Formación Empresas||GEP Services',
)}`;

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

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: 'short',
});
const MADRID_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const TOOLTIP_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'full',
  timeZone: 'Europe/Madrid',
});

type SessionsTimelineChartProps = {
  data: DashboardMetrics['sessionsTimeline']['points'];
};

type TimelinePoint = SessionsTimelineChartProps['data'][number];
type TimelineBudget = TimelinePoint['budgets'][number];

function SessionsTimelineChart({ data }: SessionsTimelineChartProps) {
  const width = 860;
  const height = 260;
  const paddingX = 56;
  const paddingY = 32;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [hoverInfo, setHoverInfo] = useState<
    { index: number; clientX: number; clientY: number } | null
  >(null);
  const companySessionsForPoint = (point: TimelinePoint) =>
    Math.max(0, point.totalSessions - point.formacionAbiertaSessions);

  const values = data.flatMap((point) => [
    companySessionsForPoint(point),
    point.formacionAbiertaSessions,
  ]);
  const maxValue = Math.max(1, ...values);
  const buildCoords = (selector: (point: TimelinePoint) => number) =>
    data.map((point, index) => {
      const xStep = data.length > 1 ? index / (data.length - 1) : 0.5;
      const value = selector(point);
      const scaledY =
        chartHeight - (value / (maxValue === 0 ? 1 : maxValue)) * chartHeight;
      return {
        x: paddingX + chartWidth * xStep,
        y: paddingY + scaledY,
      };
    });

  const companyCoords = buildCoords(companySessionsForPoint);
  const abiertaCoords = buildCoords((point) => point.formacionAbiertaSessions);

  const buildPath = (coords: Array<{ x: number; y: number }>) => {
    if (coords.length === 0) return '';
    const [first, ...rest] = coords;
    return rest.reduce(
      (acc, point) => `${acc} L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`,
    );
  };

  const companyPath = buildPath(companyCoords);
  const abiertaPath = buildPath(abiertaCoords);

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, index) =>
    Math.round((maxValue * index) / yTicks),
  );

  const xTickCandidates = data.map((point, index) => ({ point, index }));
  const xTicks = xTickCandidates.filter(
    ({ index }) => index === 0 || index === data.length - 1 || index % 7 === 0,
  );

  const getBandBounds = (index: number) => {
    const current = companyCoords[index];
    if (!current) {
      return { x: paddingX, width: 0 };
    }
    const previous = index > 0 ? companyCoords[index - 1] : undefined;
    const next = index < companyCoords.length - 1 ? companyCoords[index + 1] : undefined;
    const left = previous ? (previous.x + current.x) / 2 : paddingX;
    const right = next ? (next.x + current.x) / 2 : paddingX + chartWidth;
    return { x: left, width: Math.max(0, right - left) };
  };

  const weekendBands = data
    .map((point, index) => {
      const [year, month, day] = point.date.split('-').map((value) => Number.parseInt(value, 10));
      if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day)
      ) {
        return null;
      }
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        return null;
      }
      const bounds = getBandBounds(index);
      return { ...bounds, date: point.date };
    })
    .filter((band): band is { x: number; width: number; date: string } => Boolean(band));

  const todayKey = useMemo(() => MADRID_DAY_FORMATTER.format(new Date()), []);
  const todayIndex = useMemo(
    () => data.findIndex((point) => point.date === todayKey),
    [data, todayKey],
  );
  const hoveredIndex = hoverInfo?.index ?? null;
  const hoveredPoint = hoveredIndex != null ? data[hoveredIndex] : null;
  const todayBand = todayIndex >= 0 ? getBandBounds(todayIndex) : null;
  const hoveredBand = hoveredIndex != null ? getBandBounds(hoveredIndex) : null;

  const tooltipPosition = (() => {
    if (!hoverInfo || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = hoverInfo.clientX - rect.left;
    const relativeY = hoverInfo.clientY - rect.top;
    const maxWidth = Math.min(320, Math.max(rect.width - 24, 200));
    const left = Math.min(
      Math.max(relativeX + 16, 0),
      Math.max(rect.width - maxWidth, 0),
    );
    const top = Math.max(relativeY - 24, 0);
    return { left, top, maxWidth };
  })();

  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!data.length) return;
    const svgRect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - svgRect.left;
    const normalizedX =
      svgRect.width > 0 ? (x / svgRect.width) * width : x;
    const clampedX = Math.min(
      Math.max(normalizedX, paddingX),
      paddingX + chartWidth,
    );
    let index = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    companyCoords.forEach((coord, coordIndex) => {
      const distance = Math.abs(coord.x - clampedX);
      if (distance < minDistance) {
        minDistance = distance;
        index = coordIndex;
      }
    });
    setHoverInfo({ index, clientX: event.clientX, clientY: event.clientY });
  };

  const handleMouseLeave = (event: ReactMouseEvent<SVGSVGElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && tooltipRef.current?.contains(nextTarget)) {
      return;
    }
    setHoverInfo(null);
  };

  const handleTooltipMouseLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && svgRef.current?.contains(nextTarget)) {
      return;
    }
    setHoverInfo(null);
  };

  const formatList = (values: string[]) => (values.length ? values.join(', ') : '—');

  const budgetGroups = useMemo(() => {
    if (!hoveredPoint) return [];
    const grouped: Record<'company' | 'formacionAbierta', TimelineBudget[]> = {
      company: [],
      formacionAbierta: [],
    };
    hoveredPoint.budgets.forEach((budget) => {
      const type = budget.type === 'formacionAbierta' ? 'formacionAbierta' : 'company';
      grouped[type].push(budget);
    });
    const definitions = [
      {
        type: 'company' as const,
        label: 'Formaciones Empresa y GEP Services',
        color: '#0d6efd',
      },
      {
        type: 'formacionAbierta' as const,
        label: 'Formación Abierta',
        color: '#6610f2',
      },
    ];
    return definitions
      .map((definition) => ({ ...definition, budgets: grouped[definition.type] }))
      .filter((definition) => definition.budgets.length > 0);
  }, [hoveredPoint]);

  return (
    <Card className="border-0 shadow-sm">
      <Card.Body>
        <div className="d-flex flex-column flex-lg-row justify-content-between gap-3 align-items-lg-center mb-3">
          <div>
            <span className="text-uppercase text-muted small fw-semibold">
              Evolución de sesiones
            </span>
            <p className="mb-0 text-muted small">
              Últimas 2 semanas y próximas 3 semanas desde hoy.
            </p>
          </div>
          <div className="d-flex gap-3 small">
            <span className="d-flex align-items-center gap-2">
              <span
                className="rounded"
                style={{ display: 'inline-block', width: '12px', height: '4px', backgroundColor: '#0d6efd' }}
                aria-hidden="true"
              />
              Formaciones Empresa y GEP Services
            </span>
            <span className="d-flex align-items-center gap-2">
              <span
                className="rounded"
                style={{ display: 'inline-block', width: '12px', height: '4px', backgroundColor: '#6610f2' }}
                aria-hidden="true"
              />
              Formación Abierta
            </span>
          </div>
        </div>
        <div className="w-100" style={{ overflowX: 'auto' }}>
          <div
            ref={containerRef}
            className="position-relative"
            style={{ minWidth: `${width}px` }}
          >
            <svg
              ref={svgRef}
              role="img"
              aria-label="Evolución de sesiones"
              aria-describedby="sessions-trend-desc"
              viewBox={`0 0 ${width} ${height}`}
              style={{ width: '100%', height: '100%', display: 'block' }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <desc id="sessions-trend-desc">
                Línea azul Formaciones Empresa y GEP Services, línea violeta Formación Abierta por día.
              </desc>
              <rect
                x={paddingX}
                y={paddingY}
                width={chartWidth}
                height={chartHeight}
                fill="none"
                stroke="var(--bs-border-color)"
              />
              {weekendBands.map((band) => (
                <rect
                  key={`weekend-${band.date}`}
                  x={band.x}
                  y={paddingY}
                  width={band.width}
                  height={chartHeight}
                  fill="rgba(220, 53, 69, 0.12)"
                  pointerEvents="none"
                />
              ))}
              {todayBand ? (
                <rect
                  x={todayBand.x}
                  y={paddingY}
                  width={todayBand.width}
                  height={chartHeight}
                  fill="rgba(255, 193, 7, 0.18)"
                  pointerEvents="none"
                />
              ) : null}
              {hoveredBand ? (
                <rect
                  x={hoveredBand.x}
                  y={paddingY}
                  width={hoveredBand.width}
                  height={chartHeight}
                  fill="rgba(13, 110, 253, 0.18)"
                  pointerEvents="none"
                />
              ) : null}
              {yTickValues.map((tick, index) => {
                const y = paddingY + chartHeight - (tick / (maxValue || 1)) * chartHeight;
                return (
                  <g key={`y-${tick}`}>
                    <line
                      x1={paddingX}
                      x2={paddingX + chartWidth}
                      y1={y}
                      y2={y}
                      stroke="var(--bs-border-color)"
                      strokeDasharray="4 4"
                      opacity={index === 0 ? 1 : 0.4}
                    />
                    <text
                      x={paddingX - 8}
                      y={y + 4}
                      textAnchor="end"
                      fontSize={12}
                      fill="var(--bs-secondary-color)"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}
              {xTicks.map(({ point, index }) => {
                const coord = companyCoords[index];
                if (!coord) return null;
                const labelDate = new Date(`${point.date}T00:00:00`);
                return (
                  <g key={`x-${point.date}`}>
                    <line
                      x1={coord.x}
                      x2={coord.x}
                      y1={paddingY}
                      y2={paddingY + chartHeight}
                      stroke="var(--bs-border-color)"
                      strokeDasharray="4 4"
                      opacity={0.3}
                    />
                    <text
                      x={coord.x}
                      y={paddingY + chartHeight + 20}
                      textAnchor="middle"
                      fontSize={12}
                      fill="var(--bs-secondary-color)"
                    >
                      {DATE_LABEL_FORMATTER.format(labelDate)}
                    </text>
                  </g>
                );
              })}
              <path
                d={companyPath}
                fill="none"
                stroke="#0d6efd"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path
                d={abiertaPath}
                fill="none"
                stroke="#6610f2"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {companyCoords.map((coord, index) => {
                const isHovered = hoveredIndex === index;
                return (
                  <circle
                    key={`total-point-${data[index]?.date ?? index}`}
                    cx={coord.x}
                    cy={coord.y}
                    r={isHovered ? 5 : 3.5}
                    fill="#0d6efd"
                    opacity={isHovered ? 1 : 0.85}
                  />
                );
              })}
              {abiertaCoords.map((coord, index) => (
                <circle
                  key={`abierta-point-${data[index]?.date ?? index}`}
                  cx={coord.x}
                  cy={coord.y}
                  r={3}
                  fill="#6610f2"
                  opacity={hoveredIndex === index ? 1 : 0.85}
                />
              ))}
            </svg>
            {hoveredPoint && tooltipPosition ? (
              <div
                ref={tooltipRef}
                className="position-absolute bg-white border rounded shadow-sm p-3"
                style={{
                  left: tooltipPosition.left,
                  top: tooltipPosition.top,
                  maxWidth: tooltipPosition.maxWidth,
                  maxHeight: 320,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                }}
                onMouseLeave={handleTooltipMouseLeave}
              >
                <div className="text-uppercase text-muted small fw-semibold">
                  Presupuestos del día
                </div>
                <div className="fw-semibold mb-2">
                  {TOOLTIP_DATE_FORMATTER.format(
                    new Date(`${hoveredPoint.date}T00:00:00`),
                  )}
                </div>
                {budgetGroups.length > 0 ? (
                  <div className="d-flex flex-column gap-3">
                    {budgetGroups.map((group, groupIndex) => (
                      <div
                        key={group.type}
                        className={groupIndex === 0 ? undefined : 'pt-2 border-top'}
                      >
                        <div className="d-flex align-items-center gap-2 mb-2">
                          <span
                            className="rounded"
                            style={{
                              display: 'inline-block',
                              width: '12px',
                              height: '4px',
                              backgroundColor: group.color,
                            }}
                            aria-hidden="true"
                          />
                          <span className="text-uppercase small fw-semibold" style={{ color: group.color }}>
                            {group.label}
                          </span>
                        </div>
                        <ul className="list-unstyled mb-0 small">
                          {group.budgets.map((budget, budgetIndex) => {
                            const itemClassName = budgetIndex === 0 ? undefined : 'pt-2 mt-2 border-top';
                            if (group.type === 'formacionAbierta') {
                              return (
                                <li key={budget.id} className={itemClassName}>
                                  {budget.sessionTitle ? (
                                    <div>
                                      <span className="text-muted">Presupuesto:</span>{' '}
                                      {budget.sessionTitle}
                                    </div>
                                  ) : null}
                                  <div>
                                    <span className="text-muted">Organización:</span>{' '}
                                    {budget.companyName ?? '—'}
                                  </div>
                                  <div>
                                    <span className="text-muted">Total de alumnos:</span>{' '}
                                    {formatNumber(budget.studentsCount ?? 0)}
                                  </div>
                                </li>
                              );
                            }

                            return (
                              <li key={budget.id} className={itemClassName}>
                                <div>
                                  <span className="text-muted">Empresa:</span>{' '}
                                  {budget.companyName ?? '—'}
                                </div>
                                <div>
                                  <span className="text-muted">Título de la sesión:</span>{' '}
                                  {budget.sessionTitle ?? '—'}
                                </div>
                                <div>
                                  <span className="text-muted">Formador o Bombero:</span>{' '}
                                  {formatList(budget.trainers)}
                                </div>
                                <div>
                                  <span className="text-muted">Unidad móvil:</span>{' '}
                                  {formatList(budget.mobileUnits)}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted small mb-0">
                    Sin presupuestos registrados para este día.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
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
                  title="Formacion Abierta"
                  value={metrics.sessions.sinFormador}
                  accent="info"
                  description="Eventos de formación abierta con reservas sin formador asignado."
                  href={SESSION_FORMACION_ABIERTA_URL}
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
                  description="Presupuestos con sesiones planificadas que ya deberían haberse finalizado."
                  href={SESSION_PENDING_COMPLETION_URL}
                />
              </Col>
            </Row>
            <div className="mt-4">
              <SessionsTimelineChart data={metrics.sessionsTimeline.points} />
            </div>
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

