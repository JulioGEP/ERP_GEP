import { FormEvent, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fetchSlackChannels,
  sendSlackChannelMessage,
  type SlackChannel,
} from '../../features/reporting/api';
import { isApiError } from '../../api/client';

function sortChannels(channels: SlackChannel[]): SlackChannel[] {
  return [...channels].sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

export default function SlackMessagesPage() {
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [message, setMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const channelsQuery = useQuery({
    queryKey: ['reporting', 'slack-channels'],
    queryFn: fetchSlackChannels,
    staleTime: 5 * 60 * 1000,
  });

  const channels = useMemo(() => sortChannels(channelsQuery.data ?? []), [channelsQuery.data]);

  const sendMessageMutation = useMutation({
    mutationFn: sendSlackChannelMessage,
    onSuccess: () => {
      setSuccessMessage('Mensaje enviado correctamente a Slack.');
      setMessage('');
    },
  });

  const canSubmit =
    !sendMessageMutation.isPending && selectedChannelId.trim().length > 0 && message.trim().length > 0;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage(null);

    if (!canSubmit) {
      return;
    }

    sendMessageMutation.mutate({
      channelId: selectedChannelId,
      message: message.trim(),
    });
  };

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Mensajes Slack
        </Card.Header>
        <Card.Body>
          <p className="text-muted mb-4">
            Selecciona un canal de Slack y envía un mensaje con el token configurado en Netlify.
          </p>

          {channelsQuery.isLoading ? (
            <div className="d-flex align-items-center gap-2 mb-3">
              <Spinner animation="border" size="sm" />
              <span>Cargando canales de Slack…</span>
            </div>
          ) : null}

          {channelsQuery.isError ? (
            <Alert variant="danger">
              {isApiError(channelsQuery.error)
                ? channelsQuery.error.message
                : 'No se pudieron cargar los canales de Slack.'}
            </Alert>
          ) : null}

          {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}

          {sendMessageMutation.isError ? (
            <Alert variant="danger">
              {isApiError(sendMessageMutation.error)
                ? sendMessageMutation.error.message
                : 'No se pudo enviar el mensaje a Slack.'}
            </Alert>
          ) : null}

          <Form onSubmit={onSubmit}>
            <Form.Group className="mb-3" controlId="slack-channel-select">
              <Form.Label>Canal</Form.Label>
              <Form.Select
                value={selectedChannelId}
                onChange={(event) => setSelectedChannelId(event.target.value)}
                disabled={channelsQuery.isLoading || channelsQuery.isError || channels.length === 0}
              >
                <option value="">Selecciona un canal…</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                    {channel.isPrivate ? ' (privado)' : ''}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3" controlId="slack-message-body">
              <Form.Label>Mensaje</Form.Label>
              <Form.Control
                as="textarea"
                rows={6}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Escribe el mensaje que quieres enviar al canal seleccionado"
              />
            </Form.Group>

            <Button type="submit" disabled={!canSubmit}>
              {sendMessageMutation.isPending ? 'Enviando…' : 'Enviar mensaje'}
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </section>
  );
}
