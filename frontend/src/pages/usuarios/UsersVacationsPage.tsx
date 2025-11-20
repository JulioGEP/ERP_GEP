import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap';
import {
  applyBulkVacationDay,
  fetchVacationsSummary,
  type VacationSummaryUser,
  type VacationType,
} from '../../api/userVacations';

const VACATION_TYPE_LABELS: Record<VacationType, string> = {
  A: 'Vacaciones',
  F: 'Festivo',
  L: 'Libre',
  C: 'Compensado',
  T: 'Turno',
};

export default function UsersVacationsPage() {
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [bulkDate, setBulkDate] = useState('');
  const [bulkType, setBulkType] = useState<VacationType>('F');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
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
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            Estado general · {summaryQuery.data?.users.length ?? 0} personas
            <span className="ms-2 text-muted small">{totalWithVacations} con vacaciones marcadas</span>
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
