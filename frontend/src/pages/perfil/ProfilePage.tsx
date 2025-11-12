import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, InputGroup, Row, Spinner } from 'react-bootstrap';
import { changePassword } from '../../api/auth';
import { ApiError } from '../../api/client';
import {
  disconnectTrainerCalendar,
  fetchTrainerCalendarStatus,
  startTrainerCalendarOAuth,
  syncTrainerCalendar,
} from '../../api/trainer-calendar';
import { useAuth } from '../../context/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';

export default function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const [calendarSuccessMessage, setCalendarSuccessMessage] = useState<string | null>(null);
  const [calendarErrorMessage, setCalendarErrorMessage] = useState<string | null>(null);

  const isTrainer = (user?.role ?? '').toLowerCase() === 'formador';

  const calendarStatusQuery = useQuery({
    queryKey: ['trainerCalendarStatus'],
    queryFn: fetchTrainerCalendarStatus,
    enabled: isTrainer,
    staleTime: 60_000,
  });

  const calendarConfigured = calendarStatusQuery.data?.configured ?? false;

  const formatCalendarDate = useCallback((iso: string | null | undefined) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
  }, []);

  const resolveCalendarErrorMessage = useCallback((code?: string | null) => {
    const normalized = (code ?? '').toLowerCase();
    switch (normalized) {
      case 'access_denied':
        return 'Se canceló la autorización de Google Calendar.';
      case 'state_expired':
      case 'state_not_found':
        return 'El enlace de autorización caducó. Intenta conectar de nuevo.';
      case 'token_exchange_failed':
        return 'No se pudo completar la autenticación con Google.';
      case 'userinfo_failed':
        return 'No se pudo obtener la cuenta de Google seleccionada.';
      case 'sync_failed':
        return 'Google Calendar se conectó pero la sincronización inicial falló. Usa “Sincronizar ahora” para reintentarlo.';
      default:
        return 'No se pudo conectar con Google Calendar. Inténtalo más tarde.';
    }
  }, []);

  useEffect(() => {
    if (!isTrainer) return;
    const params = new URLSearchParams(location.search);
    const calendarParam = params.get('calendar');
    if (!calendarParam) return;

    if (calendarParam === 'connected') {
      setCalendarSuccessMessage('Google Calendar se ha conectado y sincronizado correctamente.');
      setCalendarErrorMessage(null);
    } else if (calendarParam === 'error') {
      const code = params.get('calendarError');
      setCalendarErrorMessage(resolveCalendarErrorMessage(code));
      setCalendarSuccessMessage(null);
    }

    params.delete('calendar');
    params.delete('calendarError');
    navigate(
      { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' },
      { replace: true },
    );

    void queryClient.invalidateQueries({ queryKey: ['trainerCalendarStatus'] });
  }, [isTrainer, location.pathname, location.search, navigate, queryClient, resolveCalendarErrorMessage]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const changePasswordMutation = useMutation({
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

  const calendarConnectMutation = useMutation({
    mutationFn: async () => {
      const returnTo =
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : '/perfil';
      const response = await startTrainerCalendarOAuth(returnTo);
      return response.url;
    },
    onMutate: () => {
      setCalendarErrorMessage(null);
      setCalendarSuccessMessage(null);
    },
    onSuccess: (url) => {
      if (typeof window !== 'undefined') {
        window.location.href = url;
      }
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? error.message
          : 'No se pudo iniciar la conexión con Google Calendar.';
      setCalendarErrorMessage(message);
    },
  });

  const calendarDisconnectMutation = useMutation({
    mutationFn: disconnectTrainerCalendar,
    onMutate: () => {
      setCalendarErrorMessage(null);
    },
    onSuccess: async () => {
      setCalendarSuccessMessage('Se ha desconectado Google Calendar.');
      await queryClient.invalidateQueries({ queryKey: ['trainerCalendarStatus'] });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? error.message
          : 'No se pudo desconectar Google Calendar.';
      setCalendarErrorMessage(message);
    },
  });

  const calendarSyncMutation = useMutation({
    mutationFn: syncTrainerCalendar,
    onMutate: () => {
      setCalendarErrorMessage(null);
    },
    onSuccess: async () => {
      setCalendarSuccessMessage('Sincronización con Google Calendar completada.');
      await queryClient.invalidateQueries({ queryKey: ['trainerCalendarStatus'] });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? error.message
          : 'No se pudo sincronizar con Google Calendar.';
      setCalendarErrorMessage(message);
    },
  });

  const passwordLengthValid = newPassword.length >= 8;
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit =
    currentPassword.length > 0 && passwordLengthValid && passwordsMatch && !changePasswordMutation.isPending;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;
      setErrorMessage(null);
      setSuccessMessage(null);
      await changePasswordMutation.mutateAsync();
    },
    [canSubmit, changePasswordMutation],
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

      {isTrainer ? (
        <Card className="shadow-sm">
          <Card.Body className="d-grid gap-3">
            <div>
              <h2 className="h5 fw-bold mb-1">Google Calendar</h2>
              <p className="text-muted mb-0">
                Sincroniza automáticamente tus sesiones y variantes asignadas con tu cuenta de Google Calendar.
              </p>
            </div>

            {calendarSuccessMessage ? <Alert variant="success">{calendarSuccessMessage}</Alert> : null}
            {calendarErrorMessage ? <Alert variant="danger">{calendarErrorMessage}</Alert> : null}

            {calendarStatusQuery.isLoading ? (
              <div className="d-flex align-items-center gap-2 text-muted">
                <Spinner animation="border" size="sm" role="status" />
                <span>Cargando estado…</span>
              </div>
            ) : calendarStatusQuery.isError ? (
              <Alert variant="danger" className="mb-0">
                No se pudo obtener el estado de Google Calendar.
              </Alert>
            ) : calendarStatusQuery.data?.connected ? (
              <div className="d-flex flex-column flex-lg-row justify-content-between gap-3">
                <div className="d-grid gap-1">
                  <div className="fw-semibold text-uppercase text-muted small">Cuenta conectada</div>
                  <div>{calendarStatusQuery.data?.accountEmail ?? 'Cuenta de Google'}</div>
                  <div className="text-muted small">
                    Eventos sincronizados: {calendarStatusQuery.data?.totalEvents ?? 0}
                  </div>
                  {calendarStatusQuery.data?.lastSyncedAt ? (
                    <div className="text-muted small">
                      Última sincronización:{' '}
                      {formatCalendarDate(calendarStatusQuery.data.lastSyncedAt) ?? 'Sin datos'}
                    </div>
                  ) : null}
                </div>

                <div className="d-flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={calendarSyncMutation.isPending || calendarDisconnectMutation.isPending}
                    onClick={() => calendarSyncMutation.mutate()}
                  >
                    {calendarSyncMutation.isPending ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" /> Sincronizando…
                      </>
                    ) : (
                      'Sincronizar ahora'
                    )}
                  </Button>
                  <Button
                    variant="outline-danger"
                    disabled={calendarDisconnectMutation.isPending || calendarSyncMutation.isPending}
                    onClick={() => calendarDisconnectMutation.mutate()}
                  >
                    {calendarDisconnectMutation.isPending ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" /> Desconectando…
                      </>
                    ) : (
                      'Desconectar'
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="d-grid gap-3">
                {!calendarConfigured ? (
                  <Alert variant="warning" className="mb-0">
                    La integración de Google Calendar todavía no está configurada. Contacta con un administrador para
                    habilitarla.
                  </Alert>
                ) : null}
                <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3">
                  <div>
                    <div className="fw-semibold text-uppercase text-muted small">Estado</div>
                    <div>No conectado</div>
                    <div className="text-muted small">
                      {calendarConfigured
                        ? 'Puedes vincular tu cuenta de Google Calendar cuando quieras desde este perfil.'
                        : 'Esperamos poder ofrecer esta sincronización pronto.'}
                    </div>
                  </div>
                  <div>
                    <Button
                      onClick={() => calendarConnectMutation.mutate()}
                      disabled={!calendarConfigured || calendarConnectMutation.isPending}
                      title={
                        !calendarConfigured
                          ? 'Esta opción estará disponible cuando un administrador configure la integración.'
                          : undefined
                      }
                    >
                      {calendarConnectMutation.isPending ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" /> Conectando…
                        </>
                      ) : (
                        'Conectar con Google Calendar'
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card.Body>
        </Card>
      ) : null}

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
                      disabled={changePasswordMutation.isPending}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowCurrentPassword((prev) => !prev)}
                      type="button"
                      disabled={changePasswordMutation.isPending}
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
                      disabled={changePasswordMutation.isPending}
                      isInvalid={newPassword.length > 0 && !passwordLengthValid}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      type="button"
                      disabled={changePasswordMutation.isPending}
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
                      disabled={changePasswordMutation.isPending}
                      isInvalid={confirmPassword.length > 0 && !passwordsMatch}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      type="button"
                      disabled={changePasswordMutation.isPending}
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
                {changePasswordMutation.isPending ? (
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
