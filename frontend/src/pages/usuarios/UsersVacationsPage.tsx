import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap';
import {
  acceptVacationRequest,
  deleteVacationRequest,
  applyBulkVacationDay,
  fetchVacationRequests,
  fetchVacationsSummary,
  type VacationSummaryUser,
  type VacationType,
  type UserVacationDay,
  type VacationRequestItem,
} from '../../api/userVacations';

const VACATION_TYPE_LABELS: Record<VacationType, string> = {
  V: 'Vacaciones',
  L: 'Festivo local',
  A: 'Día aniversario',
  T: 'Teletrabajo',
  M: 'Matrimonio o registro de pareja de hecho',
  H: 'Accidente, enfermedad, hospitalización o intervención de un familiar',
  F: 'Fallecimiento de un familiar',
  R: 'Traslado del domicilio habitual',
  P: 'Exámenes prenatales',
  I: 'Incapacidad temporal',
  N: 'Festivos nacionales',
};

const VACATION_TYPE_COLORS: Record<VacationType, string> = {
  V: '#2563eb',
  L: '#65a30d',
  A: '#e11d48',
  T: '#7c3aed',
  M: '#f97316',
  H: '#ef4444',
  F: '#0ea5e9',
  R: '#0f766e',
  P: '#a855f7',
  I: '#475569',
  N: '#facc15',
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
  const [bulkType, setBulkType] = useState<VacationType>('V');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectionManuallyChanged, setSelectionManuallyChanged] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'danger'; message: string } | null>(
    null,
  );
  const [requestActionId, setRequestActionId] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['vacations-summary', year],
    queryFn: () => fetchVacationsSummary(year),
  });

  const requestsQuery = useQuery<VacationRequestItem[]>({
    queryKey: ['vacation-requests'],
    queryFn: fetchVacationRequests,
  });

  const users = useMemo<VacationSummaryUser[]>(() => {
    return [...(summaryQuery.data?.users ?? [])].sort((a, b) =>
      a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }),
    );
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
    if (selectionManuallyChanged || !users.length || selectedUsers.length) return;

    setSelectedUsers(users.map((user) => user.userId));
  }, [selectionManuallyChanged, selectedUsers.length, users]);

  const bulkMutation = useMutation({
    mutationFn: applyBulkVacationDay,
    onSuccess: (payload) => {
      setFeedback({ variant: 'success', message: `Marca aplicada el ${payload.date}.` });
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
              anniversaryAllowance: entry.anniversaryAllowance,
              localHolidayAllowance: entry.localHolidayAllowance,
              previousYearAllowance: entry.previousYearAllowance,
              totalAllowance: entry.totalAllowance,
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

  const acceptRequestMutation = useMutation({
    mutationFn: (id: string) => acceptVacationRequest(id),
    onMutate: (id) => setRequestActionId(id),
    onSuccess: (payload) => {
      setFeedback({ variant: 'success', message: payload.message });
      void queryClient.invalidateQueries({ queryKey: ['vacation-requests'] });
      void summaryQuery.refetch();
    },
    onError: () => {
      setFeedback({ variant: 'danger', message: 'No se pudo aceptar la petición.' });
    },
    onSettled: () => setRequestActionId(null),
  });

  const deleteRequestMutation = useMutation({
    mutationFn: (id: string) => deleteVacationRequest(id),
    onMutate: (id) => setRequestActionId(id),
    onSuccess: () => {
      setFeedback({ variant: 'success', message: 'Petición eliminada correctamente.' });
      void queryClient.invalidateQueries({ queryKey: ['vacation-requests'] });
    },
    onError: () => {
      setFeedback({ variant: 'danger', message: 'No se pudo eliminar la petición.' });
    },
    onSettled: () => setRequestActionId(null),
  });

  const requests = requestsQuery.data ?? [];

  const handleUserToggle = (userId: string, checked: boolean) => {
    setSelectionManuallyChanged(true);
    setSelectedUsers((prev) => {
      if (checked) return [...new Set([...prev, userId])];
      return prev.filter((id) => id !== userId);
    });
  };

  const handleBulkSubmit = () => {
    if (!bulkDate || !bulkType || selectedUsers.length === 0) return;
    void bulkMutation.mutate({ date: bulkDate, type: bulkType, userIds: selectedUsers });
  };

  const totalWithVacations = users.filter((user) => user.enjoyed > 0 || Object.values(user.counts).some(Boolean))
    .length;
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

      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <div className="fw-semibold">Peticiones de vacaciones y teletrabajo</div>
            <div className="text-muted small">Revisa las solicitudes enviadas por el equipo.</div>
          </div>
          <Badge bg="light" text="dark" className="border">
            {requests.length} pendientes
          </Badge>
        </Card.Header>
        <Card.Body className="p-0">
          {requestsQuery.isLoading ? (
            <div className="d-flex justify-content-center align-items-center py-4">
              <Spinner animation="border" />
            </div>
          ) : null}
          {requestsQuery.isError ? (
            <Alert variant="danger" className="m-3">
              No se pudieron cargar las peticiones pendientes.
            </Alert>
          ) : null}
          {!requestsQuery.isLoading && !requestsQuery.isError ? (
            requests.length ? (
              <div className="table-responsive">
                <Table hover className="mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Persona</th>
                      <th>Correo</th>
                      <th>Fechas solicitadas</th>
                      <th>Tipo</th>
                      <th>Notas</th>
                      <th>Creada</th>
                      <th className="text-end">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((request) => {
                      const accepting = acceptRequestMutation.isPending && acceptRequestMutation.variables === request.id;
                      const deleting = deleteRequestMutation.isPending && deleteRequestMutation.variables === request.id;
                      const disabled = accepting || deleting || requestActionId === request.id;
                      const dateRangeLabel =
                        request.startDate === request.endDate
                          ? request.startDate
                          : `${request.startDate} → ${request.endDate}`;
                      const tagLabel = request.tag ? VACATION_TYPE_LABELS[request.tag] ?? 'Otro' : 'Vacaciones';
                      const typeColor = request.tag ? VACATION_TYPE_COLORS[request.tag] : '#0ea5e9';

                      return (
                        <tr key={request.id}>
                          <td className="fw-semibold">{request.userName}</td>
                          <td className="text-muted small">{request.userEmail}</td>
                          <td>{dateRangeLabel}</td>
                          <td>
                            <Badge bg="light" text="dark" className="border" style={{ borderColor: typeColor }}>
                              {tagLabel}
                            </Badge>
                          </td>
                          <td>{request.notes?.length ? request.notes : '—'}</td>
                          <td>{new Date(request.createdAt).toLocaleString('es-ES')}</td>
                          <td className="text-end d-flex justify-content-end gap-2">
                            <Button
                              size="sm"
                              variant="outline-success"
                              disabled={disabled}
                              onClick={() => acceptRequestMutation.mutate(request.id)}
                            >
                              {accepting ? 'Aceptando…' : 'Aceptar'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline-danger"
                              disabled={disabled}
                              onClick={() => deleteRequestMutation.mutate(request.id)}
                            >
                              {deleting ? 'Eliminando…' : 'Eliminar'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            ) : (
              <div className="p-3 text-muted">No hay peticiones pendientes.</div>
            )
          ) : null}
        </Card.Body>
      </Card>

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
                    const allowanceLabel = `${user.enjoyed} / ${user.totalAllowance} días (${user.remaining} restantes)`;

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
                              <div key={key} className="border rounded px-2 py-1 d-flex gap-2 align-items-center">
                                <span
                                  className="d-inline-block"
                                  style={{
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '999px',
                                    backgroundColor: VACATION_TYPE_COLORS[key as VacationType],
                                  }}
                                ></span>
                                <div className="small">
                                  <div className="text-muted text-uppercase">{VACATION_TYPE_LABELS[key as VacationType]}</div>
                                  <div className="fw-semibold">{value} días</div>
                                </div>
                              </div>
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
          <div className="d-flex align-items-center gap-2">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => {
                setSelectionManuallyChanged(true);
                setSelectedUsers([]);
              }}
              disabled={!selectedUsers.length}
            >
              Borrar Selección
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => {
                setSelectionManuallyChanged(true);
                setSelectedUsers(users.map((user) => user.userId));
              }}
              disabled={!users.length}
            >
              Seleccionar todo
            </Button>
          </div>
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
              <div className="border rounded p-2" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {users.map((user) => (
                  <Form.Check
                    key={user.userId}
                    type="checkbox"
                    id={`bulk-user-${user.userId}`}
                    label={user.fullName}
                    checked={selectedUsers.includes(user.userId)}
                    onChange={(event) => handleUserToggle(user.userId, event.target.checked)}
                    className="mb-2"
                  />
                ))}
              </div>
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
