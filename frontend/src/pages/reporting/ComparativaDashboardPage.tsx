import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Badge, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  fetchComparativaDashboard,
  type ComparativaFilters,
  type ComparativaKpi,
} from '../../features/reporting/api';

const METRIC_CONFIG: { key: string; label: string }[] = [
  { key: 'gepServicesSessions', label: 'GEP Services' },
  { key: 'formacionEmpresaSessions', label: 'Formacion Empresa' },
  { key: 'formacionAbiertaVariantesSessions', label: 'Formación Abierta' },
];

const BREAKDOWN_CONFIG = [
  {
    dimension: 'formacionEmpresaSite' as const,
    title: 'Formaciones Empresa por sedes',
    description: 'Sumatorio de sesiones por sede',
  },
  {
    dimension: 'formacionAbiertaSite' as const,
    title: 'Formaciones Abierta por sedes',
    description: 'Sumatorio de variantes por sede',
  },
  {
    dimension: 'gepServicesType' as const,
    title: 'GEP Services por tipo de servicio',
    description: 'Sumatorio de sesiones por tipo de servicio',
  },
];

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfIsoWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function buildWeekRange(reference: Date) {
  const start = startOfIsoWeek(reference);
  const end = addDays(start, 6);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function buildMonthRange(reference: Date) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function buildQuarterRange(reference: Date) {
  const quarter = Math.floor(reference.getMonth() / 3);
  const startMonth = quarter * 3;
  const start = new Date(reference.getFullYear(), startMonth, 1);
  const end = new Date(reference.getFullYear(), startMonth + 3, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function buildYearRange(reference: Date) {
  const start = new Date(reference.getFullYear(), 0, 1);
  const end = new Date(reference.getFullYear(), 12, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function toPreviousYearDate(value: string) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  date.setFullYear(date.getFullYear() - 1);
  return formatDate(date);
}

function buildInitialPeriod(today: Date) {
  const start = new Date(today);
  start.setDate(1);

  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function buildComparisonPeriod(today: Date) {
  const start = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const end = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function normalizeSparkline(points?: number[]) {
  if (!Array.isArray(points)) return Array(12).fill(0);
  if (points.length >= 12) return points.slice(-12);
  const padding = Array(12 - points.length).fill(0);
  return [...padding, ...points];
}

export default function ComparativaDashboardPage() {
  const today = useMemo(() => new Date(), []);
  const [filters, setFilters] = useState<ComparativaFilters>({
    currentPeriod: buildInitialPeriod(today),
    previousPeriod: buildComparisonPeriod(today),
    granularity: 'isoWeek',
  });

  const quickRanges = useMemo(
    () => [
      { label: 'Semana actual', range: buildWeekRange(today) },
      { label: 'Semana pasada', range: buildWeekRange(addDays(today, -7)) },
      { label: 'Mes actual', range: buildMonthRange(today) },
      { label: 'Mes pasado', range: buildMonthRange(new Date(today.getFullYear(), today.getMonth() - 1, 1)) },
      { label: 'Trimestre actual', range: buildQuarterRange(today) },
      { label: 'Trimestre pasado', range: buildQuarterRange(new Date(today.getFullYear(), today.getMonth() - 3, 1)) },
      { label: 'Año actual', range: buildYearRange(today) },
      { label: 'Año pasado', range: buildYearRange(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())) },
    ],
    [today],
  );

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

  const handleDateChange = (
    period: 'currentPeriod' | 'previousPeriod',
    key: 'startDate' | 'endDate',
    value: string,
  ) => {
    setFilters((prev) => {
      const updated: ComparativaFilters = {
        ...prev,
        [period]: {
          ...prev[period],
          [key]: value,
        },
      };

      if (period === 'currentPeriod') {
        updated.previousPeriod = {
          ...prev.previousPeriod,
          [key]: toPreviousYearDate(value),
        };
      }

      return updated;
    });
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

  const applyQuickRange = (range: { startDate: string; endDate: string }) => {
    setFilters((prev) => ({
      ...prev,
      currentPeriod: range,
      previousPeriod: {
        startDate: toPreviousYearDate(range.startDate),
        endDate: toPreviousYearDate(range.endDate),
      },
    }));
  };

  const getBreakdownItems = (
    dimension: (typeof BREAKDOWN_CONFIG)[number]['dimension'],
  ) => {
    return dashboardQuery.data?.breakdowns.filter((item) => item.dimension === dimension) ?? [];
  };

  const renderMetric = (kpi: ComparativaKpi) => {
    const comparativaValue = numberFormatter.format(kpi.lastYearValue);
    const currentValue = numberFormatter.format(kpi.value);
    const absoluteDifference = kpi.value - kpi.lastYearValue;
    const absoluteDifferenceLabel = `${absoluteDifference >= 0 ? '+' : ''}${numberFormatter.format(absoluteDifference)}`;
    const percentageDifference = kpi.lastYearValue === 0
      ? 0
      : (absoluteDifference / kpi.lastYearValue) * 100;
    const percentageDifferenceLabel = `${percentageDifference >= 0 ? '+' : ''}${percentageFormatter.format(percentageDifference)}%`;
    const deltaVariant = percentageDifference > 0 ? 'success' : percentageDifference < 0 ? 'danger' : 'secondary';

    return (
      <Card className="h-100 shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-start">
            <Card.Title as="h6" className="mb-0">
              {kpi.label}
            </Card.Title>
            <Badge bg={deltaVariant} pill>
              {percentageDifferenceLabel}
            </Badge>
          </div>

          <div>
            <div className="fs-3 fw-semibold">{currentValue}</div>
            <div className="text-muted">Comparativa: {comparativaValue}</div>
            <div className="text-muted">Diferencia absoluta: {absoluteDifferenceLabel}</div>
          </div>

          <div>
            <div className="small text-muted mb-1">Evolutivo semanal · últimas 12 semanas</div>
            {renderSparkline(normalizeSparkline(kpi.sparkline))}
          </div>
        </Card.Body>
      </Card>
    );
  };

  const renderBreakdownCard = (
    config: (typeof BREAKDOWN_CONFIG)[number],
  ) => {
    const items = getBreakdownItems(config.dimension);

    return (
      <Card className="h-100 shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <Card.Title as="h6" className="mb-1">
              {config.title}
            </Card.Title>
            <div className="text-muted small">{config.description}</div>
          </div>

          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th className="text-muted small">Etiqueta</th>
                  <th className="text-muted small text-end">Actual</th>
                  <th className="text-muted small text-end">Comparativa</th>
                  <th className="text-muted small text-end">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted small py-3">
                      Sin datos para el periodo seleccionado
                    </td>
                  </tr>
                )}
                {items.map((item) => {
                  const diff = item.current - item.previous;
                  const diffLabel = `${diff >= 0 ? '+' : ''}${numberFormatter.format(diff)}`;
                  const badgeVariant = diff > 0 ? 'success' : diff < 0 ? 'danger' : 'secondary';

                  return (
                    <tr key={item.label}>
                      <td className="small">{item.label}</td>
                      <td className="text-end fw-semibold">{numberFormatter.format(item.current)}</td>
                      <td className="text-end">{numberFormatter.format(item.previous)}</td>
                      <td className="text-end">
                        <Badge bg={badgeVariant}>{diffLabel}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card.Body>
      </Card>
    );
  };

  const getMetricData = (key: string): ComparativaKpi => {
    const placeholder: ComparativaKpi = {
      key,
      label: METRIC_CONFIG.find((item) => item.key === key)?.label ?? key,
      value: 0,
      lastYearValue: 0,
      deltaPercentage: 0,
      sparkline: Array(12).fill(0),
    };
    return dashboardQuery.data?.highlights.find((item) => item.key === key) ?? placeholder;
  };

  const renderContent = () => {
    if (dashboardQuery.isLoading) {
      return (
        <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 240 }}>
          <Spinner animation="border" role="status" />
        </div>
      );
    }

    if (dashboardQuery.isError) {
      const errorMessage = isApiError(dashboardQuery.error)
        ? dashboardQuery.error.message
        : 'No se pudo cargar la comparativa. Inténtalo de nuevo más tarde.';
      return <div className="text-danger">{errorMessage}</div>;
    }

    return (
      <div className="d-flex flex-column gap-4 mt-3">
        <Row xs={1} md={2} lg={3} className="g-3">
          {METRIC_CONFIG.map((metric) => (
            <Col key={metric.key}>{renderMetric(getMetricData(metric.key))}</Col>
          ))}
        </Row>

        <Row className="g-3">
          {BREAKDOWN_CONFIG.map((item) => (
            <Col xs={12} md={6} key={item.dimension}>
              {renderBreakdownCard(item)}
            </Col>
          ))}
        </Row>
      </div>
    );
  };

  return (
    <div className="p-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
        <div>
          <h4 className="mb-1">Comparativa</h4>
          <div className="text-muted">Revisa la evolución semanal de sesiones y su comparación</div>
        </div>
      </div>

      <Card className="shadow-sm">
        <Card.Body>
          <div className="d-flex flex-wrap gap-2 mb-3">
            {quickRanges.map((item) => (
              <Button
                key={item.label}
                size="sm"
                variant="outline-primary"
                onClick={() => applyQuickRange(item.range)}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <Row className="g-3">
            <Col xs={12} md={6}>
              <div className="fw-semibold mb-2">Fechas</div>
              <Row className="g-2">
                <Col>
                  <Form.Label className="small text-muted">Fecha inicio</Form.Label>
                  <Form.Control
                    type="date"
                    value={filters.currentPeriod.startDate}
                    onChange={(event) => handleDateChange('currentPeriod', 'startDate', event.target.value)}
                  />
                </Col>
                <Col>
                  <Form.Label className="small text-muted">Fecha fin</Form.Label>
                  <Form.Control
                    type="date"
                    value={filters.currentPeriod.endDate}
                    onChange={(event) => handleDateChange('currentPeriod', 'endDate', event.target.value)}
                  />
                </Col>
              </Row>
            </Col>

            <Col xs={12} md={6}>
              <div className="fw-semibold mb-2">Comparativa</div>
              <Row className="g-2">
                <Col>
                  <Form.Label className="small text-muted">Fecha inicio</Form.Label>
                  <Form.Control
                    type="date"
                    value={filters.previousPeriod.startDate}
                    onChange={(event) => handleDateChange('previousPeriod', 'startDate', event.target.value)}
                  />
                </Col>
                <Col>
                  <Form.Label className="small text-muted">Fecha fin</Form.Label>
                  <Form.Control
                    type="date"
                    value={filters.previousPeriod.endDate}
                    onChange={(event) => handleDateChange('previousPeriod', 'endDate', event.target.value)}
                  />
                </Col>
              </Row>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {renderContent()}
    </div>
  );
}
