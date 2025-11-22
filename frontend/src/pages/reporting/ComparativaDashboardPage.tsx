import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Badge, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  fetchComparativaDashboard,
  type ComparativaFilters,
  type ComparativaKpi,
} from '../../features/reporting/api';

const METRIC_CONFIG: { key: string; label: string }[] = [
  { key: 'gepServicesSessions', label: 'Sumatorio de sesiones de GEP Services' },
  { key: 'formacionEmpresaSessions', label: 'Sumatorio de sesiones de Formacion Empresa' },
  { key: 'formacionAbiertaVariantesSessions', label: 'Sumatorio de sesiones de Formación abierta (Variantes)' },
];

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildInitialPeriod(today: Date, weeksBack: number) {
  const start = new Date(today);
  start.setDate(start.getDate() - weeksBack * 7 + 1);
  return {
    startDate: formatDate(start),
    endDate: formatDate(today),
  } as const;
}

function buildComparisonPeriod(today: Date, weeksBack: number) {
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() - weeksBack * 7 + 1);

  const end = new Date(today);
  end.setFullYear(end.getFullYear() - 1);

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
  const initialWeeks = 12;

  const [filters, setFilters] = useState<ComparativaFilters>({
    currentPeriod: buildInitialPeriod(today, initialWeeks),
    previousPeriod: buildComparisonPeriod(today, initialWeeks),
    granularity: 'isoWeek',
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
    setFilters((prev) => ({
      ...prev,
      [period]: {
        ...prev[period],
        [key]: value,
      },
    }));
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

  const renderMetric = (kpi: ComparativaKpi) => {
    const comparativaValue = numberFormatter.format(kpi.lastYearValue);
    const currentValue = numberFormatter.format(kpi.value);
    const diff = kpi.value - kpi.lastYearValue;
    const diffLabel = `${diff >= 0 ? '+' : ''}${numberFormatter.format(diff)}`;
    const diffPercentage = kpi.lastYearValue === 0
      ? 0
      : (diff / kpi.lastYearValue) * 100;
    const diffPercentageLabel = `${diffPercentage >= 0 ? '+' : ''}${percentageFormatter.format(diffPercentage)}%`;
    const deltaVariant = diffPercentage >= 0 ? 'success' : 'danger';

    return (
      <Card className="h-100 shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-start">
            <Card.Title as="h6" className="mb-0">
              {kpi.label}
            </Card.Title>
            <Badge bg={deltaVariant} pill>
              {diffPercentageLabel} vs comparativa
            </Badge>
          </div>

          <div>
            <div className="fs-3 fw-semibold">{currentValue}</div>
            <div className="text-muted">Comparativa: {comparativaValue} ({diffLabel})</div>
          </div>

          <div>
            <div className="small text-muted mb-1">Evolutivo semanal · últimas 12 semanas</div>
            {renderSparkline(normalizeSparkline(kpi.sparkline))}
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
      <Row xs={1} md={2} lg={3} className="g-3 mt-3">
        {METRIC_CONFIG.map((metric) => (
          <Col key={metric.key}>{renderMetric(getMetricData(metric.key))}</Col>
        ))}
      </Row>
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
