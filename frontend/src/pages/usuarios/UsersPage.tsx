import { FormEvent, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User, UserRole } from '../../types/user';
import { createUser, fetchUsers, updateUser } from '../../features/users/api';

export type UsersPageProps = Record<string, never>;

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  comercial: 'Comercial',
  administracion: 'Administración',
  logistica: 'Logística',
  people: 'People',
  formador: 'Formador',
};

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = Object.entries(ROLE_LABELS).map(
  ([value, label]) => ({ value: value as UserRole, label }),
);

type CreateFormState = {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  password: string;
  active: boolean;
};

type EditFormState = {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  active: boolean;
  password: string;
};

export default function UsersPage(_props: UsersPageProps) {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const [createForm, setCreateForm] = useState<CreateFormState>({
    firstName: '',
    lastName: '',
    email: '',
    role: 'comercial',
    password: '',
    active: true,
  });

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'danger'; message: string } | null>(
    null,
  );

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    try {
      await createMutation.mutateAsync(createForm);
      setCreateForm({
        firstName: '',
        lastName: '',
        email: '',
        role: 'comercial',
        password: '',
        active: true,
      });
      setFeedback({ type: 'success', message: 'Usuario creado correctamente.' });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo crear el usuario.';
      setFeedback({ type: 'danger', message });
    }
  };

  const handleStartEdit = (user: User) => {
    setEditingUserId(user.id);
    setEditForm({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      email: user.email,
      role: user.role,
      active: user.active,
      password: '',
    });
    setFeedback(null);
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
    setEditForm(null);
  };

  const handleUpdateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingUserId || !editForm) return;
    setFeedback(null);
    try {
      await updateMutation.mutateAsync({
        id: editingUserId,
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        email: editForm.email,
        role: editForm.role,
        active: editForm.active,
        password: editForm.password ? editForm.password : undefined,
      });
      setFeedback({ type: 'success', message: 'Usuario actualizado correctamente.' });
      setEditingUserId(null);
      setEditForm(null);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo actualizar el usuario.';
      setFeedback({ type: 'danger', message });
    }
  };

  const users = usersQuery.data ?? [];
  const isLoading = usersQuery.isLoading;
  const isCreating = createMutation.isPending;
  const isUpdating = updateMutation.isPending;

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        const aDate = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bDate = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bDate - aDate;
      }),
    [users],
  );

  return (
    <div className="d-grid gap-4">
      <header>
        <h1 className="h3 fw-bold mb-1">Gestión de usuarios</h1>
        <p className="text-muted mb-0">Crea y administra los usuarios con acceso al ERP.</p>
      </header>

      {feedback && <Alert variant={feedback.type}>{feedback.message}</Alert>}

      <Card className="shadow-sm border-0">
        <Card.Body>
          <h2 className="h5 fw-semibold">Crear nuevo usuario</h2>
          <Form className="d-grid gap-3 mt-3" onSubmit={handleCreateSubmit}>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="createFirstName">
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control
                    type="text"
                    value={createForm.firstName}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, firstName: event.target.value }))
                    }
                    placeholder="Nombre"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="createLastName">
                  <Form.Label>Apellidos</Form.Label>
                  <Form.Control
                    type="text"
                    value={createForm.lastName}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, lastName: event.target.value }))
                    }
                    placeholder="Apellidos"
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="createEmail">
                  <Form.Label>Correo electrónico</Form.Label>
                  <Form.Control
                    type="email"
                    value={createForm.email}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, email: event.target.value }))
                    }
                    placeholder="nombre@empresa.com"
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="createRole">
                  <Form.Label>Rol</Form.Label>
                  <Form.Select
                    value={createForm.role}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        role: event.target.value as UserRole,
                      }))
                    }
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="createActive">
                  <Form.Label className="d-block">Estado</Form.Label>
                  <Form.Check
                    type="switch"
                    label={createForm.active ? 'Activo' : 'Inactivo'}
                    checked={createForm.active}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, active: event.target.checked }))
                    }
                  />
                </Form.Group>
              </Col>
            </Row>

            <Form.Group controlId="createPassword">
              <Form.Label>Contraseña temporal</Form.Label>
              <Form.Control
                type="password"
                value={createForm.password}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, password: event.target.value }))
                }
                placeholder="Introduce una contraseña temporal"
                required
                minLength={6}
              />
              <Form.Text className="text-muted">
                La contraseña debe tener al menos 6 caracteres.
              </Form.Text>
            </Form.Group>

            <div className="d-flex justify-content-end">
              <Button type="submit" disabled={isCreating}>
                {isCreating && <Spinner animation="border" size="sm" className="me-2" />}Crear usuario
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      <Card className="shadow-sm border-0">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h2 className="h5 fw-semibold mb-0">Usuarios existentes</h2>
            {usersQuery.isFetching && <Spinner animation="border" size="sm" />}
          </div>

          {usersQuery.isError && (
            <Alert variant="danger">
              {usersQuery.error instanceof Error
                ? usersQuery.error.message
                : 'No se pudo cargar la lista de usuarios.'}
            </Alert>
          )}

          {isLoading ? (
            <div className="d-flex justify-content-center py-5">
              <Spinner animation="border" />
            </div>
          ) : (
            <div className="table-responsive">
              <Table hover responsive className="align-middle">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((user) => {
                    const isEditing = editingUserId === user.id;
                    const formValues = isEditing && editForm ? editForm : null;
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="fw-semibold">
                            {user.firstName ?? ''} {user.lastName ?? ''}
                          </div>
                          <div className="text-muted small">ID: {user.id}</div>
                        </td>
                        <td>{user.email}</td>
                        <td>{ROLE_LABELS[user.role]}</td>
                        <td>
                          <Badge bg={user.active ? 'success' : 'secondary'}>
                            {user.active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </td>
                        <td className="text-end">
                          {isEditing ? (
                            <Form onSubmit={handleUpdateSubmit} className="d-grid gap-2">
                              <Row className="g-2">
                                <Col md={4}>
                                  <Form.Control
                                    type="text"
                                    value={formValues?.firstName ?? ''}
                                    onChange={(event) =>
                                      setEditForm((prev) =>
                                        prev
                                          ? { ...prev, firstName: event.target.value }
                                          : prev,
                                      )
                                    }
                                    placeholder="Nombre"
                                  />
                                </Col>
                                <Col md={4}>
                                  <Form.Control
                                    type="text"
                                    value={formValues?.lastName ?? ''}
                                    onChange={(event) =>
                                      setEditForm((prev) =>
                                        prev ? { ...prev, lastName: event.target.value } : prev,
                                      )
                                    }
                                    placeholder="Apellidos"
                                  />
                                </Col>
                                <Col md={4}>
                                  <Form.Control
                                    type="email"
                                    value={formValues?.email ?? ''}
                                    onChange={(event) =>
                                      setEditForm((prev) =>
                                        prev ? { ...prev, email: event.target.value } : prev,
                                      )
                                    }
                                    required
                                  />
                                </Col>
                              </Row>
                              <Row className="g-2">
                                <Col md={4}>
                                  <Form.Select
                                    value={formValues?.role ?? user.role}
                                    onChange={(event) =>
                                      setEditForm((prev) =>
                                        prev
                                          ? { ...prev, role: event.target.value as UserRole }
                                          : prev,
                                      )
                                    }
                                  >
                                    {ROLE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </Form.Select>
                                </Col>
                                <Col md={4}>
                                  <Form.Check
                                    type="switch"
                                    label={formValues?.active ? 'Activo' : 'Inactivo'}
                                    checked={formValues?.active ?? false}
                                    onChange={(event) =>
                                      setEditForm((prev) =>
                                        prev ? { ...prev, active: event.target.checked } : prev,
                                      )
                                    }
                                  />
                                </Col>
                                <Col md={4}>
                                  <Form.Control
                                    type="password"
                                    value={formValues?.password ?? ''}
                                    placeholder="Nueva contraseña"
                                    minLength={6}
                                    onChange={(event) =>
                                      setEditForm((prev) =>
                                        prev ? { ...prev, password: event.target.value } : prev,
                                      )
                                    }
                                  />
                                  <Form.Text className="text-muted">
                                    Deja vacío para mantener la contraseña actual.
                                  </Form.Text>
                                </Col>
                              </Row>
                              <div className="d-flex justify-content-end gap-2">
                                <Button
                                  variant="outline-secondary"
                                  type="button"
                                  onClick={handleCancelEdit}
                                  disabled={isUpdating}
                                >
                                  Cancelar
                                </Button>
                                <Button type="submit" disabled={isUpdating}>
                                  {isUpdating && (
                                    <Spinner animation="border" size="sm" className="me-2" />
                                  )}
                                  Guardar cambios
                                </Button>
                              </div>
                            </Form>
                          ) : (
                            <Button
                              variant="link"
                              className="text-decoration-none"
                              onClick={() => handleStartEdit(user)}
                            >
                              Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {sortedUsers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-4 text-muted">
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
    </div>
  );
}
