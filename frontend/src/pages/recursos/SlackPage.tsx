import { useMemo, useState } from 'react';
import { Alert, Button, Card, Spinner, Table } from 'react-bootstrap';
import { useMutation } from '@tanstack/react-query';

import { isApiError } from '../../api/client';
import {
  sendDailyAvailabilitySlackMessage,
  sendDailyTrainersSlackMessage,
  type SlackDailyAvailabilityResponse,
  type SlackDailyTrainersResponse,
} from '../../features/reporting/api';

type SlackLogEntry = {
  id: string;
  createdAt: string;
  type: 'availability' | 'trainers';
  status: 'success' | 'error';
  message: string;
  channel?: string;
  text?: string;
  error?: string;
};

function formatLogType(type: SlackLogEntry['type']): string {
  return type === 'availability' ? 'Asistencia' : 'Formadores';
}

function formatLogStatus(status: SlackLogEntry['status']): string {
  return status === 'success' ? 'Enviado' : 'Error';
}

export default function SlackPage() {
  const [availabilityResult, setAvailabilityResult] = useState<SlackDailyAvailabilityResponse | null>(null);
  const [trainersResult, setTrainersResult] = useState<SlackDailyTrainersResponse | null>(null);
  const [logs, setLogs] = useState<SlackLogEntry[]>([]);

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );

  const appendLog = (entry: Omit<SlackLogEntry, 'id' | 'createdAt'>) => {
    setLogs((prev) => [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const sendAvailabilityMutation = useMutation({
    mutationFn: () => sendDailyAvailabilitySlackMessage(),
    onSuccess: (data) => {
      setAvailabilityResult(data);
      appendLog({
        type: 'availability',
        status: 'success',
        message: data.message,
        channel: data.channel,
        text: data.text,
      });
    },
    onError: (error) => {
      appendLog({
        type: 'availability',
        status: 'error',
        message: 'Error al enviar el mensaje de asistencia.',
        error: isApiError(error) ? error.message : 'Error inesperado al enviar el mensaje a Slack.',
      });
    },
  });

  const sendTrainersMutation = useMutation({
    mutationFn: () => sendDailyTrainersSlackMessage(),
    onSuccess: (data) => {
      setTrainersResult(data);
      appendLog({
        type: 'trainers',
        status: 'success',
        message: data.message,
        channel: data.channel,
        text: data.text,
      });
    },
    onError: (error) => {
      appendLog({
        type: 'trainers',
        status: 'error',
        message: 'Error al enviar el mensaje de formadores.',
        error: isApiError(error) ? error.message : 'Error inesperado al enviar el mensaje de formadores.',
      });
    },
  });

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Recursos Slack
        </Card.Header>
        <Card.Body>
          <p className="text-muted mb-3">
            Envía manualmente mensajes automáticos al canal de Slack desde Recursos.
          </p>

          <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
            <Button
              variant="primary"
              onClick={() => sendAvailabilityMutation.mutate()}
              disabled={sendAvailabilityMutation.isPending}
            >
              {sendAvailabilityMutation.isPending ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Enviando...
                </>
              ) : (
                'Mensaje Asistencia'
              )}
            </Button>

            <Button
              variant="secondary"
              onClick={() => sendTrainersMutation.mutate()}
              disabled={sendTrainersMutation.isPending}
            >
              {sendTrainersMutation.isPending ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Enviando...
                </>
              ) : (
                'Mensaje Formadores'
              )}
            </Button>
          </div>

          <div className="mb-4">
            <h2 className="h5 mb-3">Log de envíos</h2>
            {logs.length === 0 ? (
              <Alert variant="light" className="mb-0 border">
                Todavía no hay envíos registrados en esta sesión.
              </Alert>
            ) : (
              <div className="table-responsive">
                <Table striped bordered hover size="sm" className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Resultado</th>
                      <th>Canal</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((entry) => (
                      <tr key={entry.id}>
                        <td>{dateTimeFormatter.format(new Date(entry.createdAt))}</td>
                        <td>{formatLogType(entry.type)}</td>
                        <td>
                          <span className={`badge text-bg-${entry.status === 'success' ? 'success' : 'danger'}`}>
                            {formatLogStatus(entry.status)}
                          </span>
                        </td>
                        <td>{entry.channel ?? '—'}</td>
                        <td>
                          <div className="fw-semibold">{entry.message}</div>
                          {entry.error ? <div className="text-danger small mt-1">{entry.error}</div> : null}
                          {entry.text ? (
                            <pre className="bg-light p-2 rounded mt-2 mb-0 small" style={{ whiteSpace: 'pre-wrap' }}>
                              {entry.text}
                            </pre>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>

          {sendAvailabilityMutation.isError && (
            <Alert variant="danger" className="mb-3">
              {isApiError(sendAvailabilityMutation.error)
                ? `Error al enviar a Slack: ${sendAvailabilityMutation.error.message}`
                : 'Error inesperado al enviar el mensaje a Slack.'}
            </Alert>
          )}

          {sendTrainersMutation.isError && (
            <Alert variant="danger" className="mb-3">
              {isApiError(sendTrainersMutation.error)
                ? `Error al enviar mensaje de formadores: ${sendTrainersMutation.error.message}`
                : 'Error inesperado al enviar el mensaje de formadores.'}
            </Alert>
          )}

          {availabilityResult && (
            <Alert variant="success" className="mb-3">
              <div className="fw-semibold mb-2">{availabilityResult.message}</div>
              <div>
                <strong>Canal:</strong> {availabilityResult.channel}
              </div>
              <div className="mt-2">
                <strong>Mensaje enviado:</strong>
                <pre className="bg-light p-2 rounded mt-1 mb-0" style={{ whiteSpace: 'pre-wrap' }}>
                  {availabilityResult.text}
                </pre>
              </div>
            </Alert>
          )}

          {trainersResult && (
            <Alert variant="success" className="mb-0">
              <div className="fw-semibold mb-2">{trainersResult.message}</div>
              <div>
                <strong>Canal:</strong> {trainersResult.channel}
              </div>
              <div className="mt-2">
                <strong>Mensaje enviado:</strong>
                <pre className="bg-light p-2 rounded mt-1 mb-0" style={{ whiteSpace: 'pre-wrap' }}>
                  {trainersResult.text}
                </pre>
              </div>
            </Alert>
          )}
        </Card.Body>
      </Card>
    </section>
  );
}
