import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import logo from '../assets/gep-group-logo.png';
import { requestPasswordReset, type PasswordResetRequestInput } from '../api/auth';
import { isApiError } from '../api/client';

export default function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const [requestCompleted, setRequestCompleted] = useState(false);

  useEffect(() => {
    if (emailInputRef.current) {
      emailInputRef.current.focus();
    }
  }, []);

  const mutation = useMutation({
    mutationFn: (input: PasswordResetRequestInput) => requestPasswordReset(input),
    onSuccess: () => {
      setRequestCompleted(true);
    },
  });

  useEffect(() => {
    if (requestCompleted && emailInputRef.current) {
      emailInputRef.current.blur();
    }
  }, [requestCompleted]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail.length) {
      emailInputRef.current?.focus();
      return;
    }
    setRequestCompleted(false);
    mutation.mutate({ email: trimmedEmail });
  };

  const isLoading = mutation.isPending;

  const errorMessage = useMemo(() => {
    if (!mutation.isError) {
      return null;
    }
    if (isApiError(mutation.error)) {
      if (mutation.error.status === 429) {
        return 'Has solicitado demasiados restablecimientos en poco tiempo. Inténtalo de nuevo más tarde.';
      }
      return mutation.error.message ?? 'No se pudo enviar la solicitud.';
    }
    return 'No se pudo enviar la solicitud.';
  }, [mutation.error, mutation.isError]);

  const successMessage = requestCompleted
    ? 'Si el correo existe en nuestro sistema, recibirás un email con instrucciones para restablecer la contraseña.'
    : null;

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
      <Container style={{ maxWidth: '420px' }}>
        <Card className="shadow-sm border-0">
          <Card.Body className="p-4">
            <div className="text-center mb-4">
              <img src={logo} alt="GEP Group" height={72} className="mb-3" />
              <h1 className="h4 fw-bold mb-1">Recuperar contraseña</h1>
              <p className="text-muted mb-0">
                Introduce el correo asociado a tu cuenta para enviarte las instrucciones de restablecimiento.
              </p>
            </div>
            <Form onSubmit={handleSubmit} className="d-grid gap-3">
              <Form.Group controlId="password-reset-email">
                <Form.Label className="fw-semibold text-uppercase small">Correo electrónico</Form.Label>
                <Form.Control
                  ref={emailInputRef}
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={email}
                  autoComplete="email"
                  onChange={(event) => {
                    setEmail(event.currentTarget.value);
                    if (requestCompleted) {
                      setRequestCompleted(false);
                    }
                  }}
                  disabled={isLoading}
                  required
                />
              </Form.Group>
              {successMessage ? (
                <Alert variant="success" className="mb-0">
                  {successMessage}
                </Alert>
              ) : null}
              {errorMessage ? (
                <Alert variant="danger" className="mb-0">
                  {errorMessage}
                </Alert>
              ) : null}
              <div className="d-grid gap-2">
                <Button type="submit" variant="primary" disabled={isLoading} className="py-2">
                  {isLoading ? (
                    <>
                      <Spinner animation="border" size="sm" role="status" className="me-2" />
                      Enviando instrucciones…
                    </>
                  ) : (
                    'Enviar instrucciones'
                  )}
                </Button>
                <div className="text-center">
                  <Link to="/" className="small">
                    Volver al inicio de sesión
                  </Link>
                </div>
              </div>
            </Form>
          </Card.Body>
        </Card>
      </Container>
    </div>
  );
}
