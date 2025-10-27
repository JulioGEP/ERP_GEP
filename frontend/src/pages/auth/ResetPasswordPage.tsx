import { useMemo, useState } from 'react';
import { Alert, Button, Form, Stack } from 'react-bootstrap';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { resetPassword } from '../../api/auth';
import { AuthLayout } from './AuthLayout';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams]);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: resetPassword,
    onMutate: () => {
      setErrorMessage(null);
    },
    onSuccess: () => {
      navigate('/login?reset=success', { replace: true });
    },
    onError: (error: unknown) => {
      console.error('No se pudo restablecer la contraseña', error);
      if (error instanceof Error && error.message) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('No se pudo restablecer la contraseña. Inténtalo de nuevo.');
      }
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setErrorMessage('El enlace de restablecimiento no es válido.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.');
      return;
    }
    resetMutation.mutate({ token, newPassword });
  };

  return (
    <AuthLayout
      title="Establecer nueva contraseña"
      subtitle="Introduce una contraseña segura para tu cuenta"
      footer={
        <span className="text-muted small">
          ¿Recordaste la contraseña? <Link to="/login">Volver al acceso</Link>
        </span>
      }
    >
      <Stack gap={3}>
        {!token ? (
          <Alert variant="warning" className="mb-0">
            El enlace de restablecimiento es inválido o ha caducado.
          </Alert>
        ) : null}

        {errorMessage ? (
          <Alert variant="danger" className="mb-0">
            {errorMessage}
          </Alert>
        ) : null}

        <Form onSubmit={handleSubmit}>
          <Stack gap={3}>
            <Form.Group controlId="reset-password">
              <Form.Label>Nueva contraseña</Form.Label>
              <Form.Control
                type="password"
                autoComplete="new-password"
                value={newPassword}
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                disabled={resetMutation.isPending || !token}
              />
            </Form.Group>

            <Form.Group controlId="reset-password-confirm">
              <Form.Label>Confirmar contraseña</Form.Label>
              <Form.Control
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                disabled={resetMutation.isPending || !token}
              />
            </Form.Group>

            <div className="d-grid">
              <Button type="submit" disabled={resetMutation.isPending || !token}>
                {resetMutation.isPending ? 'Guardando…' : 'Guardar contraseña'}
              </Button>
            </div>
          </Stack>
        </Form>
      </Stack>
    </AuthLayout>
  );
}
