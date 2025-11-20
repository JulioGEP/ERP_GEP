import { FormEvent, useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, InputGroup, ListGroup, Row, Spinner } from 'react-bootstrap';
import { changePassword } from '../../api/auth';
import { ApiError } from '../../api/client';
import { fetchUserDocuments } from '../../api/userDocuments';
import { fetchUserById } from '../../api/users';
import { useAuth } from '../../context/AuthContext';

type ProfileUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  active: boolean;
  bankAccount?: string | null;
  address?: string | null;
  startDate?: string | null;
};

export default function ProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const profileQuery = useQuery<ProfileUser | undefined>({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return undefined;
      const fetched = await fetchUserById(user.id);
      return fetched;
    },
    enabled: !!user?.id,
  });

  const documentsQuery = useQuery({
    queryKey: ['user-documents', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      return fetchUserDocuments(user.id);
    },
    enabled: !!user?.id,
  });

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

  const userDetails = useMemo<ProfileUser | null>(() => {
    if (profileQuery.data) return profileQuery.data;
    if (!user) return null;
    return user;
  }, [profileQuery.data, user]);

  const displayName = useMemo(() => {
    if (!userDetails) return '';
    const name = `${userDetails.firstName ?? ''} ${userDetails.lastName ?? ''}`.trim();
    return name.length ? name : userDetails.email;
  }, [userDetails]);

  const formattedStartDate = useMemo(() => {
    if (!userDetails?.startDate) return null;
    const date = new Date(userDetails.startDate);
    return Number.isNaN(date.getTime()) ? userDetails.startDate : date.toLocaleDateString();
  }, [userDetails?.startDate]);

  const documents = documentsQuery.data ?? [];

  const personalInfoItems: Array<{ label: string; value: string | null }> = [
    { label: 'Nombre', value: displayName },
    { label: 'Email', value: userDetails?.email ?? null },
    { label: 'Rol', value: userDetails?.role ?? null },
    { label: 'Cuenta bancaria', value: userDetails?.bankAccount ?? null },
    { label: 'Dirección', value: userDetails?.address ?? null },
    { label: 'Fecha alta', value: formattedStartDate },
  ];

  return (
    <div className="d-grid gap-4">
      <Card className="shadow-sm">
        <Card.Body className="d-grid gap-4">
          <div>
            <h1 className="h3 fw-bold mb-1">Mi perfil</h1>
            <p className="text-muted mb-0">Consulta tu información y gestiona tu contraseña.</p>
          </div>

          {profileQuery.isLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner size="sm" animation="border" />
              <span>Cargando información…</span>
            </div>
          ) : profileQuery.isError ? (
            <Alert variant="danger" className="mb-0">
              No se pudo cargar la información del perfil.
            </Alert>
          ) : (
            <Row className="g-3">
              {personalInfoItems.map((item) => (
                <Col key={item.label} xs={12} md={6}>
                  <div className="border rounded p-3 h-100">
                    <div className="fw-semibold text-uppercase text-muted small">{item.label}</div>
                    <div>{item.value || <span className="text-muted">Sin datos</span>}</div>
                  </div>
                </Col>
              ))}
            </Row>
          )}
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Body className="d-grid gap-3">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h2 className="h5 fw-bold mb-1">Mis documentos</h2>
              <p className="text-muted mb-0">Consulta los enlaces públicos de tus documentos.</p>
            </div>
          </div>

          {documentsQuery.isError ? <Alert variant="danger">No se pudieron cargar los documentos.</Alert> : null}

          {documentsQuery.isLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner size="sm" animation="border" />
              <span>Cargando documentos…</span>
            </div>
          ) : documents.length ? (
            <ListGroup>
              {documents.map((doc) => (
                <ListGroup.Item key={doc.id} className="d-flex justify-content-between align-items-center">
                  <div>
                    <div className="fw-semibold">{doc.file_name}</div>
                    <div className="text-muted small">{doc.mime_type || 'Archivo'}</div>
                  </div>
                  <Button
                    as="a"
                    href={doc.drive_web_view_link ?? doc.drive_web_content_link ?? doc.download_url}
                    variant="outline-primary"
                    size="sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          ) : (
            <p className="text-muted mb-0">No hay documentos disponibles.</p>
          )}
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
                  <InputGroup>
                    <Form.Control
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                      required
                      autoComplete="current-password"
                      disabled={mutation.isPending}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowCurrentPassword((prev) => !prev)}
                      type="button"
                      disabled={mutation.isPending}
                    >
                      {showCurrentPassword ? 'Ocultar' : 'Mostrar'}
                    </Button>
                  </InputGroup>
                </Form.Group>
              </Col>
              <Col xs={12} md={6}>
                <Form.Group controlId="profileNewPassword">
                  <Form.Label>Nueva contraseña</Form.Label>
                  <InputGroup hasValidation>
                    <Form.Control
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.currentTarget.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      disabled={mutation.isPending}
                      isInvalid={newPassword.length > 0 && !passwordLengthValid}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      type="button"
                      disabled={mutation.isPending}
                    >
                      {showNewPassword ? 'Ocultar' : 'Mostrar'}
                    </Button>
                  </InputGroup>
                  <Form.Control.Feedback type="invalid">
                    Debe tener al menos 8 caracteres.
                  </Form.Control.Feedback>
                </Form.Group>
              </Col>
              <Col xs={12} md={6}>
                <Form.Group controlId="profileConfirmPassword">
                  <Form.Label>Repetir nueva contraseña</Form.Label>
                  <InputGroup hasValidation>
                    <Form.Control
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      disabled={mutation.isPending}
                      isInvalid={confirmPassword.length > 0 && !passwordsMatch}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      type="button"
                      disabled={mutation.isPending}
                    >
                      {showConfirmPassword ? 'Ocultar' : 'Mostrar'}
                    </Button>
                  </InputGroup>
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
