import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Form,
  Modal,
  Spinner,
  Table,
} from 'react-bootstrap';
import { useMutation, useQuery } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import {
  createUser,
  fetchUsers,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
} from '../../api/users';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { emitToast } from '../../utils/toast';
import { USER_ROLES, type User, type UserRole } from '../../types/user';

const PAGE_SIZE = 10;

const ROLE_LABELS: Record<UserRole, string> = {
  comercial: 'Comercial',
  administracion: 'Administración',
  logistica: 'Logística',
  admin: 'Admin',
  people: 'People',
  formador: 'Formador',
};

type ActiveFilter = 'all' | 'true' | 'false';

type UserFormValues = {
  first_name: string;
  last_name: string;
  email?: string;
  role: UserRole;
};

type UserFormModalProps = {
  show: boolean;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSubmit: (values: UserFormValues) => Promise<void>;
  isSubmitting: boolean;
  errorMessage: string | null;
  initialUser?: User | null;
};

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as any).message ?? '').trim();
    if (message.length) {
      return message;
    }
  }
  return fallback;
}

function formatRole(role: UserRole): string {
  return ROLE_LABELS[role] ?? role;
}

function UserFormModal({
  show,
  mode,
  onClose,
  onSubmit,
  isSubmitting,
  errorMessage,
  initialUser,
}: UserFormModalProps) {
  const isCreate = mode === 'create';
  const [firstName, setFirstName] = useState(initialUser?.first_name ?? '');
  const [lastName, setLastName] = useState(initialUser?.last_name ?? '');
  const [email, setEmail] = useState(initialUser?.email ?? '');
  const [role, setRole] = useState<UserRole>(initialUser?.role ?? USER_ROLES[0]);

  useEffect(() => {
    if (!show) {
      return;
    }
    setFirstName(initialUser?.first_name ?? '');
    setLastName(initialUser?.last_name ?? '');
    setEmail(initialUser?.email ?? '');
    setRole(initialUser?.role ?? USER_ROLES[0]);
  }, [initialUser?.email, initialUser?.first_name, initialUser?.last_name, initialUser?.role, show]);

  const isSubmitDisabled = useMemo(() => {
    if (!firstName.trim().length || !lastName.trim().length) {
      return true;
    }
    if (isCreate) {
      if (!email.trim().length) {
        return true;
      }
      return false;
    }
    return false;
  }, [email, firstName, isCreate, lastName]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitDisabled) return;

    const payload: UserFormValues = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      role,
    };

    if (isCreate) {
      payload.email = email.trim();
    }

    await onSubmit(payload);
  };

  return (
    <Modal show={show} onHide={onClose} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{isCreate ? 'Añadir usuario' : 'Editar usuario'}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-grid gap-3">
          <Form.Group controlId={`${mode}-first-name`}>
            <Form.Label>Nombre</Form.Label>
            <Form.Control
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Nombre"
              autoFocus
              disabled={isSubmitting}
              required
            />
          </Form.Group>

          <Form.Group controlId={`${mode}-last-name`}>
            <Form.Label>Apellido</Form.Label>
            <Form.Control
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Apellido"
              disabled={isSubmitting}
              required
            />
          </Form.Group>

          {isCreate ? (
            <Form.Group controlId={`${mode}-email`}>
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="usuario@empresa.com"
                disabled={isSubmitting}
                required
              />
            </Form.Group>
          ) : (
            <Form.Group controlId={`${mode}-email-readonly`}>
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" value={email} disabled readOnly />
            </Form.Group>
          )}

          <Form.Group controlId={`${mode}-role`}>
            <Form.Label>Rol</Form.Label>
            <Form.Select
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              disabled={isSubmitting}
            >
              {USER_ROLES.map((availableRole) => (
                <option key={availableRole} value={availableRole}>
                  {formatRole(availableRole)}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          {errorMessage ? (
            <Alert variant="danger" className="mb-0">
              {errorMessage}
            </Alert>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting || isSubmitDisabled}>
            {isSubmitting ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  className="me-2"
                />
                Guardando…
              </>
            ) : isCreate ? (
              'Crear usuario'
            ) : (
              'Guardar cambios'
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [searchValue, setSearchValue] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(searchValue, 300);

  const usersQuery = useQuery({
    queryKey: ['users', { page, roleFilter, activeFilter, q: debouncedSearch }],
    queryFn: () =>
      fetchUsers({
        page,
        perPage: PAGE_SIZE,
        role: roleFilter,
        active: activeFilter,
        q: debouncedSearch,
      }),
    keepPreviousData: true,
    staleTime: 30_000,
  });

  const users = usersQuery.data?.data ?? [];
  const meta = usersQuery.data?.meta;
  const totalUsers = meta?.total ?? 0;
  const totalPages = Math.max(1, meta?.total_pages ?? 1);

  const listError = usersQuery.error
    ? formatError(usersQuery.error, 'No se pudieron cargar los usuarios.')
    : null;

  const createUserMutation = useMutation({
    mutationFn: (input: CreateUserInput) => createUser(input),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) => updateUser(id, input),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateUser(id, { active }),
  });

  const isCreating = createUserMutation.isPending;
  const isUpdating = updateUserMutation.isPending;
  const isToggling = toggleActiveMutation.isPending && pendingToggleId !== null;

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchValue(event.target.value);
    setPage(1);
  };

  const handleRoleFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setRoleFilter(event.target.value as 'all' | UserRole);
    setPage(1);
  };

  const handleActiveFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setActiveFilter(event.target.value as ActiveFilter);
    setPage(1);
  };

  const handleCreateSubmit = async (values: UserFormValues) => {
    setCreateError(null);
    const payload: CreateUserInput = {
      first_name: values.first_name,
      last_name: values.last_name,
      email: values.email ?? '',
      role: values.role,
    };
    try {
      await createUserMutation.mutateAsync(payload);
      emitToast({ variant: 'success', message: 'Usuario creado correctamente.' });
      setShowCreateModal(false);
      await usersQuery.refetch();
    } catch (error) {
      setCreateError(formatError(error, 'No se pudo crear el usuario.'));
    }
  };

  const handleEditSubmit = async (values: UserFormValues) => {
    if (!editingUser) return;
    setEditError(null);
    const payload: UpdateUserInput = {
      first_name: values.first_name,
      last_name: values.last_name,
      role: values.role,
    };

    try {
      await updateUserMutation.mutateAsync({ id: editingUser.id, input: payload });
      emitToast({ variant: 'success', message: 'Usuario actualizado correctamente.' });
      setEditingUser(null);
      await usersQuery.refetch();
    } catch (error) {
      setEditError(formatError(error, 'No se pudo actualizar el usuario.'));
    }
  };

  const handleToggleActive = async (user: User) => {
    const nextActive = !user.active;
    const confirmation = window.confirm(
      `¿Seguro que quieres ${nextActive ? 'activar' : 'desactivar'} a ${user.first_name} ${user.last_name}?`,
    );
    if (!confirmation) return;

    setPendingToggleId(user.id);
    try {
      await toggleActiveMutation.mutateAsync({ id: user.id, active: nextActive });
      emitToast({
        variant: 'success',
        message: nextActive ? 'Usuario activado.' : 'Usuario desactivado.',
      });
      await usersQuery.refetch();
    } catch (error) {
      emitToast({
        variant: 'danger',
        message: formatError(error, 'No se pudo cambiar el estado del usuario.'),
      });
    } finally {
      setPendingToggleId(null);
    }
  };

  const handleGoToPreviousPage = () => {
    setPage((current) => Math.max(1, current - 1));
  };

  const handleGoToNextPage = () => {
    setPage((current) => Math.min(totalPages, current + 1));
  };

  return (
    <div className="d-grid gap-4">
      <header className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Gestión de usuarios</h1>
          <p className="text-muted mb-0">Administra roles y accesos dentro del ERP.</p>
        </div>
        <Button size="lg" onClick={() => setShowCreateModal(true)}>
          Añadir usuario
        </Button>
      </header>

      <section className="d-grid gap-3">
        <div className="row g-3">
          <div className="col-12 col-md-4">
            <Form.Group controlId="users-search">
              <Form.Label>Búsqueda</Form.Label>
              <Form.Control
                placeholder="Buscar por nombre o email"
                value={searchValue}
                onChange={handleSearchChange}
              />
            </Form.Group>
          </div>
          <div className="col-12 col-md-4">
            <Form.Group controlId="users-role-filter">
              <Form.Label>Rol</Form.Label>
              <Form.Select value={roleFilter} onChange={handleRoleFilterChange}>
                <option value="all">Todos los roles</option>
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {formatRole(role)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>
          <div className="col-12 col-md-4">
            <Form.Group controlId="users-active-filter">
              <Form.Label>Estado</Form.Label>
              <Form.Select value={activeFilter} onChange={handleActiveFilterChange}>
                <option value="all">Todos</option>
                <option value="true">Solo activos</option>
                <option value="false">Solo inactivos</option>
              </Form.Select>
            </Form.Group>
          </div>
        </div>

        {listError ? (
          <Alert variant="danger" className="mb-0 d-flex align-items-center justify-content-between gap-3">
            <span>{listError}</span>
            <Button variant="outline-light" onClick={() => usersQuery.refetch()}>
              Reintentar
            </Button>
          </Alert>
        ) : null}
      </section>

      <section className="card shadow-sm">
        <div className="table-responsive">
          <Table hover className="mb-0">
            <thead className="table-light">
              <tr>
                <th>Nombre</th>
                <th>Apellido</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-5 text-center text-muted">
                    No hay usuarios que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const isTogglePending = isToggling && pendingToggleId === user.id;
                  return (
                    <tr key={user.id}>
                      <td className="align-middle">{user.first_name}</td>
                      <td className="align-middle">{user.last_name}</td>
                      <td className="align-middle">{user.email}</td>
                      <td className="align-middle">
                        <Badge bg="light" text="dark" className="text-uppercase">
                          {formatRole(user.role)}
                        </Badge>
                      </td>
                      <td className="align-middle">
                        <Badge bg={user.active ? 'success' : 'secondary'}>
                          {user.active ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </td>
                      <td className="align-middle text-end">
                        <div className="d-inline-flex gap-2">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => setEditingUser(user)}
                            disabled={isUpdating || isTogglePending}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant={user.active ? 'outline-warning' : 'outline-success'}
                            onClick={() => handleToggleActive(user)}
                            disabled={isTogglePending}
                          >
                            {isTogglePending ? (
                              <Spinner animation="border" size="sm" role="status" />
                            ) : user.active ? (
                              'Desactivar'
                            ) : (
                              'Activar'
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </div>
        <footer className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3 px-3 py-3 border-top">
          <span className="text-muted small">
            Mostrando {users.length} de {totalUsers} usuario{totalUsers === 1 ? '' : 's'}.
          </span>
          <div className="d-flex align-items-center gap-3">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={handleGoToPreviousPage}
              disabled={page <= 1 || usersQuery.isFetching || usersQuery.isLoading}
            >
              Anterior
            </Button>
            <span className="fw-semibold">
              Página {page} de {totalPages}
            </span>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={handleGoToNextPage}
              disabled={page >= totalPages || usersQuery.isFetching || usersQuery.isLoading}
            >
              Siguiente
            </Button>
          </div>
        </footer>
      </section>

      <UserFormModal
        show={showCreateModal}
        mode="create"
        onClose={() => {
          if (!isCreating) {
            setShowCreateModal(false);
            setCreateError(null);
          }
        }}
        onSubmit={handleCreateSubmit}
        isSubmitting={isCreating}
        errorMessage={createError}
      />

      <UserFormModal
        show={!!editingUser}
        mode="edit"
        onClose={() => {
          if (!isUpdating) {
            setEditingUser(null);
            setEditError(null);
          }
        }}
        onSubmit={handleEditSubmit}
        isSubmitting={isUpdating}
        errorMessage={editError}
        initialUser={editingUser ?? undefined}
      />
    </div>
  );
}
