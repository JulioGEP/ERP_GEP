import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Spinner, Table } from 'react-bootstrap';
import {
  fetchTrainerHours,
  type TrainerHoursFilters,
  type TrainerHoursItem,
} from '../../features/reporting/api';
import { isApiError } from '../../api/client';
import { exportToExcel } from '../../shared/export/exportToExcel';

function formatTrainerName(item: TrainerHoursItem): string {
  const parts = [item.name, item.lastName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);
  if (parts.length) {
    return parts.join(' ');
  }
  return item.trainerId;
}

function isUnassignedTrainerName(name: string | null, lastName: string | null): boolean {
  const normalizedParts = [name, lastName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);
  if (!normalizedParts.length) {
    return false;
  }
  return normalizedParts.join(' ').toLowerCase() === 'sin asignar';
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
  const items = useMemo(() => {
    if (!data) {
      return [] as TrainerHoursItem[];
    }
    return data.items.filter((item) => !isUnassignedTrainerName(item.name, item.lastName));
  }, [data]);

  const summary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.totalSessions += item.sessionCount;
        acc.totalHours += item.totalHours;
        acc.totalServiceCost += item.serviceCost;
        acc.totalExtraCost += item.extraCost;
        acc.totalPayrollCost += item.payrollCost;
        return acc;
      },
      {
        totalSessions: 0,
        totalHours: 0,
        totalServiceCost: 0,
        totalExtraCost: 0,
        totalPayrollCost: 0,
      },
    );
  }, [items]);

  const hasLoadedData = Boolean(data);
  const summaryTrainers = hasLoadedData ? integerFormatter.format(items.length) : '—';
  const summarySessions = hasLoadedData ? integerFormatter.format(summary.totalSessions) : '—';
  const summaryHours = hasLoadedData ? hoursFormatter.format(summary.totalHours) : '—';
  const summaryServiceCost = hasLoadedData
    ? currencyFormatter.format(summary.totalServiceCost)
    : '—';
  const summaryExtraCost = hasLoadedData ? currencyFormatter.format(summary.totalExtraCost) : '—';
  const summaryPayrollCost = hasLoadedData
    ? currencyFormatter.format(summary.totalPayrollCost)
    : '—';

  const periodLabel = useMemo(() => {
    if (filters.startDate && filters.endDate) {
      return `${filters.startDate}_a_${filters.endDate}`;
    }
    if (filters.startDate) {
      return `desde_${filters.startDate}`;
    }
    if (filters.endDate) {
      return `hasta_${filters.endDate}`;
    }
    return 'completo';
  }, [filters.endDate, filters.startDate]);

  const canDownload = !hasInvalidRange && !trainerHoursQuery.isLoading && !trainerHoursQuery.isError && items.length > 0;

  const handleDownload = () => {
    if (!canDownload) {
      return;
    }

    const roundToTwoDecimals = (value: number) => Math.round(value * 100) / 100;

    const headerRow = [
      'Formador',
      'ID formador',
      'Sesiones',
      'Horas totales',
      'Coste servicio (€)',
      'Coste extra (€)',
      'Nómina (€)',
    ] as const;

    const rows = items.map((item) => {
      const displayName = formatTrainerName(item);
      return [
        displayName,
        item.trainerId,
        item.sessionCount,
        roundToTwoDecimals(item.totalHours),
        roundToTwoDecimals(item.serviceCost),
        roundToTwoDecimals(item.extraCost),
        roundToTwoDecimals(item.payrollCost),
      ] as const;
    });

    const sheetRows = [
      headerRow,
      ...rows,
      [
        'Total',
        '',
        summary.totalSessions,
        roundToTwoDecimals(summary.totalHours),
        roundToTwoDecimals(summary.totalServiceCost),
        roundToTwoDecimals(summary.totalExtraCost),
        roundToTwoDecimals(summary.totalPayrollCost),
      ],
    ];

    exportToExcel({
      rows: sheetRows,
      fileName: `horas_formadores_${periodLabel}.xlsx`,
      sheetName: 'Horas Formadores',
      auditEvent: {
        action: 'reporting.horas_formadores.export',
        details: {
          period: periodLabel,
          itemCount: items.length,
        },
      },
    });
  };

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
              <th className="text-end">{integerFormatter.format(summary.totalSessions)}</th>
              <th className="text-end">{hoursFormatter.format(summary.totalHours)}</th>
              <th className="text-end">{currencyFormatter.format(summary.totalServiceCost)}</th>
              <th className="text-end">{currencyFormatter.format(summary.totalExtraCost)}</th>
              <th className="text-end">{currencyFormatter.format(summary.totalPayrollCost)}</th>
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
              <Button
                type="button"
                className="ms-auto"
                onClick={handleDownload}
                disabled={!canDownload}
              >
                Descargar
              </Button>
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
