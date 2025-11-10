import { useMemo } from 'react';
import { Alert, Card, Table } from 'react-bootstrap';

type ControlHorarioRecord = {
  id: string;
  sessionName: string;
  organizationName: string;
  trainerFullName: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
};

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

  const records = useMemo<ControlHorarioRecord[]>(() => [], []);
  const hasRecords = records.length > 0;

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

          {hasRecords ? (
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
                        <td className="align-middle">{record.sessionName}</td>
                        <td className="align-middle">{record.organizationName}</td>
                        <td className="align-middle">{record.trainerFullName}</td>
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
          ) : (
            <Alert variant="info">No hay registros de control horario disponibles.</Alert>
          )}
        </Card.Body>
      </Card>
    </section>
  );
}
