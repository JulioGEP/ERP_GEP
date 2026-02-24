import { useState } from 'react';
import { Alert, Button, Card, Spinner } from 'react-bootstrap';
import { useMutation } from '@tanstack/react-query';

import { isApiError } from '../../api/client';
import {
  sendDailyAvailabilitySlackMessage,
  type SlackDailyAvailabilityResponse,
} from '../../features/reporting/api';

export default function SlackPage() {
  const [result, setResult] = useState<SlackDailyAvailabilityResponse | null>(null);

  const sendSlackMutation = useMutation({
    mutationFn: () => sendDailyAvailabilitySlackMessage(),
    onSuccess: (data) => {
      setResult(data);
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
            Envía manualmente el resumen diario de no disponibilidad y teletrabajo al canal de Slack.
          </p>

          <div className="d-flex align-items-center gap-2 mb-3">
            <Button
              variant="primary"
              onClick={() => sendSlackMutation.mutate()}
              disabled={sendSlackMutation.isPending}
            >
              {sendSlackMutation.isPending ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Enviando...
                </>
              ) : (
                'Enviar Slack'
              )}
            </Button>
          </div>

          {sendSlackMutation.isError && (
            <Alert variant="danger" className="mb-3">
              {isApiError(sendSlackMutation.error)
                ? `Error al enviar a Slack: ${sendSlackMutation.error.message}`
                : 'Error inesperado al enviar el mensaje a Slack.'}
            </Alert>
          )}

          {result && (
            <Alert variant="success" className="mb-0">
              <div className="fw-semibold mb-2">{result.message}</div>
              <div>
                <strong>Canal:</strong> {result.channel}
              </div>
              <div className="mt-2">
                <strong>Mensaje enviado:</strong>
                <pre className="bg-light p-2 rounded mt-1 mb-0" style={{ whiteSpace: 'pre-wrap' }}>
                  {result.text}
                </pre>
              </div>
            </Alert>
          )}
        </Card.Body>
      </Card>
    </section>
  );
}
