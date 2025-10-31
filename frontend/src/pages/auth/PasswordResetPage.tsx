import { FormEvent, useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router-dom';
import { confirmPasswordReset } from '../../api/auth';
import { ApiError } from '../../api/client';

export default function PasswordResetPage() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') ?? '').trim();
  const tokenValid = token.length > 0;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: ({ token: resetToken, newPassword }: { token: string; newPassword: string }) =>
      confirmPasswordReset(resetToken, newPassword),
  });

  const isSubmitting = resetMutation.isPending;
  const passwordLengthValid = password.length >= 8;
  const passwordsMatch = password === confirmPassword;
  const formLocked = Boolean(successMessage) || !tokenValid;

  const canSubmit = tokenValid && passwordLengthValid && passwordsMatch && !isSubmitting && !successMessage;

  const passwordLengthError = password.length > 0 && !passwordLengthValid;
  const passwordMismatchError = confirmPassword.length > 0 && !passwordsMatch;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!tokenValid || !canSubmit) {
        if (!tokenValid) {
          setErrorMessage('El enlace de restablecimiento no es válido. Solicita uno nuevo.');
        }
        return;
      }

      setErrorMessage(null);

      try {
        const response = await resetMutation.mutateAsync({ token, newPassword: password });
        setSuccessMessage(response.message || 'Contraseña actualizada correctamente.');
      } catch (error) {
        if (error instanceof ApiError) {
          setErrorMessage(error.message || 'No se pudo restablecer la contraseña.');
        } else if (error instanceof Error) {
          setErrorMessage(error.message || 'No se pudo restablecer la contraseña.');
        } else {
          setErrorMessage('No se pudo restablecer la contraseña.');
        }
      }
    },
    [canSubmit, password, resetMutation, token, tokenValid],
  );

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Card className="shadow-sm">
          <Card.Body className="p-4">
            <div className="mb-4">
              <h2 className="mb-1">Crear contraseña</h2>
              <div className="text-muted">Introduce una contraseña para acceder al ERP.</div>
            </div>

            {!tokenValid && !successMessage ? (
              <Alert variant="danger">
                El enlace de restablecimiento no es válido o está incompleto. Solicita uno nuevo a un administrador.
              </Alert>
            ) : null}

            {successMessage ? (
              <Alert variant="success" className="mb-4">
                <div className="mb-2">{successMessage}</div>
                <div className="mb-0">
                  <Link to="/login">Ir a iniciar sesión</Link>
                </div>
              </Alert>
            ) : null}

            {errorMessage ? (
              <Alert variant="danger">{errorMessage}</Alert>
            ) : null}

            <Form onSubmit={handleSubmit} autoComplete="off">
              <Form.Group className="mb-3" controlId="passwordResetNewPassword">
                <Form.Label>Nueva contraseña</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="********"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  minLength={8}
                  required
                  disabled={formLocked}
                  autoComplete="new-password"
                />
                <Form.Text className="text-muted">Debe tener al menos 8 caracteres.</Form.Text>
                {passwordLengthError ? (
                  <div className="text-danger small mt-1">La contraseña debe tener al menos 8 caracteres.</div>
                ) : null}
              </Form.Group>

              <Form.Group className="mb-4" controlId="passwordResetConfirmPassword">
                <Form.Label>Repite la contraseña</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="********"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                  minLength={8}
                  required
                  disabled={formLocked}
                  autoComplete="new-password"
                />
                {passwordMismatchError ? (
                  <div className="text-danger small mt-1">Las contraseñas no coinciden.</div>
                ) : null}
              </Form.Group>

              <div className="d-grid">
                <Button type="submit" disabled={!canSubmit}>
                  {isSubmitting ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" /> Guardando…
                    </>
                  ) : (
                    'Guardar contraseña'
                  )}
                </Button>
              </div>
            </Form>
          </Card.Body>
        </Card>
      </div>
    </Container>
  );
}
