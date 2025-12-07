import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Alert, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  fetchTrainerSelfHours,
  type TrainerHoursFilters,
  type TrainerSelfHoursItem,
} from '../../features/reporting/api';
import { fetchTrainerSessions, type TrainerSessionDetail } from '../../api/trainer-sessions';
import { SessionDetailCard } from '../usuarios/trainer/TrainerSessionsPage';

function formatDate(value: string | null, formatter: Intl.DateTimeFormat): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return formatter.format(parsed);
}

function getCurrentMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const formatDateValue = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    startDate: formatDateValue(start),
    endDate: formatDateValue(end),
  };
}

export default function ControlHorasPage() {
  const [filters, setFilters] = useState<{ startDate: string; endDate: string }>(getCurrentMonthRange);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const hasInvalidRange = Boolean(filters.startDate && filters.endDate && filters.startDate > filters.endDate);

  const appliedFilters = useMemo<TrainerHoursFilters>(() => {
    if (hasInvalidRange) {
      return {};
    }
    return {
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
    };
  }, [filters.endDate, filters.startDate, hasInvalidRange]);

  const hoursQuery = useQuery({
    queryKey: ['trainer', 'control-horas', appliedFilters.startDate ?? null, appliedFilters.endDate ?? null],
    queryFn: () => fetchTrainerSelfHours(appliedFilters),
    enabled: !hasInvalidRange,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const sessionsQuery = useQuery({
    queryKey: ['trainer', 'sessions'],
    queryFn: fetchTrainerSessions,
    staleTime: 5 * 60 * 1000,
  });

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
      }),
    [],
  );
  const hoursFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [],
  );
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }),
    [],
  );

  const data = hasInvalidRange ? null : hoursQuery.data ?? null;
  const items = data?.items ?? [];
  const totalSessions = data?.summary.totalSessions ?? 0;
  const totalHours = data?.summary.totalHours ?? 0;
  const totalServiceCost = data?.summary.totalServiceCost ?? 0;
  const totalExtraCost = data?.summary.totalExtraCost ?? 0;
  const totalPayrollCost = data?.summary.totalPayrollCost ?? 0;

  const sessionsById = useMemo(() => {
    const map = new Map<string, TrainerSessionDetail>();
    const entries = sessionsQuery.data?.dates ?? [];
    entries.forEach((entry) => {
      entry.sessions.forEach((session) => {
        if (session.sessionId) {
          map.set(session.sessionId, session);
        }
      });
    });
    return map;
  }, [sessionsQuery.data]);

  const selectedSession = selectedSessionId ? sessionsById.get(selectedSessionId) ?? null : null;

  let content: JSX.Element;

  if (hasInvalidRange) {
    content = (
      <Alert variant="warning">
        La fecha de inicio no puede ser posterior a la fecha de fin. Ajusta el rango para ver los resultados.
      </Alert>
    );
  } else if (hoursQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (hoursQuery.isError) {
    const error = hoursQuery.error;
    const message = isApiError(error)
      ? error.message
      : 'No se pudo cargar la información de control de horas.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (!items.length) {
    content = <Alert variant="info">No hay horas registradas en el periodo seleccionado.</Alert>;
  } else {
    content = (
      <div className="table-responsive">
        <Table striped bordered hover>
          <thead>
            <tr>
              <th style={{ width: '18%' }}>Fecha de la sesión</th>
              <th style={{ width: '32%' }}>Nombre de la sesión</th>
              <th style={{ width: '12%' }} className="text-end">
                Horas totales
              </th>
              <th style={{ width: '12%' }} className="text-end">
                Coste servicio
              </th>
              <th style={{ width: '12%' }} className="text-end">
                Coste extra
              </th>
              <th style={{ width: '14%' }} className="text-end">
                Nómina
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: TrainerSelfHoursItem) => (
              <tr
                key={item.id}
                role="button"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedSessionId(item.id)}
              >
                <td className="align-middle">{formatDate(item.sessionDate, dateFormatter)}</td>
                <td className="align-middle">{item.sessionName || '—'}</td>
                <td className="text-end align-middle">{hoursFormatter.format(item.totalHours)}</td>
                <td className="text-end align-middle">{currencyFormatter.format(item.serviceCost)}</td>
                <td className="text-end align-middle">{currencyFormatter.format(item.extraCost)}</td>
                <td className="text-end align-middle">{currencyFormatter.format(item.payrollCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <th className="text-end">{totalSessions}</th>
              <th className="text-end">{hoursFormatter.format(totalHours)}</th>
              <th className="text-end">{currencyFormatter.format(totalServiceCost)}</th>
              <th className="text-end">{currencyFormatter.format(totalExtraCost)}</th>
              <th className="text-end">{currencyFormatter.format(totalPayrollCost)}</th>
            </tr>
          </tfoot>
        </Table>
      </div>
    );
  }

  const sessionModalBody = (() => {
    if (!selectedSessionId) return null;
    if (sessionsQuery.isLoading) {
      return (
        <div className="d-flex align-items-center gap-2">
          <Spinner animation="border" size="sm" role="status" />
          <span>Cargando información de la sesión…</span>
        </div>
      );
    }
    if (sessionsQuery.isError) {
      return <Alert variant="danger">No se pudo cargar la información de la sesión.</Alert>;
    }
    if (!selectedSession) {
      return <Alert variant="warning">No se encontró información de la sesión seleccionada.</Alert>;
    }
    return <SessionDetailCard session={selectedSession} />;
  })();

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Control de horas
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Consulta el detalle de tus horas impartidas y los costes asociados a cada sesión.
          </p>
          <Form className="mb-3">
            <div className="d-flex gap-3 flex-wrap align-items-end">
              <Form.Group controlId="control-horas-start" className="mb-0">
                <Form.Label>Fecha de inicio</Form.Label>
                <Form.Control
                  type="date"
                  value={filters.startDate}
                  max={filters.endDate || undefined}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    setFilters((prev) => ({ ...prev, startDate: nextValue }));
                  }}
                />
              </Form.Group>
              <Form.Group controlId="control-horas-end" className="mb-0">
                <Form.Label>Fecha de fin</Form.Label>
                <Form.Control
                  type="date"
                  value={filters.endDate}
                  min={filters.startDate || undefined}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    setFilters((prev) => ({ ...prev, endDate: nextValue }));
                  }}
                />
              </Form.Group>
            </div>
          </Form>
          {content}
        </Card.Body>
      </Card>

      <Modal
        show={Boolean(selectedSessionId)}
        onHide={() => setSelectedSessionId(null)}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>Detalle de la sesión</Modal.Title>
        </Modal.Header>
        <Modal.Body>{sessionModalBody}</Modal.Body>
      </Modal>
    </section>
  );
}
