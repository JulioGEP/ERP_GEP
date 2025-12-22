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
  OverlayTrigger,
  Pagination,
  Row,
  Spinner,
  Table,
  Tooltip,
  ListGroup,
} from 'react-bootstrap';
import { ApiError } from '../../api/client';
import {
  createUser,
  fetchUserById,
  fetchUsers,
  updateUser,
  type CreateUserPayload,
  type UpdateUserPayload,
  type UserSummary,
  type UserPayroll,
} from '../../api/users';
import {
  fetchUserVacations,
  saveUserVacationDay,
  updateVacationAllowance,
  type UserVacationsResponse,
  type VacationType,
} from '../../api/userVacations';
import {
  deleteUserDocument,
  fetchUserDocuments,
  uploadUserDocument,
  type UserDocument,
} from '../../api/userDocuments';
import { VacationCalendar } from '../../components/vacations/VacationCalendar';
import { fetchTrainerDocuments } from '../../features/recursos/api';
import { type TrainerDocument } from '../../types/trainer';

const PAGE_SIZE = 10;
const ROLE_OPTIONS = ['Admin', 'Comercial', 'Administracion', 'Logistica', 'People', 'Formador'] as const;
const DEFAULT_WEEKLY_HOURS = '40';

type PayrollPayload = {
  convenio: string;
  categoria: string;
  antiguedad: string | null;
  horasSemana: number;
  baseRetencion: number | null;
  salarioBruto: number | null;
  salarioBrutoTotal: number | null;
  retencion: number | null;
  aportacionSsIrpf: number | null;
  aportacionSsIrpfDetalle: string | null;
  salarioLimpio: number | null;
  contingenciasComunes: number | null;
  contingenciasComunesDetalle: string | null;
  totalEmpresa: number | null;
};

const defaultPayrollValues: PayrollFormValues = {
  convenio: '',
  categoria: '',
  antiguedad: '',
  horasSemana: DEFAULT_WEEKLY_HOURS,
  baseRetencion: '',
  salarioBruto: '',
  salarioBrutoTotal: '',
  retencion: '',
  aportacionSsIrpfDetalle: '',
  aportacionSsIrpf: '',
  salarioLimpio: '',
  contingenciasComunesDetalle: '',
  contingenciasComunes: '',
  totalEmpresa: '',
};

function mapPayrollToForm(payroll?: UserPayroll | null): PayrollFormValues {
  if (!payroll) return { ...defaultPayrollValues };

  const format = (value: number | null, fallback = '') =>
    value === null || value === undefined ? fallback : value.toFixed(2);

  return {
    convenio: payroll.convenio ?? '',
    categoria: payroll.categoria ?? '',
    antiguedad: payroll.antiguedad ?? '',
    horasSemana: payroll.horasSemana?.toString() ?? DEFAULT_WEEKLY_HOURS,
    baseRetencion: format(payroll.baseRetencion),
    salarioBruto: format(payroll.salarioBruto),
    salarioBrutoTotal: format(payroll.salarioBrutoTotal),
    retencion: format(payroll.retencion),
    aportacionSsIrpfDetalle: payroll.aportacionSsIrpfDetalle ?? '',
    aportacionSsIrpf: format(payroll.aportacionSsIrpf),
    salarioLimpio: format(payroll.salarioLimpio),
    contingenciasComunesDetalle: payroll.contingenciasComunesDetalle ?? '',
    contingenciasComunes: format(payroll.contingenciasComunes),
    totalEmpresa: format(payroll.totalEmpresa),
  };
}

function parseLocaleNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.length) return null;

  const cleaned = trimmed.replace(/%/g, '').replace(/,/g, '.');
  const parsed = Number(cleaned);

  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeNumber(value: string, fallback: number | null = null): number | null {
  const parsed = parseLocaleNumber(value);
  if (parsed === null) return fallback;
  return Number(parsed.toFixed(2));
}

function calculateBaseRetencionMonthly(value: string): number | null {
  const normalized = normalizeNumber(value);
  if (normalized === null) return null;
  return Number((normalized / 12).toFixed(2));
}

function calculateSalarioBruto(baseRetencion: string, horasSemana: string): number | null {
  const baseMensual = calculateBaseRetencionMonthly(baseRetencion);
  const horas = normalizeNumber(horasSemana, Number(DEFAULT_WEEKLY_HOURS));

  if (baseMensual === null || horas === null) return null;

  return Number(((baseMensual / 40) * horas).toFixed(2));
}

function parsePercentageInput(value: string): number | null {
  const parsed = parseLocaleNumber(value);
  if (parsed === null) return null;

  const hasPercentSymbol = value.includes('%');
  const shouldNormalizeToPercent = hasPercentSymbol || parsed > 1;

  return shouldNormalizeToPercent ? parsed / 100 : parsed;
}

function parseSumExpression(
  expression: string,
  parser: (value: string) => number | null,
): number | null {
  if (!expression.trim()) return 0;

  const parts = expression.split('+');
  let total = 0;
  let parsedAny = false;

  for (const part of parts) {
    const normalized = part.trim();
    if (!normalized) continue;

    const parsed = parser(normalized);
    if (parsed === null) return null;

    parsedAny = true;
    total += parsed;
  }

  return parsedAny ? total : 0;
}

