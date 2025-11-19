import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  fetchComparativaDashboard,
  type ComparativaDashboardResponse,
  type ComparativaFilters,
  type ComparativaKpi,
  type ComparativaRankingRow,
  type ComparativaTrend,
} from '../../features/reporting/api';

/**
 * Vista "Comparativa" (Reporting)
 *
 * Filtros esperados por la API (apoyados en dimensión calendario con year/isoWeek):
 * - currentPeriod: rango de fechas del período actual (fecha inicio/fin)
 * - previousPeriod: rango de fechas de comparación (p.ej. mismo período LY)
 * - granularity: day | isoWeek | month (agregación de series)
 * - siteId / costCenterId / trainingType / serviceType / channel / funnel
 * - includeCancellations / includeNoShow (toggles para incluir/excluir en KPIs)
 *
 * Métricas/endpoint agregados esperados:
 * - highlights: KPIs clave (sessions, revenue, enrollments, attendance...) con delta vs LY y sparkline
 * - trends: series por día/isoWeek/mes de sesiones, ingresos, inscritos
 * - breakdowns: mix apilado por sede/servicio/canal
 * - revenueMix: % ingresos por servicio/canal (donut)
 * - heatmap: ocupación por sede vs isoWeek (utilization)
 * - funnel: conversiones entre etapas (incluyendo cancelaciones/no-show)
 * - ranking: top cursos/sedes/canales con export CSV
 */
