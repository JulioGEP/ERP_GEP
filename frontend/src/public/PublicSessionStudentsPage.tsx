import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Container,
  Form,
  Spinner,
  Table,
  Toast,
  ToastContainer,
} from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from "../api/client";
import type { PublicSessionInfo, SessionStudent } from "../api/sessions.types";
import {
  createPublicSessionStudent,
  deletePublicSessionStudent,
  fetchPublicSessionStudents,
  updatePublicSessionStudent,
} from "../features/presupuestos/api/students.api";
import gepLogo from "../assets/gep-group-logo.png";

const EMPTY_DRAFT = { nombre: '', apellido: '', dni: '' };

function extractTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has('token')) {
    const tokenParam = searchParams.get('token');
    if (tokenParam && tokenParam.trim().length) {
      return tokenParam.trim();
    }
  }
  const path = window.location.pathname;
  const match = path.match(/\/public\/sesiones\/([^/]+)\/alumnos/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return null;
}

function normalizeDniInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function validateDraft(draft: typeof EMPTY_DRAFT): string | null {
  const nombre = draft.nombre.trim();
  const apellido = draft.apellido.trim();
  const dni = normalizeDniInput(draft.dni);

  if (!nombre.length || !apellido.length || !dni.length) {
    return 'Nombre, apellidos y DNI son obligatorios';
  }

  if (dni.length < 7 || dni.length > 12 || !/^[A-Z0-9]+$/.test(dni)) {
    return 'El DNI debe tener entre 7 y 12 caracteres alfanuméricos';
  }

  return null;
}

function buildPageTitle(session: PublicSessionInfo | null): string {
  if (!session) return 'Captura de alumnos';
  const parts: string[] = [];
  if (session.deal_id) parts.push(session.deal_id);
  if (session.session_name) parts.push(session.session_name);
  if (session.formation_name) parts.push(session.formation_name);
  const title = parts.length ? parts.join(' — ') : 'Captura de alumnos';
  if (typeof document !== 'undefined') {
    document.title = `${title} | GEP Group`;
  }
  return title;
}

type ToastState = { id: string; variant: 'success' | 'danger' | 'info'; message: string };

