import { FormEvent, useCallback, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { changePassword } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: (response) => {
      setSuccessMessage(response.message || 'Contraseña actualizada correctamente.');
      setErrorMessage(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      setErrorMessage(apiError?.message ?? 'No se pudo actualizar la contraseña.');
      setSuccessMessage(null);
    },
  });

  const passwordLengthValid = newPassword.length >= 8;
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit =
    currentPassword.length > 0 && passwordLengthValid && passwordsMatch && !mutation.isPending;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;
      setErrorMessage(null);
      setSuccessMessage(null);
      await mutation.mutateAsync();
    },
    [canSubmit, mutation],
  );

  const displayName = useMemo(() => {
    if (!user) return '';
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return name.length ? name : user.email;
  }, [user]);

  return (
    <div className="d-grid gap-4">
      <Card className="shadow-sm">
        <Card.Body>
          <div className="d-grid gap-2">
            <div>
              <h1 className="h3 fw-bold mb-1">Mi perfil</h1>
              <p className="text-muted mb-0">Consulta tu información y gestiona tu contraseña.</p>
            </div>

            <Row className="g-3">
              <Col xs={12} md={6}>
                <div className="border rounded p-3 h-100">
                  <div className="fw-semibold text-uppercase text-muted small">Nombre</div>
                  <div>{displayName}</div>
                </div>
              </Col>
              <Col xs={12} md={6}>
                <div className="border rounded p-3 h-100">
                  <div className="fw-semibold text-uppercase text-muted small">Email</div>
                  <div>{user?.email}</div>
                </div>
              </Col>
              <Col xs={12} md={6}>
                <div className="border rounded p-3 h-100">
                  <div className="fw-semibold text-uppercase text-muted small">Rol</div>
                  <div>{user?.role}</div>
                </div>
              </Col>
            </Row>
          </div>
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Body className="d-grid gap-4">
          <div>
            <h2 className="h5 fw-bold mb-1">Cambiar contraseña</h2>
            <p className="text-muted mb-0">Por seguridad, la nueva contraseña debe tener al menos 8 caracteres.</p>
          </div>

          {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}
          {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}

          <Form onSubmit={handleSubmit} autoComplete="off">
            <Row className="g-3">
              <Col xs={12} md={6}>
                <Form.Group controlId="profileCurrentPassword">
                  <Form.Label>Contraseña actual</Form.Label>
                  <Form.Control
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                    required
                    autoComplete="current-password"
                    disabled={mutation.isPending}
                  />
                </Form.Group>
              </Col>
              <Col xs={12} md={6}>
                <Form.Group controlId="profileNewPassword">
                  <Form.Label>Nueva contraseña</Form.Label>
                  <Form.Control
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.currentTarget.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    disabled={mutation.isPending}
                    isInvalid={newPassword.length > 0 && !passwordLengthValid}
                  />
                  <Form.Control.Feedback type="invalid">
                    Debe tener al menos 8 caracteres.
                  </Form.Control.Feedback>
                </Form.Group>
              </Col>
              <Col xs={12} md={6}>
                <Form.Group controlId="profileConfirmPassword">
                  <Form.Label>Repetir nueva contraseña</Form.Label>
                  <Form.Control
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    disabled={mutation.isPending}
                    isInvalid={confirmPassword.length > 0 && !passwordsMatch}
                  />
                  <Form.Control.Feedback type="invalid">
                    Las contraseñas no coinciden.
                  </Form.Control.Feedback>
                </Form.Group>
              </Col>
            </Row>

            <div className="d-flex justify-content-end mt-4">
              <Button type="submit" disabled={!canSubmit}>
                {mutation.isPending ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Guardando…
                  </>
                ) : (
                  'Guardar cambios'
                )}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>
    </div>
  );
}
