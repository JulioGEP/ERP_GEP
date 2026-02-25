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
  dietas: 'Dietas',
  kilometraje: 'Kilometraje',
  pernocta: 'Pernocta',
  nocturnidad: 'Nocturnidad',
  festivo: 'Festivo',
  horasExtras: 'Horas extras',
  gastosExtras: 'Gastos extras',
};

const METRIC_ORDER: PayrollReportMetricKey[] = [
  'salarioBruto',
  'salarioBrutoTotal',
  'salarioLimpio',
  'contingenciasComunes',
  'aportacionSsIrpf',
  'totalEmpresa',
  'dietas',
  'kilometraje',
  'pernocta',
  'nocturnidad',
  'festivo',
  'horasExtras',
  'gastosExtras',
];

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

export default function ReporteNominasPage() {
  const [period, setPeriod] = useState<string>(buildCurrentMonthPeriod());

  const query = useQuery({
    queryKey: ['reporting', 'reporte-nominas', period],
    queryFn: () => fetchReporteNominas(period),
  });

  const queryError = query.error instanceof ApiError ? query.error.message : 'No se pudo cargar el reporte.';

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
        </>
      ) : null}
    </div>
  );
}
