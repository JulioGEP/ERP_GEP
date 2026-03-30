import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap';
import type { Content, TableCell } from 'pdfmake/interfaces';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { isApiError } from '../../api/client';
import {
  fetchActuacionesPreventivosInformes,
  type ActuacionesPreventivosInforme,
} from '../../features/reporting/api';
import { emitToast } from '../../utils/toast';

type Granularity = 'dia' | 'semana' | 'mes';

type KpiRow = {
  periodo: string;
  turnos: number;
  actividadTotal: number;
  partesTrabajo: number;
  asistenciasSanitarias: number;
  promedioActividadDiaria: number;
};

const WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;
const MONTH_LABELS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'] as const;

type LineChartPoint = {
  month: string;
  turnos: number;
  partes: number;
  asistencias: number;
};

type WeekDayDetail = {
  day: (typeof WEEK_DAYS)[number];
  turnos: number;
  actividad: number;
  partes: number;
  asistencias: number;
};

const ACCUMULATED_WEEK_KEY = '__acumulada__';

type PdfMakeWithVfs = typeof pdfMake & {
  vfs?: Record<string, string>;
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

function toDayIndex(date: Date): number {
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

function getWeekOfMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

function formatDateDisplay(value: string): string {
  const date = parseDateSafe(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatDateOnlyDisplay(value: string): string {
  const date = parseDateSafe(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date);
}

function ensurePdfMakeFontsLoaded(): void {
  const pdfMakeWithVfs = pdfMake as PdfMakeWithVfs;
  if (pdfMakeWithVfs.vfs && Object.keys(pdfMakeWithVfs.vfs).length > 0) return;

  const bundledFonts = pdfFonts as { pdfMake?: { vfs?: Record<string, string> } };
  const bundledVfs = bundledFonts.pdfMake?.vfs;

  if (bundledVfs) {
    pdfMakeWithVfs.vfs = bundledVfs;
  }
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
  const grouped = new Map<string, { label: string; days: Set<string>; turnos: number; partes: number; asistencias: number }>();

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
      turnos: 0,
      partes: 0,
      asistencias: 0,
    };

    current.days.add(dayKey);
    current.turnos += 1;
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
        turnos: value.turnos,
        actividadTotal,
        partesTrabajo: value.partes,
        asistenciasSanitarias: value.asistencias,
        promedioActividadDiaria: value.days.size ? actividadTotal / value.days.size : 0,
      };
    });
}

