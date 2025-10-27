import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';
import type { UserRole, UserSummary } from '../../types/user';
import { USER_ROLES } from '../../types/user';
import { ApiError } from '../../api/client';
import {
  createUser,
  fetchUsers,
  updateUser,
  USERS_QUERY_KEY,
  type CreateUserPayload,
  type UpdateUserPayload,
} from '../../api/users';
import { emitToast } from '../../utils/toast';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  comercial: 'Comercial',
  administracion: 'Administración',
  logistica: 'Logística',
  people: 'People',
  formador: 'Formador',
};

type NewUserFormState = {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
};

type EditUserFormState = {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  active: boolean;
};

function sortUsers(users: readonly UserSummary[]): UserSummary[] {
  return users
    .slice()
    .sort((a, b) => {
      const lastA = (a.last_name ?? '').toLocaleLowerCase('es');
      const lastB = (b.last_name ?? '').toLocaleLowerCase('es');
      if (lastA !== lastB) return lastA.localeCompare(lastB, 'es');

      const firstA = (a.first_name ?? '').toLocaleLowerCase('es');
      const firstB = (b.first_name ?? '').toLocaleLowerCase('es');
      if (firstA !== firstB) return firstA.localeCompare(firstB, 'es');

      return a.email.toLocaleLowerCase('es').localeCompare(b.email.toLocaleLowerCase('es'), 'es');
    });
}

function normalizeNameInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeEmailInput(value: string): string {
  return value.trim();
}

function buildCreatePayload(form: NewUserFormState): CreateUserPayload {
  return {
    first_name: normalizeNameInput(form.firstName),
    last_name: normalizeNameInput(form.lastName),
    email: normalizeEmailInput(form.email),
    role: form.role,
  };
}

function buildUpdatePayload(form: EditUserFormState): UpdateUserPayload {
  return {
    first_name: normalizeNameInput(form.firstName),
    last_name: normalizeNameInput(form.lastName),
    email: normalizeEmailInput(form.email),
    role: form.role,
    active: form.active,
  };
}

