import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Alert, Card, Form, Spinner, Table } from 'react-bootstrap';
import {
  fetchTrainerHours,
  type TrainerHoursFilters,
  type TrainerHoursItem,
} from '../../features/reporting/api';
import { isApiError } from '../../api/client';

function formatTrainerName(item: TrainerHoursItem): string {
  const parts = [item.name, item.lastName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);
  if (parts.length) {
    return parts.join(' ');
  }
  return item.trainerId;
}

function getCurrentMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

export default function HorasFormadoresPage() {
  const [filters, setFilters] = useState<{ startDate: string; endDate: string }>(getCurrentMonthRange);

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

  const trainerHoursQuery = useQuery({
    queryKey: [
      'reporting',
      'horas-formadores',
      appliedFilters.startDate ?? null,
      appliedFilters.endDate ?? null,
    ],
    queryFn: () => fetchTrainerHours(appliedFilters),
    staleTime: 5 * 60 * 1000,
    enabled: !hasInvalidRange,
    placeholderData: keepPreviousData,
  });

  const hoursFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [],
  );
  const integerFormatter = useMemo(() => new Intl.NumberFormat('es-ES'), []);
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }),
    [],
  );

  const data = hasInvalidRange ? null : trainerHoursQuery.data ?? null;
  const items = data?.items ?? [];
  const totalSessions = data?.summary.totalSessions ?? 0;
  const totalHours = data?.summary.totalHours ?? 0;
  const totalServiceCost = data?.summary.totalServiceCost ?? 0;
  const totalExtraCost = data?.summary.totalExtraCost ?? 0;
  const totalPayrollCost = data?.summary.totalPayrollCost ?? 0;
  const hasLoadedData = Boolean(data);
  const summaryTrainers = hasLoadedData ? integerFormatter.format(items.length) : '—';
  const summarySessions = hasLoadedData ? integerFormatter.format(totalSessions) : '—';
  const summaryHours = hasLoadedData ? hoursFormatter.format(totalHours) : '—';
  const summaryServiceCost = hasLoadedData ? currencyFormatter.format(totalServiceCost) : '—';
  const summaryExtraCost = hasLoadedData ? currencyFormatter.format(totalExtraCost) : '—';
  const summaryPayrollCost = hasLoadedData ? currencyFormatter.format(totalPayrollCost) : '—';

  let content: JSX.Element;

  if (hasInvalidRange) {
    content = (
      <Alert variant="warning">
        La fecha de inicio no puede ser posterior a la fecha de fin. Ajusta el rango para ver los
        resultados.
      </Alert>
    );
  } else if (trainerHoursQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (trainerHoursQuery.isError) {
    const error = trainerHoursQuery.error;
    const message = isApiError(error)
      ? error.message
      : 'No se pudo cargar la información de horas por formador.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (!items.length) {
    content = <Alert variant="info">No hay sesiones con horas asignadas a formadores.</Alert>;
  } else {
    content = (
      <div className="table-responsive">
        <Table striped bordered hover>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Formador</th>
              <th style={{ width: '14%' }} className="text-end">
                Sesiones
              </th>
              <th style={{ width: '14%' }} className="text-end">
                Horas totales
              </th>
              <th style={{ width: '14%' }} className="text-end">
                Coste servicio
              </th>
              <th style={{ width: '14%' }} className="text-end">
                Coste extra
              </th>
              <th style={{ width: '14%' }} className="text-end">
                Nómina
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const displayName = formatTrainerName(item);
              const showIdentifier = displayName !== item.trainerId;
              return (
                <tr key={item.trainerId}>
                  <td>
                    <div className="fw-semibold">{displayName}</div>
                    {showIdentifier ? (
                      <div className="text-muted small">ID: {item.trainerId}</div>
                    ) : null}
                  </td>
                  <td className="text-end align-middle">{integerFormatter.format(item.sessionCount)}</td>
                  <td className="text-end align-middle">{hoursFormatter.format(item.totalHours)}</td>
                  <td className="text-end align-middle">{currencyFormatter.format(item.serviceCost)}</td>
                  <td className="text-end align-middle">{currencyFormatter.format(item.extraCost)}</td>
                  <td className="text-end align-middle">{currencyFormatter.format(item.payrollCost)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <th className="text-end">{integerFormatter.format(totalSessions)}</th>
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

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Horas Formadores
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Informe agregado del total de horas impartidas por cada formador según las sesiones
            planificadas.
          </p>
          <Form className="mb-3">
            <div className="d-flex gap-3 flex-wrap align-items-end">
              <Form.Group controlId="horas-formadores-start" className="mb-0">
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
              <Form.Group controlId="horas-formadores-end" className="mb-0">
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
          <div className="d-flex gap-3 flex-wrap mb-3">
            <div>
              <span className="text-muted d-block small">Total de formadores</span>
              <span className="fw-semibold h5 mb-0">{summaryTrainers}</span>
            </div>
            <div>
              <span className="text-muted d-block small">Total de sesiones</span>
              <span className="fw-semibold h5 mb-0">{summarySessions}</span>
            </div>
            <div>
              <span className="text-muted d-block small">Total de horas</span>
              <span className="fw-semibold h5 mb-0">{summaryHours}</span>
            </div>
            <div>
              <span className="text-muted d-block small">Coste servicio</span>
              <span className="fw-semibold h5 mb-0">{summaryServiceCost}</span>
            </div>
            <div>
              <span className="text-muted d-block small">Coste extra</span>
              <span className="fw-semibold h5 mb-0">{summaryExtraCost}</span>
            </div>
            <div>
              <span className="text-muted d-block small">Nómina</span>
              <span className="fw-semibold h5 mb-0">{summaryPayrollCost}</span>
            </div>
          </div>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
