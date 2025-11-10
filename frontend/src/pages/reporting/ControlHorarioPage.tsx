import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import { fetchControlHorarioRecords, type ControlHorarioRecord } from '../../features/reporting/api';

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function diffInMinutes(reference: string | null, actual: string | null): number | null {
  const referenceDate = parseDate(reference);
  const actualDate = parseDate(actual);
  if (!referenceDate || !actualDate) return null;
  const diffMilliseconds = actualDate.getTime() - referenceDate.getTime();
  return Math.round(diffMilliseconds / (1000 * 60));
}

export default function ControlHorarioPage() {
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [],
  );

  const differenceFormatter = useMemo(
    () =>
      new Intl.NumberFormat('es-ES', {
        signDisplay: 'always',
        maximumFractionDigits: 0,
      }),
    [],
  );

  const recordsQuery = useQuery({
    queryKey: ['reporting', 'control-horario'],
    queryFn: fetchControlHorarioRecords,
    staleTime: 5 * 60 * 1000,
  });

  const records = recordsQuery.data ?? [];
  const hasRecords = records.length > 0;

  let content: JSX.Element;

  if (recordsQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (recordsQuery.isError) {
    const error = recordsQuery.error;
    const message = isApiError(error)
      ? error.message
      : 'No se pudo cargar la información del control horario.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (!hasRecords) {
    content = <Alert variant="info">No hay registros de control horario disponibles.</Alert>;
  } else {
    content = (
      <div className="table-responsive">
        <Table striped bordered hover>
          <thead>
            <tr>
              <th>Nombre de la sesión</th>
              <th>Nombre de la organización</th>
              <th>Nombre / Apellidos de formador</th>
              <th>Horarios de inicio y fin de la sesión</th>
              <th>Horario de marcaje de la formación</th>
              <th>Diferencias (minutos)</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const sessionName = record.sessionName ?? '—';
              const organizationName = record.organizationName ?? '—';
              const trainerFullName = record.trainerFullName ?? '—';
              const plannedStart = record.plannedStart
                ? dateTimeFormatter.format(new Date(record.plannedStart))
                : '—';
              const plannedEnd = record.plannedEnd
                ? dateTimeFormatter.format(new Date(record.plannedEnd))
                : '—';
              const clockIn = record.clockIn
                ? dateTimeFormatter.format(new Date(record.clockIn))
                : '—';
              const clockOut = record.clockOut
                ? dateTimeFormatter.format(new Date(record.clockOut))
                : '—';

              const startDiff = diffInMinutes(record.plannedStart, record.clockIn);
              const endDiff = diffInMinutes(record.plannedEnd, record.clockOut);

              const differenceSummary = (() => {
                const parts: string[] = [];
                if (startDiff !== null) {
                  parts.push(`Inicio: ${differenceFormatter.format(startDiff)} min`);
                }
                if (endDiff !== null) {
                  parts.push(`Fin: ${differenceFormatter.format(endDiff)} min`);
                }
                return parts.length ? parts.join(' · ') : '—';
              })();

              return (
                <tr key={record.id}>
                  <td className="align-middle">{sessionName}</td>
                  <td className="align-middle">{organizationName}</td>
                  <td className="align-middle">{trainerFullName}</td>
                  <td className="align-middle">
                    <div>
                      <span className="fw-semibold">Inicio:</span> {plannedStart}
                    </div>
                    <div>
                      <span className="fw-semibold">Fin:</span> {plannedEnd}
                    </div>
                  </td>
                  <td className="align-middle">
                    <div>
                      <span className="fw-semibold">Entrada:</span> {clockIn}
                    </div>
                    <div>
                      <span className="fw-semibold">Salida:</span> {clockOut}
                    </div>
                  </td>
                  <td className="align-middle">{differenceSummary}</td>
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
          Control Horario
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Seguimiento de los marcajes realizados por los formadores en cada sesión planificada.
          </p>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
