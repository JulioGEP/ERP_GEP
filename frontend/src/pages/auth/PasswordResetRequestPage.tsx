import { FormEvent, useCallback, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../../api/auth';
import { ApiError } from '../../api/client';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export default function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ email: requestEmail }: { email: string }) => requestPasswordReset(requestEmail),
  });

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const emailValid = EMAIL_REGEX.test(normalizedEmail);
  const isSubmitting = mutation.isPending;
  const formLocked = Boolean(successMessage);
  const canSubmit = emailValid && !isSubmitting && !formLocked;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;

      setErrorMessage(null);

      try {
        const response = await mutation.mutateAsync({ email: normalizedEmail });
        setSuccessMessage(
          response.message ||
            'Si el usuario existe, recibirá un correo con instrucciones para crear una contraseña en los próximos minutos.',
        );
      } catch (error) {
        if (error instanceof ApiError) {
          setErrorMessage(error.message || 'No se pudo procesar la solicitud. Inténtalo de nuevo en unos minutos.');
        } else if (error instanceof Error) {
          setErrorMessage(error.message || 'No se pudo procesar la solicitud. Inténtalo de nuevo en unos minutos.');
        } else {
          setErrorMessage('No se pudo procesar la solicitud. Inténtalo de nuevo en unos minutos.');
        }
      }
    },
    [canSubmit, mutation, normalizedEmail],
  );

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Card className="shadow-sm">
          <Card.Body className="p-4">
            <div className="mb-4">
              <h2 className="mb-1">Olvidé mi contraseña</h2>
              <div className="text-muted">
                Escribe tu correo y te enviaremos un enlace válido durante 10 minutos para crear una nueva contraseña.
              </div>
            </div>

            {successMessage ? (
              <Alert variant="success" className="mb-4">
                <div className="mb-2">{successMessage}</div>
                <div className="mb-0">Revisa también la carpeta de spam o promociones si no ves el mensaje.</div>
              </Alert>
            ) : null}

            {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}

            <Form onSubmit={handleSubmit} autoComplete="off">
              <Form.Group className="mb-3" controlId="passwordResetRequestEmail">
                <Form.Label>Correo electrónico</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="tucorreo@empresa.com"
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  required
                  autoComplete="email"
                  disabled={formLocked}
                  isInvalid={email.length > 0 && !emailValid}
                />
                <Form.Control.Feedback type="invalid">
                  Introduce un correo electrónico válido.
                </Form.Control.Feedback>
              </Form.Group>

              <div className="d-grid mb-3">
                <Button type="submit" disabled={!canSubmit}>
                  {isSubmitting ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" /> Enviando…
                    </>
                  ) : (
                    'Enviar instrucciones'
                  )}
                </Button>
              </div>

              <div className="text-center">
                <Link to="/login">Volver a iniciar sesión</Link>
              </div>
            </Form>
          </Card.Body>
        </Card>
      </div>
    </Container>
  );
}
