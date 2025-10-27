import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import logo from '../assets/gep-group-logo.png';
import { resetPassword, type ResetPasswordInput } from '../api/auth';
import { isApiError } from '../api/client';

export default function PasswordResetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token')?.trim() ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetCompleted, setResetCompleted] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (!token.length) {
      setLocalError('El enlace de restablecimiento no es válido. Solicita uno nuevo.');
    }
  }, [token]);

  const mutation = useMutation({
    mutationFn: (input: ResetPasswordInput) => resetPassword(input),
    onSuccess: () => {
      setResetCompleted(true);
      setLocalError(null);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending || resetCompleted) {
      return;
    }
    if (!token.length) {
      setLocalError('El enlace de restablecimiento no es válido. Solicita uno nuevo.');
      return;
    }
    if (password.trim().length < 8) {
      setLocalError('La contraseña debe tener al menos 8 caracteres.');
      passwordInputRef.current?.focus();
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Las contraseñas no coinciden.');
      return;
    }
    setLocalError(null);
    mutation.mutate({ token, password: password.trim() });
  };

  const isLoading = mutation.isPending;

  const errorMessage = useMemo(() => {
    if (localError) {
      return localError;
    }
    if (!mutation.isError) {
      return null;
    }
    if (isApiError(mutation.error)) {
      return mutation.error.message ?? 'No se pudo restablecer la contraseña.';
    }
    return 'No se pudo restablecer la contraseña.';
  }, [localError, mutation.error, mutation.isError]);

  const successMessage = resetCompleted
    ? 'Tu contraseña se actualizó correctamente. Ahora puedes iniciar sesión con tus nuevas credenciales.'
    : null;

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
      <Container style={{ maxWidth: '420px' }}>
        <Card className="shadow-sm border-0">
          <Card.Body className="p-4">
            <div className="text-center mb-4">
              <img src={logo} alt="GEP Group" height={72} className="mb-3" />
              <h1 className="h4 fw-bold mb-1">Establecer nueva contraseña</h1>
              <p className="text-muted mb-0">
                Crea una contraseña segura para acceder al planificador.
              </p>
            </div>
            <Form onSubmit={handleSubmit} className="d-grid gap-3">
              <Form.Group controlId="password-reset-new-password">
                <Form.Label className="fw-semibold text-uppercase small">Nueva contraseña</Form.Label>
                <Form.Control
                  ref={passwordInputRef}
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => {
                    setPassword(event.currentTarget.value);
                    setLocalError(null);
                  }}
                  disabled={!token.length || isLoading || resetCompleted}
                  required
                  minLength={8}
                />
              </Form.Group>
              <Form.Group controlId="password-reset-confirm-password">
                <Form.Label className="fw-semibold text-uppercase small">Confirmar contraseña</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="Repite la nueva contraseña"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) => {
                    setConfirmPassword(event.currentTarget.value);
                    setLocalError(null);
                  }}
                  disabled={!token.length || isLoading || resetCompleted}
                  required
                  minLength={8}
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
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!token.length || isLoading || resetCompleted}
                  className="py-2"
                >
                  {isLoading ? (
                    <>
                      <Spinner animation="border" size="sm" role="status" className="me-2" />
                      Guardando contraseña…
                    </>
                  ) : (
                    'Guardar contraseña'
                  )}
                </Button>
                {resetCompleted ? (
                  <Button
                    type="button"
                    variant="outline-primary"
                    onClick={() => navigate('/')}
                    className="py-2"
                  >
                    Ir al inicio de sesión
                  </Button>
                ) : (
                  <div className="text-center">
                    <Link to="/recuperar-contraseña" className="small">
                      ¿Necesitas un nuevo enlace?
                    </Link>
                  </div>
                )}
              </div>
            </Form>
          </Card.Body>
        </Card>
      </Container>
    </div>
  );
}