function buildPayrollPayload(payroll: PayrollFormValues): PayrollPayload {
  const horasSemana = normalizeNumber(payroll.horasSemana, Number(DEFAULT_WEEKLY_HOURS)) ?? Number(DEFAULT_WEEKLY_HOURS);
  const baseRetencion = calculateBaseRetencionMonthly(payroll.baseRetencion);
  const salarioBrutoCalculado = calculateSalarioBruto(payroll.baseRetencion, payroll.horasSemana);
  const aportacionSsIrpfDetalle = payroll.aportacionSsIrpfDetalle.trim();
  const contingenciasComunesDetalle = payroll.contingenciasComunesDetalle.trim();

  return {
    convenio: payroll.convenio.trim(),
    categoria: payroll.categoria.trim(),
    antiguedad: payroll.antiguedad ? payroll.antiguedad : null,
    horasSemana,
    baseRetencion,
    salarioBruto: salarioBrutoCalculado,
    salarioBrutoTotal: normalizeNumber(payroll.salarioBrutoTotal),
    retencion: normalizeNumber(payroll.retencion),
    aportacionSsIrpfDetalle: aportacionSsIrpfDetalle.length ? aportacionSsIrpfDetalle : null,
    aportacionSsIrpf: normalizeNumber(payroll.aportacionSsIrpf),
    salarioLimpio: normalizeNumber(payroll.salarioLimpio),
    contingenciasComunesDetalle:
      contingenciasComunesDetalle.length ? contingenciasComunesDetalle : null,
    contingenciasComunes: normalizeNumber(payroll.contingenciasComunes),
    totalEmpresa: normalizeNumber(payroll.totalEmpresa),
  };
}

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
  position: string;
  startDate: string;
  payroll: PayrollFormValues;
};

type PayrollFormValues = {
  convenio: string;
  categoria: string;
  antiguedad: string;
  horasSemana: string;
  baseRetencion: string;
  salarioBruto: string;
  salarioBrutoTotal: string;
  retencion: string;
  aportacionSsIrpfDetalle: string;
  aportacionSsIrpf: string;
  salarioLimpio: string;
  contingenciasComunesDetalle: string;
  contingenciasComunes: string;
  totalEmpresa: string;
};

type UsersListResponse = { total: number; page: number; pageSize: number; users: UserSummary[] };

