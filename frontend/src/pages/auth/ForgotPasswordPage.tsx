import { useState } from 'react';
import { Alert, Button, Form, Stack } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { forgotPassword } from '../../api/auth';
import { AuthLayout } from './AuthLayout';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const forgotMutation = useMutation({
    mutationFn: forgotPassword,
    onMutate: () => {
      setErrorMessage(null);
    },
    onSuccess: (message) => {
      setSubmitted(true);
      if (message) {
        setErrorMessage(null);
      }
    },
    onError: (error: unknown) => {
      console.error('No se pudo solicitar el restablecimiento de contraseña', error);
      setErrorMessage('No se pudo enviar el enlace de recuperación. Inténtalo más tarde.');
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (forgotMutation.isPending) {
      return;
    }
    setErrorMessage(null);
    forgotMutation.mutate(email.trim());
  };

  return (
    <AuthLayout
      title="Recuperar contraseña"
      subtitle="Introduce tu correo y te enviaremos un enlace"
      footer={
        <span className="text-muted small">
          ¿Ya la recuerdas? <Link to="/login">Vuelve al acceso</Link>
        </span>
      }
    >
      <Stack gap={3}>
        {submitted ? (
          <Alert variant="success" className="mb-0">
            Si el correo corresponde a una cuenta activa, recibirás un enlace de recuperación en unos minutos.
          </Alert>
        ) : null}

        {errorMessage ? (
          <Alert variant="danger" className="mb-0">
            {errorMessage}
          </Alert>
        ) : null}

        <Form onSubmit={handleSubmit}>
          <Stack gap={3}>
            <Form.Group controlId="forgot-email">
              <Form.Label>Correo electrónico</Form.Label>
              <Form.Control
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={forgotMutation.isPending || submitted}
              />
            </Form.Group>

            <div className="d-grid">
              <Button type="submit" disabled={forgotMutation.isPending || submitted}>
                {forgotMutation.isPending ? 'Enviando…' : 'Enviar instrucciones'}
              </Button>
            </div>
          </Stack>
        </Form>
      </Stack>
    </AuthLayout>
  );
}
