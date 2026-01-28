import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { isApiError } from '../../api/client';
import {
  createReportingControlHorarioEntry,
  fetchReportingControlHorario,
  updateReportingControlHorarioEntry,
  type ReportingControlHorarioEntry,
  type ReportingControlHorarioPerson,
} from '../../features/reporting/api';

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthRange(year: number, month: number): { startDate: string; endDate: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    startDate: formatDateKey(start),
    endDate: formatDateKey(end),
  };
}

function getInitialFilters(): {
  month: number;
  year: number;
  userIds: string[];
  roleFilter: 'all' | 'trainer' | 'user';
} {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    userIds: [],
    roleFilter: 'all',
  };
}

function buildDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (current <= endDate) {
    dates.push(formatDateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function diffMinutes(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 60000));
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

function getTotalMinutesClassName(totalMinutes: number): string | undefined {
  if (totalMinutes >= 8 * 60 + 15) {
    return 'text-danger';
  }
  if (totalMinutes <= 5 * 60) {
    return 'text-warning';
  }
  return 'text-success';
}

function toTimeInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function escapeCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

type ModalState = {
  person: ReportingControlHorarioPerson;
  date: string;
  entry: ReportingControlHorarioEntry | null;
};

export default function ControlHorarioPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(getInitialFilters);
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');

  const queryClient = useQueryClient();

  const dateRange = useMemo(() => getMonthRange(filters.year, filters.month), [filters.month, filters.year]);

  const recordsQuery = useQuery({
    queryKey: ['reporting-control-horario', dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      fetchReportingControlHorario({ startDate: dateRange.startDate, endDate: dateRange.endDate }),
    staleTime: 2 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!modalState) {
        throw new Error('Faltan datos para guardar el fichaje.');
      }
      if (modalState.entry?.id) {
        return updateReportingControlHorarioEntry({
          id: modalState.entry.id,
          checkInTime,
          checkOutTime: checkOutTime || null,
        });
      }
      return createReportingControlHorarioEntry({
        userId: modalState.person.id,
        date: modalState.date,
        checkInTime,
        checkOutTime: checkOutTime || null,
      });
    },
    onSuccess: () => {
      setModalState(null);
      setCheckInTime('');
      setCheckOutTime('');
      queryClient.invalidateQueries({ queryKey: ['reporting-control-horario'] });
    },
  });

  const people = recordsQuery.data?.people ?? [];
  const entries = recordsQuery.data?.entries ?? [];

  const filteredPeople = useMemo(() => {
    return people.filter((person) => {
      if (filters.userIds.length && !filters.userIds.includes(person.id)) {
        return false;
      }
      if (filters.roleFilter === 'trainer') {
        return person.role === 'Formador';
      }
      if (filters.roleFilter === 'user') {
        return person.role !== 'Formador';
      }
      return true;
    });
  }, [filters.roleFilter, filters.userIds, people]);

  const filteredEntries = useMemo(() => {
    if (!filteredPeople.length) {
      return [];
    }
    const validIds = new Set(filteredPeople.map((person) => person.id));
    return entries.filter((entry) => validIds.has(entry.userId));
  }, [entries, filteredPeople]);

  const dates = useMemo(() => buildDateRange(dateRange.startDate, dateRange.endDate), [dateRange]);

  const entriesByUserDate = useMemo(() => {
    const map = new Map<string, ReportingControlHorarioEntry[]>();
    filteredEntries.forEach((entry) => {
      const key = `${entry.userId}-${entry.date}`;
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    });
    return map;
  }, [filteredEntries]);

  const rows = useMemo(() => {
    const output: Array<{ person: ReportingControlHorarioPerson; date: string; entries: ReportingControlHorarioEntry[] }> = [];
    dates.forEach((date) => {
      filteredPeople.forEach((person) => {
        const key = `${person.id}-${date}`;
        output.push({
          person,
          date,
          entries: entriesByUserDate.get(key) ?? [],
        });
      });
    });
    return output;
  }, [dates, entriesByUserDate, filteredPeople]);

  const rowsWithTotals = useMemo(
    () =>
      rows.map((row) => {
        const totalMinutes = row.entries.reduce((acc, entry) => {
          if (!entry.checkIn || !entry.checkOut) return acc;
          return acc + diffMinutes(entry.checkIn, entry.checkOut);
        }, 0);
        return {
          ...row,
          totalMinutes,
        };
      }),
    [rows],
  );

  const weekGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      label: string;
      rows: typeof rowsWithTotals;
      totalMinutes: number;
    }> = [];
    const groupMap = new Map<string, typeof groups[number]>();
    rowsWithTotals.forEach((row) => {
      const { week, year } = getIsoWeekInfo(new Date(`${row.date}T00:00:00`));
      const key = `${year}-W${String(week).padStart(2, '0')}`;
      let group = groupMap.get(key);
      if (!group) {
        group = {
          key,
          label: `Semana ${week} (${year})`,
          rows: [],
          totalMinutes: 0,
        };
        groupMap.set(key, group);
        groups.push(group);
      }
      group.rows.push(row);
      group.totalMinutes += row.totalMinutes;
    });
    return groups;
  }, [rowsWithTotals]);

  const monthlyTotalMinutes = useMemo(
    () => rowsWithTotals.reduce((acc, row) => acc + row.totalMinutes, 0),
    [rowsWithTotals],
  );

  const monthOptions = useMemo(
    () => [
      { value: 1, label: 'Enero' },
      { value: 2, label: 'Febrero' },
      { value: 3, label: 'Marzo' },
      { value: 4, label: 'Abril' },
      { value: 5, label: 'Mayo' },
      { value: 6, label: 'Junio' },
      { value: 7, label: 'Julio' },
      { value: 8, label: 'Agosto' },
      { value: 9, label: 'Septiembre' },
      { value: 10, label: 'Octubre' },
      { value: 11, label: 'Noviembre' },
      { value: 12, label: 'Diciembre' },
    ],
    [],
  );
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, index) => currentYear - 2 + index);
  }, []);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }),
    [],
  );
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }),
    [],
  );

  const handleOpenModal = (person: ReportingControlHorarioPerson, date: string, entry?: ReportingControlHorarioEntry) => {
    setModalState({ person, date, entry: entry ?? null });
    setCheckInTime(toTimeInputValue(entry?.checkIn ?? null));
    setCheckOutTime(toTimeInputValue(entry?.checkOut ?? null));
  };

  const handleDownload = () => {
    if (!rows.length) return;
    const headers = ['Usuario', 'Rol', 'Fecha', 'Fichajes', 'Total'];
    const lines = rows.map((row) => {
      const totalMinutes = row.entries.reduce((acc, entry) => {
        if (!entry.checkIn || !entry.checkOut) return acc;
        return acc + diffMinutes(entry.checkIn, entry.checkOut);
      }, 0);
      const entriesLabel = row.entries.length
        ? row.entries
            .map((entry) => {
              const checkIn = entry.checkIn ? timeFormatter.format(new Date(entry.checkIn)) : '—';
              const checkOut = entry.checkOut ? timeFormatter.format(new Date(entry.checkOut)) : '—';
              return `${checkIn} → ${checkOut}`;
            })
            .join(' | ')
        : 'Sin fichajes';
      return [
        escapeCsvValue(row.person.name),
        escapeCsvValue(row.person.role),
        escapeCsvValue(dateFormatter.format(new Date(`${row.date}T00:00:00`))),
        escapeCsvValue(entriesLabel),
        escapeCsvValue(totalMinutes ? formatDuration(totalMinutes) : '—'),
      ].join(',');
    });
    const csv = [headers.map(escapeCsvValue).join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `control-horario-${dateRange.startDate}-${dateRange.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFixedTrainerClick = (person: ReportingControlHorarioPerson) => {
    const params = new URLSearchParams();
    params.set('trainerId', person.id);
    navigate(`/usuarios/costes_extra?${params.toString()}`);
  };

  let content: JSX.Element;

  if (recordsQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (recordsQuery.isError) {
    const error = recordsQuery.error;
    const message = isApiError(error)
      ? error.message
      : 'No se pudo cargar la información del control horario.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (!people.length) {
    content = <Alert variant="info">No hay usuarios disponibles para el control horario.</Alert>;
  } else {
    content = (
      <div className="table-responsive">
        <Table striped bordered hover className="align-middle">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Fecha</th>
              <th>Fichajes</th>
              <th style={{ width: '12%' }}>Total</th>
              <th style={{ width: '16%' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {weekGroups.map((group) => (
              <Fragment key={group.key}>
                <tr className="table-light">
                  <td colSpan={5} className="fw-semibold">
                    {group.label}
                  </td>
                </tr>
                {group.rows.map((row) => {
                  const totalClassName = row.totalMinutes ? getTotalMinutesClassName(row.totalMinutes) : undefined;
                  return (
                    <tr key={`${row.person.id}-${row.date}`}>
                      <td>
                        <div className="fw-semibold">
                          {row.person.isFixedTrainer ? (
                            <Button
                              variant="link"
                              className="p-0 align-baseline fw-semibold"
                              onClick={() => handleFixedTrainerClick(row.person)}
                            >
                              {row.person.name}
                            </Button>
                          ) : (
                            row.person.name
                          )}
                        </div>
                        <div className="text-muted small">{row.person.role}</div>
                      </td>
                      <td>{dateFormatter.format(new Date(`${row.date}T00:00:00`))}</td>
                      <td>
                        {row.entries.length ? (
                          <div className="d-flex flex-column gap-2">
                            {row.entries.map((entry) => (
                              <div key={entry.id} className="d-flex align-items-center gap-2">
                                <span>
                                  {entry.checkIn ? timeFormatter.format(new Date(entry.checkIn)) : '—'} →{' '}
                                  {entry.checkOut ? timeFormatter.format(new Date(entry.checkOut)) : '—'}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  onClick={() => handleOpenModal(row.person, row.date, entry)}
                                >
                                  Editar
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted">Sin fichajes</span>
                        )}
                      </td>
                      <td className={totalClassName}>
                        {row.totalMinutes ? formatDuration(row.totalMinutes) : '—'}
                      </td>
                      <td>
                        <Button size="sm" variant="outline-primary" onClick={() => handleOpenModal(row.person, row.date)}>
                          Añadir fichaje
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="table-secondary">
                  <td colSpan={3} className="fw-semibold">
                    Total semana
                  </td>
                  <td className="fw-semibold">
                    {group.totalMinutes ? formatDuration(group.totalMinutes) : '—'}
                  </td>
                  <td />
                </tr>
              </Fragment>
            ))}
          </tbody>
        </Table>
      </div>
    );
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Control horario
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Resumen de fichajes de usuarios del ERP y formadores con contrato fijo.
          </p>
          <Form className="mb-3">
            <div className="d-flex gap-3 flex-wrap">
              <Form.Group controlId="control-horario-month">
                <Form.Label>Mes</Form.Label>
                <Form.Select
                  value={filters.month}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFilters((prev) => ({ ...prev, month: Number(value) }));
                  }}
                >
                  {monthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group controlId="control-horario-year">
                <Form.Label>Año</Form.Label>
                <Form.Select
                  value={filters.year}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFilters((prev) => ({ ...prev, year: Number(value) }));
                  }}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group controlId="control-horario-user">
                <Form.Label>Usuarios</Form.Label>
                <div className="border rounded p-2" style={{ maxHeight: '240px', overflowY: 'auto', minWidth: '220px' }}>
                  {people.map((person) => {
                    const isChecked = filters.userIds.includes(person.id);
                    return (
                      <Form.Check
                        key={person.id}
                        id={`control-horario-user-${person.id}`}
                        type="checkbox"
                        label={person.name}
                        checked={isChecked}
                        onChange={(event) => {
                          const { checked } = event.currentTarget;
                          setFilters((prev) => {
                            const userIds = checked
                              ? Array.from(new Set([...prev.userIds, person.id]))
                              : prev.userIds.filter((userId) => userId !== person.id);
                            return { ...prev, userIds };
                          });
                        }}
                      />
                    );
                  })}
                </div>
                <Form.Text className="text-muted">Si no seleccionas usuarios, se muestran todos.</Form.Text>
              </Form.Group>
              <Form.Group controlId="control-horario-role">
                <Form.Label>Tipo</Form.Label>
                <Form.Select
                  value={filters.roleFilter}
                  onChange={(event) => {
                    const value = event.currentTarget.value as 'all' | 'trainer' | 'user';
                    setFilters((prev) => ({
                      ...prev,
                      roleFilter: value,
                    }));
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="user">Usuarios</option>
                  <option value="trainer">Formadores</option>
                </Form.Select>
              </Form.Group>
              <div className="ms-auto align-self-end d-flex align-items-center gap-3">
                <div className="text-end">
                  <div className="text-muted small">Total mensual</div>
                  <div className="fw-semibold">{monthlyTotalMinutes ? formatDuration(monthlyTotalMinutes) : '—'}</div>
                </div>
                <Button variant="success" onClick={handleDownload} disabled={!rows.length}>
                  Descargar
                </Button>
              </div>
            </div>
          </Form>
          {content}
        </Card.Body>
      </Card>

      <Modal show={Boolean(modalState)} onHide={() => setModalState(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{modalState?.entry ? 'Editar fichaje' : 'Añadir fichaje'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form className="d-grid gap-3">
            <Form.Group>
              <Form.Label>Usuario</Form.Label>
              <Form.Control value={modalState?.person.name ?? ''} disabled />
            </Form.Group>
            <Form.Group>
              <Form.Label>Fecha</Form.Label>
              <Form.Control value={modalState?.date ?? ''} disabled />
            </Form.Group>
            <Form.Group>
              <Form.Label>Hora de entrada</Form.Label>
              <Form.Control
                type="time"
                value={checkInTime}
                onChange={(event) => setCheckInTime(event.currentTarget.value)}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Hora de salida</Form.Label>
              <Form.Control
                type="time"
                value={checkOutTime}
                onChange={(event) => setCheckOutTime(event.currentTarget.value)}
              />
            </Form.Group>
          </Form>
          {mutation.isError ? (
            <Alert variant="danger" className="mt-3 mb-0">
              {isApiError(mutation.error) ? mutation.error.message : 'No se pudo guardar el fichaje.'}
            </Alert>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setModalState(null)} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !checkInTime}
          >
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </Modal.Footer>
      </Modal>
    </section>
  );
}
