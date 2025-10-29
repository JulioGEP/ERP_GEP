import { FormEvent, useCallback, useMemo, useState } from 'react';
import { Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { useNavigate, useLocation } from 'react-router-dom';
import { ApiError, isApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

type LocationState = {
  from?: string;
};

export default function LoginPage() {
  const { login, isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Si ya hay sesión, redirige a home para evitar volver a loguear
  if (!isLoading && isAuthenticated) {
    navigate(from, { replace: true });
  }

  const formValid = useMemo(() => {
    const e = email.trim();
    const p = password.trim();
    return e.length > 0 && p.length > 0;
  }, [email, password]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!formValid || submitting) return;

      setErrorText(null);
      setSubmitting(true);

      try {
        await login(email.trim(), password);
        // Si todo va bien, volvemos a donde veníamos o al home
        navigate(from, { replace: true });
      } catch (err) {
        if (isApiError(err)) {
          if ((err as ApiError).status === 401) {
            setErrorText('Email o contraseña incorrectos.');
          } else {
            setErrorText(err.message || 'No se pudo iniciar sesión.');
          }
        } else if (err instanceof Error) {
          setErrorText(err.message);
        } else {
          setErrorText('No se pudo iniciar sesión.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, formValid, submitting, login, navigate, from],
  );

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Card className="shadow-sm">
          <Card.Body className="p-4">
            <div className="mb-4">
              <h2 className="mb-1">Iniciar sesión</h2>
              <div className="text-muted">ERP colaborativo – GEP Group</div>
            </div>

            <Form onSubmit={handleSubmit} autoComplete="on">
              <Form.Group className="mb-3" controlId="loginEmail">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  required
                  autoFocus
                />
              </Form.Group>

              <Form.Group className="mb-3" controlId="loginPassword">
                <Form.Label>Contraseña</Form.Label>
                <Form.Control
                  type="password"
                  placeholder="********"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  required
                />
              </Form.Group>

              {errorText && (
                <div className="alert alert-danger py-2" role="alert">
                  {errorText}
                </div>
              )}

              <div className="d-grid">
                <Button type="submit" disabled={!formValid || submitting}>
                  {submitting ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" /> Accediendo…
                    </>
                  ) : (
                    'Entrar'
                  )}
                </Button>
              </div>
            </Form>

            <div className="mt-3 text-center">
              <small className="text-muted">
                ¿Has olvidado la contraseña? Contacta con un administrador para restablecerla.
              </small>
            </div>
          </Card.Body>
        </Card>
      </div>
    </Container>
  );
}
