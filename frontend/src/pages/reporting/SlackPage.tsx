import { useState } from 'react';
import { Alert, Button, Card, Spinner } from 'react-bootstrap';
import { useMutation } from '@tanstack/react-query';

import { isApiError } from '../../api/client';
import {
  sendDailyAvailabilitySlackMessage,
  sendDailyTrainersSlackMessage,
  type SlackDailyAvailabilityResponse,
  type SlackDailyTrainersResponse,
} from '../../features/reporting/api';

export default function SlackPage() {
  const [availabilityResult, setAvailabilityResult] = useState<SlackDailyAvailabilityResponse | null>(null);
  const [trainersResult, setTrainersResult] = useState<SlackDailyTrainersResponse | null>(null);

  const sendAvailabilityMutation = useMutation({
    mutationFn: () => sendDailyAvailabilitySlackMessage(),
    onSuccess: (data) => {
      setAvailabilityResult(data);
    },
  });

  const sendTrainersMutation = useMutation({
    mutationFn: () => sendDailyTrainersSlackMessage(),
    onSuccess: (data) => {
      setTrainersResult(data);
    },
  });

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Reporting Slack
        </Card.Header>
        <Card.Body>
          <p className="text-muted mb-3">
            Envía manualmente mensajes automáticos de reporting al canal de Slack.
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
                'Mensaje Vacaciones'
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
