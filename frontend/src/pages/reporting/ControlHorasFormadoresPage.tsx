import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Card, Form, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  fetchReportingTrainerControlHours,
  type ReportingTrainerControlHoursItem,
  type TrainerHoursFilters,
} from '../../features/reporting/api';

function getCurrentMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const format = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return { startDate: format(start), endDate: format(end) };
}

export default function ControlHorasFormadoresPage() {
  const [filters, setFilters] = useState(() => ({ ...getCurrentMonthRange(), trainerSearch: '', status: 'all' as 'all' | 'logged' | 'pending' }));

  const hasInvalidRange = Boolean(filters.startDate && filters.endDate && filters.startDate > filters.endDate);

  const appliedFilters = useMemo<TrainerHoursFilters>(
    () =>
      hasInvalidRange
        ? {}
        : {
            startDate: filters.startDate || undefined,
            endDate: filters.endDate || undefined,
          },
    [filters.endDate, filters.startDate, hasInvalidRange],
  );

  const reportQuery = useQuery({
    queryKey: ['reporting-control-horas-formadores', appliedFilters.startDate ?? null, appliedFilters.endDate ?? null],
    queryFn: () => fetchReportingTrainerControlHours(appliedFilters),
    enabled: !hasInvalidRange,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [],
  );

  const rows = useMemo(() => {
    const baseRows = reportQuery.data?.items ?? [];
    return baseRows.filter((item) => {
      const search = filters.trainerSearch.trim().toLowerCase();
      if (search.length && !item.trainerName.toLowerCase().includes(search) && !item.sessionName.toLowerCase().includes(search)) {
        return false;
      }
      if (filters.status === 'logged') {
        return item.hasTimeLog;
      }
      if (filters.status === 'pending') {
        return !item.hasTimeLog;
      }
      return true;
    });
  }, [filters.status, filters.trainerSearch, reportQuery.data?.items]);

  const summary = useMemo(
    () =>
      rows.reduce(
        (acc, item) => {
          acc.assigned += item.assignedHours;
          acc.logged += item.loggedHours;
          if (item.hasTimeLog) {
            acc.loggedSessions += 1;
          } else {
            acc.pendingSessions += 1;
          }
          return acc;
        },
        { assigned: 0, logged: 0, loggedSessions: 0, pendingSessions: 0 },
      ),
    [rows],
  );

  let content: JSX.Element;
  if (hasInvalidRange) {
    content = <Alert variant="warning">La fecha de inicio no puede ser posterior a la fecha de fin.</Alert>;
  } else if (reportQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (reportQuery.isError) {
    content = (
      <Alert variant="danger">
        {isApiError(reportQuery.error)
          ? reportQuery.error.message
          : 'No se pudo cargar el control de horas de formadores.'}
      </Alert>
    );
  } else if (!rows.length) {
    content = <Alert variant="info">No hay sesiones asignadas para los filtros seleccionados.</Alert>;
  } else {
    content = (
      <div className="table-responsive">
        <Table striped bordered hover>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Formador</th>
              <th>Sesión</th>
              <th className="text-end">Horas asignadas</th>
              <th className="text-end">Horas fichadas</th>
              <th className="text-end">Diurnas</th>
              <th className="text-end">Nocturnas</th>
              <th className="text-end">Festivo autonómico</th>
              <th className="text-end">Festivo nacional</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item: ReportingTrainerControlHoursItem) => (
              <tr key={`${item.trainerId}-${item.sessionId}`}>
                <td>{item.sessionDate ?? '—'}</td>
                <td>{item.trainerName}</td>
                <td>{item.sessionName}</td>
                <td className="text-end">{numberFormatter.format(item.assignedHours)}</td>
                <td className="text-end">{numberFormatter.format(item.loggedHours)}</td>
                <td className="text-end">{numberFormatter.format(item.dayHours)}</td>
                <td className="text-end">{numberFormatter.format(item.nightHours)}</td>
                <td className="text-end">{numberFormatter.format(item.regionalHolidayHours)}</td>
                <td className="text-end">{numberFormatter.format(item.nationalHolidayHours)}</td>
                <td>{item.hasTimeLog ? 'Fichada' : 'Sin fichar'}</td>
              </tr>
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
          Control horas formadores externos
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Vista diaria de sesiones asignadas para formadores con <code>contrato_fijo = false</code>, mostrando sesiones fichadas y pendientes.
          </p>

          <Form className="mb-3">
            <div className="d-flex gap-3 flex-wrap align-items-end">
              <Form.Group controlId="control-horas-formadores-start" className="mb-0">
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
              <Form.Group controlId="control-horas-formadores-end" className="mb-0">
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
              <Form.Group controlId="control-horas-formadores-search" className="mb-0">
                <Form.Label>Buscar</Form.Label>
                <Form.Control
                  type="search"
                  placeholder="Formador o sesión"
                  value={filters.trainerSearch}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    setFilters((prev) => ({ ...prev, trainerSearch: nextValue }));
                  }}
                />
              </Form.Group>
              <Form.Group controlId="control-horas-formadores-status" className="mb-0">
                <Form.Label>Estado fichaje</Form.Label>
                <Form.Select
                  value={filters.status}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value as 'all' | 'logged' | 'pending';
                    setFilters((prev) => ({ ...prev, status: nextValue }));
                  }}
                >
                  <option value="all">Todas</option>
                  <option value="logged">Fichadas</option>
                  <option value="pending">Sin fichar</option>
                </Form.Select>
              </Form.Group>
            </div>
          </Form>

          <div className="d-flex gap-4 flex-wrap mb-3">
            <div>
              <span className="text-muted d-block small">Sesiones fichadas</span>
              <span className="fw-semibold h5 mb-0">{summary.loggedSessions}</span>
            </div>
            <div>
              <span className="text-muted d-block small">Sesiones sin fichar</span>
              <span className="fw-semibold h5 mb-0">{summary.pendingSessions}</span>
            </div>
            <div>
              <span className="text-muted d-block small">Horas asignadas</span>
              <span className="fw-semibold h5 mb-0">{numberFormatter.format(summary.assigned)}</span>
            </div>
            <div>
              <span className="text-muted d-block small">Horas fichadas</span>
              <span className="fw-semibold h5 mb-0">{numberFormatter.format(summary.logged)}</span>
            </div>
          </div>

          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
