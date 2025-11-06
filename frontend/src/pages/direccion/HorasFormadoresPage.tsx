import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Spinner, Table } from 'react-bootstrap';
import { fetchTrainerHours, type TrainerHoursItem } from '../../features/direccion/api';
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

export default function HorasFormadoresPage() {
  const trainerHoursQuery = useQuery({
    queryKey: ['direccion', 'horas-formadores'],
    queryFn: fetchTrainerHours,
    staleTime: 5 * 60 * 1000,
  });

  const hoursFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [],
  );
  const integerFormatter = useMemo(() => new Intl.NumberFormat('es-ES'), []);

  const items = trainerHoursQuery.data?.items ?? [];
  const totalSessions = trainerHoursQuery.data?.summary.totalSessions ?? 0;
  const totalHours = trainerHoursQuery.data?.summary.totalHours ?? 0;
  const hasLoadedData = Boolean(trainerHoursQuery.data);
  const summaryTrainers = hasLoadedData ? integerFormatter.format(items.length) : '—';
  const summarySessions = hasLoadedData ? integerFormatter.format(totalSessions) : '—';
  const summaryHours = hasLoadedData ? hoursFormatter.format(totalHours) : '—';

  let content: JSX.Element;

  if (trainerHoursQuery.isLoading) {
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
              <th style={{ width: '50%' }}>Formador</th>
              <th style={{ width: '25%' }} className="text-end">
                Sesiones
              </th>
              <th style={{ width: '25%' }} className="text-end">
                Horas totales
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
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <th className="text-end">{integerFormatter.format(totalSessions)}</th>
              <th className="text-end">{hoursFormatter.format(totalHours)}</th>
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
          </div>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
