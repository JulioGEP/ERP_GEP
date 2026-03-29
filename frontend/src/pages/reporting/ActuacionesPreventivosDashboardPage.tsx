import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  fetchActuacionesPreventivosInformes,
  type ActuacionesPreventivosInforme,
} from '../../features/reporting/api';

type Granularity = 'dia' | 'semana' | 'mes';

type KpiRow = {
  periodo: string;
  actividadTotal: number;
  partesTrabajo: number;
  asistenciasSanitarias: number;
  promedioActividadDiaria: number;
};

function toDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfIsoWeek(date: Date): Date {
  const normalized = toDateOnly(date);
  const day = normalized.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  normalized.setDate(normalized.getDate() + diff);
  return normalized;
}

function endOfIsoWeek(date: Date): Date {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

function parseDateSafe(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateDisplay(value: string): string {
  const date = parseDateSafe(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function getMonthLabel(date: Date): string {
  const month = new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(date);
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
}

function getIsoWeek(date: Date): { year: number; week: number } {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: utcDate.getUTCFullYear(), week };
}

function buildKpiRows(informes: ActuacionesPreventivosInforme[], granularity: Granularity): KpiRow[] {
  const grouped = new Map<string, { label: string; days: Set<string>; partes: number; asistencias: number }>();

  for (const informe of informes) {
    const date = parseDateSafe(informe.fechaEjercicio);
    if (!date) continue;

    const dayKey = formatDateInput(date);

    let key = '';
    let label = '';
    if (granularity === 'dia') {
      key = dayKey;
      label = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date);
    } else if (granularity === 'semana') {
      const week = getIsoWeek(date);
      key = `${week.year}-W${String(week.week).padStart(2, '0')}`;
      const weekStart = startOfIsoWeek(date);
      const weekEnd = endOfIsoWeek(date);
      label = `${new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit' }).format(weekStart)} - ${new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(weekEnd)}`;
    } else {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      label = getMonthLabel(date);
    }

    const current = grouped.get(key) ?? {
      label,
      days: new Set<string>(),
      partes: 0,
      asistencias: 0,
    };

    current.days.add(dayKey);
    current.partes += informe.partesTrabajo;
    current.asistencias += informe.asistenciasSanitarias;

    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => {
      const actividadTotal = value.partes + value.asistencias;
      return {
        periodo: value.label,
        actividadTotal,
        partesTrabajo: value.partes,
        asistenciasSanitarias: value.asistencias,
        promedioActividadDiaria: value.days.size ? actividadTotal / value.days.size : 0,
      };
    });
}

export default function ActuacionesPreventivosDashboardPage() {
  const today = useMemo(() => new Date(), []);
  const [granularity, setGranularity] = useState<Granularity>('mes');
  const [startDate, setStartDate] = useState<string>(() => formatDateInput(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [endDate, setEndDate] = useState<string>(() => formatDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 0)));

  const informesQuery = useQuery({
    queryKey: ['reporting', 'actuaciones-preventivos', startDate, endDate],
    queryFn: () =>
      fetchActuacionesPreventivosInformes({
        startDate,
        endDate,
      }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const informes = informesQuery.data ?? [];

  const kpis = useMemo(() => buildKpiRows(informes, granularity), [informes, granularity]);

  const totals = useMemo(() => {
    return informes.reduce(
      (acc, informe) => {
        acc.partes += informe.partesTrabajo;
        acc.asistencias += informe.asistenciasSanitarias;
        return acc;
      },
      { partes: 0, asistencias: 0 },
    );
  }, [informes]);

  return (
    <section className="py-3 d-grid gap-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">Dashboard - Actuaciones preventivos</Card.Header>
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col xs={12} md={4} lg={3}>
              <Form.Group controlId="granularity">
                <Form.Label>Filtro KPI</Form.Label>
                <Form.Select value={granularity} onChange={(event) => setGranularity(event.target.value as Granularity)}>
                  <option value="dia">Día</option>
                  <option value="semana">Semana</option>
                  <option value="mes">Mes</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={12} md={4} lg={3}>
              <Form.Group controlId="startDate">
                <Form.Label>Desde</Form.Label>
                <Form.Control type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </Form.Group>
            </Col>
            <Col xs={12} md={4} lg={3}>
              <Form.Group controlId="endDate">
                <Form.Label>Hasta</Form.Label>
                <Form.Control type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </Form.Group>
            </Col>
            <Col xs={12} lg={3}>
              <div className="d-flex flex-wrap gap-2">
                <Badge bg="primary">Informes: {informes.length}</Badge>
                <Badge bg="secondary">Partes: {totals.partes}</Badge>
                <Badge bg="secondary">Asistencias: {totals.asistencias}</Badge>
              </div>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Header as="h2" className="h5 mb-0">KPIs</Card.Header>
        <Card.Body>
          {informesQuery.isLoading ? (
            <div className="d-flex justify-content-center py-4">
              <Spinner animation="border" role="status" />
            </div>
          ) : informesQuery.isError ? (
            <Alert variant="danger">
              {isApiError(informesQuery.error)
                ? informesQuery.error.message
                : 'No se pudo cargar el resumen de KPIs.'}
            </Alert>
          ) : kpis.length === 0 ? (
            <Alert variant="info">No hay datos para el rango seleccionado.</Alert>
          ) : (
            <div className="table-responsive">
              <Table striped bordered hover size="sm" className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th>Actividad total</th>
                    <th>Partes trabajo</th>
                    <th>Asistencias sanitarias</th>
                    <th>Promedio actividad/día</th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.map((row) => (
                    <tr key={row.periodo}>
                      <td>{row.periodo}</td>
                      <td>{row.actividadTotal}</td>
                      <td>{row.partesTrabajo}</td>
                      <td>{row.asistenciasSanitarias}</td>
                      <td>{row.promedioActividadDiaria.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Header as="h2" className="h5 mb-0">Logs de informes</Card.Header>
        <Card.Body>
          {informesQuery.isLoading ? (
            <div className="d-flex justify-content-center py-4">
              <Spinner animation="border" role="status" />
            </div>
          ) : informesQuery.isError ? (
            <Alert variant="danger">
              {isApiError(informesQuery.error)
                ? informesQuery.error.message
                : 'No se pudieron cargar los logs de informes.'}
            </Alert>
          ) : informes.length === 0 ? (
            <Alert variant="info">No hay informes en el rango seleccionado.</Alert>
          ) : (
            <div className="table-responsive">
              <Table striped bordered hover size="sm" className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Fecha ejercicio</th>
                    <th>Deal ID</th>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    <th>Dirección preventivo</th>
                    <th>Bombero</th>
                    <th>Turno</th>
                    <th>Partes</th>
                    <th>Asistencias</th>
                    <th>Observaciones</th>
                    <th>Responsable</th>
                  </tr>
                </thead>
                <tbody>
                  {informes.map((informe) => (
                    <tr key={informe.id}>
                      <td>{formatDateDisplay(informe.fechaEjercicio)}</td>
                      <td className="text-nowrap">{informe.dealId}</td>
                      <td>{informe.cliente ?? '—'}</td>
                      <td>{informe.personaContacto ?? '—'}</td>
                      <td>{informe.direccionPreventivo ?? '—'}</td>
                      <td>{informe.bombero ?? '—'}</td>
                      <td>{informe.turno ?? '—'}</td>
                      <td>{informe.partesTrabajo}</td>
                      <td>{informe.asistenciasSanitarias}</td>
                      <td>{informe.observaciones ?? '—'}</td>
                      <td>{informe.responsable ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>
    </section>
  );
}
