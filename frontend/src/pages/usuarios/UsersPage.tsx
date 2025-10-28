import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Pagination,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';
import { ApiError } from '../../api/client';
import {
  createUser,
  fetchUsers,
  updateUser,
  type CreateUserPayload,
  type UpdateUserPayload,
  type UserSummary,
} from '../../api/users';
import { requestPasswordReset } from '../../api/auth';

const PAGE_SIZE = 10;
const ROLE_OPTIONS = ['Admin', 'Comercial', 'Administracion', 'Logistica', 'People', 'Formador'] as const;

export type UsersPageProps = {
  onNotify?: (payload: { variant: 'success' | 'danger' | 'info' | 'warning'; message: string }) => void;
};

type UserFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  active: boolean;
};

export default function UsersPage({ onNotify }: UsersPageProps) {
  const notify = useCallback(
    (variant: 'success' | 'danger' | 'info' | 'warning', message: string) => {
      if (onNotify) {
        onNotify({ variant, message });
      } else {
        console.log(`[users:${variant}]`, message);
      }
    },
    [onNotify],
  );

  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users', page, searchTerm],
    queryFn: () => fetchUsers({ page, pageSize: PAGE_SIZE, search: searchTerm || undefined }),
    keepPreviousData: true,
  });

  useEffect(() => {
    if (!usersQuery.data) return;
    const totalPages = Math.max(1, Math.ceil(usersQuery.data.total / usersQuery.data.pageSize));
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, usersQuery.data]);

  const openCreateModal = useCallback(() => {
    setEditingUser(null);
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((user: UserSummary) => {
    setEditingUser(user);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingUser(null);
  }, []);

  const createMutation = useMutation({
    mutationFn: (payload: CreateUserPayload) => createUser(payload),
    onSuccess: () => {
      notify('success', 'Usuario creado correctamente');
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      closeModal();
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      const message = apiError?.message ?? 'No se pudo crear el usuario.';
      notify('danger', message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserPayload }) => updateUser(id, payload),
    onSuccess: () => {
      notify('success', 'Usuario actualizado correctamente');
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      closeModal();
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      const message = apiError?.message ?? 'No se pudo actualizar el usuario.';
      notify('danger', message);
    },
  });

  const resetMutation = useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
    onSuccess: () => {
      notify('info', 'Se ha enviado el enlace de restablecimiento si el usuario existe.');
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      const message = apiError?.message ?? 'No se pudo solicitar el restablecimiento de contraseña.';
      notify('danger', message);
    },
    onSettled: () => {
      setResettingId(null);
    },
  });

  const handleModalSubmit = useCallback(
    async (values: UserFormValues) => {
      if (editingUser) {
        await updateMutation.mutateAsync({
          id: editingUser.id,
          payload: values,
        });
      } else {
        await createMutation.mutateAsync(values);
      }
    },
    [createMutation, editingUser, updateMutation],
  );

  const handleResetPassword = useCallback(
    (user: UserSummary) => {
      setResettingId(user.id);
      resetMutation.mutate(user.email);
    },
    [resetMutation],
  );

  const totalUsers = usersQuery.data?.total ?? 0;
  const users = usersQuery.data?.users ?? [];
  const currentPage = usersQuery.data?.page ?? page;
  const totalPages = usersQuery.data ? Math.max(1, Math.ceil(usersQuery.data.total / usersQuery.data.pageSize)) : 1;

  const paginationItems = useMemo(() => {
    const items: JSX.Element[] = [];
    for (let i = 1; i <= totalPages; i += 1) {
      items.push(
        <Pagination.Item key={i} active={i === currentPage} onClick={() => setPage(i)}>
          {i}
        </Pagination.Item>,
      );
    }
    return items;
  }, [currentPage, totalPages]);

  const isLoading = usersQuery.isLoading;
  const isRefetching = usersQuery.isFetching && !usersQuery.isLoading;

  return (
    <div className="d-grid gap-4">
      <Card className="shadow-sm">
        <Card.Body className="d-grid gap-4">
          <div className="d-flex flex-column flex-md-row justify-content-between gap-3 align-items-md-center">
            <div>
              <h1 className="h3 fw-bold mb-1">Usuarios</h1>
              <p className="text-muted mb-0">Gestiona el acceso a la plataforma</p>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Form onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setSearchTerm(searchInput.trim());
              }} className="d-flex align-items-center gap-2">
                <Form.Control
                  type="search"
                  placeholder="Buscar"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  style={{ minWidth: '220px' }}
                />
                <Button type="submit" variant="outline-secondary">
                  Buscar
                </Button>
              </Form>
              <Button onClick={openCreateModal}>Crear usuario</Button>
            </div>
          </div>

          {usersQuery.error && (
            <Alert variant="danger">
              {usersQuery.error instanceof ApiError
                ? usersQuery.error.message
                : 'No se pudieron cargar los usuarios.'}
            </Alert>
          )}

          <div className="position-relative">
            {isLoading && (
              <div className="py-5 text-center">
                <Spinner animation="border" role="status" />
              </div>
            )}

            {!isLoading && (
              <Table hover responsive className="mb-0">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th className="text-end">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center text-muted py-4">
                        No hay usuarios para mostrar.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id}>
                        <td>{`${user.firstName} ${user.lastName}`}</td>
                        <td>{user.email}</td>
                        <td>{user.role}</td>
                        <td>
                          <Badge bg={user.active ? 'success' : 'secondary'}>
                            {user.active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </td>
                        <td>
                          <div className="d-flex justify-content-end gap-2">
                            <Button variant="outline-secondary" size="sm" onClick={() => openEditModal(user)}>
                              Editar
                            </Button>
                            <Button
                              variant="outline-primary"
                              size="sm"
                              disabled={resetMutation.isPending && resettingId === user.id}
                              onClick={() => handleResetPassword(user)}
                            >
                              {resetMutation.isPending && resettingId === user.id ? (
                                <Spinner animation="border" size="sm" role="status" />
                              ) : (
                                'Enviar enlace'
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            )}
          </div>

          <Row className="align-items-center g-3">
            <Col className="text-muted small">
              {isRefetching ? 'Actualizando…' : `Mostrando ${users.length} de ${totalUsers} usuarios`}
            </Col>
            <Col className="d-flex justify-content-end">
              <Pagination className="mb-0">
                <Pagination.Prev
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                />
                {paginationItems}
                <Pagination.Next
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                />
              </Pagination>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <UserFormModal
        show={showModal}
        onHide={closeModal}
        onSubmit={handleModalSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        initialValue={editingUser}
      />
    </div>
  );
}

type UserFormModalProps = {
  show: boolean;
  onHide: () => void;
  onSubmit: (values: UserFormValues) => Promise<void>;
  isSubmitting: boolean;
  initialValue: UserSummary | null;
};

function UserFormModal({ show, onHide, onSubmit, isSubmitting, initialValue }: UserFormModalProps) {
  const [values, setValues] = useState<UserFormValues>(() =>
    initialValue
      ? {
          firstName: initialValue.firstName,
          lastName: initialValue.lastName,
          email: initialValue.email,
          role: initialValue.role,
          active: initialValue.active,
        }
      : { firstName: '', lastName: '', email: '', role: ROLE_OPTIONS[0], active: true },
  );

  useEffect(() => {
    if (initialValue) {
      setValues({
        firstName: initialValue.firstName,
        lastName: initialValue.lastName,
        email: initialValue.email,
        role: initialValue.role,
        active: initialValue.active,
      });
    } else {
      setValues({ firstName: '', lastName: '', email: '', role: ROLE_OPTIONS[0], active: true });
    }
  }, [initialValue]);

  const handleChange = (field: keyof UserFormValues, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(values);
  };

  const title = initialValue ? 'Editar usuario' : 'Crear usuario';

  return (
    <Modal show={show} onHide={onHide} backdrop="static" centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-grid gap-3">
          <Form.Group controlId="user-first-name">
            <Form.Label>Nombre</Form.Label>
            <Form.Control
              type="text"
              value={values.firstName}
              onChange={(event) => handleChange('firstName', event.target.value)}
              required
              disabled={isSubmitting}
            />
          </Form.Group>
          <Form.Group controlId="user-last-name">
            <Form.Label>Apellido</Form.Label>
            <Form.Control
              type="text"
              value={values.lastName}
              onChange={(event) => handleChange('lastName', event.target.value)}
              required
              disabled={isSubmitting}
            />
          </Form.Group>
          <Form.Group controlId="user-email">
            <Form.Label>Email</Form.Label>
            <Form.Control
              type="email"
              value={values.email}
              onChange={(event) => handleChange('email', event.target.value)}
              required
              disabled={isSubmitting}
            />
          </Form.Group>
          <Form.Group controlId="user-role">
            <Form.Label>Rol</Form.Label>
            <Form.Select
              value={values.role}
              onChange={(event) => handleChange('role', event.target.value)}
              disabled={isSubmitting}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Check
            type="switch"
            id="user-active"
            label="Activo"
            checked={values.active}
            onChange={(event) => handleChange('active', event.target.checked)}
            disabled={isSubmitting}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onHide} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando…' : 'Guardar'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