export default function ActuacionesPreventivosDashboardPage() {
  const today = useMemo(() => new Date(), []);
  const [selectedTurno, setSelectedTurno] = useState<string>('todos');
  const [granularity, setGranularity] = useState<Granularity>('mes');
  const [startDate, setStartDate] = useState<string>(() => formatDateInput(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [endDate, setEndDate] = useState<string>(() => formatDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [selectedWeekOfMonth, setSelectedWeekOfMonth] = useState<string>(ACCUMULATED_WEEK_KEY);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>(ACCUMULATED_WEEK_KEY);
  const [heatMapMonth, setHeatMapMonth] = useState<number>(0);

  const informesQuery = useQuery({
    queryKey: ['reporting', 'actuaciones-preventivos', startDate, endDate, selectedTurno],
    queryFn: () =>
      fetchActuacionesPreventivosInformes({
        startDate,
        endDate,
        turno: selectedTurno === 'todos' ? undefined : selectedTurno,
      }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const informes = informesQuery.data ?? [];

  const kpis = useMemo(() => buildKpiRows(informes, granularity), [informes, granularity]);

  const totals = useMemo(() => {
    return informes.reduce(
      (acc, informe) => {
        acc.turnos += 1;
        acc.partes += informe.partesTrabajo;
        acc.asistencias += informe.asistenciasSanitarias;
        return acc;
      },
      { turnos: 0, partes: 0, asistencias: 0 },
    );
  }, [informes]);

  const lineChartData = useMemo<LineChartPoint[]>(() => {
    const grouped = new Map<number, { turnos: number; partes: number; asistencias: number }>();
    for (let month = 0; month < 12; month += 1) {
      grouped.set(month, { turnos: 0, partes: 0, asistencias: 0 });
    }

    for (const informe of informes) {
      const date = parseDateSafe(informe.fechaEjercicio);
      if (!date) continue;
      if (selectedWeekOfMonth !== ACCUMULATED_WEEK_KEY && getWeekOfMonth(date).toString() !== selectedWeekOfMonth) continue;
      const current = grouped.get(date.getMonth());
      if (!current) continue;
      current.turnos += 1;
      current.partes += informe.partesTrabajo;
      current.asistencias += informe.asistenciasSanitarias;
    }

    return MONTH_LABELS.map((month, index) => ({
      month,
      turnos: grouped.get(index)?.turnos ?? 0,
      partes: grouped.get(index)?.partes ?? 0,
      asistencias: grouped.get(index)?.asistencias ?? 0,
    }));
  }, [informes, selectedWeekOfMonth]);

  const weekOptions = useMemo(() => {
    const weeks = new Set<string>();
    for (const informe of informes) {
      const date = parseDateSafe(informe.fechaEjercicio);
      if (!date) continue;
      const week = getIsoWeek(date);
      weeks.add(`${week.year}-W${String(week.week).padStart(2, '0')}`);
    }
    return Array.from(weeks).sort();
  }, [informes]);

  const activeWeekKey = useMemo(() => {
    if (selectedWeekKey === ACCUMULATED_WEEK_KEY) return ACCUMULATED_WEEK_KEY;
    if (selectedWeekKey && weekOptions.includes(selectedWeekKey)) return selectedWeekKey;
    return weekOptions[0] ?? ACCUMULATED_WEEK_KEY;
  }, [selectedWeekKey, weekOptions]);

  const selectedWeekDetails = useMemo<WeekDayDetail[]>(() => {
    const byDay = WEEK_DAYS.map((day) => ({ day, turnos: 0, actividad: 0, partes: 0, asistencias: 0 }));
    const isAccumulatedWeek = activeWeekKey === ACCUMULATED_WEEK_KEY;

    for (const informe of informes) {
      const date = parseDateSafe(informe.fechaEjercicio);
      if (!date) continue;
      const week = getIsoWeek(date);
      const key = `${week.year}-W${String(week.week).padStart(2, '0')}`;
      if (!isAccumulatedWeek && key !== activeWeekKey) continue;
      const dayIndex = toDayIndex(date);
      byDay[dayIndex].turnos += 1;
      byDay[dayIndex].partes += informe.partesTrabajo;
      byDay[dayIndex].asistencias += informe.asistenciasSanitarias;
      byDay[dayIndex].actividad += informe.partesTrabajo + informe.asistenciasSanitarias;
    }
    return byDay;
  }, [activeWeekKey, informes]);

  const heatMapRows = useMemo(() => {
    const grouped = new Map<number, number[]>();
    for (const informe of informes) {
      const date = parseDateSafe(informe.fechaEjercicio);
      if (!date) continue;
      if (heatMapMonth !== 0 && date.getMonth() + 1 !== heatMapMonth) continue;
      const weekNumber = getIsoWeek(date).week;
      const current = grouped.get(weekNumber) ?? Array(7).fill(0);
      current[toDayIndex(date)] += informe.partesTrabajo + informe.asistenciasSanitarias;
      grouped.set(weekNumber, current);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .map(([week, values]) => ({ week, values }));
  }, [heatMapMonth, informes]);

  const maxHeatValue = useMemo(() => {
    return heatMapRows.reduce((max, row) => Math.max(max, ...row.values), 0);
  }, [heatMapRows]);

  const maxLineValue = useMemo(() => {
    return lineChartData.reduce((max, row) => Math.max(max, row.turnos, row.partes, row.asistencias), 0);
  }, [lineChartData]);

  const handleDownloadPdf = () => {
    if (informes.length === 0) {
      emitToast({ variant: 'warning', message: 'No hay datos para exportar en PDF.' });
      return;
    }

    try {
      ensurePdfMakeFontsLoaded();

      const kpiRows: TableCell[][] = [
        [
          { text: 'Periodo', style: 'tableHeader' },
          { text: 'Turnos', style: 'tableHeader', alignment: 'right' },
          { text: 'Actividad total', style: 'tableHeader', alignment: 'right' },
          { text: 'Partes trabajo', style: 'tableHeader', alignment: 'right' },
          { text: 'Asistencias sanitarias', style: 'tableHeader', alignment: 'right' },
          { text: 'Promedio actividad/día', style: 'tableHeader', alignment: 'right' },
        ],
        ...kpis.map((row) => ([
          row.periodo,
          { text: row.turnos.toString(), alignment: 'right' as const },
          { text: row.actividadTotal.toString(), alignment: 'right' as const },
          { text: row.partesTrabajo.toString(), alignment: 'right' as const },
          { text: row.asistenciasSanitarias.toString(), alignment: 'right' as const },
          { text: row.promedioActividadDiaria.toFixed(2), alignment: 'right' as const },
        ])),
      ];

      const logRows: TableCell[][] = [
        [
          { text: 'Fecha', style: 'tableHeader' },
          { text: 'Deal ID', style: 'tableHeader' },
          { text: 'Cliente', style: 'tableHeader' },
          { text: 'Contacto', style: 'tableHeader' },
          { text: 'Dirección', style: 'tableHeader' },
          { text: 'Bombero', style: 'tableHeader' },
          { text: 'Turno', style: 'tableHeader' },
          { text: 'Partes', style: 'tableHeader', alignment: 'right' },
          { text: 'Asistencias', style: 'tableHeader', alignment: 'right' },
          { text: 'Observaciones', style: 'tableHeader' },
          { text: 'Responsable', style: 'tableHeader' },
        ],
        ...informes.map((informe) => ([
          formatDateDisplay(informe.fechaEjercicio),
          informe.dealId,
          informe.cliente ?? '—',
          informe.personaContacto ?? '—',
          informe.direccionPreventivo ?? '—',
          informe.bombero ?? '—',
          informe.turno ?? '—',
          { text: informe.partesTrabajo.toString(), alignment: 'right' as const },
          { text: informe.asistenciasSanitarias.toString(), alignment: 'right' as const },
          informe.observaciones ?? '—',
          informe.responsable ?? '—',
        ])),
      ];

      const content: Content[] = [
        { text: 'Informe completo - Actuaciones preventivos', style: 'title' },
        {
          text: `Rango: ${formatDateOnlyDisplay(startDate)} - ${formatDateOnlyDisplay(endDate)}`,
          margin: [0, 0, 0, 4],
        },
        {
          text: `Informes: ${informes.length}   |   Turnos: ${totals.turnos}   |   Partes: ${totals.partes}   |   Asistencias: ${totals.asistencias}`,
          margin: [0, 0, 0, 14],
        },
      ];

      if (kpis.length > 0) {
        content.push(
          { text: 'KPIs', style: 'sectionTitle' },
          {
            table: {
              headerRows: 1,
              widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
              body: kpiRows,
            },
            layout: 'lightHorizontalLines',
            fontSize: 9,
            margin: [0, 0, 0, 12],
          },
        );
      }

      content.push(
        { text: 'Logs de informes', style: 'sectionTitle' },
        {
          table: {
            headerRows: 1,
            widths: [58, 38, 58, 52, 66, 50, 30, 28, 35, '*', 52],
            body: logRows,
          },
          layout: 'lightHorizontalLines',
          fontSize: 7,
        },
      );

      pdfMake.createPdf({
        pageOrientation: 'landscape',
        pageMargins: [24, 24, 24, 24],
        content,
        styles: {
          title: { fontSize: 14, bold: true },
          sectionTitle: { fontSize: 11, bold: true, margin: [0, 10, 0, 6] },
          tableHeader: { bold: true, fillColor: '#f1f5f9' },
        },
      }).download(`actuaciones-preventivos-${startDate}-${endDate}.pdf`);
    } catch (error) {
      console.error(error);
      emitToast({ variant: 'danger', message: 'No se pudo generar el PDF del informe.' });
    }
  };

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
              <Form.Group controlId="turnoFilter">
                <Form.Label>Filtro por turno</Form.Label>
                <Form.Select value={selectedTurno} onChange={(event) => setSelectedTurno(event.target.value)}>
                  <option value="todos">Todos</option>
                  <option value="Mañana">Mañana</option>
                  <option value="Noche">Noche</option>
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
              <div className="d-flex flex-wrap gap-2 align-items-center">
                <Badge bg="success">Informes: {informes.length}</Badge>
                <Badge bg="dark">Turnos: {totals.turnos}</Badge>
                <Badge bg="primary">Partes: {totals.partes}</Badge>
                <Badge bg="danger">Asistencias: {totals.asistencias}</Badge>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={handleDownloadPdf}
                  disabled={informesQuery.isLoading || informes.length === 0}
                >
                  Descargar en PDF
                </Button>
              </div>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Header as="h2" className="h5 mb-0">Evolución mensual (según filtro de semana)</Card.Header>
        <Card.Body className="d-grid gap-4">
          <div>
            <h3 className="h6 mb-2">Detalle de la semana seleccionada</h3>
            <Row className="g-3 mb-2">
              <Col xs={12} md={4}>
                <Form.Group controlId="selectedIsoWeek">
                  <Form.Label>Semana ISO</Form.Label>
                  <Form.Select
                    value={activeWeekKey}
                    onChange={(event) => setSelectedWeekKey(event.target.value)}
                  >
                    <option value={ACCUMULATED_WEEK_KEY}>Semana acumulada (todas)</option>
                    {weekOptions.length === 0 ? (
                      <option value="" disabled>Sin semanas disponibles</option>
                    ) : (
                      weekOptions.map((week) => (
                        <option key={week} value={week}>{week}</option>
                      ))
                    )}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <div className="table-responsive">
              <Table striped bordered size="sm" className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Turnos</th>
                    <th>Actividad</th>
                    <th>Partes</th>
                    <th>Asistencias</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedWeekDetails.map((row) => (
                    <tr key={row.day}>
                      <td>{row.day}</td>
                      <td>{row.turnos}</td>
                      <td>{row.actividad}</td>
                      <td>{row.partes}</td>
                      <td>{row.asistencias}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>

          <div>
            <h3 className="h6 mb-2">Heat Map semanal</h3>
            <Row className="g-3 mb-2">
              <Col xs={12} md={4}>
                <Form.Group controlId="heatMapMonth">
                  <Form.Label>Filtro por mes</Form.Label>
                  <Form.Select
                    value={heatMapMonth}
                    onChange={(event) => setHeatMapMonth(Number(event.target.value))}
                  >
                    <option value={0}>Mes = 0 (visión total)</option>
                    {MONTH_LABELS.map((month, index) => (
                      <option key={month} value={index + 1}>{month}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            {heatMapRows.length === 0 ? (
              <Alert variant="info" className="mb-0">No hay datos para construir el heat map semanal.</Alert>
            ) : (
              <div className="table-responsive">
                <Table bordered size="sm" className="align-middle mb-0 text-end">
                  <thead>
                    <tr>
                      <th className="text-start">Semana</th>
                      {WEEK_DAYS.map((day) => (
                        <th key={day}>{day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatMapRows.map((row) => (
                      <tr key={row.week}>
                        <td className="text-start fw-semibold">{row.week}</td>
                        {row.values.map((value, index) => {
                          const intensity = maxHeatValue ? value / maxHeatValue : 0;
                          const alpha = value === 0 ? 0.05 : Math.max(0.15, intensity);
                          return (
                            <td
                              key={`${row.week}-${WEEK_DAYS[index]}`}
                              style={{ backgroundColor: `rgba(220, 53, 69, ${alpha})` }}
                            >
                              {value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>

          <div>
            <h3 className="h6 mb-2">Evolución mensual (según filtro de semana)</h3>
            <Row className="g-3 mb-2">
              <Col xs={12} md={4}>
                <Form.Group controlId="selectedWeekOfMonth">
                  <Form.Label>Semana del mes</Form.Label>
                  <Form.Select
                    value={selectedWeekOfMonth}
                    onChange={(event) => setSelectedWeekOfMonth(event.target.value)}
                  >
                    <option value={ACCUMULATED_WEEK_KEY}>Semana acumulada</option>
                    {[1, 2, 3, 4, 5, 6].map((week) => (
                      <option key={week} value={week.toString()}>Semana {week}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            {informesQuery.isLoading ? (
              <div className="d-flex justify-content-center py-4">
                <Spinner animation="border" role="status" />
              </div>
            ) : (
              <div className="table-responsive">
                <Table bordered size="sm" className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Mes</th>
                      <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Turnos</th>
                      <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Partes</th>
                      <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Asistencias</th>
                      <th>Visual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineChartData.map((row) => {
                      const partesWidth = maxLineValue ? (row.partes / maxLineValue) * 100 : 0;
                      const asistenciasWidth = maxLineValue ? (row.asistencias / maxLineValue) * 100 : 0;
                      const turnosWidth = maxLineValue ? (row.turnos / maxLineValue) * 100 : 0;
                      return (
                        <tr key={row.month}>
                          <td>{row.month}</td>
                          <td className="text-end" style={{ whiteSpace: 'nowrap' }}>{row.turnos}</td>
                          <td className="text-end" style={{ whiteSpace: 'nowrap' }}>{row.partes}</td>
                          <td className="text-end" style={{ whiteSpace: 'nowrap' }}>{row.asistencias}</td>
                          <td style={{ minWidth: 220 }}>
                            <div className="d-grid gap-1">
                              <div className="d-flex align-items-center gap-2">
                                <small className="text-dark fw-semibold" style={{ whiteSpace: 'nowrap' }}>Turnos</small>
                                <div className="bg-dark rounded" style={{ height: 8, width: `${turnosWidth}%`, minWidth: turnosWidth > 0 ? 4 : 0 }} />
                              </div>
                              <div className="d-flex align-items-center gap-2">
                                <small className="text-primary fw-semibold" style={{ whiteSpace: 'nowrap' }}>Partes</small>
                                <div className="bg-primary rounded" style={{ height: 8, width: `${partesWidth}%`, minWidth: partesWidth > 0 ? 4 : 0 }} />
                              </div>
                              <div className="d-flex align-items-center gap-2">
                                <small className="text-danger fw-semibold" style={{ whiteSpace: 'nowrap' }}>Asistencias</small>
                                <div className="bg-danger rounded" style={{ height: 8, width: `${asistenciasWidth}%`, minWidth: asistenciasWidth > 0 ? 4 : 0 }} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </div>
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
                    <th>Turnos</th>
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
                      <td>{row.turnos}</td>
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
