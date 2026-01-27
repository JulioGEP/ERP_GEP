import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  clockInControlHorario,
  clockOutControlHorario,
  createControlHorarioEntry,
  fetchControlHorario,
  updateControlHorarioEntry,
  type ControlHorarioEntry,
} from '../../features/controlHorario/api';

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: formatDateKey(start),
    endDate: formatDateKey(now),
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

function toTimeInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export default function ControlHorarioPage() {
  const [now, setNow] = useState(() => new Date());
  const [range] = useState(getCurrentMonthRange);
  const [showModal, setShowModal] = useState(false);
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalEntry, setModalEntry] = useState<ControlHorarioEntry | null>(null);
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');

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

  const entryMutation = useMutation({
    mutationFn: async () => {
      if (!modalDate) {
        throw new Error('No hay fecha seleccionada.');
      }
      if (modalEntry?.id) {
        return updateControlHorarioEntry({
          id: modalEntry.id,
          checkInTime,
          checkOutTime: checkOutTime || null,
        });
      }
      return createControlHorarioEntry({
        date: modalDate,
        checkInTime,
        checkOutTime: checkOutTime || null,
      });
    },
    onSuccess: () => {
      setShowModal(false);
      setModalEntry(null);
      setModalDate(null);
      setCheckInTime('');
      setCheckOutTime('');
      queryClient.invalidateQueries({ queryKey: ['control-horario'] });
    },
  });

  const entries = controlHorarioQuery.data?.entries ?? [];
  const entriesByDate = useMemo(() => {
    const map = new Map<string, ControlHorarioEntry[]>();
    entries.forEach((entry) => {
      const list = map.get(entry.date) ?? [];
      list.push(entry);
      map.set(entry.date, list);
    });
    return map;
  }, [entries]);

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

  const datesInRange = useMemo(() => buildDateRange(range.startDate, range.endDate), [range]);
  const yesterday = controlHorarioQuery.data?.meta?.yesterday ?? '';

  const handleOpenModal = (date: string, entry?: ControlHorarioEntry) => {
    setModalDate(date);
    setModalEntry(entry ?? null);
    setCheckInTime(toTimeInputValue(entry?.checkIn ?? null));
    setCheckOutTime(toTimeInputValue(entry?.checkOut ?? null));
    setShowModal(true);
  };

  const isSavingEntry = entryMutation.isPending;

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
      <div className="table-responsive">
        <Table striped bordered hover className="align-middle">
          <thead>
            <tr>
              <th style={{ width: '18%' }}>Fecha</th>
              <th>Fichajes</th>
              <th style={{ width: '14%' }}>Total</th>
              <th style={{ width: '14%' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {datesInRange.map((date) => {
              const entriesForDate = entriesByDate.get(date) ?? [];
              const totalMinutes = entriesForDate.reduce((acc, entry) => {
                if (!entry.checkIn || !entry.checkOut) return acc;
                return acc + diffMinutes(entry.checkIn, new Date(entry.checkOut));
              }, 0);
              const isYesterday = date === yesterday;
              return (
                <tr key={date}>
                  <td>{dateFormatter.format(new Date(`${date}T00:00:00`))}</td>
                  <td>
                    {entriesForDate.length ? (
                      <div className="d-flex flex-column gap-2">
                        {entriesForDate.map((entry) => {
                          const hasEnd = Boolean(entry.checkOut);
                          return (
                            <div key={entry.id} className="d-flex align-items-center gap-2">
                              <span>
                                {entry.checkIn ? timeShortFormatter.format(new Date(entry.checkIn)) : '—'} →{' '}
                                {entry.checkOut ? timeShortFormatter.format(new Date(entry.checkOut)) : '—'}
                              </span>
                              {!hasEnd ? <Badge bg="warning" text="dark">En curso</Badge> : null}
                              {isYesterday ? (
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  onClick={() => handleOpenModal(date, entry)}
                                >
                                  Editar
                                </Button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-muted">Sin fichajes</span>
                    )}
                  </td>
                  <td>{totalMinutes ? formatDuration(totalMinutes) : '—'}</td>
                  <td>
                    {isYesterday ? (
                      <Button size="sm" variant="outline-primary" onClick={() => handleOpenModal(date)}>
                        Añadir fichaje
                      </Button>
                    ) : (
                      <span className="text-muted">Bloqueado</span>
                    )}
                  </td>
                </tr>
              );
            })}
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

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{modalEntry ? 'Editar fichaje' : 'Añadir fichaje'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form className="d-grid gap-3">
            <Form.Group>
              <Form.Label>Fecha</Form.Label>
              <Form.Control value={modalDate ?? ''} disabled />
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
          {entryMutation.isError ? (
            <Alert variant="danger" className="mt-3 mb-0">
              {isApiError(entryMutation.error)
                ? entryMutation.error.message
                : 'No se pudo guardar el fichaje.'}
            </Alert>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)} disabled={isSavingEntry}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => entryMutation.mutate()} disabled={isSavingEntry || !checkInTime}>
            {isSavingEntry ? 'Guardando…' : 'Guardar'}
          </Button>
        </Modal.Footer>
      </Modal>
    </section>
  );
}