export function PublicSessionStudentsPage() {
  const token = useMemo(() => extractTokenFromLocation(), []);
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const pushToast = (toast: Omit<ToastState, 'id'>) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { ...toast, id }]);
  };

  const removeToast = (id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const studentsQuery = useQuery({
    queryKey: ['public-session-students', token],
    queryFn: () => fetchPublicSessionStudents(token ?? ''),
    enabled: Boolean(token),
    staleTime: 0,
    retry: 1,
  });

  const sessionInfo: PublicSessionInfo | null = studentsQuery.data?.session ?? null;
  const students: SessionStudent[] = studentsQuery.data?.students ?? [];
  const title = buildPageTitle(sessionInfo);

  const createMutation = useMutation({
    mutationFn: createPublicSessionStudent,
  });

  const updateMutation = useMutation({
    mutationFn: (input: { studentId: string; data: { nombre?: string; apellido?: string; dni?: string } }) =>
      updatePublicSessionStudent(token ?? '', input.studentId, input.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (studentId: string) => deletePublicSessionStudent(token ?? '', studentId),
  });

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setEditingId(null);
  };

  const handleAdd = () => {
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setEditingId('new');
  };

  const handleEdit = (student: SessionStudent) => {
    setDraft({ nombre: student.nombre, apellido: student.apellido, dni: student.dni });
    setFormError(null);
    setEditingId(student.id);
  };

  const handleDraftChange = (field: keyof typeof EMPTY_DRAFT, value: string) => {
    setDraft((current) => {
      if (field === 'dni') {
        return { ...current, dni: normalizeDniInput(value) };
      }
      return { ...current, [field]: value } as typeof EMPTY_DRAFT;
    });
    if (formError) setFormError(null);
  };

  const handleCancel = () => {
    resetDraft();
  };

  const invalidateStudents = async () => {
    await qc.invalidateQueries({ queryKey: ['public-session-students', token] });
  };

  const handleSave = async () => {
    if (!token || !editingId) return;
    const validation = validateDraft(draft);
    if (validation) {
      setFormError(validation);
      return;
    }

    const normalizedDni = normalizeDniInput(draft.dni);
    const duplicate = students.find(
      (student) => student.dni.toUpperCase() === normalizedDni && student.id !== (editingId === 'new' ? null : editingId),
    );
    if (duplicate) {
      setFormError('Este DNI ya existe en esta sesión');
      return;
    }

    setSaving(true);
    try {
      if (editingId === 'new') {
        await createMutation.mutateAsync({
          token,
          nombre: draft.nombre.trim(),
          apellido: draft.apellido.trim(),
          dni: normalizedDni,
        });
        pushToast({ variant: 'success', message: 'Alumno añadido correctamente' });
      } else {
        await updateMutation.mutateAsync({
          studentId: editingId,
          data: {
            nombre: draft.nombre.trim(),
            apellido: draft.apellido.trim(),
            dni: normalizedDni,
          },
        });
        pushToast({ variant: 'success', message: 'Alumno actualizado correctamente' });
      }
      await invalidateStudents();
      resetDraft();
    } catch (error: unknown) {
      const message = error instanceof ApiError ? error.message : 'No se pudo guardar el alumno';
      setFormError(message);
      pushToast({ variant: 'danger', message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (student: SessionStudent) => {
    if (!token) return;
    if (!window.confirm(`¿Seguro que quieres eliminar a ${student.nombre} ${student.apellido}?`)) {
      return;
    }
    setDeletingId(student.id);
    setFormError(null);
    try {
      await deleteMutation.mutateAsync(student.id);
      pushToast({ variant: 'success', message: 'Alumno eliminado correctamente' });
      await invalidateStudents();
      if (editingId === student.id) {
        resetDraft();
      }
    } catch (error: unknown) {
      const message = error instanceof ApiError ? error.message : 'No se pudo eliminar el alumno';
      pushToast({ variant: 'danger', message });
    } finally {
      setDeletingId(null);
    }
  };

  const renderRow = (student: SessionStudent) => {
    const isDeleting = deletingId === student.id && deleteMutation.isPending;
    const isUpdating = updateMutation.isPending && editingId === student.id;
    return (
      <tr key={student.id}>
        <td className="align-middle">{student.nombre}</td>
        <td className="align-middle">{student.apellido}</td>
        <td className="align-middle text-uppercase">{student.dni}</td>
        <td className="align-middle text-end">
          <div className="d-flex justify-content-end gap-2">
            <Button
              size="sm"
              variant="outline-primary"
              onClick={() => handleEdit(student)}
              disabled={Boolean(editingId) || deleteMutation.isPending || isUpdating}
            >
              Editar
            </Button>
            <Button
              size="sm"
              variant="outline-danger"
              onClick={() => handleDelete(student)}
              disabled={isDeleting || deleteMutation.isPending || isUpdating}
            >
              {isDeleting ? <Spinner animation="border" size="sm" role="status" /> : 'Eliminar'}
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  const renderEditingRow = (key: string) => (
    <tr key={key}>
      <td className="align-middle">
        <Form.Control
          value={draft.nombre}
          onChange={(event) => handleDraftChange('nombre', event.target.value)}
          placeholder="Nombre"
          autoFocus
        />
      </td>
      <td className="align-middle">
        <Form.Control
          value={draft.apellido}
          onChange={(event) => handleDraftChange('apellido', event.target.value)}
          placeholder="Apellidos"
        />
      </td>
      <td className="align-middle">
        <Form.Control
          value={draft.dni}
          onChange={(event) => handleDraftChange('dni', event.target.value)}
          placeholder="DNI"
          inputMode="text"
        />
      </td>
      <td className="align-middle text-end">
        <div className="d-flex justify-content-end gap-2">
          <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" role="status" /> : 'Guardar'}
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={handleCancel} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </td>
    </tr>
  );

  const isLoading = studentsQuery.isLoading;
  const isFetching = studentsQuery.isFetching;
  const queryError = studentsQuery.error
    ? studentsQuery.error instanceof ApiError
      ? studentsQuery.error.message
      : 'No se pudo cargar la sesión'
    : null;

  const tokenMissing = !token;

  return (
    <div className="bg-light min-vh-100 py-5">
      <Container className="py-4" style={{ maxWidth: '960px' }}>
        <header className="mb-4">
          <div className="d-flex flex-column flex-md-row gap-3 align-items-md-center mb-3">
            <div className="d-flex align-items-center gap-3">
              <img src={gepLogo} alt="GEP Group" style={{ width: '64px', height: '64px' }} />
              <div>
                <div className="fw-bold">GEP Group</div>
                {sessionInfo?.organization_name ? (
                  <div className="text-muted small">Organización: {sessionInfo.organization_name}</div>
                ) : null}
              </div>
            </div>
            <div className="d-flex flex-column gap-1 text-muted small ms-md-auto text-md-end">
              {sessionInfo?.comercial ? (
                <span>
                  <strong>Comercial asignado:</strong> {sessionInfo.comercial}
                </span>
              ) : null}
              {sessionInfo?.session_address ? (
                <span>
                  <strong>Dirección de la sesión:</strong> {sessionInfo.session_address}
                </span>
              ) : null}
            </div>
          </div>
          <h1 className="h4 fw-bold mb-1">{title}</h1>
          <p className="text-muted mb-0">
            Añade los datos de los alumnos/as que asistirán a la sesión. Podrás modificar, eliminar o añadir hasta el
            mismo día y hora de la sesión, después ya no podrán añadir alumnos/as. Si vienen alumnos/as que no están
            apuntados a la formación, no recibirán los certificados.
          </p>
        </header>

        {tokenMissing ? (
          <Alert variant="danger">
            Enlace no válido. Contacta con tu persona de contacto para obtener una nueva URL.
          </Alert>
        ) : null}

        {!tokenMissing && queryError ? (
          <Alert variant="danger" className="mb-4">
            <div>{queryError}</div>
            <div className="mt-2">
              <Button size="sm" variant="outline-light" onClick={() => studentsQuery.refetch()}>
                Reintentar
              </Button>
            </div>
          </Alert>
        ) : null}

        {!tokenMissing && !queryError ? (
          <div className="d-flex flex-column gap-3">
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleAdd}
                disabled={Boolean(editingId) || createMutation.isPending || isLoading}
              >
                Agregar alumno
              </Button>
              {isLoading || isFetching ? (
                <span className="text-muted small">Actualizando información…</span>
              ) : null}
            </div>

            {formError ? <Alert variant="warning">{formError}</Alert> : null}

            {isLoading ? (
              <div className="d-flex align-items-center gap-2 text-muted small">
                <Spinner animation="border" size="sm" role="status" /> Cargando alumnos…
              </div>
            ) : null}

            <div className="table-responsive">
              <Table striped bordered hover size="sm">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Apellidos</th>
                    <th>DNI</th>
                    <th className="text-end">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {editingId === 'new' ? renderEditingRow('new-student') : null}
                  {students.map((student) =>
                    editingId === student.id ? renderEditingRow(student.id) : renderRow(student),
                  )}
                  {!students.length && editingId !== 'new' && !isLoading ? (
                    <tr>
                      <td colSpan={4} className="text-center text-muted py-4">
                        No hay alumnos añadidos todavía
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </Table>
            </div>
          </div>
        ) : null}
      </Container>

      <ToastContainer position="top-center" className="mt-4">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            bg={toast.variant}
            onClose={() => removeToast(toast.id)}
            show
            delay={4000}
            autohide
          >
            <Toast.Body className="text-white">{toast.message}</Toast.Body>
          </Toast>
        ))}
      </ToastContainer>
    </div>
  );
}
