import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Card,
  Col,
  Form,
  Accordion,
  Modal,
  Pagination,
  Row,
  Spinner,
  Table,
  ListGroup,
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
import {
  deleteUserDocument,
  fetchUserDocuments,
  uploadUserDocument,
  type UserDocument,
} from '../../api/userDocuments';

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
  bankAccount: string;
  address: string;
  startDate: string;
};

type UsersListResponse = { total: number; page: number; pageSize: number; users: UserSummary[] };

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
  const [includeTrainers, setIncludeTrainers] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    setPage(1);
  }, [includeTrainers, statusFilter, tableFilter]);

  const usersQuery = useQuery<UsersListResponse>({
    queryKey: ['users', page, searchTerm, includeTrainers, statusFilter],
    queryFn: () =>
      fetchUsers({
        page,
        pageSize: PAGE_SIZE,
        search: searchTerm || undefined,
        includeTrainers,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    placeholderData: keepPreviousData,
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

  const handleModalSubmit = useCallback(
    async (values: UserFormValues) => {
      const normalizedPayload: UserFormValues = {
        ...values,
        bankAccount: values.bankAccount.trim(),
        address: values.address.trim(),
        startDate: values.startDate.trim(),
      };
      if (editingUser) {
        await updateMutation.mutateAsync({
          id: editingUser.id,
          payload: {
            ...normalizedPayload,
            bankAccount: normalizedPayload.bankAccount || null,
            address: normalizedPayload.address || null,
            startDate: normalizedPayload.startDate || null,
          },
        });
      } else {
        await createMutation.mutateAsync({
          ...normalizedPayload,
          bankAccount: normalizedPayload.bankAccount || null,
          address: normalizedPayload.address || null,
          startDate: normalizedPayload.startDate || null,
        });
      }
    },
    [createMutation, editingUser, updateMutation],
  );

  const totalUsers = usersQuery.data?.total ?? 0;
  const users = usersQuery.data?.users ?? ([] as UserSummary[]);
  const currentPage = usersQuery.data?.page ?? page;
  const totalPages = usersQuery.data ? Math.max(1, Math.ceil(usersQuery.data.total / usersQuery.data.pageSize)) : 1;

  const filteredUsers = useMemo(() => {
    const normalizedFilter = tableFilter.trim().toLowerCase();

    return users.filter((user) => {
      if (!includeTrainers && user.role === 'Formador') {
        return false;
      }

      if (statusFilter === 'active' && !user.active) {
        return false;
      }

      if (statusFilter === 'inactive' && user.active) {
        return false;
      }

      if (normalizedFilter.length > 0) {
        const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
        if (!fullName.includes(normalizedFilter)) {
          return false;
        }
      }

      return true;
    });
  }, [includeTrainers, statusFilter, tableFilter, users]);

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

          <Alert variant="info">
            Los usuarios nuevos acceden con la contraseña por defecto <strong>123456</strong>. Pueden
            actualizarla desde la sección "Mi perfil".
          </Alert>

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
              <div className="d-grid gap-3">
                <div className="d-flex flex-column flex-lg-row gap-2 justify-content-between align-items-lg-center">
                  <div className="d-flex gap-2 flex-wrap">
                    <Button
                      variant={includeTrainers ? 'outline-secondary' : 'outline-primary'}
                      onClick={() => setIncludeTrainers((prev) => !prev)}
                    >
                      {includeTrainers ? 'Ocultar formadores' : 'Mostrar Formadores'}
                    </Button>
                    <ButtonGroup>
                      <Button
                        variant={statusFilter === 'all' ? 'primary' : 'outline-secondary'}
                        onClick={() => setStatusFilter('all')}
                      >
                        Todos
                      </Button>
                      <Button
                        variant={statusFilter === 'active' ? 'primary' : 'outline-secondary'}
                        onClick={() => setStatusFilter('active')}
                      >
                        Activos
                      </Button>
                      <Button
                        variant={statusFilter === 'inactive' ? 'primary' : 'outline-secondary'}
                        onClick={() => setStatusFilter('inactive')}
                      >
                        Inactivos
                      </Button>
                    </ButtonGroup>
                  </div>
                  <Form.Control
                    size="sm"
                    type="search"
                    placeholder="Filtrar por nombre o apellido"
                    value={tableFilter}
                    onChange={(event) => setTableFilter(event.target.value)}
                    style={{ maxWidth: '280px' }}
                  />
                </div>
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
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-muted py-4">
                          No hay usuarios para mostrar.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user: UserSummary) => (
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
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>
            )}
          </div>

          <Row className="align-items-center g-3">
            <Col className="text-muted small">
              {isRefetching
                ? 'Actualizando…'
                : `Mostrando ${filteredUsers.length} de ${totalUsers} usuarios`}
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
  const queryClient = useQueryClient();
  const userId = initialValue?.id ?? null;
  const [values, setValues] = useState<UserFormValues>(() =>
    initialValue
      ? {
          firstName: initialValue.firstName,
          lastName: initialValue.lastName,
          email: initialValue.email,
          role: initialValue.role,
          active: initialValue.active,
          bankAccount: initialValue.bankAccount ?? '',
          address: initialValue.address ?? '',
          startDate: initialValue.startDate ? initialValue.startDate.slice(0, 10) : '',
        }
      : {
          firstName: '',
          lastName: '',
          email: '',
          role: ROLE_OPTIONS[0],
          active: true,
          bankAccount: '',
          address: '',
          startDate: '',
        },
  );

  useEffect(() => {
    if (initialValue) {
      setValues({
        firstName: initialValue.firstName,
        lastName: initialValue.lastName,
        email: initialValue.email,
        role: initialValue.role,
        active: initialValue.active,
        bankAccount: initialValue.bankAccount ?? '',
        address: initialValue.address ?? '',
        startDate: initialValue.startDate ? initialValue.startDate.slice(0, 10) : '',
      });
    } else {
      setValues({
        firstName: '',
        lastName: '',
        email: '',
        role: ROLE_OPTIONS[0],
        active: true,
        bankAccount: '',
        address: '',
        startDate: '',
      });
    }
  }, [initialValue]);

  const [documentError, setDocumentError] = useState<string | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);

  const documentsQuery = useQuery<UserDocument[]>({
    queryKey: ['user-documents', userId],
    queryFn: async () => fetchUserDocuments(userId as string),
    enabled: Boolean(userId && show),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadUserDocument({ userId: userId as string, file }),
    onSuccess: (document) => {
      queryClient.setQueryData<UserDocument[] | undefined>(['user-documents', userId], (prev) => [
        document,
        ...(Array.isArray(prev) ? prev : []),
      ]);
      setDocumentError(null);
      if (documentInputRef.current) {
        documentInputRef.current.value = '';
      }
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      setDocumentError(apiError?.message ?? 'No se pudo subir el documento.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => deleteUserDocument(documentId),
    onSuccess: (_, documentId) => {
      queryClient.setQueryData<UserDocument[] | undefined>(['user-documents', userId], (prev) =>
        Array.isArray(prev) ? prev.filter((doc) => doc.id !== documentId) : prev,
      );
      setDocumentError(null);
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      setDocumentError(apiError?.message ?? 'No se pudo eliminar el documento.');
    },
  });

  const handleChange = (field: keyof UserFormValues, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(values);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !userId) return;
    uploadMutation.mutate(file);
  };

  const documents = documentsQuery.data ?? [];

  const formatFileSize = (size: number | null) => {
    if (!size) return '';
    const kb = size / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const title = initialValue ? 'Editar usuario' : 'Crear usuario';

  const resolveDocumentUrl = (document: UserDocument) =>
    document.drive_web_view_link ?? document.drive_web_content_link ?? document.download_url;

  const handleDeleteDocument = (documentId: string) => {
    const document = documents.find((item) => item.id === documentId);
    const fileName = document?.file_name ?? 'el documento';
    const confirmed = window.confirm(`¿Quieres eliminar ${fileName}?`);
    if (!confirmed) return;
    deleteMutation.mutate(documentId);
  };

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
          <Form.Group controlId="user-bank-account">
            <Form.Label>Cuenta bancaria</Form.Label>
            <Form.Control
              type="text"
              value={values.bankAccount}
              onChange={(event) => handleChange('bankAccount', event.target.value)}
              disabled={isSubmitting}
              placeholder="IBAN o número de cuenta"
            />
          </Form.Group>
          <Form.Group controlId="user-address">
            <Form.Label>Dirección</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={values.address}
              onChange={(event) => handleChange('address', event.target.value)}
              disabled={isSubmitting}
            />
          </Form.Group>
          <Form.Group controlId="user-start-date">
            <Form.Label>Fecha Alta</Form.Label>
            <Form.Control
              type="date"
              value={values.startDate}
              onChange={(event) => handleChange('startDate', event.target.value)}
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
          <Accordion defaultActiveKey="documents">
            <Accordion.Item eventKey="documents">
              <Accordion.Header>Documentos</Accordion.Header>
              <Accordion.Body className="d-grid gap-3">
                {!initialValue ? (
                  <p className="text-muted mb-0">Guarda el usuario para gestionar sus documentos.</p>
                ) : (
                  <>
                    {documentError ? <Alert variant="danger">{documentError}</Alert> : null}
                    {documentsQuery.isLoading ? (
                      <div className="d-flex align-items-center gap-2">
                        <Spinner size="sm" animation="border" />
                        <span>Cargando documentos…</span>
                      </div>
                    ) : documents.length ? (
                      <ListGroup>
                        {documents.map((doc) => (
                          <ListGroup.Item key={doc.id} className="d-flex justify-content-between align-items-center gap-3">
                            <div className="me-auto">
                              <div className="fw-semibold">{doc.file_name}</div>
                              <div className="text-muted small">
                                {doc.mime_type || 'Archivo'}
                                {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ''}
                              </div>
                            </div>
                            <div className="d-flex align-items-center gap-2">
                              <Button
                                as="a"
                                href={resolveDocumentUrl(doc)}
                                variant="outline-primary"
                                size="sm"
                                target="_blank"
                                rel="noreferrer"
                              >
                                Ver
                              </Button>
                              <Button
                                variant="outline-danger"
                                size="sm"
                                disabled={deleteMutation.isPending && deleteMutation.variables === doc.id}
                                onClick={() => handleDeleteDocument(doc.id)}
                              >
                                {deleteMutation.isPending && deleteMutation.variables === doc.id
                                  ? 'Eliminando…'
                                  : 'Eliminar'}
                              </Button>
                            </div>
                          </ListGroup.Item>
                        ))}
                      </ListGroup>
                    ) : (
                      <p className="text-muted mb-0">No hay documentos disponibles.</p>
                    )}
                    <Form.Group controlId="user-documents-upload" className="mb-0">
                      <Form.Label className="fw-semibold">Subir documento</Form.Label>
                      <Form.Control
                        type="file"
                        onChange={handleFileChange}
                        disabled={uploadMutation.isPending}
                        ref={documentInputRef}
                      />
                      {uploadMutation.isPending ? (
                        <div className="d-flex align-items-center gap-2 mt-2 text-muted">
                          <Spinner size="sm" animation="border" />
                          <span>Subiendo…</span>
                        </div>
                      ) : null}
                    </Form.Group>
                  </>
                )}
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>
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
