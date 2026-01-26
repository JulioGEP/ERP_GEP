import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Col,
  Form,
  ListGroup,
  Modal,
  OverlayTrigger,
  Row,
  Spinner,
  Table,
  Tooltip,
} from 'react-bootstrap';
import {
  acceptVacationRequest,
  deleteVacationRequest,
  applyBulkVacationDay,
  fetchVacationRequests,
  fetchVacationsSummary,
  sendSlackAvailabilityNotification,
  type SlackAvailabilityResponse,
  type VacationSummaryUser,
  type VacationType,
  type UserVacationDay,
  type VacationRequestItem,
} from '../../api/userVacations';
import { type UserSummary } from '../../api/users';
import {
  VACATION_TYPE_COLORS,
  VACATION_TYPE_FULL_LABELS,
  VACATION_TYPE_LABELS,
} from '../../constants/vacations';
import { VacationManagerModal } from './UsersPage';

const MONTH_FORMATTER = new Intl.DateTimeFormat('es-ES', { month: 'long' });
const DEFAULT_SLACK_CHANNEL_ID = 'C063C7QRHK4';

function buildIsoDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function isWeekend(year: number, monthIndex: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function formatLocaleDateLabel(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('es-ES', { timeZone: 'UTC' });
}

export default function UsersVacationsPage() {
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [bulkDateInput, setBulkDateInput] = useState('');
  const [bulkDates, setBulkDates] = useState<string[]>([]);
  const [bulkType, setBulkType] = useState<VacationType>('V');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectionManuallyChanged, setSelectionManuallyChanged] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'danger'; message: string } | null>(
    null,
  );
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [bulkUserFilter, setBulkUserFilter] = useState('');
  const [bulkUserListOpen, setBulkUserListOpen] = useState(false);
  const [vacationUser, setVacationUser] = useState<UserSummary | null>(null);
  const [slackChannelId, setSlackChannelId] = useState(DEFAULT_SLACK_CHANNEL_ID);
  const bulkUserFieldRef = useRef<HTMLDivElement | null>(null);
  const bulkUserPointerInteractingRef = useRef(false);

  const summaryQuery = useQuery({
    queryKey: ['vacations-summary', year],
    queryFn: () => fetchVacationsSummary(year),
  });

  const requestsQuery = useQuery<VacationRequestItem[]>({
    queryKey: ['vacation-requests'],
    queryFn: fetchVacationRequests,
  });

  const renderVacationTypeLabel = (type: VacationType) => {
    const label = VACATION_TYPE_LABELS[type];
    const fullLabel = VACATION_TYPE_FULL_LABELS[type];

    return (
      <OverlayTrigger placement="top" overlay={<Tooltip id={`vacation-type-${type}`}>{fullLabel}</Tooltip>}>
        <span className="text-nowrap">{label}</span>
      </OverlayTrigger>
    );
  };

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bulkUserFieldRef.current && !bulkUserFieldRef.current.contains(event.target as Node)) {
        setBulkUserListOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const bulkMutation = useMutation({
    mutationFn: applyBulkVacationDay,
    onSuccess: (payload) => {
      const ignoredCount = payload.ignoredUserIds?.length ?? 0;
      const datesLabel = payload.dates.join(', ');
      const message =
        ignoredCount > 0
          ? `Marca aplicada en ${datesLabel}. ${ignoredCount} usuario${ignoredCount === 1 ? '' : 's'} ignorado${ignoredCount === 1 ? '' : 's'} por estar inactivo.`
          : `Marca aplicada en ${datesLabel}.`;
      setFeedback({ variant: 'success', message });
      setBulkDates([]);
      setBulkDateInput('');
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

  const slackNotificationMutation = useMutation({
    mutationFn: sendSlackAvailabilityNotification,
    onSuccess: (response: SlackAvailabilityResponse) => {
      let message = 'Comunicación enviada a Slack.';
      if (response.notified) {
        message = `Comunicación enviada a Slack${response.channelId ? ` (${response.channelId})` : ''}.`;
      } else if (response.skipped) {
        const reason = response.reason;
        if (reason === 'no_absences') {
          message = 'No hay ausencias para notificar en Slack.';
        } else if (reason === 'no_users') {
          message = 'No hay personas disponibles para notificar en Slack.';
        } else if (reason === 'outside_schedule') {
          message = 'El envío está fuera del horario programado.';
        }
      }
      setFeedback({ variant: 'success', message });
    },
    onError: () => {
      setFeedback({ variant: 'danger', message: 'No se pudo enviar la comunicación a Slack.' });
    },
  });

  const requests = requestsQuery.data ?? [];

  const handleUserToggle = (userId: string, checked: boolean) => {
    setSelectionManuallyChanged(true);
    setSelectedUsers((prev) => {
      if (checked) return [...new Set([...prev, userId])];
      return prev.filter((id) => id !== userId);
    });
  };

  const handleToggleAllUsers = () => {
    setSelectionManuallyChanged(true);
    setSelectedUsers((prev) => {
      const allSelected = users.length > 0 && prev.length === users.length;
      return allSelected ? [] : users.map((user) => user.userId);
    });
  };

  const allUsersSelected = users.length > 0 && selectedUsers.length === users.length;

  const filteredBulkUsers = useMemo(() => {
    const search = bulkUserFilter.trim().toLowerCase();
    if (!search) return users;
    return users.filter((user) => user.fullName.toLowerCase().includes(search));
  }, [bulkUserFilter, users]);

  const selectedUsersSummary = useMemo(() => {
    const selected = new Set(selectedUsers);
    return users
      .filter((user) => selected.has(user.userId))
      .map((user) => user.fullName)
      .join(', ');
  }, [selectedUsers, users]);

  const handleCloseVacationModal = () => setVacationUser(null);

  const addBulkDate = (value: string) => {
    if (!value) return;
    setBulkDates((previous) => {
      const nextDates = new Set(previous);
      nextDates.add(value);
      return Array.from(nextDates).sort();
    });
    setBulkDateInput('');
  };

  const removeBulkDate = (value: string) => {
    setBulkDates((previous) => previous.filter((date) => date !== value));
  };

  const handleBulkSubmit = () => {
    if (!bulkDates.length || !bulkType || selectedUsers.length === 0) return;
    void bulkMutation.mutate({ dates: bulkDates, type: bulkType, userIds: selectedUsers });
  };

  const handleSendSlackNotification = () => {
    const channelId = slackChannelId.trim() || DEFAULT_SLACK_CHANNEL_ID;
    slackNotificationMutation.mutate({ channelId, force: true });
  };

  const roles = useMemo(() => {
    const roleSet = new Set<string>();
    for (const user of users) {
      if (user.role) roleSet.add(user.role);
    }
    return Array.from(roleSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [users]);

  const handleSelectRole = (role: string) => {
    setSelectionManuallyChanged(true);
    const roleUsers = users.filter((user) => user.role === role).map((user) => user.userId);
    setSelectedUsers(roleUsers);
  };

  const totalWithVacations = users.filter((user) => user.enjoyed > 0 || Object.values(user.counts).some(Boolean))
    .length;
  const summaryYear = summaryQuery.data?.year ?? year;
  const generatedAt = summaryQuery.data?.generatedAt ?? null;

  const handleOpenVacationModal = (user: VacationSummaryUser) => {
    const [firstName, ...rest] = user.fullName.split(' ');
    setVacationUser({
      id: user.userId,
      firstName,
      lastName: rest.join(' ') || '',
      email: '',
      role: user.role,
      active: user.active,
      bankAccount: null,
      address: null,
      createdAt: '',
      updatedAt: '',
      trainerId: null,
      trainerFixedContract: null,
      payroll: {
        convenio: '',
        categoria: '',
        antiguedad: null,
        horasSemana: 40,
        baseRetencion: null,
        baseRetencionDetalle: null,
        salarioBruto: null,
        salarioBrutoTotal: null,
        retencion: null,
        aportacionSsIrpf: null,
        aportacionSsIrpfDetalle: null,
        salarioLimpio: null,
        contingenciasComunes: null,
        contingenciasComunesDetalle: null,
        totalEmpresa: null,
      },
    });
  };

  return (
    <div className="d-grid gap-4">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
        <div>
          <h1 className="h3 mb-1">Vacaciones del equipo</h1>
          <div className="text-muted">Resumen rápido de ausencias para todo el equipo.</div>
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
        <Card.Header>
          <div className="fw-semibold">Comunicación de disponibilidad en Slack</div>
          <div className="text-muted small">
            Envía manualmente el resumen de vacaciones y teletrabajo del equipo.
          </div>
        </Card.Header>
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md={8}>
              <Form.Label>Id del canal de Slack</Form.Label>
              <Form.Control
                type="text"
                value={slackChannelId}
                onChange={(event) => setSlackChannelId(event.target.value)}
                placeholder={DEFAULT_SLACK_CHANNEL_ID}
              />
              <div className="text-muted small mt-2">
                Se utilizará este canal para enviar el mensaje de disponibilidad del equipo.
              </div>
            </Col>
            <Col md={4}>
              <Button
                className="w-100"
                onClick={handleSendSlackNotification}
                disabled={slackNotificationMutation.isPending}
              >
                {slackNotificationMutation.isPending ? 'Enviando…' : 'Enviar'}
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

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
                              {request.tag ? renderVacationTypeLabel(request.tag) : tagLabel}
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
            {roles.length ? (
              <div className="d-flex flex-wrap gap-2 mt-2">
                {roles.map((role) => {
                  const roleUserIds = users
                    .filter((user) => user.role === role)
                    .map((user) => user.userId);
                  const isActive =
                    roleUserIds.length > 0 &&
                    roleUserIds.every((id) => selectedUsers.includes(id)) &&
                    selectedUsers.length === roleUserIds.length;

                  return (
                    <Badge
                      key={role}
                      bg={isActive ? 'primary' : 'light'}
                      text={isActive ? undefined : 'dark'}
                      className="text-uppercase small border px-2 py-1"
                      role="button"
                      onClick={() => handleSelectRole(role)}
                    >
                      {role}
                    </Badge>
                  );
                })}
              </div>
            ) : null}
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
                    <th className="text-center" style={{ width: '80px' }}>
                      <Button
                        variant="light"
                        size="sm"
                        className="border"
                        onClick={handleToggleAllUsers}
                        aria-label={allUsersSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                        title={allUsersSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                      >
                        {allUsersSelected ? <DeselectIcon width={18} height={18} /> : <SelectIcon width={18} height={18} />}
                      </Button>
                    </th>
                    <th>Persona</th>
                    <th>Rol</th>
                    <th>Vacaciones</th>
                    <th>Siguientes Vacaciones</th>
                    <th className="text-end">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
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
                          {user.active ? null : <div className="text-muted small">Inactivo</div>}
                        </td>
                        <td>{user.role}</td>
                        <td>
                          <div>{allowanceLabel}</div>
                        </td>
                        <td>
                          <div>{upcomingLabel}</div>
                        </td>
                        <td className="text-end">
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => handleOpenVacationModal(user)}
                          >
                            Vacaciones
                          </Button>
                        </td>
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

      <VacationManagerModal
        show={Boolean(vacationUser)}
        user={vacationUser}
        year={summaryYear}
        onHide={handleCloseVacationModal}
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
              <Form.Label>Fechas</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control
                  type="date"
                  value={bulkDateInput}
                  onChange={(event) => setBulkDateInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && bulkDateInput) {
                      event.preventDefault();
                      addBulkDate(bulkDateInput);
                    }
                  }}
                />
                <Button variant="outline-secondary" onClick={() => addBulkDate(bulkDateInput)} disabled={!bulkDateInput}>
                  Añadir
                </Button>
              </div>
              <div className="d-flex flex-wrap gap-2 mt-2">
                {bulkDates.map((date) => (
                  <Badge key={date} bg="light" text="dark" className="border d-flex align-items-center gap-2">
                    <span>{formatLocaleDateLabel(date)}</span>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={() => removeBulkDate(date)}
                      aria-label={`Quitar ${formatLocaleDateLabel(date)}`}
                    >
                      ×
                    </Button>
                  </Badge>
                ))}
              </div>
            </Col>
            <Col md={4}>
              <Form.Label>Categoría</Form.Label>
              <Form.Select value={bulkType} onChange={(event) => setBulkType(event.target.value as VacationType)}>
                {Object.entries(VACATION_TYPE_LABELS).map(([key, label]) => (
                  <option value={key} key={key} title={VACATION_TYPE_FULL_LABELS[key as VacationType]}>
                    {label} ({key})
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col md={4}>
              <Form.Label>Personas</Form.Label>
              <div ref={bulkUserFieldRef} className="session-multiselect">
                <Form.Control
                  type="text"
                  readOnly
                  placeholder="Selecciona personas"
                  value={selectedUsersSummary}
                  className="session-multiselect-summary"
                  aria-expanded={bulkUserListOpen}
                  aria-controls="bulk-users-options"
                  onMouseDown={() => {
                    bulkUserPointerInteractingRef.current = true;
                  }}
                  onClick={() => {
                    setBulkUserListOpen((open) => !open);
                    bulkUserPointerInteractingRef.current = false;
                  }}
                  onFocus={() => {
                    if (!bulkUserPointerInteractingRef.current) {
                      setBulkUserListOpen(true);
                    }
                  }}
                  onBlur={() => {
                    bulkUserPointerInteractingRef.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setBulkUserListOpen((open) => !open);
                    }
                  }}
                  title={selectedUsersSummary}
                />
                <Collapse in={bulkUserListOpen}>
                  <div id="bulk-users-options" className="session-multiselect-panel mt-2">
                    <Form.Control
                      type="search"
                      placeholder="Buscar"
                      value={bulkUserFilter}
                      onChange={(event) => setBulkUserFilter(event.target.value)}
                      className="mb-2"
                      title={bulkUserFilter}
                    />
                    <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                      <ListGroup variant="flush">
                        {filteredBulkUsers.map((user) => {
                          const checked = selectedUsers.includes(user.userId);
                          return (
                            <ListGroup.Item key={user.userId} className="py-1">
                              <Form.Check
                                type="checkbox"
                                id={`bulk-user-${user.userId}`}
                                label={user.fullName}
                                checked={checked}
                                onChange={(event) => handleUserToggle(user.userId, event.target.checked)}
                              />
                            </ListGroup.Item>
                          );
                        })}
                        {!filteredBulkUsers.length ? (
                          <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                        ) : null}
                      </ListGroup>
                    </div>
                  </div>
                </Collapse>
              </div>
            </Col>
          </Row>
          <div className="d-flex justify-content-end mt-3">
            <Button
              onClick={handleBulkSubmit}
              disabled={!bulkDates.length || !bulkType || selectedUsers.length === 0 || bulkMutation.isPending}
            >
              {bulkMutation.isPending ? 'Aplicando…' : 'Aplicar en calendarios seleccionados'}
            </Button>
          </div>
          <div className="text-muted small mt-2">Se ignorarán automáticamente los usuarios inactivos.</div>
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
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip id={`vacation-type-legend-${key}`}>{VACATION_TYPE_FULL_LABELS[key as VacationType]}</Tooltip>}
              >
                <span className="text-nowrap">{label}</span>
              </OverlayTrigger>{' '}
              ({key})
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
              const dayEntries = Array.from({ length: daysInMonth }, (_, index) => {
                const dayLabel = index + 1;
                return {
                  dayLabel,
                  iso: buildIsoDate(year, monthIndex, dayLabel),
                  isWeekend: isWeekend(year, monthIndex, dayLabel),
                };
              });
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
                          {dayEntries.map(({ dayLabel, isWeekend }) => (
                            <th
                              key={dayLabel}
                              className={`text-muted small${isWeekend ? ' weekend-header' : ''}`}
                              style={{ minWidth: '34px' }}
                            >
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
                              {dayEntries.map(({ dayLabel, iso, isWeekend }) => {
                                const type = dayMap?.get(iso) ?? '';
                                const color = type ? VACATION_TYPE_COLORS[type as VacationType] : undefined;

                                return (
                                  <td
                                    key={dayLabel}
                                    className={`vacation-calendar-cell text-uppercase${
                                      isWeekend ? ' weekend' : ''
                                    }`}
                                    style={{
                                      backgroundColor: color,
                                      color: type ? '#ffffff' : undefined,
                                    }}
                                    title={type ? `${VACATION_TYPE_FULL_LABELS[type as VacationType]} (${type})` : undefined}
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

type IconProps = React.SVGProps<SVGSVGElement>;

function SelectIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false" {...props}>
      <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h9A1.5 1.5 0 0 0 12 12.5V10h1v2.5A2.5 2.5 0 0 1 10.5 15h-9A2.5 2.5 0 0 1-1 12.5v-9A2.5 2.5 0 0 1 1.5 1h9A2.5 2.5 0 0 1 13 3.5V6h-1V3.5A1.5 1.5 0 0 0 10.5 2z" />
      <path d="M15.854 4.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 .708-.708L8.5 11.293l6.646-6.647a.5.5 0 0 1 .708 0" />
    </svg>
  );
}

function DeselectIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false" {...props}>
      <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h9A1.5 1.5 0 0 0 12 12.5V10h1v2.5A2.5 2.5 0 0 1 10.5 15h-9A2.5 2.5 0 0 1-1 12.5v-9A2.5 2.5 0 0 1 1.5 1h9A2.5 2.5 0 0 1 13 3.5V6h-1V3.5A1.5 1.5 0 0 0 10.5 2z" />
      <path d="M4.146 4.146a.5.5 0 0 1 .708 0L8 7.293l3.146-3.147a.5.5 0 0 1 .708.708L8.707 8l3.147 3.146a.5.5 0 0 1-.708.708L8 8.707l-3.146 3.147a.5.5 0 0 1-.708-.708L7.293 8 4.146 4.854a.5.5 0 0 1 0-.708" />
    </svg>
  );
}
