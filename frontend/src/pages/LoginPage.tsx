import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { useMutation } from '@tanstack/react-query';

import logo from '../assets/gep-group-logo.png';
import { login, type LoginInput } from '../api/auth';
import { isApiError } from '../api/client';
import { useCurrentUser } from '../app/CurrentUserContext';

export default function LoginPage() {
  const { setAuthToken, refetch } = useCurrentUser();
  const [email, setEmail] = useState('julio@gepgroup.es');
  const [password, setPassword] = useState('');
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (emailInputRef.current) {
      emailInputRef.current.focus();
    }
  }, []);

  const mutation = useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: async (response) => {
      setAuthToken(response.data.token);
      await refetch();
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }
    if (!email.trim().length) {
      emailInputRef.current?.focus();
      return;
    }
    if (!password.trim().length) {
      passwordInputRef.current?.focus();
      return;
    }
    mutation.mutate({ email: email.trim(), password: password });
  };

  const isLoading = mutation.isPending;

  const errorMessage = useMemo(() => {
    if (!mutation.isError) {
      return null;
    }
    if (isApiError(mutation.error)) {
      if (mutation.error.status === 401) {
        return 'Credenciales no válidas. Revisa el usuario y la contraseña.';
      }
      return mutation.error.message ?? 'No se pudo iniciar sesión.';
    }
    return 'No se pudo iniciar sesión.';
  }, [mutation.error, mutation.isError]);

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
      <Container style={{ maxWidth: '420px' }}>
        <Card className="shadow-sm border-0">
          <Card.Body className="p-4">
            <div className="text-center mb-4">
              <img src={logo} alt="GEP Group" height={72} className="mb-3" />
              <h1 className="h4 fw-bold mb-1">Acceso al planificador</h1>
              <p className="text-muted mb-0">Introduce tus credenciales para continuar.</p>
            </div>
            <Form onSubmit={handleSubmit} className="d-grid gap-3">
              <Form.Group controlId="login-email">
                <Form.Label className="fw-semibold text-uppercase small">Usuario</Form.Label>
                <Form.Control
                  ref={emailInputRef}
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={email}
                  autoComplete="username"
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  disabled={isLoading}
                  required
                />
              </Form.Group>
              <Form.Group controlId="login-password">
                <Form.Label className="fw-semibold text-uppercase small">Contraseña</Form.Label>
                <Form.Control
                  ref={passwordInputRef}
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  disabled={isLoading}
                  required
                />
              </Form.Group>
              {errorMessage ? (
                <Alert variant="danger" className="mb-0">
                  {errorMessage}
                </Alert>
              ) : null}
              <div className="d-grid">
                <Button type="submit" variant="primary" disabled={isLoading} className="py-2">
                  {isLoading ? (
                    <>
                      <Spinner animation="border" size="sm" role="status" className="me-2" />
                      Iniciando sesión…
                    </>
                  ) : (
                    'Iniciar sesión'
                  )}
                </Button>
              </div>
            </Form>
          </Card.Body>
        </Card>
      </Container>
    </div>
  );
}