const DEFAULT_NEW_USER_FORM: NewUserFormState = {
  firstName: '',
  lastName: '',
  email: '',
  role: 'comercial',
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [newUserForm, setNewUserForm] = useState<NewUserFormState>(DEFAULT_NEW_USER_FORM);
  const [createError, setCreateError] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [editForm, setEditForm] = useState<EditUserFormState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: fetchUsers,
    refetchOnWindowFocus: false,
  });

  const users = useMemo(() => sortUsers(usersQuery.data ?? []), [usersQuery.data]);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: (created) => {
      queryClient.setQueryData<UserSummary[]>(USERS_QUERY_KEY, (current = []) =>
        sortUsers([...current, created]),
      );
      setNewUserForm(DEFAULT_NEW_USER_FORM);
      setCreateError(null);
      emitToast({ variant: 'success', message: 'Usuario creado correctamente.' });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      setCreateError(apiError?.message ?? 'No se pudo crear el usuario.');
    },
  });

  const editMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: (updated) => {
      queryClient.setQueryData<UserSummary[]>(USERS_QUERY_KEY, (current = []) =>
        sortUsers(current.map((user) => (user.id === updated.id ? updated : user))),
      );
      setShowEditModal(false);
      setEditingUser(null);
      setEditForm(null);
      setEditError(null);
      emitToast({ variant: 'success', message: 'Usuario actualizado.' });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      setEditError(apiError?.message ?? 'No se pudo actualizar el usuario.');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: (updated) => {
      queryClient.setQueryData<UserSummary[]>(USERS_QUERY_KEY, (current = []) =>
        sortUsers(current.map((user) => (user.id === updated.id ? updated : user))),
      );
      emitToast({
        variant: 'success',
        message: updated.active ? 'Usuario activado.' : 'Usuario desactivado.',
      });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      emitToast({
        variant: 'danger',
        message: apiError?.message ?? 'No se pudo actualizar el estado del usuario.',
      });
    },
  });

  const handleNewUserChange = (field: keyof NewUserFormState, value: string | UserRole) => {
    setNewUserForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createMutation.isPending) return;

    const payload = buildCreatePayload(newUserForm);

    if (!payload.email) {
      setCreateError('El email es obligatorio.');
      return;
    }

    setCreateError(null);
    createMutation.mutate(payload);
  };

  const handleOpenEditModal = (user: UserSummary) => {
    setEditingUser(user);
    setEditForm({
      firstName: user.first_name ?? '',
      lastName: user.last_name ?? '',
      email: user.email,
      role: user.role,
      active: user.active,
    });
    setEditError(null);
    setShowEditModal(true);
  };

  const handleCloseEditModal = () => {
    if (editMutation.isPending) return;
    setShowEditModal(false);
    setEditingUser(null);
    setEditForm(null);
    setEditError(null);
  };

  const handleEditFieldChange = (field: keyof EditUserFormState, value: string | boolean | UserRole) => {
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleEditSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingUser || !editForm || editMutation.isPending) return;

    const payload = buildUpdatePayload(editForm);
    if (!payload.email) {
      setEditError('El email es obligatorio.');
      return;
    }

    const hasChanges =
      payload.first_name !== (editingUser.first_name ?? null) ||
      payload.last_name !== (editingUser.last_name ?? null) ||
      payload.email !== editingUser.email ||
      payload.role !== editingUser.role ||
      payload.active !== editingUser.active;

    if (!hasChanges) {
      setEditError('No se han realizado cambios.');
      return;
    }

    setEditError(null);
    editMutation.mutate({ id: editingUser.id, data: payload });
  };

  const handleToggleActive = (user: UserSummary) => {
    if (toggleActiveMutation.isPending) return;
    toggleActiveMutation.mutate({ id: user.id, data: { active: !user.active } });
  };

  const togglePendingForUser = toggleActiveMutation.variables?.id;
  const queryErrorMessage = usersQuery.error
    ? usersQuery.error instanceof ApiError
      ? usersQuery.error.message
      : 'No se pudieron cargar los usuarios.'
    : null;

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-2">Usuarios</h1>
          <p className="text-muted mb-0">Gestiona los accesos y roles del equipo.</p>
        </div>
        {usersQuery.isFetching ? <Spinner animation="border" role="status" size="sm" /> : null}
      </section>

      <Card>
        <Card.Body>
          <Card.Title className="mb-4">Añadir usuario</Card.Title>
          <Form onSubmit={handleCreateSubmit} className="d-grid gap-3">
            {createError ? <Alert variant="danger">{createError}</Alert> : null}
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="new-user-first-name">
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control
                    type="text"
                    value={newUserForm.firstName}
                    onChange={(event) => handleNewUserChange('firstName', event.target.value)}
                    placeholder="Nombre"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="new-user-last-name">
                  <Form.Label>Apellido</Form.Label>
                  <Form.Control
                    type="text"
                    value={newUserForm.lastName}
                    onChange={(event) => handleNewUserChange('lastName', event.target.value)}
                    placeholder="Apellido"
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="new-user-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={newUserForm.email}
                    onChange={(event) => handleNewUserChange('email', event.target.value)}
                    placeholder="nombre@empresa.com"
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="new-user-role">
                  <Form.Label>Rol</Form.Label>
                  <Form.Select
                    value={newUserForm.role}
                    onChange={(event) => handleNewUserChange('role', event.target.value as UserRole)}
                  >
                    {USER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role] ?? role}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <div className="d-flex justify-content-end">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creando…' : 'Crear usuario'}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body className="d-grid gap-3">
          <div className="d-flex align-items-center justify-content-between">
            <Card.Title className="mb-0">Listado</Card.Title>
            {usersQuery.isFetching ? (
              <Spinner animation="border" role="status" size="sm" />
            ) : null}
          </div>

          {usersQuery.isError ? (
            <Alert variant="danger" className="mb-0">
              <div>{queryErrorMessage}</div>
              <div className="mt-3">
                <Button variant="outline-light" size="sm" onClick={() => usersQuery.refetch()}>
                  Reintentar
                </Button>
              </div>
            </Alert>
          ) : (
            <div className="table-responsive">
              <Table hover responsive className="align-middle">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Apellido</th>
                    <th>Email</th>
                    <th>Rol</th>
                    <th>Activo</th>
                    <th className="text-end">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {usersQuery.isLoading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-4">
                        <Spinner animation="border" role="status" />
                      </td>
                    </tr>
                  ) : users.length ? (
                    users.map((user) => {
                      const isToggling = togglePendingForUser === user.id && toggleActiveMutation.isPending;
                      return (
                        <tr key={user.id}>
                          <td>{user.first_name ?? '—'}</td>
                          <td>{user.last_name ?? '—'}</td>
                          <td>{user.email}</td>
                          <td>{ROLE_LABELS[user.role] ?? user.role}</td>
                          <td>
                            <Badge bg={user.active ? 'success' : 'secondary'}>
                              {user.active ? 'Activo' : 'Inactivo'}
                            </Badge>
                          </td>
                          <td>
                            <div className="d-flex justify-content-end gap-2">
                              <Button
                                variant="outline-primary"
                                size="sm"
                                onClick={() => handleOpenEditModal(user)}
                              >
                                Editar
                              </Button>
                              <Button
                                variant={user.active ? 'outline-danger' : 'outline-success'}
                                size="sm"
                                disabled={isToggling}
                                onClick={() => handleToggleActive(user)}
                              >
                                {isToggling
                                  ? 'Guardando…'
                                  : user.active
                                  ? 'Desactivar'
                                  : 'Activar'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-center text-muted py-4">
                        No hay usuarios registrados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      <Modal show={showEditModal} onHide={handleCloseEditModal} centered>
        <Form onSubmit={handleEditSubmit}>
          <Modal.Header closeButton>
            <Modal.Title>Editar usuario</Modal.Title>
          </Modal.Header>
          <Modal.Body className="d-grid gap-3">
            {editError ? <Alert variant="danger">{editError}</Alert> : null}
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="edit-user-first-name">
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control
                    type="text"
                    value={editForm?.firstName ?? ''}
                    onChange={(event) => handleEditFieldChange('firstName', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="edit-user-last-name">
                  <Form.Label>Apellido</Form.Label>
                  <Form.Control
                    type="text"
                    value={editForm?.lastName ?? ''}
                    onChange={(event) => handleEditFieldChange('lastName', event.target.value)}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="edit-user-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={editForm?.email ?? ''}
                    onChange={(event) => handleEditFieldChange('email', event.target.value)}
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="edit-user-role">
                  <Form.Label>Rol</Form.Label>
                  <Form.Select
                    value={editForm?.role ?? 'comercial'}
                    onChange={(event) => handleEditFieldChange('role', event.target.value as UserRole)}
                  >
                    {USER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role] ?? role}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Form.Group controlId="edit-user-active">
              <Form.Check
                type="switch"
                label="Usuario activo"
                checked={editForm?.active ?? false}
                onChange={(event) => handleEditFieldChange('active', event.target.checked)}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={handleCloseEditModal} disabled={editMutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={editMutation.isPending}>
              {editMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
}
