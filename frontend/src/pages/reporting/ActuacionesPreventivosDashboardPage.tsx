import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Form, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  fetchActuacionesPreventivosDashboard,
  type ActuacionesPreventivosDashboardFilters,
  type ActuacionesPreventivosLogItem,
  type ActuacionesPreventivosMonthlyKpi,
} from '../../features/reporting/api';

type Granularity = 'day' | 'week' | 'month';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatDateTime(value: string, formatter: Intl.DateTimeFormat): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatter.format(parsed);
}

function formatMonthLabel(monthText: string): string {
  const [yearRaw, monthRaw] = monthText.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return monthText;
  }

  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function startOfIsoWeek(date: Date): Date {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy;
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveRange(granularity: Granularity, value: string): ActuacionesPreventivosDashboardFilters {
  if (!value.trim()) return {};

  if (granularity === 'day') {
    return { startDate: value, endDate: value };
  }

  if (granularity === 'month') {
    const [yearRaw, monthRaw] = value.split('-');
    const year = Number.parseInt(yearRaw, 10);
    const monthIndex = Number.parseInt(monthRaw, 10) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
      return {};
    }

    const start = new Date(Date.UTC(year, monthIndex, 1));
    const end = new Date(Date.UTC(year, monthIndex + 1, 0));
    return { startDate: toDateInput(start), endDate: toDateInput(end) };
  }

  const [yearPart, weekPart] = value.split('-W');
  const year = Number.parseInt(yearPart, 10);
  const week = Number.parseInt(weekPart, 10);

  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) {
    return {};
  }

  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekOneStart = startOfIsoWeek(januaryFourth);
  const start = new Date(weekOneStart);
  start.setUTCDate(start.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

function totalizeKpis(items: ActuacionesPreventivosMonthlyKpi[]) {
  return items.reduce(
    (acc, item) => {
      acc.informesCount += item.informesCount;
      acc.partesTrabajo += item.partesTrabajo;
      acc.asistenciasSanitarias += item.asistenciasSanitarias;
      acc.actividadTotal += item.actividadTotal;
      acc.diasConActividad += item.diasConActividad;
      return acc;
    },
    {
      informesCount: 0,
      partesTrabajo: 0,
      asistenciasSanitarias: 0,
      actividadTotal: 0,
      diasConActividad: 0,
      promedioActividadDia: 0,
    },
  );
}

export default function ActuacionesPreventivosDashboardPage() {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [filterValue, setFilterValue] = useState<string>('');

  const queryFilters = useMemo(
    () => resolveRange(granularity, filterValue),
    [granularity, filterValue],
  );

  const dashboardQuery = useQuery({
    queryKey: ['reporting', 'actuaciones-preventivos', queryFilters.startDate ?? '', queryFilters.endDate ?? ''],
    queryFn: () => fetchActuacionesPreventivosDashboard(queryFilters),
    staleTime: 60_000,
  });

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [],
  );

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat('es-ES', {
        maximumFractionDigits: 2,
      }),
    [],
  );

  const monthlyKpis = dashboardQuery.data?.monthlyKpis ?? [];
  const logs = dashboardQuery.data?.logs ?? [];
  const totals = totalizeKpis(monthlyKpis);
  const globalAverage = totals.diasConActividad > 0 ? totals.actividadTotal / totals.diasConActividad : 0;

  let content: JSX.Element;

  if (dashboardQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (dashboardQuery.isError) {
    const message = isApiError(dashboardQuery.error)
      ? dashboardQuery.error.message
      : 'No se pudieron cargar los datos de actuaciones preventivos.';
    content = <Alert variant="danger">{message}</Alert>;
  } else {
    content = (
      <div className="d-grid gap-3">
        <Card className="shadow-sm">
          <Card.Header className="fw-semibold">KPI mensuales</Card.Header>
          <Card.Body>
            {monthlyKpis.length === 0 ? (
              <Alert variant="info" className="mb-0">
                No hay datos para el filtro seleccionado.
              </Alert>
            ) : (
              <div className="table-responsive">
                <Table striped bordered hover size="sm" className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Mes</th>
                      <th>Informes</th>
                      <th>Partes</th>
                      <th>Asistencias</th>
                      <th>Actividad total</th>
                      <th>Días con actividad</th>
                      <th>Promedio actividad/día</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyKpis.map((row) => (
                      <tr key={row.month}>
                        <td>{formatMonthLabel(row.month)}</td>
                        <td>{numberFormatter.format(row.informesCount)}</td>
                        <td>{numberFormatter.format(row.partesTrabajo)}</td>
                        <td>{numberFormatter.format(row.asistenciasSanitarias)}</td>
                        <td>{numberFormatter.format(row.actividadTotal)}</td>
                        <td>{numberFormatter.format(row.diasConActividad)}</td>
                        <td>{numberFormatter.format(row.promedioActividadDia)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="fw-semibold">
                      <td>Total</td>
                      <td>{numberFormatter.format(totals.informesCount)}</td>
                      <td>{numberFormatter.format(totals.partesTrabajo)}</td>
                      <td>{numberFormatter.format(totals.asistenciasSanitarias)}</td>
                      <td>{numberFormatter.format(totals.actividadTotal)}</td>
                      <td>{numberFormatter.format(totals.diasConActividad)}</td>
                      <td>{numberFormatter.format(globalAverage)}</td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            )}
          </Card.Body>
        </Card>

        <Card className="shadow-sm">
          <Card.Header className="fw-semibold">Logs por informe</Card.Header>
          <Card.Body>
            {logs.length === 0 ? (
              <Alert variant="info" className="mb-0">
                No hay informes para mostrar.
              </Alert>
            ) : (
              <div className="table-responsive">
                <Table striped bordered hover size="sm" className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Fecha ejercicio</th>
                      <th>Presupuesto</th>
                      <th>Cliente</th>
                      <th>Turno</th>
                      <th>Partes</th>
                      <th>Asistencias</th>
                      <th>Actividad</th>
                      <th>Bombero</th>
                      <th>Responsable</th>
                      <th>Observaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log: ActuacionesPreventivosLogItem) => (
                      <tr key={log.id}>
                        <td>{formatDateTime(log.fechaEjercicio, dateTimeFormatter)}</td>
                        <td>{log.presupuesto}</td>
                        <td>{log.cliente}</td>
                        <td>{log.turno}</td>
                        <td>{numberFormatter.format(log.partesTrabajo)}</td>
                        <td>{numberFormatter.format(log.asistenciasSanitarias)}</td>
                        <td>{numberFormatter.format(log.actividadTotal)}</td>
                        <td>{log.bombero}</td>
                        <td>{log.responsable}</td>
                        <td className="text-break">{log.observaciones || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    );
  }

  return (
    <section className="py-3 d-grid gap-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Dashboard de Actuaciones Preventivos
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Vista operativa con KPI mensuales y el detalle de logs por informe.
          </p>
          <div className="row g-3 align-items-end">
            <div className="col-md-3">
              <Form.Label>Filtrar por</Form.Label>
              <Form.Select
                value={granularity}
                onChange={(event) => {
                  setGranularity(event.target.value as Granularity);
                  setFilterValue('');
                }}
              >
                <option value="day">Día</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
              </Form.Select>
            </div>
            <div className="col-md-3">
              <Form.Label>Valor</Form.Label>
              {granularity === 'day' ? (
                <Form.Control
                  type="date"
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                />
              ) : null}
              {granularity === 'week' ? (
                <Form.Control
                  type="week"
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                />
              ) : null}
              {granularity === 'month' ? (
                <Form.Control
                  type="month"
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                />
              ) : null}
            </div>
            <div className="col-md-6">
              <div className="text-muted small">
                Si dejas el valor vacío, se muestra el histórico completo disponible.
              </div>
            </div>
          </div>
        </Card.Body>
      </Card>

      {content}
    </section>
  );
}
