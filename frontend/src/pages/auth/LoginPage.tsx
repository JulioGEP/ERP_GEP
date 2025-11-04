import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Container, Form, InputGroup, Spinner } from 'react-bootstrap';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ApiError, isApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

type LocationState = {
  from?: string;
};

type RoleOption = {
  value: string;
  label: string;
};

export default function LoginPage() {
  const { login, isLoading: authLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from || '/';

  const isLoading = authLoading;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [availableRoles, setAvailableRoles] = useState<RoleOption[]>([]);
  const [selectedRole, setSelectedRole] = useState('');

  useEffect(() => {
    const hydrateFromBrowserStorage = () => {
      const emailField = document.querySelector<HTMLInputElement>('input[name="email"]');
      const passwordField = document.querySelector<HTMLInputElement>('input[name="password"]');

      if (emailField?.value) {
        setEmail((prev) => (prev ? prev : emailField.value));
      }

      if (passwordField?.value) {
        setPassword((prev) => (prev ? prev : passwordField.value));
      }
    };

    hydrateFromBrowserStorage();

    const timeouts = [100, 300, 600].map((delay) => window.setTimeout(hydrateFromBrowserStorage, delay));

    return () => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  // Si ya hay sesión, redirige a home para evitar volver a loguear
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [from, isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    setAvailableRoles([]);
    setSelectedRole('');
  }, [email]);

  const formValid = useMemo(() => {
    const e = email.trim();
    const p = password.trim();
    const roleReady = availableRoles.length === 0 || selectedRole.trim().length > 0;
    return e.length > 0 && p.length > 0 && roleReady;
  }, [email, password, availableRoles, selectedRole]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!formValid || submitting) return;

      setErrorText(null);
      setSubmitting(true);

      try {
        await login(email.trim(), password, selectedRole.trim() || undefined);
        // Si todo va bien, volvemos a donde veníamos o al home
        navigate(from, { replace: true });
      } catch (err) {
        if (isApiError(err)) {
          if (err.code === 'MULTIPLE_ROLES' || err.code === 'INVALID_ROLE_SELECTION') {
            const rolesRaw = Array.isArray((err.details as any)?.roles) ? (err.details as any).roles : [];
            const roles: RoleOption[] = rolesRaw
              .map((role: any) => {
                const value = typeof role?.value === 'string' ? role.value : typeof role?.role === 'string' ? role.role : '';
                const label = typeof role?.label === 'string'
                  ? role.label
                  : typeof role?.role === 'string'
                  ? role.role
                  : typeof role?.value === 'string'
                  ? role.value
                  : '';
                if (!value.trim()) return null;
                return { value, label: label || value } as RoleOption;
              })
              .filter((option): option is RoleOption => Boolean(option));

            if (roles.length > 0) {
              setAvailableRoles(roles);
              if (err.code === 'MULTIPLE_ROLES') {
                setSelectedRole('');
              } else if (!roles.some((option) => option.value === selectedRole)) {
                setSelectedRole('');
              }
            }

            setErrorText(err.message || 'Selecciona un rol para continuar.');
          } else if ((err as ApiError).status === 401) {
            setAvailableRoles([]);
            setSelectedRole('');
            setErrorText('Email o contraseña incorrectos.');
          } else {
            setAvailableRoles([]);
            setSelectedRole('');
            setErrorText(err.message || 'No se pudo iniciar sesión.');
          }
        } else if (err instanceof Error) {
          setAvailableRoles([]);
          setSelectedRole('');
          setErrorText(err.message);
        } else {
          setAvailableRoles([]);
          setSelectedRole('');
          setErrorText('No se pudo iniciar sesión.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, selectedRole, formValid, submitting, login, navigate, from],
  );

  return (
    <Container
      className="login-page-wrapper d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh' }}
    >
      <div className="login-page-card-wrapper" style={{ width: '100%', maxWidth: 420 }}>
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
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  name="email"
                />
              </Form.Group>

              <Form.Group className="mb-3" controlId="loginPassword">
                <Form.Label>Contraseña</Form.Label>
                <InputGroup>
                  <Form.Control
                    type={showPassword ? 'text' : 'password'}
                    placeholder="********"
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    required
                    autoComplete="current-password"
                    name="password"
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={() => setShowPassword((prev) => !prev)}
                    type="button"
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </Button>
                </InputGroup>
              </Form.Group>

              {availableRoles.length > 0 && (
                <Form.Group className="mb-3" controlId="loginRole">
                  <Form.Label>Selecciona un rol</Form.Label>
                  <Form.Select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.currentTarget.value)}
                    disabled={submitting}
                    required
                  >
                    <option value="">Elige un rol…</option>
                    {availableRoles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              )}

              {errorText && (
                <div className="alert alert-danger py-2" role="alert">
                  {errorText}
                </div>
              )}

              <div className="d-grid">
                <Button className="login-submit-button" type="submit" disabled={!formValid || submitting}>
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
                ¿Has olvidado la contraseña?{' '}
                <Link to="/auth/password/forgot">Recupérala aquí</Link>.
              </small>
            </div>
          </Card.Body>
        </Card>
      </div>
    </Container>
  );
}
