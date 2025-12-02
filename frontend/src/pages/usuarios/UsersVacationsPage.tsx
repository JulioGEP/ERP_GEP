import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap';
import {
  applyBulkVacationDay,
  fetchVacationsSummary,
  type VacationSummaryUser,
  type VacationType,
  type UserVacationDay,
} from '../../api/userVacations';

const VACATION_TYPE_LABELS: Record<VacationType, string> = {
  A: 'Vacaciones',
  F: 'Festivo',
  L: 'Libre',
  C: 'Compensado',
  T: 'Turno',
};

const VACATION_TYPE_COLORS: Record<VacationType, string> = {
  A: '#f59e0b',
  F: '#0284c7',
  L: '#65a30d',
  C: '#e11d48',
  T: '#7c3aed',
};

const MONTH_FORMATTER = new Intl.DateTimeFormat('es-ES', { month: 'long' });

function buildIsoDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export default function UsersVacationsPage() {
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [bulkDate, setBulkDate] = useState('');
  const [bulkType, setBulkType] = useState<VacationType>('F');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'danger'; message: string } | null>(
    null,
  );

  const summaryQuery = useQuery({
    queryKey: ['vacations-summary', year],
    queryFn: () => fetchVacationsSummary(year),
  });

  const users = useMemo<VacationSummaryUser[]>(() => {
    return [...(summaryQuery.data?.users ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [summaryQuery.data?.users]);

  const selectedCalendarUsers = useMemo(() => {
    return users.filter((user) => selectedUsers.includes(user.userId));
  }, [selectedUsers, users]);

  const userDayMap = useMemo(() => {
    const map = new Map<string, Map<string, VacationType>>();
    for (const user of users) {
      const days = new Map<string, VacationType>();
      for (const day of user.days ?? []) {
        days.set(day.date, day.type);
      }
      map.set(user.userId, days);
    }
    return map;
  }, [users]);

  useEffect(() => {
    if (users.length && !selectedUsers.length) {
      setSelectedUsers(users.map((user) => user.userId));
    }
  }, [selectedUsers.length, users]);

  const bulkMutation = useMutation({
    mutationFn: applyBulkVacationDay,
    onSuccess: (payload) => {
      setFeedback({ variant: 'success', message: `Festivo aplicado el ${payload.date}.` });
      setBulkDate('');
      queryClient.setQueryData(['vacations-summary', year], (previous: any) => {
        if (!previous) return previous;
        const updatedUsers = new Map<string, VacationSummaryUser>();
        for (const user of previous.users as VacationSummaryUser[]) {
          updatedUsers.set(user.userId, user);
        }
        for (const entry of payload.updated) {
          const existing = updatedUsers.get(entry.userId);
          if (existing) {
            updatedUsers.set(entry.userId, {
              ...existing,
              allowance: entry.allowance,
              enjoyed: entry.enjoyed,
              remaining: entry.remaining,
              counts: entry.counts as VacationSummaryUser['counts'],
              days: entry.days,
              upcomingDates: entry.days
                .map((day) => day.date)
                .filter((date) => date >= new Date().toISOString().slice(0, 10))
                .slice(0, 5),
              lastUpdated: entry.updatedDate ?? existing.lastUpdated,
            });
          }
        }
        return { ...previous, users: Array.from(updatedUsers.values()) };
      });
      void summaryQuery.refetch();
    },
    onError: () => {
      setFeedback({ variant: 'danger', message: 'No se pudo aplicar el festivo.' });
    },
  });

  const handleUserToggle = (userId: string, checked: boolean) => {
    setSelectedUsers((prev) => {
      if (checked) return [...new Set([...prev, userId])];
      return prev.filter((id) => id !== userId);
    });
  };

  const handleBulkSubmit = () => {
    if (!bulkDate || !bulkType || selectedUsers.length === 0) return;
    void bulkMutation.mutate({ date: bulkDate, type: bulkType, userIds: selectedUsers });
  };

  const totalWithVacations = users.filter((user) => user.enjoyed > 0 || user.counts.A > 0).length;
  const summaryYear = summaryQuery.data?.year ?? year;
  const generatedAt = summaryQuery.data?.generatedAt ?? null;

  return (
    <div className="d-grid gap-4">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
        <div>
          <h1 className="h3 mb-1">Vacaciones del equipo</h1>
          <div className="text-muted">
            Resumen rápido de ausencias para todo el equipo (excluye roles de formador).
          </div>
        </div>
        <Form className="d-flex align-items-center gap-2">
          <Form.Label className="mb-0">Año</Form.Label>
          <Form.Control
            type="number"
            min={2000}
            max={9999}
            value={year}
            onChange={(event) => setYear(Number(event.target.value) || currentYear)}
            style={{ width: '120px' }}
          />
          <Button variant="outline-secondary" onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching}>
            {summaryQuery.isFetching ? 'Actualizando…' : 'Actualizar'}
          </Button>
        </Form>
      </div>

      {feedback ? <Alert variant={feedback.variant}>{feedback.message}</Alert> : null}

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-3">
          <div>
            <div>
              Estado general · {summaryQuery.data?.users.length ?? 0} personas
              <span className="ms-2 text-muted small">{totalWithVacations} con vacaciones marcadas</span>
            </div>
            <div className="text-muted small mt-1">
              {generatedAt ? `Generado el ${new Date(generatedAt).toLocaleDateString('es-ES')}` : 'Pendiente de generar'}
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <Badge bg="light" text="dark" className="text-uppercase border">
              {summaryYear}
            </Badge>
            <Button
              variant="outline-primary"
              size="sm"
              onClick={() => setShowCalendar(true)}
              disabled={!selectedCalendarUsers.length}
            >
              Ver calendario
            </Button>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          {summaryQuery.isLoading ? (
            <div className="d-flex justify-content-center align-items-center py-4">
              <Spinner animation="border" />
            </div>
          ) : null}
          {summaryQuery.isError ? (
            <Alert variant="danger" className="m-3">
              No se pudo cargar el resumen de vacaciones.
            </Alert>
          ) : null}
          {!summaryQuery.isLoading && !summaryQuery.isError ? (
            <div className="table-responsive">
              <Table hover className="mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Seleccionar</th>
                    <th>Persona</th>
                    <th>Rol</th>
                    <th>Vacaciones</th>
                    <th>Ausencias</th>
                    <th>Próximas fechas</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const totalAbsences = Object.values(user.counts).reduce((acc, value) => acc + value, 0);
                    const upcomingLabel = user.upcomingDates.length
                      ? user.upcomingDates.join(', ')
                      : 'Sin próximas ausencias';
                    const allowanceLabel =
                      user.allowance !== null
                        ? `${user.enjoyed} / ${user.allowance} días (${user.remaining ?? 0} restantes)`
                        : `${user.enjoyed} días`;

                    return (
                      <tr key={user.userId}>
                        <td>
                          <Form.Check
                            type="checkbox"
                            aria-label={`Seleccionar ${user.fullName}`}
                            checked={selectedUsers.includes(user.userId)}
                            onChange={(event) => handleUserToggle(user.userId, event.target.checked)}
                          />
                        </td>
                        <td>
                          <div className="fw-semibold">{user.fullName}</div>
                          <div className="text-muted small">{user.active ? 'Activo' : 'Inactivo'}</div>
                        </td>
                        <td>{user.role}</td>
                        <td>
                          <div>{allowanceLabel}</div>
                          <div className="text-muted small">Última marca: {user.lastUpdated ?? '—'}</div>
                        </td>
                        <td>
                          <div className="d-flex flex-wrap gap-2">
                            {Object.entries(user.counts).map(([key, value]) => (
                              <Badge bg="light" text="dark" key={key} className="border">
                                {key}: {value}
                              </Badge>
                            ))}
                            {totalAbsences === 0 ? (
                              <Badge bg="secondary" className="text-uppercase">
                                Sin ausencias
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td>{upcomingLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          ) : null}
        </Card.Body>
      </Card>

      <VacationsCalendarModal
        show={showCalendar}
        onHide={() => setShowCalendar(false)}
        users={selectedCalendarUsers}
        year={summaryYear}
        userDayMap={userDayMap}
      />

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            Aplicar festivo de forma masiva
            <div className="text-muted small">Marca la misma ausencia en los calendarios seleccionados.</div>
          </div>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setSelectedUsers(users.map((user) => user.userId))}
            disabled={!users.length}
          >
            Seleccionar todo
          </Button>
        </Card.Header>
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md={4}>
              <Form.Label>Fecha</Form.Label>
              <Form.Control type="date" value={bulkDate} onChange={(event) => setBulkDate(event.target.value)} />
            </Col>
            <Col md={4}>
              <Form.Label>Marca</Form.Label>
              <Form.Select value={bulkType} onChange={(event) => setBulkType(event.target.value as VacationType)}>
                {Object.entries(VACATION_TYPE_LABELS).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label} ({key})
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col md={4}>
              <Form.Label>Personas</Form.Label>
              <Form.Select
                multiple
                value={selectedUsers}
                onChange={(event) =>
                  setSelectedUsers(Array.from(event.target.selectedOptions, (option) => option.value))
                }
                style={{ minHeight: '160px' }}
              >
                {users.map((user) => (
                  <option value={user.userId} key={user.userId}>
                    {user.fullName}
                  </option>
                ))}
              </Form.Select>
            </Col>
          </Row>
          <div className="d-flex justify-content-end mt-3">
            <Button
              onClick={handleBulkSubmit}
              disabled={!bulkDate || !bulkType || selectedUsers.length === 0 || bulkMutation.isPending}
            >
              {bulkMutation.isPending ? 'Aplicando…' : 'Aplicar en calendarios seleccionados'}
            </Button>
          </div>
          <div className="text-muted small mt-2">
            Se ignorarán automáticamente los formadores y solo se marcarán usuarios activos.
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}

type VacationsCalendarModalProps = {
  show: boolean;
  onHide: () => void;
  users: VacationSummaryUser[];
  year: number;
  userDayMap: Map<string, Map<string, VacationType>>;
};

function VacationsCalendarModal({ show, onHide, users, year, userDayMap }: VacationsCalendarModalProps) {
  return (
    <Modal show={show} onHide={onHide} size="xl" dialogClassName="vacations-calendar-modal" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>Calendario de ausencias · {year}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-grid gap-3">
        <div className="text-muted small">
          Vista anual para revisar de un vistazo las marcas diarias de todo el equipo. Inspirada en el Excel
          compartido, pero optimizada para la web.
        </div>

        <div className="d-flex align-items-center gap-2 flex-wrap">
          {Object.entries(VACATION_TYPE_LABELS).map(([key, label]) => (
            <Badge key={key} bg="light" text="dark" className="border text-uppercase">
              <span
                className="me-1"
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '999px',
                  backgroundColor: VACATION_TYPE_COLORS[key as VacationType],
                }}
              ></span>
              {label} ({key})
            </Badge>
          ))}
        </div>

        {!users.length ? (
          <Alert variant="secondary" className="mb-0">
            No hay información de vacaciones para mostrar.
          </Alert>
        ) : null}

        {users.length
          ? Array.from({ length: 12 }, (_, monthIndex) => {
              const daysInMonth = getDaysInMonth(year, monthIndex);
              const dayLabels = Array.from({ length: daysInMonth }, (_, index) => index + 1);
              const monthName = MONTH_FORMATTER.format(new Date(Date.UTC(year, monthIndex, 1)));

              return (
                <div key={`${year}-${monthIndex}`} className="border rounded overflow-hidden">
                  <div className="d-flex justify-content-between align-items-center px-3 py-2 bg-light">
                    <div className="fw-semibold text-capitalize">{monthName}</div>
                    <div className="text-muted small">{year}</div>
                  </div>
                  <div className="table-responsive">
                    <Table
                      bordered
                      size="sm"
                      className="mb-0 vacation-summary-calendar-table align-middle text-center"
                    >
                      <thead>
                        <tr>
                          <th className="text-start" style={{ minWidth: '200px' }}>
                            Persona
                          </th>
                          {dayLabels.map((dayLabel) => (
                            <th key={dayLabel} className="text-muted small" style={{ minWidth: '34px' }}>
                              {dayLabel}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => {
                          const dayMap = userDayMap.get(user.userId);
                          return (
                            <tr key={`${user.userId}-${monthIndex}`}>
                              <td className="text-start">
                                <div className="fw-semibold">{user.fullName}</div>
                                <div className="text-muted small">{user.role}</div>
                              </td>
                              {dayLabels.map((dayLabel) => {
                                const iso = buildIsoDate(year, monthIndex, dayLabel);
                                const type = dayMap?.get(iso) ?? '';
                                const color = type ? VACATION_TYPE_COLORS[type as VacationType] : undefined;

                                return (
                                  <td
                                    key={dayLabel}
                                    className="vacation-calendar-cell text-uppercase"
                                    style={{
                                      backgroundColor: color,
                                      color: type ? '#ffffff' : undefined,
                                    }}
                                    title={type ? `${VACATION_TYPE_LABELS[type as VacationType]} (${type})` : undefined}
                                  >
                                    {type || ''}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </div>
                </div>
              );
            })
          : null}
      </Modal.Body>
    </Modal>
  );
}
