import { useMemo, useState } from 'react';
import { Alert, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';

import {
  fetchReporteNominas,
  type PayrollReportComparisonMetric,
  type PayrollReportMetricKey,
} from '../../features/reporting/api';
import { ApiError } from '../../api/client';

const CATEGORY_LABELS = {
  fixedTrainers: 'Formadores fijos',
  fixedStaff: 'Personal fijo',
  discontinuousTrainers: 'Formadores discontinuos',
  overall: 'Total',
} as const;

const METRIC_LABELS: Record<PayrollReportMetricKey, string> = {
  salarioBruto: 'Salario bruto',
  salarioBrutoTotal: 'Salario bruto total',
  salarioLimpio: 'Salario limpio',
  contingenciasComunes: 'Contingencias comunes',
  aportacionSsIrpf: 'Aportación SS/IRPF',
  totalEmpresa: 'Total empresa',
  costeServicioFormacion: 'Coste servicio formación',
  costeServicioPreventivo: 'Coste servicio preventivos',
  dietas: 'Dietas',
  kilometraje: 'Kilometraje',
  pernocta: 'Pernocta',
  nocturnidad: 'Nocturnidad',
  festivo: 'Festivo',
  horasExtras: 'Horas extras',
  gastosExtras: 'Gastos extras',
  variable: 'Variable',
};

const METRIC_ORDER: PayrollReportMetricKey[] = [
  'salarioBruto',
  'salarioBrutoTotal',
  'salarioLimpio',
  'contingenciasComunes',
  'aportacionSsIrpf',
  'totalEmpresa',
  'costeServicioFormacion',
  'costeServicioPreventivo',
  'dietas',
  'kilometraje',
  'pernocta',
  'nocturnidad',
  'festivo',
  'horasExtras',
  'gastosExtras',
  'variable',
];

const METRIC_COLORS: Record<PayrollReportMetricKey, string> = {
  salarioBruto: '#1f77b4',
  salarioBrutoTotal: '#ff7f0e',
  salarioLimpio: '#2ca02c',
  contingenciasComunes: '#d62728',
  aportacionSsIrpf: '#9467bd',
  totalEmpresa: '#8c564b',
  costeServicioFormacion: '#e377c2',
  costeServicioPreventivo: '#7f7f7f',
  dietas: '#bcbd22',
  kilometraje: '#17becf',
  pernocta: '#005f73',
  nocturnidad: '#6a4c93',
  festivo: '#ef476f',
  horasExtras: '#118ab2',
  gastosExtras: '#f3722c',
  variable: '#43aa8b',
};

function buildCurrentMonthPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function formatPercentage(value: number | null): string {
  if (value === null) return 'N/A';
  return `${value.toFixed(2)}%`;
}

function parsePeriod(period: string): { year: number; month: number } {
  const [year, month] = period.split('-').map(Number);
  return { year, month };
}

function shiftPeriod(period: string, monthsToShift: number): string {
  const { year, month } = parsePeriod(period);
  const date = new Date(Date.UTC(year, month - 1 + monthsToShift, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildMonthRange(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const result: string[] = [];
  let current = start;
  while (current <= end) {
    result.push(current);
    current = shiftPeriod(current, 1);
  }
  return result;
}

function formatMonth(period: string): string {
  const { year, month } = parsePeriod(period);
  return new Intl.DateTimeFormat('es-ES', {
    month: 'short',
    year: '2-digit',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function createLinePath(values: number[], xScale: (index: number) => number, yScale: (value: number) => number): string {
  if (values.length === 0) return '';
  return values
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${xScale(index)} ${yScale(value)}`)
    .join(' ');
}

function ComparisonTable({
  title,
  totalCost,
  metrics,
}: {
  title: string;
  totalCost: PayrollReportComparisonMetric;
  metrics: Record<PayrollReportMetricKey, PayrollReportComparisonMetric>;
}) {
  return (
    <Card className="shadow-sm h-100">
      <Card.Body>
        <Card.Title className="h6">{title}</Card.Title>
        <Table bordered hover responsive size="sm" className="align-middle mb-0">
          <thead>
            <tr>
              <th>Línea</th>
              <th className="text-end">Actual</th>
              <th className="text-end">Comparado</th>
              <th className="text-end">Diferencia abs.</th>
              <th className="text-end">Diferencia %</th>
            </tr>
          </thead>
          <tbody>
            <tr className="table-primary">
              <td><strong>Coste total</strong></td>
              <td className="text-end">{formatCurrency(totalCost.current)}</td>
              <td className="text-end">{formatCurrency(totalCost.previous)}</td>
              <td className="text-end">{formatCurrency(totalCost.absoluteDifference)}</td>
              <td className="text-end">{formatPercentage(totalCost.percentageDifference)}</td>
            </tr>
            {METRIC_ORDER.map((metricKey) => (
              <tr key={metricKey}>
                <td>{METRIC_LABELS[metricKey]}</td>
                <td className="text-end">{formatCurrency(metrics[metricKey].current)}</td>
                <td className="text-end">{formatCurrency(metrics[metricKey].previous)}</td>
                <td className="text-end">{formatCurrency(metrics[metricKey].absoluteDifference)}</td>
                <td className="text-end">{formatPercentage(metrics[metricKey].percentageDifference)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
}

function AccumulatedComparisonTable({
  title,
  totalCost,
  metrics,
}: {
  title: string;
  totalCost: PayrollReportComparisonMetric;
  metrics: Record<PayrollReportMetricKey, PayrollReportComparisonMetric>;
}) {
  return (
    <Card className="shadow-sm">
      <Card.Body>
        <Card.Title className="h5">{title}</Card.Title>
        <Table bordered hover responsive className="align-middle mb-0" size="sm">
          <thead>
            <tr>
              <th>Línea</th>
              <th className="text-end">Acumulado actual</th>
              <th className="text-end">Acumulado año pasado</th>
              <th className="text-end">Diferencia abs.</th>
              <th className="text-end">Diferencia %</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_ORDER.map((metricKey) => (
              <tr key={metricKey}>
                <td>{METRIC_LABELS[metricKey]}</td>
                <td className="text-end">{formatCurrency(metrics[metricKey].current)}</td>
                <td className="text-end">{formatCurrency(metrics[metricKey].previous)}</td>
                <td className="text-end">{formatCurrency(metrics[metricKey].absoluteDifference)}</td>
                <td className="text-end">{formatPercentage(metrics[metricKey].percentageDifference)}</td>
              </tr>
            ))}
            <tr className="table-primary">
              <td><strong>Total nóminas acumulado</strong></td>
              <td className="text-end"><strong>{formatCurrency(totalCost.current)}</strong></td>
              <td className="text-end"><strong>{formatCurrency(totalCost.previous)}</strong></td>
              <td className="text-end"><strong>{formatCurrency(totalCost.absoluteDifference)}</strong></td>
              <td className="text-end"><strong>{formatPercentage(totalCost.percentageDifference)}</strong></td>
            </tr>
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
}

export default function ReporteNominasPage() {
  const [period, setPeriod] = useState<string>(buildCurrentMonthPeriod());
  const [trendEndPeriod, setTrendEndPeriod] = useState<string>(buildCurrentMonthPeriod());
  const [trendStartPeriod, setTrendStartPeriod] = useState<string>(shiftPeriod(buildCurrentMonthPeriod(), -11));
  const [showPreviousRange, setShowPreviousRange] = useState<boolean>(false);
  const [selectedMetrics, setSelectedMetrics] = useState<PayrollReportMetricKey[]>([
    'salarioBruto',
    'salarioLimpio',
    'totalEmpresa',
    'variable',
  ]);

  const query = useQuery({
    queryKey: ['reporting', 'reporte-nominas', period],
    queryFn: () => fetchReporteNominas(period),
  });

  const queryError = query.error instanceof ApiError ? query.error.message : 'No se pudo cargar el reporte.';

  const trendMonths = useMemo(
    () => buildMonthRange(trendStartPeriod, trendEndPeriod),
    [trendEndPeriod, trendStartPeriod]
  );

  const previousRangeMonths = useMemo(() => {
    if (!trendMonths.length) return [];
    return trendMonths.map((month) => shiftPeriod(month, -trendMonths.length));
  }, [trendMonths]);

  const trendQuery = useQuery({
    queryKey: ['reporting', 'reporte-nominas-trend', trendStartPeriod, trendEndPeriod, showPreviousRange],
    queryFn: async () => {
      const currentRange = await Promise.all(trendMonths.map((month) => fetchReporteNominas(month)));
      const previousRange = showPreviousRange
        ? await Promise.all(previousRangeMonths.map((month) => fetchReporteNominas(month)))
        : [];
      return { currentRange, previousRange };
    },
    enabled: trendMonths.length > 0,
  });

  const trendDataError = trendQuery.error instanceof ApiError ? trendQuery.error.message : 'No se pudo cargar la evolución.';

  const trendSeriesData = useMemo(() => {
    const current = trendMonths.map((month, index) => ({
      period: month,
      label: formatMonth(month),
      metrics: trendQuery.data?.currentRange[index]?.totals.overall.metrics,
    }));
    const previous = previousRangeMonths.map((month, index) => ({
      period: month,
      label: formatMonth(month),
      metrics: trendQuery.data?.previousRange[index]?.totals.overall.metrics,
    }));
    return { current, previous };
  }, [previousRangeMonths, trendMonths, trendQuery.data?.currentRange, trendQuery.data?.previousRange]);

  const chartValues = useMemo(() => {
    const values: number[] = [];
    selectedMetrics.forEach((metricKey) => {
      trendSeriesData.current.forEach((item) => {
        if (item.metrics) values.push(item.metrics[metricKey]);
      });
      if (showPreviousRange) {
        trendSeriesData.previous.forEach((item) => {
          if (item.metrics) values.push(item.metrics[metricKey]);
        });
      }
    });
    return values;
  }, [selectedMetrics, showPreviousRange, trendSeriesData.current, trendSeriesData.previous]);

  const yMax = useMemo(() => {
    const max = Math.max(...chartValues, 0);
    return max > 0 ? max : 1;
  }, [chartValues]);

  const periodText = useMemo(() => {
    if (!query.data?.period) return period;
    return `${query.data.period.period} (Q${query.data.period.quarter})`;
  }, [period, query.data?.period]);

  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <h1 className="h3 mb-1">Reporte Nóminas</h1>
        <p className="text-muted mb-0">
          Visibilidad mensual de gastos de nómina por grupo y comparativas absolutas y porcentuales.
        </p>
      </div>

      <Card className="shadow-sm">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md={4} lg={3}>
              <Form.Group controlId="period-selector">
                <Form.Label>Periodo</Form.Label>
                <Form.Control
                  type="month"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                />
              </Form.Group>
            </Col>
            <Col>
              <small className="text-muted">Periodo consultado: {periodText}</small>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {query.isLoading ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner animation="border" size="sm" />
          Cargando reporte...
        </div>
      ) : null}

      {query.isError ? <Alert variant="danger">{queryError}</Alert> : null}

      {query.data ? (
        <>
          <Card className="shadow-sm">
            <Card.Body>
              <Card.Title className="h5">Resumen mensual por grupo</Card.Title>
              <Table bordered hover responsive className="align-middle mb-0" size="sm">
                <thead>
                  <tr>
                    <th>Línea</th>
                    <th className="text-end">Formadores fijos</th>
                    <th className="text-end">Personal fijo</th>
                    <th className="text-end">Formadores discontinuos</th>
                    <th className="text-end">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ORDER.map((metricKey) => (
                    <tr key={metricKey}>
                      <td>{METRIC_LABELS[metricKey]}</td>
                      <td className="text-end">{formatCurrency(query.data.totals.fixedTrainers.metrics[metricKey])}</td>
                      <td className="text-end">{formatCurrency(query.data.totals.fixedStaff.metrics[metricKey])}</td>
                      <td className="text-end">{formatCurrency(query.data.totals.discontinuousTrainers.metrics[metricKey])}</td>
                      <td className="text-end">{formatCurrency(query.data.totals.overall.metrics[metricKey])}</td>
                    </tr>
                  ))}
                  <tr className="table-primary">
                    <td><strong>Coste total</strong></td>
                    <td className="text-end"><strong>{formatCurrency(query.data.totals.fixedTrainers.totalCost)}</strong></td>
                    <td className="text-end"><strong>{formatCurrency(query.data.totals.fixedStaff.totalCost)}</strong></td>
                    <td className="text-end"><strong>{formatCurrency(query.data.totals.discontinuousTrainers.totalCost)}</strong></td>
                    <td className="text-end"><strong>{formatCurrency(query.data.totals.overall.totalCost)}</strong></td>
                  </tr>
                </tbody>
              </Table>
            </Card.Body>
          </Card>

          <Card className="shadow-sm">
            <Card.Body>
              <Card.Title className="h5">Resumen trimestral (acumulado)</Card.Title>
              <Table bordered hover responsive className="align-middle mb-0" size="sm">
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th className="text-end">Coste total</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((categoryKey) => (
                    <tr key={categoryKey}>
                      <td>{CATEGORY_LABELS[categoryKey]}</td>
                      <td className="text-end">{formatCurrency(query.data.quarterTotals[categoryKey].totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>

          <Row className="g-3">
            <Col xl={6}>
              <ComparisonTable
                title="Mensual vs mes anterior"
                totalCost={query.data.comparisons.monthVsPreviousMonth.totalCost}
                metrics={query.data.comparisons.monthVsPreviousMonth.metrics}
              />
            </Col>
            <Col xl={6}>
              <ComparisonTable
                title="Mensual vs mismo mes año anterior"
                totalCost={query.data.comparisons.monthVsSameMonthLastYear.totalCost}
                metrics={query.data.comparisons.monthVsSameMonthLastYear.metrics}
              />
            </Col>
            <Col xl={6}>
              <ComparisonTable
                title="Trimestral vs trimestre anterior"
                totalCost={query.data.comparisons.quarterVsPreviousQuarter.totalCost}
                metrics={query.data.comparisons.quarterVsPreviousQuarter.metrics}
              />
            </Col>
            <Col xl={6}>
              <ComparisonTable
                title="Trimestral vs mismo trimestre año anterior"
                totalCost={query.data.comparisons.quarterVsSameQuarterLastYear.totalCost}
                metrics={query.data.comparisons.quarterVsSameQuarterLastYear.metrics}
              />
            </Col>
          </Row>

          <AccumulatedComparisonTable
            title="Acumulado anual vs acumulado mismo día del año pasado"
            totalCost={query.data.comparisons.yearToDateVsSameDateLastYear.totalCost}
            metrics={query.data.comparisons.yearToDateVsSameDateLastYear.metrics}
          />
        </>
      ) : null}

      <Card className="shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <Card.Title className="h5 mb-1">Evolución temporal de gastos</Card.Title>
            <p className="text-muted mb-0">
              Selecciona las líneas de coste que quieras visualizar y, si quieres, compáralas con el rango inmediatamente anterior.
            </p>
          </div>

          <Row className="g-3 align-items-end">
            <Col md={3}>
              <Form.Group controlId="trend-start-period">
                <Form.Label>Desde</Form.Label>
                <Form.Control
                  type="month"
                  value={trendStartPeriod}
                  max={trendEndPeriod}
                  onChange={(event) => setTrendStartPeriod(event.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="trend-end-period">
                <Form.Label>Hasta</Form.Label>
                <Form.Control
                  type="month"
                  value={trendEndPeriod}
                  min={trendStartPeriod}
                  onChange={(event) => setTrendEndPeriod(event.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Check
                id="trend-compare-previous"
                type="checkbox"
                label="Comparar con el rango anterior equivalente"
                checked={showPreviousRange}
                onChange={(event) => setShowPreviousRange(event.target.checked)}
              />
            </Col>
          </Row>

          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setSelectedMetrics(METRIC_ORDER)}>
              Seleccionar todo
            </button>
            <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setSelectedMetrics([])}>
              Limpiar selección
            </button>
          </div>

          <Row className="g-2">
            {METRIC_ORDER.map((metricKey) => (
              <Col key={metricKey} md={4} lg={3}>
                <Form.Check
                  id={`trend-metric-${metricKey}`}
                  type="checkbox"
                  label={METRIC_LABELS[metricKey]}
                  checked={selectedMetrics.includes(metricKey)}
                  onChange={(event) => {
                    setSelectedMetrics((previous) => {
                      if (event.target.checked) {
                        return previous.includes(metricKey) ? previous : [...previous, metricKey];
                      }
                      return previous.filter((item) => item !== metricKey);
                    });
                  }}
                />
              </Col>
            ))}
          </Row>

          {!trendMonths.length ? <Alert variant="warning" className="mb-0">El rango seleccionado no es válido.</Alert> : null}
          {trendQuery.isLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner animation="border" size="sm" />
              Cargando evolución...
            </div>
          ) : null}
          {trendQuery.isError ? <Alert variant="danger" className="mb-0">{trendDataError}</Alert> : null}

          {trendMonths.length > 0 && !trendQuery.isLoading && !trendQuery.isError ? (
            <div className="border rounded p-2 bg-light-subtle">
              {selectedMetrics.length === 0 ? (
                <Alert variant="info" className="mb-0">Selecciona al menos un campo para dibujar la gráfica.</Alert>
              ) : (
                <svg viewBox="0 0 1000 360" role="img" aria-label="Evolución temporal de costes" className="w-100">
                  {(() => {
                    const padding = { top: 20, right: 20, bottom: 70, left: 90 };
                    const width = 1000 - padding.left - padding.right;
                    const height = 360 - padding.top - padding.bottom;
                    const xScale = (index: number) =>
                      padding.left + (trendMonths.length === 1 ? width / 2 : (index * width) / (trendMonths.length - 1));
                    const yScale = (value: number) => padding.top + height - (value / yMax) * height;
                    const ticks = 5;

                    return (
                      <>
                        {[...Array(ticks)].map((_, index) => {
                          const value = (yMax / (ticks - 1)) * index;
                          const y = yScale(value);
                          return (
                            <g key={`grid-${index}`}>
                              <line x1={padding.left} x2={padding.left + width} y1={y} y2={y} stroke="#dee2e6" />
                              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#6c757d">
                                {formatCurrency(value)}
                              </text>
                            </g>
                          );
                        })}

                        {selectedMetrics.map((metricKey) => {
                          const currentValues = trendSeriesData.current.map((item) => item.metrics?.[metricKey] ?? 0);
                          const currentPath = createLinePath(currentValues, xScale, yScale);
                          const previousValues = trendSeriesData.previous.map((item) => item.metrics?.[metricKey] ?? 0);
                          const previousPath = createLinePath(previousValues, xScale, yScale);
                          const color = METRIC_COLORS[metricKey];

                          return (
                            <g key={`line-${metricKey}`}>
                              <path d={currentPath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
                              {showPreviousRange ? (
                                <path
                                  d={previousPath}
                                  fill="none"
                                  stroke={color}
                                  strokeWidth={2}
                                  strokeDasharray="6 4"
                                  strokeLinecap="round"
                                  opacity={0.8}
                                />
                              ) : null}
                            </g>
                          );
                        })}

                        {trendSeriesData.current.map((item, index) => (
                          <text
                            key={item.period}
                            x={xScale(index)}
                            y={padding.top + height + 20}
                            textAnchor="middle"
                            fontSize="11"
                            fill="#6c757d"
                          >
                            {item.label}
                          </text>
                        ))}
                      </>
                    );
                  })()}
                </svg>
              )}
            </div>
          ) : null}

          {selectedMetrics.length > 0 ? (
            <div className="d-flex flex-wrap gap-3">
              {selectedMetrics.map((metricKey) => (
                <div key={`legend-${metricKey}`} className="d-flex align-items-center gap-2 small">
                  <span
                    style={{
                      display: 'inline-block',
                      width: 18,
                      height: 3,
                      backgroundColor: METRIC_COLORS[metricKey],
                    }}
                  />
                  <span>{METRIC_LABELS[metricKey]}</span>
                  {showPreviousRange ? <span className="text-muted">(línea discontinua = rango anterior)</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </Card.Body>
      </Card>
    </div>
  );
}