export default function ComparativaDashboardPage() {
  const today = useMemo(() => new Date(), []);
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);

  const initialCurrentStart = useMemo(() => {
    const start = new Date(today);
    start.setDate(start.getDate() - 28);
    return formatDate(start);
  }, [today]);

  const initialPreviousStart = useMemo(() => {
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - 1);
    start.setDate(start.getDate() - 28);
    return formatDate(start);
  }, [today]);

  const initialCurrentEnd = useMemo(() => formatDate(today), [today]);
  const initialPreviousEnd = useMemo(() => {
    const end = new Date(today);
    end.setFullYear(end.getFullYear() - 1);
    return formatDate(end);
  }, [today]);

  const [filters, setFilters] = useState<ComparativaFilters>({
    currentPeriod: { startDate: initialCurrentStart, endDate: initialCurrentEnd },
    previousPeriod: { startDate: initialPreviousStart, endDate: initialPreviousEnd },
    granularity: 'isoWeek',
    includeCancellations: false,
    includeNoShow: false,
  });

  const appliedFilters = useMemo(() => filters, [filters]);

  const dashboardQuery = useQuery({
    queryKey: [
      'reporting',
      'comparativa',
      appliedFilters.currentPeriod.startDate,
      appliedFilters.currentPeriod.endDate,
      appliedFilters.previousPeriod.startDate,
      appliedFilters.previousPeriod.endDate,
      appliedFilters.granularity,
      appliedFilters.siteId ?? 'any',
      appliedFilters.costCenterId ?? 'any',
      appliedFilters.trainingType ?? 'any',
      appliedFilters.serviceType ?? 'any',
      appliedFilters.channel ?? 'any',
      appliedFilters.funnel ?? 'any',
      appliedFilters.includeCancellations ? 'cancel' : 'nocancel',
      appliedFilters.includeNoShow ? 'noshow' : 'nonoshow',
    ],
    queryFn: () => fetchComparativaDashboard(appliedFilters),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }),
    [],
  );
  const percentageFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 1 }),
    [],
  );
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }),
    [],
  );

  const handleFilterChange = (partial: Partial<ComparativaFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const onDateChange = (field: 'currentPeriod' | 'previousPeriod', key: 'startDate' | 'endDate', value: string) => {
    handleFilterChange({
      [field]: {
        ...(filters[field] ?? filters.currentPeriod),
        [key]: value,
      },
    });
  };

  const exportRankingCsv = (ranking: ComparativaRankingRow[]) => {
    if (!ranking.length) return;

    const header = ['Posición', 'Elemento', 'Categoría', 'Actual', 'LY', 'Conversión %'];
    const rows = ranking.map((row) => [
      row.rank,
      row.label,
      row.category,
      row.currentValue,
      row.previousValue,
      row.conversionRate ?? '',
    ]);

    const csv = [header, ...rows]
      .map((columns) => columns.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'comparativa_ranking.csv';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const renderSparkline = (points: number[]) => {
    if (!points.length) return <div className="text-muted small">Sin datos</div>;
    const max = Math.max(...points);
    return (
      <div className="d-flex gap-1 align-items-end" style={{ height: 36 }}>
        {points.map((value, index) => {
          const height = max > 0 ? Math.max((value / max) * 100, 6) : 6;
          return (
            <div
              key={`${value}-${index}`}
              style={{
                width: 10,
                height: `${height}%`,
                background: 'linear-gradient(180deg, #0d6efd 0%, #6ea8fe 100%)',
                borderRadius: 4,
              }}
            />
          );
        })}
      </div>
    );
  };

  const renderMetricValue = (kpi: ComparativaKpi) => {
    const value = kpi.unit === 'currency'
      ? currencyFormatter.format(kpi.value)
      : kpi.unit === 'percentage'
        ? `${percentageFormatter.format(kpi.value)}%`
        : numberFormatter.format(kpi.value);

    const deltaLabel = `${kpi.deltaPercentage >= 0 ? '+' : ''}${percentageFormatter.format(kpi.deltaPercentage)}% vs LY`;
    const deltaVariant = kpi.deltaPercentage >= 0 ? 'success' : 'danger';

    return (
      <div>
        <div className="fs-4 fw-semibold">{value}</div>
        <Badge bg={deltaVariant} pill>
          {deltaLabel}
        </Badge>{' '}
        <span className="text-muted small">LY: {numberFormatter.format(kpi.lastYearValue)}</span>
      </div>
    );
  };

  const renderTrend = (trend: ComparativaTrend) => (
    <Card key={trend.metric} className="h-100 shadow-sm">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Card.Title as="h6" className="mb-0">
            {trend.label}
          </Card.Title>
          <Badge bg="secondary" pill>
            {filters.granularity === 'day' ? 'Día' : filters.granularity === 'month' ? 'Mes' : 'ISO Week'}
          </Badge>
        </div>
        {trend.points.length ? (
          <div className="d-flex flex-wrap gap-3 align-items-end" style={{ minHeight: 140 }}>
            {trend.points.map((point) => {
              const diff = point.currentValue - point.previousValue;
              const diffLabel = `${diff >= 0 ? '+' : ''}${numberFormatter.format(diff)}`;
              return (
                <div key={point.periodLabel} className="text-center" style={{ minWidth: 110 }}>
                  <div className="fw-semibold">{point.periodLabel}</div>
                  <div className="text-muted small">ISO {point.isoWeek} / {point.isoYear}</div>
                  <div className="fw-bold text-primary">{numberFormatter.format(point.currentValue)}</div>
                  <div className="text-muted">LY: {numberFormatter.format(point.previousValue)}</div>
                  <div className={diff >= 0 ? 'text-success' : 'text-danger'}>{diffLabel}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-muted">Sin series para el período.</div>
        )}
      </Card.Body>
    </Card>
  );

  const renderBreakdown = (response: ComparativaDashboardResponse, dimension: 'site' | 'service' | 'channel', title: string) => {
    const items = response.breakdowns.filter((item) => item.dimension === dimension);
    if (!items.length) {
      return (
        <Card className="h-100 shadow-sm">
          <Card.Body>
            <Card.Title as="h6">{title}</Card.Title>
            <div className="text-muted">Sin datos para los filtros seleccionados.</div>
          </Card.Body>
        </Card>
      );
    }

    const max = Math.max(...items.map((item) => item.current));
    return (
      <Card className="h-100 shadow-sm">
        <Card.Body>
          <Card.Title as="h6">{title}</Card.Title>
          <div className="d-flex flex-column gap-3">
            {items.map((item) => {
              const width = max > 0 ? Math.max((item.current / max) * 100, 8) : 8;
              const delta = item.current - item.previous;
              const deltaLabel = `${delta >= 0 ? '+' : ''}${numberFormatter.format(delta)} vs LY`;
              return (
                <div key={item.label}>
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <span className="fw-semibold">{item.label}</span>
                    <span className="text-muted small">LY: {numberFormatter.format(item.previous)}</span>
                  </div>
                  <div className="bg-light rounded-2" style={{ height: 14 }}>
                    <div
                      className="bg-primary rounded-2"
                      style={{ width: `${width}%`, height: '100%' }}
                      role="presentation"
                    />
                  </div>
                  <div className={delta >= 0 ? 'text-success small' : 'text-danger small'}>{deltaLabel}</div>
                </div>
              );
            })}
          </div>
        </Card.Body>
      </Card>
    );
  };

  const renderRevenueMix = (response: ComparativaDashboardResponse) => (
    <Card className="h-100 shadow-sm">
      <Card.Body>
        <Card.Title as="h6">Mix ingresos (placeholder donut)</Card.Title>
        {response.revenueMix.length ? (
          <div className="d-flex flex-wrap gap-3 align-items-center">
            <div
              className="rounded-circle bg-light border d-flex align-items-center justify-content-center"
              style={{ width: 160, height: 160 }}
            >
              <div className="text-center">
                <div className="fw-bold">Donut</div>
                <div className="text-muted small">Valores %</div>
              </div>
            </div>
            <div className="d-flex flex-column gap-2">
              {response.revenueMix.map((slice) => (
                <div key={slice.label} className="d-flex align-items-center gap-2">
                  <span className="rounded-circle bg-primary" style={{ width: 10, height: 10 }} />
                  <span className="fw-semibold">{slice.label}</span>
                  <span className="text-muted">{percentageFormatter.format(slice.percentage)}%</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-muted">Sin datos para el mix de ingresos.</div>
        )}
      </Card.Body>
    </Card>
  );

  const renderHeatmap = (response: ComparativaDashboardResponse) => {
    if (!response.heatmap.length) {
      return (
        <Card className="h-100 shadow-sm">
          <Card.Body>
            <Card.Title as="h6">Heatmap ocupación</Card.Title>
            <div className="text-muted">Sin datos de ocupación para mostrar.</div>
          </Card.Body>
        </Card>
      );
    }

    const sites = Array.from(new Set(response.heatmap.map((cell) => cell.site)));
    const weeks = Array.from(new Set(response.heatmap.map((cell) => `${cell.isoYear}-W${cell.isoWeek}`)));

    const getColor = (value: number) => {
      if (value >= 85) return '#0f5132';
      if (value >= 70) return '#198754';
      if (value >= 55) return '#fd7e14';
      return '#dc3545';
    };

    return (
      <Card className="h-100 shadow-sm">
        <Card.Body>
          <Card.Title as="h6">Heatmap ocupación (sede vs ISO week)</Card.Title>
          <div className="table-responsive">
            <Table bordered hover size="sm" className="align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Sede</th>
                  {weeks.map((week) => (
                    <th key={week} className="text-center">{week}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site}>
                    <th className="bg-light">{site}</th>
                    {weeks.map((week) => {
                      const [isoYear, isoWeekLabel] = week.split('-W');
                      const match = response.heatmap.find(
                        (cell) => cell.site === site && cell.isoYear === Number(isoYear) && cell.isoWeek === Number(isoWeekLabel),
                      );
                      const value = match?.utilization ?? 0;
                      return (
                        <td key={week} className="text-center" style={{ backgroundColor: '#f8f9fa' }}>
                          <div
                            className="rounded-1 text-white"
                            style={{
                              backgroundColor: getColor(value),
                              padding: '4px 6px',
                            }}
                          >
                            {percentageFormatter.format(value)}%
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>
    );
  };

  const renderFunnel = (response: ComparativaDashboardResponse) => (
    <Card className="h-100 shadow-sm">
      <Card.Body>
        <Card.Title as="h6">Embudo de conversión</Card.Title>
        {response.funnel.length ? (
          <div className="d-flex flex-column gap-3">
            {response.funnel.map((stage) => {
              const width = Math.min(Math.max(stage.conversionRate, 6), 100);
              const delta = stage.current - stage.previous;
              const deltaLabel = `${delta >= 0 ? '+' : ''}${numberFormatter.format(delta)} vs LY`;
              return (
                <div key={stage.name}>
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="fw-semibold">{stage.name}</div>
                    <div className="text-muted small">{numberFormatter.format(stage.previous)} LY</div>
                  </div>
                  <div className="bg-light rounded-2" style={{ height: 14 }}>
                    <div
                      className="bg-info rounded-2"
                      style={{ width: `${width}%`, height: '100%' }}
                      role="presentation"
                    />
                  </div>
                  <div className="d-flex justify-content-between">
                    <span className="fw-bold">{numberFormatter.format(stage.current)} actuales</span>
                    <span className={delta >= 0 ? 'text-success small' : 'text-danger small'}>{deltaLabel}</span>
                  </div>
                  <div className="text-muted small">Conversión acumulada: {percentageFormatter.format(stage.conversionRate)}%</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-muted">Sin etapas de embudo cargadas.</div>
        )}
      </Card.Body>
    </Card>
  );

  const renderRanking = (response: ComparativaDashboardResponse) => (
    <Card className="shadow-sm">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Card.Title as="h6" className="mb-0">Ranking (cursos / sedes / canales)</Card.Title>
          <Button
            variant="outline-primary"
            size="sm"
            disabled={!response.ranking.length}
            onClick={() => exportRankingCsv(response.ranking)}
          >
            Exportar CSV
          </Button>
        </div>
        {response.ranking.length ? (
          <div className="table-responsive">
            <Table striped bordered hover size="sm" className="align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: 70 }}>#</th>
                  <th>Elemento</th>
                  <th style={{ width: 140 }}>Categoría</th>
                  <th style={{ width: 140 }} className="text-end">Actual</th>
                  <th style={{ width: 140 }} className="text-end">LY</th>
                  <th style={{ width: 140 }} className="text-end">Conversión</th>
                </tr>
              </thead>
              <tbody>
                {response.ranking.map((row) => {
                  const delta = row.currentValue - row.previousValue;
                  const deltaLabel = `${delta >= 0 ? '+' : ''}${numberFormatter.format(delta)}`;
                  return (
                    <tr key={`${row.category}-${row.label}`}>
                      <td className="fw-bold">{row.rank}</td>
                      <td>{row.label}</td>
                      <td>{row.category}</td>
                      <td className="text-end">{currencyFormatter.format(row.currentValue)}</td>
                      <td className="text-end">{currencyFormatter.format(row.previousValue)}</td>
                      <td className="text-end">
                        {row.conversionRate !== undefined ? `${percentageFormatter.format(row.conversionRate)}%` : '—'}
                        <div className={delta >= 0 ? 'text-success small' : 'text-danger small'}>{deltaLabel}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : (
          <div className="text-muted">Aún no hay ranking para este filtro.</div>
        )}
      </Card.Body>
    </Card>
  );

  let content: JSX.Element;
  if (dashboardQuery.isLoading) {
    content = (
      <div className="py-5 text-center">
        <Spinner animation="border" role="status" />
        <div className="mt-3 text-muted">Cargando comparativa...</div>
      </div>
    );
  } else if (dashboardQuery.isError) {
    const message = isApiError(dashboardQuery.error)
      ? dashboardQuery.error.message
      : 'No se pudo cargar la comparativa. Ajusta los filtros o vuelve a intentarlo.';
    content = <Alert variant="danger">{message}</Alert>;
  } else {
    const data = dashboardQuery.data;
    if (!data) {
      content = <Alert variant="info">Sin resultados todavía. Ajusta el rango de fechas.</Alert>;
    } else {
      content = (
        <div className="d-flex flex-column gap-3">
          <Row xs={1} md={2} xl={4} className="g-3">
            {data.highlights.length ? (
              data.highlights.map((kpi) => (
                <Col key={kpi.key}>
                  <Card className="h-100 shadow-sm">
                    <Card.Body>
                      <Card.Title as="h6">{kpi.label}</Card.Title>
                      {renderMetricValue(kpi)}
                      <div className="mt-3">{renderSparkline(kpi.sparkline)}</div>
                    </Card.Body>
                  </Card>
                </Col>
              ))
            ) : (
              <Col>
                <Alert variant="light" className="h-100 mb-0">Añade filtros para ver KPIs.</Alert>
              </Col>
            )}
          </Row>

          <Row xs={1} md={2} className="g-3">
            {data.trends.map((trend) => (
              <Col key={trend.metric}>{renderTrend(trend)}</Col>
            ))}
          </Row>

          <Row xs={1} lg={3} className="g-3">
            <Col>{renderBreakdown(data, 'site', 'Mix por sede (barras apiladas)')}</Col>
            <Col>{renderBreakdown(data, 'service', 'Mix por servicio (barras apiladas)')}</Col>
            <Col>{renderRevenueMix(data)}</Col>
          </Row>

          <Row xs={1} lg={2} className="g-3">
            <Col>{renderHeatmap(data)}</Col>
            <Col>{renderFunnel(data)}</Col>
          </Row>

          {renderRanking(data)}
        </div>
      );
    }
  }

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h1 className="h3 mb-0">Reporting · Comparativa</h1>
          <div className="text-muted">Comparativa de desempeño contra el mismo período del año anterior.</div>
        </div>
      </div>

      <Card className="mb-3 shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
            <Card.Title as="h5" className="mb-0">Filtros</Card.Title>
            <div className="d-flex gap-2">
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() =>
                  setFilters({
                    currentPeriod: { startDate: initialCurrentStart, endDate: initialCurrentEnd },
                    previousPeriod: { startDate: initialPreviousStart, endDate: initialPreviousEnd },
                    granularity: 'isoWeek',
                    includeCancellations: false,
                    includeNoShow: false,
                  })
                }
              >
                Reset
              </Button>
            </div>
          </div>

          <Row className="g-3">
            <Col md={3}>
              <Form.Group controlId="currentStart">
                <Form.Label>Período actual - inicio</Form.Label>
                <Form.Control
                  type="date"
                  value={filters.currentPeriod.startDate}
                  onChange={(event) => onDateChange('currentPeriod', 'startDate', event.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="currentEnd">
                <Form.Label>Período actual - fin</Form.Label>
                <Form.Control
                  type="date"
                  value={filters.currentPeriod.endDate}
                  onChange={(event) => onDateChange('currentPeriod', 'endDate', event.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="previousStart">
                <Form.Label>Período LY - inicio</Form.Label>
                <Form.Control
                  type="date"
                  value={filters.previousPeriod.startDate}
                  onChange={(event) => onDateChange('previousPeriod', 'startDate', event.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="previousEnd">
                <Form.Label>Período LY - fin</Form.Label>
                <Form.Control
                  type="date"
                  value={filters.previousPeriod.endDate}
                  onChange={(event) => onDateChange('previousPeriod', 'endDate', event.target.value)}
                />
              </Form.Group>
            </Col>
          </Row>

          <Row className="g-3 mt-0">
            <Col md={3}>
              <Form.Group controlId="granularity">
                <Form.Label>Granularidad</Form.Label>
                <Form.Select
                  value={filters.granularity}
                  onChange={(event) => handleFilterChange({ granularity: event.target.value as ComparativaFilters['granularity'] })}
                >
                  <option value="day">Día</option>
                  <option value="isoWeek">ISO week</option>
                  <option value="month">Mes</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="site">
                <Form.Label>Sede</Form.Label>
                <Form.Select value={filters.siteId ?? ''} onChange={(event) => handleFilterChange({ siteId: event.target.value || undefined })}>
                  <option value="">Todas</option>
                  <option value="madrid">Madrid</option>
                  <option value="barcelona">Barcelona</option>
                  <option value="valencia">Valencia</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="costCenter">
                <Form.Label>Centro de coste</Form.Label>
                <Form.Select
                  value={filters.costCenterId ?? ''}
                  onChange={(event) => handleFilterChange({ costCenterId: event.target.value || undefined })}
                >
                  <option value="">Todos</option>
                  <option value="cc-formacion">Formación</option>
                  <option value="cc-prevencion">Prevención</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="trainingType">
                <Form.Label>Tipo formación</Form.Label>
                <Form.Select
                  value={filters.trainingType ?? ''}
                  onChange={(event) => handleFilterChange({ trainingType: event.target.value || undefined })}
                >
                  <option value="">Todas</option>
                  <option value="presencial">Presencial</option>
                  <option value="online">Online</option>
                  <option value="mixta">Mixta</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Row className="g-3 mt-0">
            <Col md={3}>
              <Form.Group controlId="serviceType">
                <Form.Label>Tipo servicio</Form.Label>
                <Form.Select
                  value={filters.serviceType ?? ''}
                  onChange={(event) => handleFilterChange({ serviceType: event.target.value || undefined })}
                >
                  <option value="">Todos</option>
                  <option value="formacion">Formación</option>
                  <option value="preventivo">Preventivo</option>
                  <option value="simulacro">Simulacro</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="channel">
                <Form.Label>Canal</Form.Label>
                <Form.Select
                  value={filters.channel ?? ''}
                  onChange={(event) => handleFilterChange({ channel: event.target.value || undefined })}
                >
                  <option value="">Todos</option>
                  <option value="directo">Directo</option>
                  <option value="partners">Partners</option>
                  <option value="marketplace">Marketplace</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="funnel">
                <Form.Label>Embudo</Form.Label>
                <Form.Select
                  value={filters.funnel ?? ''}
                  onChange={(event) => handleFilterChange({ funnel: event.target.value || undefined })}
                >
                  <option value="">Todos</option>
                  <option value="lead">Lead</option>
                  <option value="oportunidad">Oportunidad</option>
                  <option value="propuesta">Propuesta</option>
                  <option value="inscripcion">Inscripción</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3} className="d-flex align-items-end gap-3">
              <Form.Check
                type="switch"
                id="includeCancellations"
                label="Incluir cancelaciones"
                checked={filters.includeCancellations}
                onChange={(event) => handleFilterChange({ includeCancellations: event.target.checked })}
              />
              <Form.Check
                type="switch"
                id="includeNoShow"
                label="Incluir no-show"
                checked={filters.includeNoShow}
                onChange={(event) => handleFilterChange({ includeNoShow: event.target.checked })}
              />
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {dashboardQuery.isFetching ? (
        <Card className="mb-3 shadow-sm">
          <Card.Body>
            <div className="d-flex align-items-center gap-3">
              <Spinner animation="border" size="sm" />
              <span className="text-muted">Actualizando métricas...</span>
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {content}
    </div>
  );
}
