import { useState } from 'react';
import { Alert, Button, Form, Stack } from 'react-bootstrap';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { login } from '../../api/auth';
import { useCurrentUser } from '../../app/auth/UserContext';
import { AuthLayout } from './AuthLayout';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { refresh, setUser } = useCurrentUser();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetNotice = searchParams.get('reset') === 'success';
  const redirectedFromProtectedRoute = Boolean((location.state as any)?.from);

  const loginMutation = useMutation({
    mutationFn: login,
    onMutate: () => {
      setErrorMessage(null);
    },
    onSuccess: async (user) => {
      setUser(user);
      const result = await refresh();
      if (result.error) {
        console.error('Error actualizando la sesión tras login', result.error);
      }
      navigate('/presupuestos', { replace: true });
    },
    onError: (error: unknown) => {
      console.error('No se pudo iniciar sesión', error);
      setErrorMessage('No se pudo iniciar sesión. Comprueba tus credenciales e inténtalo de nuevo.');
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginMutation.isPending) {
      return;
    }
    setErrorMessage(null);
    loginMutation.mutate({ email: email.trim(), password });
  };

  return (
    <AuthLayout
      title="Acceder al planificador"
      subtitle="Introduce tus credenciales para continuar"
      footer={
        <span className="text-muted small">
          ¿Has olvidado la contraseña?{' '}
          <Link to="/forgot-password">Recupérala aquí</Link>
        </span>
      }
    >
      <Stack gap={3}>
        {resetNotice ? (
          <Alert variant="success" className="mb-0">
            Tu contraseña se ha actualizado correctamente. Inicia sesión con tus nuevas credenciales.
          </Alert>
        ) : null}

        {redirectedFromProtectedRoute ? (
          <Alert variant="info" className="mb-0">
            Tu sesión ha finalizado. Vuelve a iniciar sesión para continuar.
          </Alert>
        ) : null}

        {errorMessage ? (
          <Alert variant="danger" className="mb-0">
            {errorMessage}
          </Alert>
        ) : null}

        <Form onSubmit={handleSubmit}>
          <Stack gap={3}>
            <Form.Group controlId="login-email">
              <Form.Label>Correo electrónico</Form.Label>
              <Form.Control
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={loginMutation.isPending}
              />
            </Form.Group>

            <Form.Group controlId="login-password">
              <Form.Label>Contraseña</Form.Label>
              <Form.Control
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={loginMutation.isPending}
              />
            </Form.Group>

            <div className="d-grid">
              <Button type="submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? 'Accediendo…' : 'Acceder'}
              </Button>
            </div>
          </Stack>
        </Form>
      </Stack>
    </AuthLayout>
  );
}
