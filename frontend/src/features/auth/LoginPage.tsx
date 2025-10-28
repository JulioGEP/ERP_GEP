import { FormEvent, useCallback, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Container, Form, Row, Spinner } from 'react-bootstrap';
import logo from '../../assets/gep-group-logo.png';
import { useAuth } from './AuthContext';

const MODES = {
  login: 'login',
  requestReset: 'request-reset',
  confirmReset: 'confirm-reset',
} as const;

type Mode = (typeof MODES)[keyof typeof MODES];

export function LoginPage() {
  const { login, requestPasswordReset, confirmPasswordReset, isLoggingIn } = useAuth();
  const [mode, setMode] = useState<Mode>(MODES.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLoginMode = mode === MODES.login;
  const isRequestMode = mode === MODES.requestReset;
  const isConfirmMode = mode === MODES.confirmReset;

  const title = useMemo(() => {
    if (isRequestMode) return 'Recuperar contraseña';
    if (isConfirmMode) return 'Restablecer contraseña';
    return 'Iniciar sesión';
  }, [isConfirmMode, isRequestMode]);

  const handleSwitchMode = useCallback((nextMode: Mode) => {
    setMode(nextMode);
    setError(null);
    setSuccess(null);
    if (nextMode === MODES.login) {
      setPassword('');
      setToken('');
    }
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);
      setIsSubmitting(true);
      try {
        if (isLoginMode) {
          await login({ email, password });
          setPassword('');
        } else if (isRequestMode) {
          const message = await requestPasswordReset(email);
          setSuccess(message);
        } else if (isConfirmMode) {
          const message = await confirmPasswordReset(token, password);
          setSuccess(message);
          setToken('');
          setPassword('');
          setMode(MODES.login);
        }
      } catch (error_) {
        const message =
          error_ instanceof Error && error_.message
            ? error_.message
            : 'No se pudo completar la acción.';
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      confirmPasswordReset,
      email,
      isConfirmMode,
      isLoginMode,
      isRequestMode,
      login,
      password,
      requestPasswordReset,
      token,
    ],
  );

  const canSubmit = useMemo(() => {
    if (isLoginMode) {
      return email.trim().length > 0 && password.trim().length > 0;
    }
    if (isRequestMode) {
      return email.trim().length > 0;
    }
    if (isConfirmMode) {
      return token.trim().length > 0 && password.trim().length >= 6;
    }
    return false;
  }, [email, isConfirmMode, isLoginMode, isRequestMode, password, token]);

  const submitting = isSubmitting || (isLoginMode && isLoggingIn);

  return (
    <div className="bg-light min-vh-100 d-flex align-items-center">
      <Container>
        <Row className="justify-content-center">
          <Col xs={12} md={8} lg={5}>
            <Card className="shadow-sm border-0">
              <Card.Body className="p-4 p-md-5 d-grid gap-4">
                <div className="text-center d-grid gap-3">
                  <img src={logo} alt="GEP Group" height={72} className="mx-auto" />
                  <div>
                    <h1 className="h4 fw-bold mb-1">{title}</h1>
                    <p className="text-muted mb-0">Accede al ERP de GEP Group</p>
                  </div>
                </div>

                {error && <Alert variant="danger">{error}</Alert>}
                {success && <Alert variant="success">{success}</Alert>}

                <Form onSubmit={handleSubmit} className="d-grid gap-3">
                  {(isLoginMode || isRequestMode) && (
                    <Form.Group controlId="loginEmail">
                      <Form.Label>Correo electrónico</Form.Label>
                      <Form.Control
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="nombre@empresa.com"
                        autoComplete="email"
                        required
                      />
                    </Form.Group>
                  )}

                  {(isLoginMode || isConfirmMode) && (
                    <Form.Group controlId="loginPassword">
                      <Form.Label>Contraseña</Form.Label>
                      <Form.Control
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Tu contraseña"
                        autoComplete={isLoginMode ? 'current-password' : 'new-password'}
                        required={isLoginMode || isConfirmMode}
                        minLength={isConfirmMode ? 6 : undefined}
                      />
                      {isConfirmMode && (
                        <Form.Text className="text-muted">
                          Debe tener al menos 6 caracteres.
                        </Form.Text>
                      )}
                    </Form.Group>
                  )}

                  {isConfirmMode && (
                    <Form.Group controlId="resetToken">
                      <Form.Label>Token de recuperación</Form.Label>
                      <Form.Control
                        type="text"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="Introduce el token recibido"
                        required
                      />
                    </Form.Group>
                  )}

                  <div className="d-grid gap-2">
                    <Button type="submit" disabled={!canSubmit || submitting} size="lg">
                      {submitting && <Spinner animation="border" size="sm" className="me-2" />}
                      {isLoginMode && 'Entrar'}
                      {isRequestMode && 'Enviar instrucciones'}
                      {isConfirmMode && 'Restablecer contraseña'}
                    </Button>

                    {isLoginMode && (
                      <Button
                        variant="link"
                        type="button"
                        className="text-decoration-none"
                        onClick={() => handleSwitchMode(MODES.requestReset)}
                      >
                        ¿Has olvidado tu contraseña?
                      </Button>
                    )}

                    {isRequestMode && (
                      <>
                        <Button
                          variant="link"
                          type="button"
                          className="text-decoration-none"
                          onClick={() => handleSwitchMode(MODES.confirmReset)}
                        >
                          Ya tengo un token para restablecerla
                        </Button>
                        <Button
                          variant="link"
                          type="button"
                          className="text-decoration-none"
                          onClick={() => handleSwitchMode(MODES.login)}
                        >
                          Volver a iniciar sesión
                        </Button>
                      </>
                    )}

                    {isConfirmMode && (
                      <Button
                        variant="link"
                        type="button"
                        className="text-decoration-none"
                        onClick={() => handleSwitchMode(MODES.login)}
                      >
                        Volver a iniciar sesión
                      </Button>
                    )}
                  </div>
                </Form>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
}