export default function UsersPage({ onNotify }: UsersPageProps) {
  const notify = useCallback(
    (payload: { variant: 'success' | 'danger' | 'info' | 'warning'; message: string }) => {
      if (onNotify) {
        onNotify(payload);
      } else {
        console.log(`[users:${payload.variant}]`, payload.message);
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
  const [trainerFixedOnly, setTrainerFixedOnly] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    setPage(1);
  }, [includeTrainers, statusFilter, tableFilter, trainerFixedOnly]);

  useEffect(() => {
    if (trainerFixedOnly && !includeTrainers) {
      setIncludeTrainers(true);
    }
  }, [includeTrainers, trainerFixedOnly]);

  const usersQuery = useQuery<UsersListResponse>({
    queryKey: ['users', page, searchTerm, includeTrainers, statusFilter, trainerFixedOnly],
    queryFn: () =>
      fetchUsers({
        page,
        pageSize: PAGE_SIZE,
        search: searchTerm || undefined,
        includeTrainers,
        status: statusFilter === 'all' ? undefined : statusFilter,
        trainerFixedOnly: trainerFixedOnly || undefined,
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

  const handleToggleIncludeTrainers = useCallback(() => {
    setIncludeTrainers((previous) => {
      const nextValue = !previous;
      if (!nextValue && trainerFixedOnly) {
        setTrainerFixedOnly(false);
      }
      return nextValue;
    });
  }, [trainerFixedOnly]);

  const handleToggleTrainerFixedOnly = useCallback(() => {
    setTrainerFixedOnly((previous) => !previous);
    setIncludeTrainers(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingUser(null);
  }, []);

  const createMutation = useMutation({
    mutationFn: (payload: CreateUserPayload) => createUser(payload),
    onSuccess: () => {
      notify({ variant: 'success', message: 'Usuario creado correctamente' });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      closeModal();
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      const message = apiError?.message ?? 'No se pudo crear el usuario.';
      notify({ variant: 'danger', message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserPayload }) => updateUser(id, payload),
    onSuccess: (user) => {
      notify({ variant: 'success', message: 'Usuario actualizado correctamente' });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.setQueryData(['user-details', user.id], user);
      setEditingUser(user);
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      const message = apiError?.message ?? 'No se pudo actualizar el usuario.';
      notify({ variant: 'danger', message });
    },
  });

  const handleModalSubmit = useCallback(
    async (values: UserFormValues) => {
      const normalizedPayload = {
        ...values,
        bankAccount: values.bankAccount.trim(),
        address: values.address.trim(),
        position: values.position.trim(),
        startDate: values.startDate.trim(),
      };
      const payrollPayload = buildPayrollPayload(values.payroll);
      if (editingUser) {
        return updateMutation.mutateAsync({
          id: editingUser.id,
          payload: {
            ...normalizedPayload,
            bankAccount: normalizedPayload.bankAccount || null,
            address: normalizedPayload.address || null,
            position: normalizedPayload.position || null,
            startDate: normalizedPayload.startDate || null,
            payroll: payrollPayload,
          },
        });
      } else {
        return createMutation.mutateAsync({
          ...normalizedPayload,
          bankAccount: normalizedPayload.bankAccount || null,
          address: normalizedPayload.address || null,
          position: normalizedPayload.position || null,
          startDate: normalizedPayload.startDate || null,
          payroll: payrollPayload,
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

      if (trainerFixedOnly) {
        if (user.role !== 'Formador') {
          return false;
        }

        if (!user.trainerFixedContract) {
          return false;
        }
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
  }, [includeTrainers, statusFilter, tableFilter, trainerFixedOnly, users]);

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
                      onClick={handleToggleIncludeTrainers}
                    >
                      {includeTrainers ? 'Ocultar formadores' : 'Mostrar Formadores'}
                    </Button>
                    <Button
                      variant={trainerFixedOnly ? 'primary' : 'outline-secondary'}
                      onClick={handleToggleTrainerFixedOnly}
                    >
                      Formadores fijos
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
  onSubmit: (values: UserFormValues) => Promise<UserSummary>;
  isSubmitting: boolean;
  initialValue: UserSummary | null;
};


function UserFormModal({ show, onHide, onSubmit, isSubmitting, initialValue }: UserFormModalProps) {
  const queryClient = useQueryClient();
  const userId = initialValue?.id ?? null;

  const buildFormValuesFromUser = useCallback(
    (user?: UserSummary | null): UserFormValues => ({
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      email: user?.email ?? '',
      role: user?.role ?? ROLE_OPTIONS[0],
      active: user?.active ?? true,
      bankAccount: user?.bankAccount ?? '',
      address: user?.address ?? '',
      position: user?.position ?? '',
      startDate: user?.startDate ? user.startDate.slice(0, 10) : '',
      payroll: mapPayrollToForm(user?.payroll ?? null),
    }),
    [],
  );

  const [values, setValues] = useState<UserFormValues>(() => buildFormValuesFromUser(initialValue));
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const userDetailsQuery = useQuery<UserSummary>({
    queryKey: ['user-details', userId],
    queryFn: async () => fetchUserById(userId as string),
    enabled: Boolean(userId && show),
  });

  const effectiveUser = userDetailsQuery.data ?? initialValue;

  useEffect(() => {
    setValues(buildFormValuesFromUser(effectiveUser));
    setSaveSuccess(null);
    setSaveError(null);
  }, [buildFormValuesFromUser, effectiveUser, show]);

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

  const handleChange = (field: keyof Omit<UserFormValues, 'payroll'>, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const applyPayrollCalculations = (payroll: PayrollFormValues) => {
    const salarioBrutoCalculado = calculateSalarioBruto(payroll.baseRetencion, payroll.horasSemana);
    const salarioBrutoTotal = parseLocaleNumber(payroll.salarioBrutoTotal);
    const retencionPorcentaje = parsePercentageInput(payroll.retencion ?? '');

    const aportacionExpression = payroll.aportacionSsIrpfDetalle || payroll.aportacionSsIrpf;
    const aportacionExpressionIncludesRetention = /retenci[oó]n/i.test(aportacionExpression);
    const aportacionPorcentaje = parseSumExpression(aportacionExpression, (value) => {
      if (/retenci[oó]n/i.test(value)) return retencionPorcentaje ?? 0;
      return parsePercentageInput(value);
    });

    const totalAportacionPorcentaje =
      aportacionPorcentaje === null
        ? null
        : aportacionPorcentaje + (aportacionExpressionIncludesRetention ? 0 : retencionPorcentaje ?? 0);

    const aporteCalculado =
      salarioBrutoTotal !== null && totalAportacionPorcentaje !== null
        ? -(salarioBrutoTotal * totalAportacionPorcentaje)
        : null;

    const contingenciasExpression = payroll.contingenciasComunesDetalle || payroll.contingenciasComunes;
    const contingenciasPorcentaje = parseSumExpression(contingenciasExpression, parsePercentageInput);
    const contingenciasCalculadas =
      salarioBrutoTotal !== null && contingenciasPorcentaje !== null
        ? salarioBrutoTotal * contingenciasPorcentaje
        : null;

    const contingenciasComunesNumero =
      contingenciasCalculadas !== null ? contingenciasCalculadas : parseLocaleNumber(payroll.contingenciasComunes);
    const totalEmpresaCalculado =
      salarioBrutoTotal !== null && contingenciasComunesNumero !== null
        ? salarioBrutoTotal + contingenciasComunesNumero
        : null;

    const salarioLimpioCalculado =
      salarioBrutoTotal !== null && aporteCalculado !== null ? salarioBrutoTotal + aporteCalculado : null;

    return {
      ...payroll,
      salarioBruto: salarioBrutoCalculado !== null ? salarioBrutoCalculado.toFixed(2) : payroll.salarioBruto,
      aportacionSsIrpf: aporteCalculado !== null ? aporteCalculado.toFixed(2) : payroll.aportacionSsIrpf,
      salarioLimpio: salarioLimpioCalculado !== null ? salarioLimpioCalculado.toFixed(2) : payroll.salarioLimpio,
      contingenciasComunes:
        contingenciasCalculadas !== null ? contingenciasCalculadas.toFixed(2) : payroll.contingenciasComunes,
      totalEmpresa: totalEmpresaCalculado !== null ? totalEmpresaCalculado.toFixed(2) : payroll.totalEmpresa,
    };
  };

  const handlePayrollChange = (field: keyof PayrollFormValues, value: string) => {
    setValues((prev) => ({
      ...prev,
      payroll: applyPayrollCalculations({ ...prev.payroll, [field]: value }),
    }));
  };

  const formatPayrollValue = (value: string) => {
    if (!value.trim()) return '';
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return value;
    return parsed.toFixed(2);
  };

  const handlePayrollBlur = (field: keyof PayrollFormValues, value: string) => {
    setValues((prev) => ({
      ...prev,
      payroll: applyPayrollCalculations({ ...prev.payroll, [field]: formatPayrollValue(value) }),
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveSuccess(null);
    setSaveError(null);
    try {
      await onSubmit(values);
      setSaveSuccess('Cambios guardados correctamente.');
    } catch (error: unknown) {
      const apiError = error instanceof ApiError ? error : null;
      setSaveError(apiError?.message ?? 'No se pudieron guardar los cambios.');
    }
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
  const headerName = values.firstName || values.lastName ? `${values.firstName} ${values.lastName}`.trim() : title;
  const isLoadingDetails = userDetailsQuery.isFetching && !userDetailsQuery.data;
  const disableForm = isSubmitting || isLoadingDetails;

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
    <Modal show={show} onHide={onHide} backdrop="static" centered scrollable size="xl">
      <Form onSubmit={handleSubmit} className="h-100">
        <Modal.Header closeButton className="position-sticky top-0 bg-white z-3 border-bottom">
          <div className="w-100 d-grid gap-2">
            <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
              <div>
                <div className="h4 mb-0">{headerName}</div>
                <div className="text-muted">{values.email || effectiveUser?.email || ''}</div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <Button variant="outline-secondary" onClick={onHide} disabled={isSubmitting}>
                  Cerrar
                </Button>
                <Button type="submit" disabled={disableForm} className="d-flex align-items-center gap-2">
                  {isSubmitting ? <Spinner size="sm" animation="border" /> : null}
                  Guardar cambios
                </Button>
              </div>
            </div>
            <div className="text-muted small">
              {isLoadingDetails ? 'Cargando detalles del usuario…' : 'Todos los campos son editables desde este panel.'}
            </div>
          </div>
        </Modal.Header>
        <Modal.Body className="user-form-modal-body d-grid gap-4">
          {saveSuccess ? <Alert variant="success" className="mb-0">{saveSuccess}</Alert> : null}
          {saveError ? <Alert variant="danger" className="mb-0">{saveError}</Alert> : null}

          <div className="d-grid gap-3">
            <h5 className="mb-0">Datos básicos</h5>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="user-first-name">
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control
                    type="text"
                    value={values.firstName}
                    onChange={(event) => handleChange('firstName', event.target.value)}
                    required
                    disabled={disableForm}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="user-last-name">
                  <Form.Label>Apellido</Form.Label>
                  <Form.Control
                    type="text"
                    value={values.lastName}
                    onChange={(event) => handleChange('lastName', event.target.value)}
                    required
                    disabled={disableForm}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="user-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={values.email}
                    onChange={(event) => handleChange('email', event.target.value)}
                    required
                    disabled={disableForm}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="user-role">
                  <Form.Label>Rol</Form.Label>
                  <Form.Select
                    value={values.role}
                    onChange={(event) => handleChange('role', event.target.value)}
                    disabled={disableForm}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="user-bank-account">
                  <Form.Label>Cuenta bancaria</Form.Label>
                  <Form.Control
                    type="text"
                    value={values.bankAccount}
                    onChange={(event) => handleChange('bankAccount', event.target.value)}
                    disabled={disableForm}
                    placeholder="IBAN o número de cuenta"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="user-address">
                  <Form.Label>Dirección</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    value={values.address}
                    onChange={(event) => handleChange('address', event.target.value)}
                    disabled={disableForm}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="user-position">
                  <Form.Label>Posición</Form.Label>
                  <Form.Control
                    type="text"
                    value={values.position}
                    onChange={(event) => handleChange('position', event.target.value)}
                    disabled={disableForm}
                    placeholder="Ejemplo: Responsable de logística"
                  />
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group controlId="user-start-date">
                  <Form.Label>Fecha Alta</Form.Label>
                  <Form.Control
                    type="date"
                    value={values.startDate}
                    onChange={(event) => handleChange('startDate', event.target.value)}
                    disabled={disableForm}
                  />
                </Form.Group>
              </Col>
              <Col md={3} className="d-flex align-items-center">
                <Form.Check
                  type="switch"
                  id="user-active"
                  label="Activo"
                  checked={values.active}
                  onChange={(event) => handleChange('active', event.target.checked)}
                  disabled={disableForm}
                />
              </Col>
            </Row>
          </div>

          <div className="d-grid gap-3">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h5 className="mb-0">Datos nómina</h5>
              {isLoadingDetails ? <span className="text-muted small">Cargando datos…</span> : null}
            </div>
            <div className="border rounded p-3 d-grid gap-3">
              <div>
                <div className="text-uppercase text-muted small mb-2">Datos base</div>
                <Row className="g-3">
                  <Col md={6}>
                    <Form.Group controlId="payroll-convenio">
                      <Form.Label>Convenio</Form.Label>
                      <Form.Control
                        type="text"
                        value={values.payroll.convenio}
                        onChange={(event) => handlePayrollChange('convenio', event.target.value)}
                        disabled={disableForm}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group controlId="payroll-categoria">
                      <Form.Label>Categoría</Form.Label>
                      <Form.Control
                        type="text"
                        value={values.payroll.categoria}
                        onChange={(event) => handlePayrollChange('categoria', event.target.value)}
                        disabled={disableForm}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-antiguedad">
                      <Form.Label>Antigüedad</Form.Label>
                      <Form.Control
                        type="date"
                        value={values.payroll.antiguedad}
                        onChange={(event) => handlePayrollChange('antiguedad', event.target.value)}
                        disabled={disableForm}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-horas">
                      <Form.Label>Horas semana</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.horasSemana}
                        onChange={(event) => handlePayrollChange('horasSemana', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('horasSemana', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-base-retencion">
                      <Form.Label>Base de retención</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.baseRetencion}
                        onChange={(event) => handlePayrollChange('baseRetencion', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('baseRetencion', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-salario-bruto">
                      <Form.Label>Salario bruto</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.salarioBruto}
                        onChange={(event) => handlePayrollChange('salarioBruto', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('salarioBruto', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                </Row>
              </div>

              <div>
                <div className="text-uppercase text-muted small mb-2">Resultados</div>
                <Row className="g-3">
                  <Col md={4}>
                    <Form.Group controlId="payroll-salario-bruto-total">
                      <Form.Label>Salario bruto total</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.salarioBrutoTotal}
                        onChange={(event) => handlePayrollChange('salarioBrutoTotal', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('salarioBrutoTotal', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-retencion">
                      <Form.Label>Retención</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.retencion}
                        onChange={(event) => handlePayrollChange('retencion', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('retencion', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-aportacion-detalle">
                      <Form.Label>Detalle aportación SS e IRPF</Form.Label>
                      <Form.Control
                        type="text"
                        value={values.payroll.aportacionSsIrpfDetalle}
                        onChange={(event) => handlePayrollChange('aportacionSsIrpfDetalle', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('aportacionSsIrpfDetalle', event.target.value)}
                        disabled={disableForm}
                        placeholder="4,8%+1,65%"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-aportacion">
                      <Form.Label>Aportación SS e IRPF</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.aportacionSsIrpf}
                        onChange={(event) => handlePayrollChange('aportacionSsIrpf', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('aportacionSsIrpf', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-salario-limpio">
                      <Form.Label>Salario limpio</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.salarioLimpio}
                        onChange={(event) => handlePayrollChange('salarioLimpio', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('salarioLimpio', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-contingencias-detalle">
                      <Form.Label>Detalle contingencias comunes</Form.Label>
                      <Form.Control
                        type="text"
                        value={values.payroll.contingenciasComunesDetalle}
                        onChange={(event) => handlePayrollChange('contingenciasComunesDetalle', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('contingenciasComunesDetalle', event.target.value)}
                        disabled={disableForm}
                        placeholder="4,8%+1,65%"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-contingencias">
                      <Form.Label>Contingencias comunes</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.contingenciasComunes}
                        onChange={(event) => handlePayrollChange('contingenciasComunes', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('contingenciasComunes', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group controlId="payroll-total-empresa">
                      <Form.Label>Total empresa</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.01"
                        value={values.payroll.totalEmpresa}
                        onChange={(event) => handlePayrollChange('totalEmpresa', event.target.value)}
                        onBlur={(event) => handlePayrollBlur('totalEmpresa', event.target.value)}
                        disabled={disableForm}
                        inputMode="decimal"
                      />
                    </Form.Group>
                  </Col>
                </Row>
              </div>
            </div>
          </div>

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
      </Form>
    </Modal>
  );
}

export type VacationManagerModalProps = {
  show: boolean;
  user: UserSummary | null;
  year: number;
  onHide: () => void;
  onNotify?: UsersPageProps['onNotify'];
};

const VACATION_TYPE_INFO: Record<VacationType, { label: string; fullLabel: string }> = {
  V: { label: 'Vacaciones', fullLabel: 'Vacaciones' },
  L: { label: 'Festivo local', fullLabel: 'Festivo local' },
  A: { label: 'Día aniversario', fullLabel: 'Día aniversario' },
  T: { label: 'Teletrabajo', fullLabel: 'Teletrabajo' },
  M: { label: 'Matrimonio', fullLabel: 'Matrimonio o registro de pareja de hecho' },
  H: {
    label: 'Accidente',
    fullLabel: 'Accidente, enfermedad, hospitalización o intervención de un familiar',
  },
  F: { label: 'Fallecimiento', fullLabel: 'Fallecimiento de un familiar' },
  R: { label: 'Traslado', fullLabel: 'Traslado del domicilio habitual' },
  P: { label: 'Exámenes', fullLabel: 'Exámenes prenatales' },
  I: { label: 'Incapacidad', fullLabel: 'Incapacidad temporal' },
  N: { label: 'Festivos nacionales', fullLabel: 'Festivos nacionales' },
  C: { label: 'Fiesta autonómica', fullLabel: 'Fiesta autonómica' },
  Y: { label: 'Año anterior', fullLabel: 'Vacaciones año anterior' },
};

const VACATION_TYPE_LABELS: Record<VacationType, string> = Object.fromEntries(
  Object.entries(VACATION_TYPE_INFO).map(([key, info]) => [key, info.label]),
) as Record<VacationType, string>;

const VACATION_TYPE_COLORS: Record<VacationType, string> = {
  V: '#2563eb',
  L: '#65a30d',
  A: '#e11d48',
  T: '#7c3aed',
  M: '#f97316',
  H: '#ef4444',
  F: '#0ea5e9',
  R: '#0f766e',
  P: '#a855f7',
  I: '#475569',
  N: '#facc15',
  C: '#14b8a6',
  Y: '#0891b2',
};

const HOLIDAY_TYPES: VacationType[] = ['L', 'N', 'C'];

const DEFAULT_VACATION_ALLOWANCE = 24;
const DEFAULT_ANNIVERSARY_ALLOWANCE = 1;
const DEFAULT_LOCAL_HOLIDAY_ALLOWANCE = 2;
const DEFAULT_PREVIOUS_YEAR_ALLOWANCE = 0;
type AllowanceFieldKey = 'allowance' | 'anniversaryAllowance' | 'localHolidayAllowance' | 'previousYearAllowance';

export function VacationManagerModal({ show, user, year, onHide, onNotify }: VacationManagerModalProps) {
  const queryClient = useQueryClient();
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<VacationType | ''>('');
  const [allowances, setAllowances] = useState<{
    allowance: number | '';
    anniversaryAllowance: number | '';
    localHolidayAllowance: number | '';
    previousYearAllowance: number | '';
    remaining: number | '';
  }>({
    allowance: DEFAULT_VACATION_ALLOWANCE,
    anniversaryAllowance: DEFAULT_ANNIVERSARY_ALLOWANCE,
    localHolidayAllowance: DEFAULT_LOCAL_HOLIDAY_ALLOWANCE,
    previousYearAllowance: DEFAULT_PREVIOUS_YEAR_ALLOWANCE,
    remaining:
      DEFAULT_VACATION_ALLOWANCE +
      DEFAULT_ANNIVERSARY_ALLOWANCE +
      DEFAULT_PREVIOUS_YEAR_ALLOWANCE,
  });
  const normalizeNumber = (value: number | '') => (typeof value === 'number' ? value : 0);
  const computeRemaining = useCallback(
    (state: typeof allowances, enjoyedValue: number) =>
      Math.max(
        0,
        normalizeNumber(state.allowance) +
          normalizeNumber(state.anniversaryAllowance) +
          normalizeNumber(state.previousYearAllowance) -
          enjoyedValue,
      ),
    [],
  );

  const userId = user?.id ?? null;
  const trainerId = user?.trainerId ?? null;

  const vacationsQuery = useQuery<UserVacationsResponse>({
    queryKey: ['user-vacations', userId, year],
    queryFn: () => fetchUserVacations(userId as string, year),
    enabled: Boolean(show && userId),
  });

  const userDocumentsQuery = useQuery<UserDocument[]>({
    queryKey: ['vacation-user-documents', userId],
    queryFn: () => fetchUserDocuments(userId as string),
    enabled: Boolean(show && userId && !trainerId),
  });

  const trainerDocumentsQuery = useQuery<{ documents: TrainerDocument[] }>({
    queryKey: ['trainer-documents', trainerId],
    queryFn: async () => {
      if (!trainerId) return { documents: [] };
      return fetchTrainerDocuments(trainerId);
    },
    enabled: Boolean(show && trainerId),
  });

  useEffect(() => {
    setSelectionStart(null);
    setSelectionEnd(null);
    setSelectedType('');
    const allowanceValue = vacationsQuery.data?.allowance ?? DEFAULT_VACATION_ALLOWANCE;
    const anniversaryValue = vacationsQuery.data?.anniversaryAllowance ?? DEFAULT_ANNIVERSARY_ALLOWANCE;
    const localHolidayValue = vacationsQuery.data?.localHolidayAllowance ?? DEFAULT_LOCAL_HOLIDAY_ALLOWANCE;
    const previousYearValue = vacationsQuery.data?.previousYearAllowance ?? DEFAULT_PREVIOUS_YEAR_ALLOWANCE;
    const enjoyedValue = vacationsQuery.data?.enjoyed ?? 0;
    const remainingValue =
      vacationsQuery.data?.remaining ??
      computeRemaining(
        {
          allowance: allowanceValue,
          anniversaryAllowance: anniversaryValue,
          localHolidayAllowance: localHolidayValue,
          previousYearAllowance: previousYearValue,
          remaining: 0,
        },
        enjoyedValue,
      );

    setAllowances({
      allowance: allowanceValue,
      anniversaryAllowance: anniversaryValue,
      localHolidayAllowance: localHolidayValue,
      previousYearAllowance: previousYearValue,
      remaining: remainingValue,
    });
  }, [computeRemaining, vacationsQuery.data, userId]);

  useEffect(() => {
    if (!show) {
      setSelectionStart(null);
      setSelectionEnd(null);
      setSelectedType('');
    }
  }, [show]);

  const dayMutation = useMutation({
    mutationFn: (payload: { date: string; type: VacationType | '' }) =>
      saveUserVacationDay({ ...payload, userId: userId as string }),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-vacations', userId, year], data);
      onNotify?.({ variant: 'success', message: 'Vacaciones actualizadas' });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      onNotify?.({ variant: 'danger', message: apiError?.message ?? 'No se pudo guardar el día.' });
    },
  });

  const allowanceMutation = useMutation({
    mutationFn: () =>
      updateVacationAllowance({
        userId: userId as string,
        year,
        allowance: normalizeNumber(allowances.allowance),
        anniversaryAllowance: normalizeNumber(allowances.anniversaryAllowance),
        localHolidayAllowance: normalizeNumber(allowances.localHolidayAllowance),
        previousYearAllowance: normalizeNumber(allowances.previousYearAllowance),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-vacations', userId, year], data);
      setAllowances({
        allowance: data.allowance,
        anniversaryAllowance: data.anniversaryAllowance,
        localHolidayAllowance: data.localHolidayAllowance,
        previousYearAllowance: data.previousYearAllowance,
        remaining: data.remaining,
      });
      onNotify?.({ variant: 'success', message: 'Balance actualizado' });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      onNotify?.({ variant: 'danger', message: apiError?.message ?? 'No se pudo actualizar el balance.' });
    },
  });

  const data = vacationsQuery.data;
  const counts: Record<VacationType, number> =
    data?.counts ?? { V: 0, L: 0, A: 0, T: 0, M: 0, H: 0, F: 0, R: 0, P: 0, I: 0, N: 0, C: 0, Y: 0 };
  const enjoyed = data?.enjoyed ?? 0;
  const remaining = allowances.remaining === '' ? computeRemaining(allowances, enjoyed) : allowances.remaining;
  const holidayDays = useMemo(() => {
    return new Set(
      (data?.days ?? [])
        .filter((day) => HOLIDAY_TYPES.includes(day.type))
        .map((day) => day.date),
    );
  }, [data?.days]);
  const selectedDates = useMemo(() => {
    if (!selectionStart) return [] as string[];

    const startDate = new Date(`${selectionStart}T00:00:00Z`);
    const endDate = new Date(`${(selectionEnd ?? selectionStart)}T00:00:00Z`);
    const from = startDate <= endDate ? startDate : endDate;
    const to = startDate <= endDate ? endDate : startDate;

    const dates: string[] = [];
    const current = new Date(from);
    while (current <= to) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }, [selectionEnd, selectionStart]);

  const workingSelectedDates = useMemo(
    () =>
      selectedDates.filter((date) => {
        const day = new Date(`${date}T00:00:00Z`).getUTCDay();
        const isWeekend = day === 0 || day === 6;
        return !isWeekend && !holidayDays.has(date);
      }),
    [holidayDays, selectedDates],
  );

  const resolveUserDocumentUrl = (document: UserDocument) =>
    document.drive_web_view_link ?? document.drive_web_content_link ?? document.download_url;

  const formatFileSize = (size: number | null) => {
    if (!size) return '';
    const kb = size / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const justificationDocuments = useMemo(() => {
    const prefix = 'justificante -';
    const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';

    if (trainerId) {
      return (trainerDocumentsQuery.data?.documents ?? [])
        .filter((doc) => normalize(doc.file_name ?? doc.original_file_name).startsWith(prefix))
        .map((doc) => ({
          id: doc.id,
          name: doc.file_name ?? doc.original_file_name ?? doc.id,
          url: doc.drive_web_view_link ?? null,
          size: doc.file_size ?? null,
        }));
    }

    return (userDocumentsQuery.data ?? [])
      .filter((doc) => normalize(doc.file_name).startsWith(prefix))
      .map((doc) => ({
        id: doc.id,
        name: doc.file_name,
        url: resolveUserDocumentUrl(doc),
        size: doc.file_size,
      }));
  }, [trainerDocumentsQuery.data?.documents, trainerId, userDocumentsQuery.data]);

  const justificationDocumentsLoading = trainerId
    ? trainerDocumentsQuery.isLoading
    : userDocumentsQuery.isLoading;

  const justificationErrorMessage = trainerId
    ? trainerDocumentsQuery.isError
      ? (trainerDocumentsQuery.error as Error | undefined)?.message ?? 'No se pudieron cargar los documentos.'
      : null
    : userDocumentsQuery.isError
      ? (userDocumentsQuery.error as Error | undefined)?.message ?? 'No se pudieron cargar los documentos.'
      : null;

  const handleDayClick = (date: string, type: VacationType | '') => {
    if (!selectionStart || selectionEnd) {
      setSelectionStart(date);
      setSelectionEnd(null);
    } else if (date < selectionStart) {
      setSelectionStart(date);
      setSelectionEnd(selectionStart);
    } else {
      setSelectionEnd(date);
    }

    setSelectedType(type || '');
  };

  const handleSaveDays = async () => {
    if (!selectedDates.length || !userId) return;

    if (!selectedType) {
      onNotify?.({ variant: 'warning', message: 'Selecciona una categoría antes de guardar.' });
      return;
    }

    if (!workingSelectedDates.length) {
      onNotify?.({ variant: 'warning', message: 'Solo puedes guardar días laborables.' });
      return;
    }

    for (const date of workingSelectedDates) {
      await dayMutation.mutateAsync({ date, type: selectedType });
    }

    if (workingSelectedDates.length < selectedDates.length) {
      onNotify?.({
        variant: 'info',
        message: 'Los fines de semana y los festivos se han excluido automáticamente.',
      });
    }
  };

  const handleClearDays = async () => {
    if (!selectedDates.length || !userId) return;
    for (const date of selectedDates) {
      await dayMutation.mutateAsync({ date, type: '' });
    }
    setSelectedType('');
  };

  const handleAllowanceChange = (field: AllowanceFieldKey, value: string) => {
    const parsed = value === '' ? '' : Math.max(0, Number(value));
    const enjoyedValue = vacationsQuery.data?.enjoyed ?? 0;
    const nextState = { ...allowances, [field]: parsed } as typeof allowances;
    const remainingValue = computeRemaining(nextState, enjoyedValue);
    setAllowances({ ...nextState, remaining: remainingValue });
  };

  const handleRemainingChange = (value: string) => {
    const parsed = value === '' ? '' : Math.max(0, Number(value));
    if (parsed === '') {
      setAllowances({ ...allowances, remaining: '' });
      return;
    }

    const enjoyedValue = vacationsQuery.data?.enjoyed ?? 0;
    const extraAllowances =
      normalizeNumber(allowances.anniversaryAllowance) +
      normalizeNumber(allowances.previousYearAllowance);
    const updatedAllowance = Math.max(0, parsed + enjoyedValue - extraAllowances);

    setAllowances({ ...allowances, allowance: updatedAllowance, remaining: parsed });
  };

  const handleAllowanceSave = async () => {
    if (!userId) return;
    await allowanceMutation.mutateAsync();
  };

  const compactAllowanceCards: Array<{
    key: AllowanceFieldKey | 'allowance';
    label: string;
    value: number | '';
  }> = [
    {
      key: 'allowance',
      label: 'Vacaciones',
      value: allowances.allowance,
    },
    {
      key: 'anniversaryAllowance',
      label: 'Aniversario',
      value: allowances.anniversaryAllowance,
    },
    {
      key: 'previousYearAllowance',
      label: 'Año anterior',
      value: allowances.previousYearAllowance,
    },
  ];

  const highlightAllowanceCards: Array<{
    key: string;
    label: string;
    value: number | '';
    readOnly?: boolean;
    isRemaining?: boolean;
  }> = [
    {
      key: 'enjoyed',
      label: 'Disfrutadas',
      value: enjoyed,
      readOnly: true,
    },
    {
      key: 'remaining',
      label: 'Restantes',
      value: remaining,
      isRemaining: true,
    },
  ];

  return (
    <Modal show={show && Boolean(user)} onHide={onHide} size="xl" centered className="vacations-modal">
      <Modal.Header closeButton>
        <Modal.Title>
          Vacaciones · {user ? `${user.firstName} ${user.lastName}` : ''}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="vacations-modal-body d-grid gap-3">
        <div className="d-flex flex-column gap-3">
          <div className="vacation-allowance-layout">
            <div className="vacation-allowance-column vacation-allowance-column--compact">
              {compactAllowanceCards.map((item) => (
                <div key={item.key} className="vacation-allowance-card">
                  <div className="text-muted text-uppercase vacation-allowance-label">{item.label}</div>
                  <Form.Control
                    type="number"
                    min={0}
                    value={item.value}
                    size="sm"
                    className="vacation-allowance-value"
                    onChange={(event) => handleAllowanceChange(item.key as AllowanceFieldKey, event.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="vacation-allowance-column vacation-allowance-column--highlight">
              {highlightAllowanceCards.map((item) => (
                <div key={item.key} className="vacation-allowance-card">
                  <div className="text-muted text-uppercase vacation-allowance-label">{item.label}</div>
                  {item.readOnly ? (
                    <div className="fw-semibold vacation-allowance-value">{item.value}</div>
                  ) : (
                    <Form.Control
                      type="number"
                      min={0}
                      value={item.value}
                      size="sm"
                      className="vacation-allowance-value"
                      onChange={(event) =>
                        item.isRemaining
                          ? handleRemainingChange(event.target.value)
                          : handleAllowanceChange(item.key as AllowanceFieldKey, event.target.value)
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="d-flex justify-content-end">
            <Button onClick={handleAllowanceSave} disabled={allowanceMutation.isPending || !userId}>
              {allowanceMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </div>

        <div className="d-flex flex-column flex-lg-row gap-3 align-items-lg-start">
          <div className="vacation-type-list">
            {Object.entries(VACATION_TYPE_INFO).map(([key, info]) => (
              <OverlayTrigger
                key={key}
                placement="top"
                overlay={<Tooltip id={`vacation-type-${key}`}>{info.fullLabel}</Tooltip>}
              >
                <div
                  className="vacation-type-card border rounded px-3 py-2 d-flex gap-2 align-items-center"
                  title={info.fullLabel}
                >
                  <span
                    className="d-inline-block"
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '999px',
                      backgroundColor: VACATION_TYPE_COLORS[key as VacationType],
                    }}
                  ></span>
                  <div>
                    <div className="text-muted text-uppercase vacation-type-label">{info.label}</div>
                    <div className="fw-semibold vacation-type-value">{counts[key as VacationType] ?? 0} días</div>
                  </div>
                </div>
              </OverlayTrigger>
            ))}
          </div>
        </div>

        {vacationsQuery.isError ? (
          <Alert variant="danger">No se pudieron cargar las vacaciones.</Alert>
        ) : null}

        {vacationsQuery.isLoading ? (
          <div className="d-flex align-items-center gap-2 text-muted">
            <Spinner size="sm" animation="border" />
            <span>Cargando calendario…</span>
          </div>
        ) : (
          <VacationCalendar
            year={year}
            days={data?.days ?? []}
            onDayClick={handleDayClick}
            selectedDates={selectedDates}
          />
        )}

        <div className="border rounded p-3 d-grid gap-3">
          <div className="d-flex flex-column flex-md-row align-items-md-center gap-2 justify-content-between">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <Form.Label className="mb-0">Rango seleccionado</Form.Label>
              <Form.Control
                value={
                  selectionStart
                    ? selectionEnd
                      ? `${selectionStart} – ${selectionEnd}`
                      : `${selectionStart} · selecciona el último día`
                    : 'Selecciona un día de inicio'
                }
                disabled
                style={{ maxWidth: '260px' }}
              />
              {selectedDates.length ? (
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <Badge bg="secondary" className="text-uppercase">
                    {workingSelectedDates.length}{' '}
                    {workingSelectedDates.length === 1 ? 'día laborable' : 'días laborables'}
                  </Badge>
                  {selectedDates.length !== workingSelectedDates.length ? (
                    <Badge bg="light" text="dark" className="text-uppercase">
                      Excluye fines de semana y festivos
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <Form.Select
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value as VacationType | '')}
                style={{ minWidth: '240px' }}
              >
                <option value="">Sin categoria</option>
                {Object.entries(VACATION_TYPE_INFO).map(([value, info]) => (
                  <option key={value} value={value} title={info.fullLabel}>
                    {info.label}
                  </option>
                ))}
              </Form.Select>
              <Button onClick={handleSaveDays} disabled={!selectedDates.length || dayMutation.isPending}>
                {dayMutation.isPending ? 'Guardando…' : 'Guardar días'}
              </Button>
              <Button
                variant="outline-secondary"
                onClick={handleClearDays}
                disabled={!selectedDates.length || dayMutation.isPending}
              >
                Borrar
              </Button>
            </div>
          </div>
          <p className="text-muted mb-0">
            Todas las categorías salvo Teletrabajo descuentan días del balance de vacaciones disponible.
          </p>
        </div>

        <div className="border rounded p-3 d-grid gap-3">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div className="d-flex align-items-center gap-2">
              <h3 className="h6 mb-0">Justificantes relacionados</h3>
              {justificationDocumentsLoading ? (
                <div className="d-flex align-items-center gap-2 text-muted">
                  <Spinner size="sm" animation="border" />
                  <span>Cargando…</span>
                </div>
              ) : null}
            </div>
            <Badge bg="light" text="dark">
              {trainerId ? 'Formador' : 'Usuario'}
            </Badge>
          </div>

          {justificationErrorMessage ? <Alert variant="danger" className="mb-0">{justificationErrorMessage}</Alert> : null}

          {!justificationDocumentsLoading && !justificationErrorMessage ? (
            justificationDocuments.length ? (
              <ListGroup>
                {justificationDocuments.map((document) => (
                  <ListGroup.Item
                    key={document.id}
                    className="d-flex justify-content-between align-items-center gap-3 flex-wrap"
                  >
                    <div className="me-auto">
                      <div className="fw-semibold">{document.name}</div>
                      {document.size ? (
                        <div className="text-muted small">{formatFileSize(document.size)}</div>
                      ) : null}
                    </div>
                    {document.url ? (
                      <Button
                        as="a"
                        href={document.url}
                        target="_blank"
                        rel="noreferrer"
                        variant="outline-primary"
                        size="sm"
                      >
                        Ver
                      </Button>
                    ) : (
                      <span className="text-muted small">Enlace no disponible</span>
                    )}
                  </ListGroup.Item>
                ))}
              </ListGroup>
            ) : (
              <p className="text-muted mb-0">No hay justificantes disponibles.</p>
            )
          ) : null}
        </div>
      </Modal.Body>
    </Modal>
  );
}
