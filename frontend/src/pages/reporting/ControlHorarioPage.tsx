import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import { fetchControlHorarioRecords, type ControlHorarioRecord } from '../../features/reporting/api';
import { exportToExcel } from '../../shared/export/exportToExcel';

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

  const endedWithoutClockSummary = useMemo(() => {
    const now = Date.now();
    const counter = new Map<string, number>();

    for (const record of records) {
      const plannedEnd = parseDate(record.plannedEnd);
      if (!plannedEnd) {
        continue;
      }

      const hasEnded = plannedEnd.getTime() <= now;
      const hasClocked = record.clockIn !== null || record.clockOut !== null;

      if (!hasEnded || hasClocked) {
        continue;
      }

      const currentCount = counter.get(record.trainerFullName) ?? 0;
      counter.set(record.trainerFullName, currentCount + 1);
    }

    return Array.from(counter.entries())
      .map(([trainerFullName, sessionCount]) => ({ trainerFullName, sessionCount }))
      .sort((a, b) => a.trainerFullName.localeCompare(b.trainerFullName, 'es', { sensitivity: 'base' }));
  }, [records]);

  const canDownload = !recordsQuery.isLoading && !recordsQuery.isError && hasRecords;

  const handleDownload = () => {
    if (!canDownload) {
      return;
    }

    const headerRow = [
      'Nombre de la sesión',
      'Nombre de la organización',
      'Formador',
      'Inicio planificado',
      'Fin planificado',
      'Entrada (marcaje)',
      'Salida (marcaje)',
      'Diferencia inicio (minutos)',
      'Diferencia fin (minutos)',
    ] as const;

    const rows = records.map((record) => {
      const plannedStart = record.plannedStart
        ? dateTimeFormatter.format(new Date(record.plannedStart))
        : '';
      const plannedEnd = record.plannedEnd
        ? dateTimeFormatter.format(new Date(record.plannedEnd))
        : '';
      const clockIn = record.clockIn ? dateTimeFormatter.format(new Date(record.clockIn)) : '';
      const clockOut = record.clockOut ? dateTimeFormatter.format(new Date(record.clockOut)) : '';

      const startDiff = diffInMinutes(record.plannedStart, record.clockIn);
      const endDiff = diffInMinutes(record.plannedEnd, record.clockOut);

      return [
        record.sessionName ?? '',
        record.organizationName ?? '',
        record.trainerFullName ?? '',
        plannedStart,
        plannedEnd,
        clockIn,
        clockOut,
        startDiff ?? '',
        endDiff ?? '',
      ];
    });

    exportToExcel({
      rows: [headerRow, ...rows],
      fileName: `control_horario_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: 'Control Horario',
    });
  };

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
      <>
        <RecordsTable
          records={records}
          dateTimeFormatter={dateTimeFormatter}
          differenceFormatter={differenceFormatter}
        />

        <div className="mt-4">
          <h2 className="h5 mb-3">Sesiones finalizadas sin fichaje</h2>
          {endedWithoutClockSummary.length > 0 ? (
            <TrainerSummaryTable trainers={endedWithoutClockSummary} />
          ) : (
            <Alert variant="light" className="mb-0">
              No hay sesiones finalizadas sin registro de fichaje.
            </Alert>
          )}
        </div>
      </>
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
          <div className="d-flex justify-content-end mb-3">
            <Button type="button" onClick={handleDownload} disabled={!canDownload}>
              Descargar
            </Button>
          </div>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}

type RecordsTableProps = {
  records: ControlHorarioRecord[];
  dateTimeFormatter: Intl.DateTimeFormat;
  differenceFormatter: Intl.NumberFormat;
};

function RecordsTable({ records, dateTimeFormatter, differenceFormatter }: RecordsTableProps) {
  return (
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

type TrainerSummaryTableProps = {
  trainers: Array<{ trainerFullName: string; sessionCount: number }>;
};

function TrainerSummaryTable({ trainers }: TrainerSummaryTableProps) {
  return (
    <div className="table-responsive">
      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Nombre / Apellidos de formador</th>
            <th>Total de sesiones sin fichar</th>
          </tr>
        </thead>
        <tbody>
          {trainers.map(({ trainerFullName, sessionCount }) => (
            <tr key={trainerFullName}>
              <td className="align-middle">{trainerFullName}</td>
              <td className="align-middle">{sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
