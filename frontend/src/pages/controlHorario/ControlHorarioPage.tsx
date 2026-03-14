import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accordion, Alert, Badge, Button, Card, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import { getVacationTypeVisual } from '../../constants/vacations';
import {
  clockInControlHorario,
  clockOutControlHorario,
  fetchControlHorario,
  type ControlHorarioEntry,
} from '../../features/controlHorario/api';

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getHistoricRange(): { startDate: string; endDate: string } {
  const now = new Date();
  return {
    startDate: '2000-01-01',
    endDate: formatDateKey(now),
  };
}

function diffMinutes(start: string, end: Date): number {
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - startDate.getTime()) / 60000));
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getIsoWeekInfo(date: Date): { week: number; year: number } {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const week =
    1 +
    Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3) / 7);
  return { week, year: isoYear };
}

function getIsoWeekKey(date: Date): string {
  const { week, year } = getIsoWeekInfo(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}


function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function getContractHoursValue(weeklyHours: number | null): number | null {
  if (weeklyHours === null || !Number.isFinite(weeklyHours)) return null;
  const dailyHours = weeklyHours / 5;
  return Math.round(dailyHours * 100) / 100;
}

function formatContractHoursValue(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function getAbsenceLabel(absenceType: string | null, date: string): string {
  if (isWeekend(date)) return 'Fin de semana';
  if (!absenceType) return 'laborable';
  const normalized = absenceType.trim().toUpperCase();
  if (normalized === 'T') return 'laborable';
  return getVacationTypeVisual(normalized).fullLabel;
}

function isLaborableAbsence(absenceLabel: string): boolean {
  return absenceLabel.trim().toLowerCase() === 'laborable';
}

export default function ControlHorarioPage() {
  const [now, setNow] = useState(() => new Date());
  const [range] = useState(getHistoricRange);

  const queryClient = useQueryClient();

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const controlHorarioQuery = useQuery({
    queryKey: ['control-horario', range.startDate, range.endDate],
    queryFn: () => fetchControlHorario({ startDate: range.startDate, endDate: range.endDate }),
    staleTime: 30 * 1000,
  });

  const clockInMutation = useMutation({
    mutationFn: clockInControlHorario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['control-horario'] }),
  });

  const clockOutMutation = useMutation({
    mutationFn: clockOutControlHorario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['control-horario'] }),
  });

  const entries = controlHorarioQuery.data?.entries ?? [];
  const absences = controlHorarioQuery.data?.absences ?? [];
  const contractHoursByMonth = controlHorarioQuery.data?.contractHoursByMonth ?? {};
  const entriesByDate = useMemo(() => {
    const map = new Map<string, ControlHorarioEntry[]>();
    entries.forEach((entry) => {
      const list = map.get(entry.date) ?? [];
      list.push(entry);
      map.set(entry.date, list);
    });
    return map;
  }, [entries]);

  const absencesByDate = useMemo(() => {
    const map = new Map<string, string>();
    absences.forEach((absence) => {
      map.set(absence.date, absence.type);
    });
    return map;
  }, [absences]);

  const todayKey = formatDateKey(now);
  const openEntry = entries.find((entry) => entry.checkIn && !entry.checkOut) ?? null;

  const totalMinutesToday = useMemo(() => {
    const todaysEntries = entriesByDate.get(todayKey) ?? [];
    let total = 0;
    todaysEntries.forEach((entry) => {
      if (entry.checkIn && entry.checkOut) {
        total += diffMinutes(entry.checkIn, new Date(entry.checkOut));
      }
    });
    if (openEntry?.checkIn && openEntry.date === todayKey) {
      total += diffMinutes(openEntry.checkIn, now);
    }
    return total;
  }, [entriesByDate, now, openEntry, todayKey]);

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    [],
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }),
    [],
  );
  const timeShortFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }),
    [],
  );

  const monthFormatter = useMemo(() => new Intl.DateTimeFormat('es-ES', { month: 'long' }), []);
  const historicGroups = useMemo(() => {
    const monthMap = new Map<
      string,
      {
        monthKey: string;
        monthLabel: string;
        year: number;
        month: number;
        dates: string[];
        totalMinutes: number;
      }
    >();

    const dates = Array.from(entriesByDate.keys()).sort((a, b) => b.localeCompare(a));
    dates.forEach((date) => {
      const [yearRaw, monthRaw] = date.split('-');
      const year = Number.parseInt(yearRaw, 10);
      const month = Number.parseInt(monthRaw, 10);
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      const monthDate = new Date(Date.UTC(year, month - 1, 1));

      const existing = monthMap.get(monthKey);
      if (existing) {
        existing.dates.push(date);
      } else {
        monthMap.set(monthKey, {
          monthKey,
          monthLabel: monthFormatter.format(monthDate),
          year,
          month,
          dates: [date],
          totalMinutes: 0,
        });
      }
    });

    const months = Array.from(monthMap.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    months.forEach((monthGroup) => {
      monthGroup.totalMinutes = monthGroup.dates.reduce((acc, date) => {
        const entriesForDate = entriesByDate.get(date) ?? [];
        const dateTotal = entriesForDate.reduce((minutes, entry) => {
          if (!entry.checkIn || !entry.checkOut) return minutes;
          return minutes + diffMinutes(entry.checkIn, new Date(entry.checkOut));
        }, 0);
        return acc + dateTotal;
      }, 0);
    });

    const yearMap = new Map<
      number,
      {
        year: number;
        months: typeof months;
        totalMinutes: number;
      }
    >();

    months.forEach((monthGroup) => {
      const existing = yearMap.get(monthGroup.year);
      if (existing) {
        existing.months.push(monthGroup);
        existing.totalMinutes += monthGroup.totalMinutes;
      } else {
        yearMap.set(monthGroup.year, {
          year: monthGroup.year,
          months: [monthGroup],
          totalMinutes: monthGroup.totalMinutes,
        });
      }
    });

    return Array.from(yearMap.values()).sort((a, b) => b.year - a.year);
  }, [entriesByDate, monthFormatter]);

  const currentYear = now.getFullYear();
  const currentMonthKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const defaultYearKey = historicGroups.find((group) => group.year === currentYear)
    ? String(currentYear)
    : historicGroups[0]
      ? String(historicGroups[0].year)
      : undefined;
  let content: JSX.Element;

  if (controlHorarioQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (controlHorarioQuery.isError) {
    const error = controlHorarioQuery.error;
    const message = isApiError(error) ? error.message : 'No se pudo cargar el control horario.';
    content = <Alert variant="danger">{message}</Alert>;
  } else {
    content = (
      <div className="d-grid gap-3">
        {historicGroups.length ? (
          <Accordion defaultActiveKey={defaultYearKey}>
            {historicGroups.map((yearGroup) => (
              <Accordion.Item eventKey={String(yearGroup.year)} key={yearGroup.year}>
                <Accordion.Header>
                  {yearGroup.year} · Total {formatDuration(yearGroup.totalMinutes)}
                </Accordion.Header>
                <Accordion.Body className="px-0 pb-0">
                  <Accordion defaultActiveKey={currentMonthKey} alwaysOpen>
                    {yearGroup.months.map((monthGroup) => (
                      <Accordion.Item key={monthGroup.monthKey} eventKey={monthGroup.monthKey}>
                        <Accordion.Header>
                          {monthGroup.monthLabel.charAt(0).toUpperCase() + monthGroup.monthLabel.slice(1)} · Total{' '}
                          {formatDuration(monthGroup.totalMinutes)}
                        </Accordion.Header>
                        <Accordion.Body>
                          <div className="table-responsive">
                            <Table bordered hover className="align-middle mb-0">
                              <thead>
                                <tr>
                                  <th style={{ width: '18%' }}>Fecha</th>
                                  <th>Fichajes</th>
                                  <th style={{ width: '10%' }}>Contrato</th>
                                  <th style={{ width: '16%' }}>Ausencia</th>
                                  <th style={{ width: '12%' }}>Total</th>
                                  <th style={{ width: '12%' }}>Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(() => {
                                  const weekGroups = monthGroup.dates.reduce<
                                    Array<{
                                      key: string;
                                      label: string;
                                      dates: string[];
                                      totalMinutes: number;
                                    }>
                                  >((groups, date) => {
                                    const jsDate = new Date(`${date}T00:00:00`);
                                    const weekKey = getIsoWeekKey(jsDate);
                                    const weekInfo = getIsoWeekInfo(jsDate);
                                    const label = `Semana ${weekInfo.week} · ${weekInfo.year}`;
                                    const entriesForDate = entriesByDate.get(date) ?? [];
                                    const dateTotalMinutes = entriesForDate.reduce((acc, entry) => {
                                      if (!entry.checkIn || !entry.checkOut) return acc;
                                      return acc + diffMinutes(entry.checkIn, new Date(entry.checkOut));
                                    }, 0);

                                    const existing = groups.find((group) => group.key === weekKey);
                                    if (existing) {
                                      existing.dates.push(date);
                                      existing.totalMinutes += dateTotalMinutes;
                                    } else {
                                      groups.push({
                                        key: weekKey,
                                        label,
                                        dates: [date],
                                        totalMinutes: dateTotalMinutes,
                                      });
                                    }

                                    return groups;
                                  }, []);

                                  return weekGroups.map((weekGroup) => (
                                    <Fragment key={weekGroup.key}>
                                      <tr className="table-light">
                                        <td colSpan={6} className="fw-semibold">
                                          {weekGroup.label}
                                        </td>
                                      </tr>
                                      {weekGroup.dates.map((date) => {
                                        const entriesForDate = entriesByDate.get(date) ?? [];
                                        const totalMinutes = entriesForDate.reduce((acc, entry) => {
                                          if (!entry.checkIn || !entry.checkOut) return acc;
                                          return acc + diffMinutes(entry.checkIn, new Date(entry.checkOut));
                                        }, 0);
                                        const [year, month] = date.split('-');
                                        const monthKey = `${year}-${month}`;
                                        const contractHoursValue = getContractHoursValue(contractHoursByMonth[monthKey] ?? null);
                                        const absenceLabel = getAbsenceLabel(absencesByDate.get(date) ?? null, date);
                                        const laborableAbsence = isLaborableAbsence(absenceLabel);
                                        const rowStyle = {
                                          '--bs-table-bg': laborableAbsence ? '#ffffff' : '#f2f2f2',
                                          '--bs-table-hover-bg': laborableAbsence ? '#f8f9fa' : '#e9ecef',
                                        } as CSSProperties;

                                        return (
                                          <tr key={date} style={rowStyle}>
                                            <td>{dateFormatter.format(new Date(`${date}T00:00:00`))}</td>
                                            <td>
                                              {entriesForDate.length ? (
                                                <div className="d-flex flex-column gap-2">
                                                  {entriesForDate.map((entry) => {
                                                    const hasEnd = Boolean(entry.checkOut);
                                                    return (
                                                      <div key={entry.id} className="d-flex align-items-center gap-2">
                                                        <span>
                                                          {entry.checkIn
                                                            ? timeShortFormatter.format(new Date(entry.checkIn))
                                                            : '—'}{' '}
                                                          →{' '}
                                                          {entry.checkOut
                                                            ? timeShortFormatter.format(new Date(entry.checkOut))
                                                            : '—'}
                                                        </span>
                                                        {!hasEnd ? (
                                                          <Badge bg="warning" text="dark">
                                                            En curso
                                                          </Badge>
                                                        ) : null}
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              ) : (
                                                <span className="text-muted">Sin fichajes</span>
                                              )}
                                            </td>
                                            <td>{contractHoursValue === null ? '—' : formatContractHoursValue(contractHoursValue)}</td>
                                            <td>{absenceLabel}</td>
                                            <td>{totalMinutes ? formatDuration(totalMinutes) : '—'}</td>
                                            <td>
                                              <span className="text-muted">Bloqueado</span>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                      <tr className="table-secondary">
                                        <td colSpan={4} className="fw-semibold">
                                          Total semana
                                        </td>
                                        <td className="fw-semibold">
                                          {weekGroup.totalMinutes ? formatDuration(weekGroup.totalMinutes) : '—'}
                                        </td>
                                        <td />
                                      </tr>
                                    </Fragment>
                                  ));
                                })()}
                              </tbody>
                            </Table>
                          </div>
                        </Accordion.Body>
                      </Accordion.Item>
                    ))}
                  </Accordion>
                </Accordion.Body>
              </Accordion.Item>
            ))}
          </Accordion>
        ) : (
          <Alert variant="info" className="mb-0">
            Todavía no hay fichajes en tu histórico.
          </Alert>
        )}
      </div>
    );
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Control horario
        </Card.Header>
        <Card.Body className="d-grid gap-4">
          <div className="d-grid gap-3">
            <div className="display-6 fw-semibold">{timeFormatter.format(now)}</div>
            {(openEntry || totalMinutesToday > 0) && (
              <div className="text-muted">
                Horas trabajadas hoy: <span className="fw-semibold">{formatDuration(totalMinutesToday)}</span>
              </div>
            )}
            <div className="d-flex flex-wrap gap-2">
              <Button
                variant="success"
                onClick={() => clockInMutation.mutate()}
                disabled={clockInMutation.isPending || Boolean(openEntry)}
              >
                {clockInMutation.isPending ? 'Iniciando…' : 'Inicio de jornada'}
              </Button>
              <Button
                variant="danger"
                onClick={() => clockOutMutation.mutate()}
                disabled={clockOutMutation.isPending || !openEntry}
              >
                {clockOutMutation.isPending ? 'Finalizando…' : 'Fin de jornada'}
              </Button>
            </div>
          </div>

          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
