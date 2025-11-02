import { FormEvent, useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../../api/auth';
import { ApiError } from '../../api/client';

export default function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminResetLink, setAdminResetLink] = useState<string | null>(null);
  const [adminExpiresAt, setAdminExpiresAt] = useState<Date | null>(null);

  const mutation = useMutation({
    mutationFn: ({ email: emailAddress }: { email: string }) => requestPasswordReset(emailAddress),
  });

  const isSubmitting = mutation.isPending;
  const emailTrimmed = email.trim();
  const canSubmit = emailTrimmed.length > 0 && !isSubmitting;

  const adminExpiresAtLabel = adminExpiresAt
    ? new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Madrid',
      }).format(adminExpiresAt)
    : null;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!emailTrimmed.length || isSubmitting) {
        return;
      }

      setErrorMessage(null);

      try {
        const response = await mutation.mutateAsync({ email: emailTrimmed });
        setInfoMessage(response.message || 'Si el usuario existe, recibirá un email con instrucciones.');
        setAdminResetLink(response.resetUrl ?? null);
        setAdminExpiresAt(response.resetUrl && response.expiresAt ? new Date(response.expiresAt) : null);
      } catch (error) {
        if (error instanceof ApiError) {
          setErrorMessage(error.message || 'No se pudo procesar la solicitud. Inténtalo de nuevo más tarde.');
        } else if (error instanceof Error) {
          setErrorMessage(error.message || 'No se pudo procesar la solicitud. Inténtalo de nuevo más tarde.');
        } else {
          setErrorMessage('No se pudo procesar la solicitud. Inténtalo de nuevo más tarde.');
        }
        setInfoMessage(null);
        setAdminResetLink(null);
        setAdminExpiresAt(null);
      }
    },
    [emailTrimmed, isSubmitting, mutation],
  );

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Card className="shadow-sm">
          <Card.Body className="p-4">
            <div className="mb-4">
              <h2 className="mb-1">Recuperar contraseña</h2>
              <div className="text-muted">Te enviaremos un enlace para crear una contraseña nueva.</div>
            </div>

            {infoMessage ? (
              <Alert variant="success" className="mb-4">
                <div>{infoMessage}</div>
                {adminResetLink ? (
                  <div className="mt-3">
                    <div className="fw-semibold mb-1">Enlace directo:</div>
                    <div>
                      <a href={adminResetLink} target="_blank" rel="noopener noreferrer">
                        {adminResetLink}
                      </a>
                    </div>
                    {adminExpiresAtLabel ? (
                      <div className="small text-muted mt-1">Caduca el {adminExpiresAtLabel}.</div>
                    ) : null}
                  </div>
                ) : null}
              </Alert>
            ) : null}

            {errorMessage ? (
              <Alert variant="danger" className="mb-4">
                {errorMessage}
              </Alert>
            ) : null}

            <Form onSubmit={handleSubmit} autoComplete="on">
              <Form.Group className="mb-3" controlId="passwordResetRequestEmail">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  autoComplete="email"
                  required
                  disabled={isSubmitting}
                  autoFocus
                  name="email"
                />
              </Form.Group>

              <div className="d-grid">
                <Button type="submit" disabled={!canSubmit} variant="primary">
                  {isSubmitting ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" /> Enviando…
                    </>
                  ) : (
                    'Enviar enlace'
                  )}
                </Button>
              </div>
            </Form>

            <div className="mt-3 text-center">
              <small className="text-muted">
                ¿Ya tienes la contraseña? <Link to="/login">Volver a iniciar sesión</Link>
              </small>
            </div>
          </Card.Body>
        </Card>
      </div>
    </Container>
  );
}

