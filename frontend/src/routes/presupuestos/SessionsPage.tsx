import { useMemo, useState } from 'react';
import { Alert, Badge, Col, Form, Row, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import type { CalendarSession } from '../../features/calendar/api';
import { fetchCalendarSessions } from '../../features/calendar/api';

type ToastParams = { variant: 'success' | 'danger' | 'info'; message: string };

export type BudgetSessionsPageProps = {
  onSessionOpen?: (session: CalendarSession) => void;
  onNotify?: (toast: ToastParams) => void;
};

const SESSION_ESTADO_LABELS: Record<CalendarSession['estado'], string> = {
  BORRADOR: 'Borrador',
  PLANIFICADA: 'Planificada',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada',
  FINALIZADA: 'Finalizada',
};

const SESSION_ESTADO_VARIANTS: Record<CalendarSession['estado'], string> = {
  BORRADOR: 'secondary',
  PLANIFICADA: 'success',
  SUSPENDIDA: 'warning',
  CANCELADA: 'danger',
  FINALIZADA: 'primary',
};

function formatInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toRangeIso(date: string, boundary: 'start' | 'end'): string {
  const safeDate = date ? new Date(date) : new Date();
  const adjusted = new Date(safeDate);
  if (boundary === 'start') {
    adjusted.setHours(0, 0, 0, 0);
  } else {
    adjusted.setHours(23, 59, 59, 999);
  }
  return adjusted.toISOString();
}

function formatDateTime(value: string): string {
  if (!value) return '';
  return new Date(value).toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function SessionsPage({ onSessionOpen, onNotify }: BudgetSessionsPageProps) {
  const today = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => {
    const end = new Date(today);
    end.setDate(end.getDate() + 30);
    return end;
  }, [today]);

  const [startDate, setStartDate] = useState(formatInputDate(today));
  const [endDate, setEndDate] = useState(formatInputDate(defaultEnd));

  const hasValidRange = useMemo(() => {
    if (!startDate || !endDate) return false;
    return new Date(startDate) <= new Date(endDate);
  }, [startDate, endDate]);

  const sessionsQuery = useQuery({
    queryKey: ['budget-sessions', startDate, endDate],
    queryFn: () =>
      fetchCalendarSessions({ start: toRangeIso(startDate, 'start'), end: toRangeIso(endDate, 'end') }),
    enabled: hasValidRange,
  });

  const sessions = sessionsQuery.data?.sessions ?? [];

  const handleSessionClick = (session: CalendarSession) => {
    if (onSessionOpen) {
      onSessionOpen(session);
      return;
    }
    onNotify?.({ variant: 'info', message: 'No se pudo abrir el detalle de la sesión.' });
  };

  return (
    <div className="d-grid gap-4">
      <header className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <h1 className="h3 fw-bold mb-0">Sesiones</h1>
          <p className="text-muted mb-0">Listado de sesiones de presupuestos</p>
        </div>
      </header>

      <section className="p-3 border rounded-3 bg-white">
        <h2 className="h6 fw-semibold mb-3">Filtrar por fecha</h2>
        <Row className="g-3">
          <Col md={6} lg={3}>
            <Form.Label className="fw-semibold">Fecha inicio</Form.Label>
            <Form.Control
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Col>
          <Col md={6} lg={3}>
            <Form.Label className="fw-semibold">Fecha fin</Form.Label>
            <Form.Control type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </Col>
        </Row>
        {!hasValidRange && (
          <Alert variant="warning" className="mt-3 mb-0">
            Ajusta el rango de fechas para ver las sesiones.
          </Alert>
        )}
      </section>

      <section className="p-3 border rounded-3 bg-white">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <h2 className="h5 mb-0">Sesiones</h2>
          {sessionsQuery.isFetching && <Spinner animation="border" role="status" size="sm" />}
        </div>

        {sessionsQuery.isError && (
          <Alert variant="danger">
            No se pudieron cargar las sesiones. Inténtalo de nuevo.
          </Alert>
        )}

        {sessionsQuery.isLoading ? (
          <div className="d-flex justify-content-center py-5">
            <Spinner animation="border" role="status" />
          </div>
        ) : sessions.length === 0 ? (
          <Alert variant="secondary" className="mb-0">
            No hay sesiones en el rango seleccionado.
          </Alert>
        ) : (
          <div className="table-responsive">
            <Table hover className="align-middle">
              <thead>
                <tr>
                  <th>Presupuesto</th>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Fecha de inicio</th>
                  <th>Producto</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr
                    key={session.id}
                    role="button"
                    className="table-row-clickable"
                    onClick={() => handleSessionClick(session)}
                  >
                    <td>
                      <div className="fw-semibold">{session.dealTitle?.trim() || `Presupuesto ${session.dealId}`}</div>
                      <div className="text-muted small">{session.dealId}</div>
                    </td>
                    <td>{session.title}</td>
                    <td>
                      <Badge bg={SESSION_ESTADO_VARIANTS[session.estado]}>
                        {SESSION_ESTADO_LABELS[session.estado]}
                      </Badge>
                    </td>
                    <td>{formatDateTime(session.start)}</td>
                    <td>{session.productName ?? session.productCode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

export default SessionsPage;
