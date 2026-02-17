import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Collapse,
  Col,
  Form,
  ListGroup,
  Modal,
  Pagination,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DealDetail, DealProduct } from '../../../../types/deal';
import {
  SessionDTO,
  SessionGroupDTO,
  generateSessionsFromDeal,
  fetchActiveTrainers,
  fetchDealSessions,
  fetchMobileUnitsCatalog,
  fetchRoomsCatalog,
  fetchSessionCounts,
  patchSession,
  createSession,
  deleteSession,
  fetchSessionComments,
  createSessionComment,
  updateSessionComment,
  deleteSessionComment,
  fetchSessionDocuments,
  uploadSessionDocuments,
  updateSessionDocumentShare,
  deleteSessionDocument,
  fetchSessionStudents,
  createSessionStudent,
  updateSessionStudent,
  deleteSessionStudent,
  fetchSessionPublicLink,
  createSessionPublicLink,
  deleteSessionPublicLink,
  type SessionPublicLink,
  SESSION_DOCUMENT_SIZE_LIMIT_BYTES,
  SESSION_DOCUMENT_SIZE_LIMIT_LABEL,
  SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE,
  patchDealEditable,
  fetchVariantSiblings,
  type TrainerOption,
  type RoomOption,
  type MobileUnitOption,
  type SessionEstado,
  type SessionComment,
  type SessionDocument,
  type SessionStudent,
  type SessionCounts,
  type VariantSiblingOption,
  type VariantSiblingsResponse,
} from '../../api';
import { isApiError } from '../../api';
import { buildFieldTooltip } from '../../../../utils/fieldTooltip';
import { formatSedeLabel } from '../../formatSedeLabel';
import { SESSION_CODE_PREFIXES, useApplicableDealProducts } from '../../shared/useApplicableDealProducts';
import {
  SESSION_DOCUMENTS_EVENT,
  type SessionDocumentsEventDetail,
} from '../../../../utils/sessionDocumentsEvents';
import { useCurrentUserIdentity } from '../../useCurrentUserIdentity';

const SESSION_LIMIT = 10;
const MADRID_TIMEZONE = 'Europe/Madrid';

const ENABLE_SESSION_DOCUMENTS = false;
const ENABLE_SESSION_COMMENTS = false;
const ENABLE_SESSION_STATE = false;
const ENABLE_TRAINERS = false;
const ENABLE_MOBILE_UNITS = false;
const ENABLE_ROOMS = false;
const ENABLE_ADDRESS = false;
const IN_COMPANY_ROOM_VALUE = '__IN_COMPANY__';

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

function normalizeDriveUrlValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

type DeleteDialogState = {
  sessionId: string;
  productId: string;
  sessionName: string;
  status: 'loading' | 'ready' | 'failed';
  counts: SessionCounts | null;
  error: string | null;
};

const SESSION_ESTADO_LABELS: Record<SessionEstado, string> = {
  BORRADOR: 'Borrador',
  PLANIFICADA: 'Planificada',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada',
  FINALIZADA: 'Finalizada',
};
const SESSION_ESTADO_VARIANTS: Record<SessionEstado, string> = {
  BORRADOR: 'secondary',
  PLANIFICADA: 'success',
  SUSPENDIDA: 'warning',
  CANCELADA: 'danger',
  FINALIZADA: 'primary',
};
const MANUAL_SESSION_ESTADOS: SessionEstado[] = ['BORRADOR', 'SUSPENDIDA', 'CANCELADA', 'FINALIZADA'];
const MANUAL_SESSION_ESTADO_SET = new Set<SessionEstado>(MANUAL_SESSION_ESTADOS);

function buildSessionDisplayName(rawName: string | null | undefined, displayIndex: number): string {
  if (typeof rawName === 'string') {
    const trimmed = rawName.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return `Sesión ${displayIndex}`;
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    if (error.code === 'PAYLOAD_TOO_LARGE' || error.status === 413) {
      return SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE;
    }
    const baseMessage = error.message?.trim().length ? error.message : fallback;
    const meta: string[] = [];
    if (error.code?.trim().length) {
      meta.push(`código: ${error.code}`);
    }
    if (typeof error.status === 'number') {
      meta.push(`estado: ${error.status}`);
    }
    return meta.length ? `${baseMessage} (${meta.join(', ')})` : baseMessage;
  }
  if (error instanceof Error) {
    const baseMessage = error.message?.trim().length ? error.message : fallback;
    return baseMessage;
  }
  return fallback;
}

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x={9} y={9} width={11} height={11} rx={2} ry={2} />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zm8.382-1 .5-.5H11V2z" />
    </svg>
  );
}

type StudentDraft = {
  nombre: string;
  apellido: string;
  dni: string;
  asistencia: boolean;
  apto: boolean;
  certificado: boolean;
};

const EMPTY_STUDENT_DRAFT: StudentDraft = {
  nombre: '',
  apellido: '',
  dni: '',
  asistencia: false,
  apto: false,
  certificado: false,
};

function normalizeStudentDniInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function validateStudentDraft(draft: StudentDraft): string | null {
  const nombre = draft.nombre.trim();
  const apellido = draft.apellido.trim();
  const dni = normalizeStudentDniInput(draft.dni);

  if (!nombre.length || !apellido.length || !dni.length) {
    return 'Nombre, apellidos y DNI son obligatorios';
  }

  if (dni.length < 7 || dni.length > 12 || !/^[A-Z0-9]+$/.test(dni)) {
    return 'El DNI debe tener entre 7 y 12 caracteres alfanuméricos';
  }

  return null;
}

export function SessionStudentsAccordionItem({
  dealId,
  sessionId,
  onNotify,
  eventKey,
  headerAddon,
  bodyPrefix,
  enablePublicLink = true,
}: {
  dealId: string;
  sessionId: string;
  onNotify?: (toast: ToastParams) => void;
  eventKey?: string;
  headerAddon?: ReactNode;
  bodyPrefix?: ReactNode;
  enablePublicLink?: boolean;
}) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<StudentDraft>(EMPTY_STUDENT_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<SessionStudent | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [generatedLinks, setGeneratedLinks] = useState<SessionPublicLink[]>([]);
  const [deletingLinkKey, setDeletingLinkKey] = useState<string | null>(null);

  const studentsQuery = useQuery({
    queryKey: ['session-students', dealId, sessionId],
    queryFn: () => fetchSessionStudents(dealId, sessionId),
    enabled: Boolean(dealId && sessionId),
    staleTime: 30_000,
  });

  const publicLinkQuery = useQuery({
    queryKey: ['session-public-link', dealId, sessionId],
    queryFn: () => fetchSessionPublicLink(dealId, sessionId),
    enabled: enablePublicLink && Boolean(dealId && sessionId),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  const createPublicLinkMutation = useMutation({
    mutationFn: (options?: { regenerate?: boolean }) =>
      createSessionPublicLink(dealId, sessionId, options),
    onSuccess: (link) => {
      qc.setQueryData(['session-public-link', dealId, sessionId], link);
    },
  });
  const deletePublicLinkMutation = useMutation({
    mutationFn: (link: SessionPublicLink) =>
      deleteSessionPublicLink(dealId, sessionId, { tokenId: link.id, token: link.token }),
    onSuccess: () => {
      qc.setQueryData(['session-public-link', dealId, sessionId], null);
      setGeneratedLinks([]);
      void qc.invalidateQueries({ queryKey: ['session-public-link', dealId, sessionId] });
    },
  });
  const resetPublicLinkMutation = createPublicLinkMutation.reset;

  useEffect(() => {
    setEditingId(null);
    setDraft(EMPTY_STUDENT_DRAFT);
    setFormError(null);
    setDuplicateTarget(null);
    setSaving(false);
    setUpdatingId(null);
    setDeletingId(null);
    if (enablePublicLink && typeof resetPublicLinkMutation === 'function') {
      resetPublicLinkMutation();
    }
    setGeneratedLinks([]);
    setDeletingLinkKey(null);
  }, [dealId, sessionId, resetPublicLinkMutation, enablePublicLink]);

  const students = studentsQuery.data ?? [];
  const studentsLoading = studentsQuery.isLoading;
  const studentsFetching = studentsQuery.isFetching;
  const queryError = studentsQuery.error
    ? studentsQuery.error instanceof Error
      ? studentsQuery.error.message
      : 'No se pudieron cargar los alumnos'
    : null;

  const studentCount = students.length;
  const editingStudentId = editingId && editingId !== 'new' ? editingId : null;
  const isNewRow = editingId === 'new';

  const publicLink = enablePublicLink ? publicLinkQuery.data ?? null : null;
  const publicLinkLoading = enablePublicLink ? publicLinkQuery.isLoading : false;
  const publicLinkFetching = enablePublicLink ? publicLinkQuery.isFetching : false;
  const publicLinkError = enablePublicLink
    ? publicLinkQuery.error
      ? publicLinkQuery.error instanceof Error
        ? publicLinkQuery.error.message
        : 'No se pudo cargar la URL pública'
      : null
    : null;
  const publicLinkGenerating = enablePublicLink && createPublicLinkMutation.isPending;

  useEffect(() => {
    if (!enablePublicLink) {
      setGeneratedLinks([]);
      return;
    }

    setGeneratedLinks((current) => {
      if (!publicLink) {
        return [];
      }

      const normalizedLink = { ...publicLink, active: true };
      const currentKey = `${normalizedLink.id}-${normalizedLink.token ?? ''}`;
      const existingIndex = current.findIndex(
        (item) => `${item.id}-${item.token ?? ''}` === currentKey,
      );

      if (existingIndex >= 0) {
        return current.map((item, index) =>
          index === existingIndex
            ? { ...normalizedLink }
            : { ...item, active: false },
        );
      }

      return [
        ...current.map((item) => ({ ...item, active: false })),
        normalizedLink,
      ];
    });
  }, [enablePublicLink, publicLink]);

  const resolvePublicLinkUrl = useCallback((link: SessionPublicLink | null) => {
    if (!link) return null;
    if (link.public_url && link.public_url.trim().length) {
      return link.public_url;
    }
    if (link.public_path && link.public_path.trim().length && typeof window !== 'undefined') {
      return `${window.location.origin}${link.public_path}`;
    }
    return link.public_path ?? null;
  }, []);

  const publicLinkCreatedAt = useMemo(() => {
    if (!enablePublicLink || !publicLink?.created_at) return null;
    try {
      const dt = new Date(publicLink.created_at);
      if (!Number.isFinite(dt.getTime())) return null;
      return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(dt);
    } catch {
      return null;
    }
  }, [enablePublicLink, publicLink?.created_at]);

  const handleOpenPublicLink = (target: string | null) => {
    if (!target || typeof window === 'undefined') return;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const handleGeneratePublicLink = async () => {
    if (!enablePublicLink || !dealId || !sessionId) return;

    try {
      const link = await createPublicLinkMutation.mutateAsync({ regenerate: true });
      const targetUrl = resolvePublicLinkUrl(link);

      if (!targetUrl) {
        onNotify?.({ variant: 'danger', message: 'No se pudo abrir la URL pública generada' });
        return;
      }

      handleOpenPublicLink(targetUrl);
      onNotify?.({ variant: 'success', message: 'URL pública generada correctamente' });
    } catch (error: any) {
      const message = isApiError(error)
        ? error.message
        : 'No se pudo generar la URL pública, inténtalo de nuevo';
      onNotify?.({ variant: 'danger', message });
    }
  };

  const handleCopyPublicLink = async (url: string | null) => {
    if (!enablePublicLink || !url || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(url);
      onNotify?.({ variant: 'success', message: 'URL de alumnos copiada al portapapeles' });
    } catch {
      onNotify?.({ variant: 'danger', message: 'No se pudo copiar la URL, copia manualmente' });
    }
  };

  const handleDeletePublicLink = async (link: SessionPublicLink, label: string) => {
    if (!enablePublicLink || !dealId || !sessionId) return;

    if (typeof window !== 'undefined') {
      const confirmMessage = `¿Seguro que quieres eliminar ${label}?`;
      if (!window.confirm(confirmMessage)) {
        return;
      }
    }

    const key = `${link.id}-${link.token ?? ''}`;
    setDeletingLinkKey(key);

    try {
      await deletePublicLinkMutation.mutateAsync(link);
      onNotify?.({ variant: 'success', message: `${label} eliminada correctamente` });
    } catch (error: unknown) {
      const message = isApiError(error)
        ? error.message
        : 'No se pudo eliminar la URL pública, inténtalo de nuevo';
      onNotify?.({ variant: 'danger', message });
    } finally {
      setDeletingLinkKey((current) => (current === key ? null : current));
    }
  };

  const resetDraft = () => {
    setDraft(EMPTY_STUDENT_DRAFT);
    setFormError(null);
    setDuplicateTarget(null);
  };

  const handleAdd = () => {
    resetDraft();
    setEditingId('new');
  };

  const handleEdit = (student: SessionStudent) => {
    setDraft({
      nombre: student.nombre,
      apellido: student.apellido,
      dni: student.dni,
      asistencia: student.asistencia,
      apto: student.apto,
      certificado: student.certificado,
    });
    setFormError(null);
    setDuplicateTarget(null);
    setEditingId(student.id);
  };

  const handleCancel = () => {
    setEditingId(null);
    resetDraft();
  };

  const handleDraftChange = (field: keyof StudentDraft, value: string | boolean) => {
    setDraft((current) => {
      if (field === 'dni' && typeof value === 'string') {
        return { ...current, dni: normalizeStudentDniInput(value) };
      }
      if (
        (field === 'apto' || field === 'certificado' || field === 'asistencia') &&
        typeof value === 'boolean'
      ) {
        return { ...current, [field]: value } as StudentDraft;
      }
      if (typeof value === 'string') {
        return { ...current, [field]: value } as StudentDraft;
      }
      return current;
    });
    if (formError) {
      setFormError(null);
      setDuplicateTarget(null);
    }
  };

  const handleSave = async () => {
    if (!dealId || !sessionId || !editingId) return;
    const validation = validateStudentDraft(draft);
    const normalizedDni = normalizeStudentDniInput(draft.dni);
    if (validation) {
      setFormError(validation);
      setDuplicateTarget(null);
      return;
    }

    const currentId = editingId === 'new' ? null : editingId;
    const duplicate = students.find(
      (student) => student.dni.toUpperCase() === normalizedDni && student.id !== currentId,
    );
    if (duplicate) {
      setFormError('Ya existe un alumno con este DNI en la sesión.');
      setDuplicateTarget(duplicate);
      return;
    }

    setSaving(true);
    setFormError(null);
    setDuplicateTarget(null);

    try {
      if (editingId === 'new') {
        await createMutation.mutateAsync({
          dealId,
          sessionId,
          nombre: draft.nombre.trim(),
          apellido: draft.apellido.trim(),
          dni: normalizedDni,
          asistencia: draft.asistencia,
          apto: draft.apto,
          certificado: draft.certificado,
        });
        onNotify?.({ variant: 'success', message: 'Alumno añadido correctamente' });
      } else {
        await updateMutation.mutateAsync({
          id: editingId,
          data: {
            nombre: draft.nombre.trim(),
            apellido: draft.apellido.trim(),
            dni: normalizedDni,
            apto: draft.apto,
            certificado: draft.certificado,
          },
        });
        onNotify?.({ variant: 'success', message: 'Alumno actualizado correctamente' });
      }
      await qc.invalidateQueries({ queryKey: ['session-students', dealId, sessionId] });
      handleCancel();
    } catch (error: unknown) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo guardar el alumno';
      setFormError(message);
      onNotify?.({ variant: 'danger', message });
    } finally {
      setSaving(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: createSessionStudent,
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; data: Parameters<typeof updateSessionStudent>[1] }) =>
      updateSessionStudent(input.id, input.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (studentId: string) => deleteSessionStudent(studentId),
  });

  const handleToggleBoolean = async (
    student: SessionStudent,
    field: 'asistencia' | 'apto' | 'certificado',
    value: boolean,
  ) => {
    setFormError(null);
    setDuplicateTarget(null);
    setUpdatingId(student.id);
    try {
      await updateMutation.mutateAsync({ id: student.id, data: { [field]: value } });
      await qc.invalidateQueries({ queryKey: ['session-students', dealId, sessionId] });
    } catch (error: unknown) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo actualizar el alumno';
      setFormError(message);
      onNotify?.({ variant: 'danger', message });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (student: SessionStudent) => {
    if (!window.confirm('¿Seguro que quieres eliminar a este alumno?')) {
      return;
    }
    setFormError(null);
    setDuplicateTarget(null);
    setDeletingId(student.id);
    try {
      await deleteMutation.mutateAsync(student.id);
      onNotify?.({ variant: 'success', message: 'Alumno eliminado correctamente' });
      if (editingStudentId === student.id) {
        handleCancel();
      }
      await qc.invalidateQueries({ queryKey: ['session-students', dealId, sessionId] });
    } catch (error: unknown) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo eliminar el alumno';
      setFormError(message);
      onNotify?.({ variant: 'danger', message });
    } finally {
      setDeletingId(null);
    }
  };

  const renderEditingRow = (key: string) => {
    const disableInputs = saving;
    const canSave = !validateStudentDraft(draft) && !saving;

    return (
      <tr key={key}>
        <td className="align-middle">
          <Form.Control
            type="text"
            value={draft.nombre}
            onChange={(event) => handleDraftChange('nombre', event.target.value)}
            placeholder="Nombre"
            disabled={disableInputs}
            title={buildFieldTooltip(draft.nombre)}
          />
        </td>
        <td className="align-middle">
          <Form.Control
            type="text"
            value={draft.apellido}
            onChange={(event) => handleDraftChange('apellido', event.target.value)}
            placeholder="Apellidos"
            disabled={disableInputs}
            title={buildFieldTooltip(draft.apellido)}
          />
        </td>
        <td className="align-middle">
          <Form.Control
            type="text"
            value={draft.dni}
            onChange={(event) => handleDraftChange('dni', event.target.value)}
            placeholder="DNI"
            disabled={disableInputs}
            title={buildFieldTooltip(draft.dni)}
          />
        </td>
        <td className="align-middle text-center">
          <Form.Check
            type="checkbox"
            label=""
            checked={draft.asistencia}
            onChange={(event) => handleDraftChange('asistencia', event.target.checked)}
            disabled={disableInputs}
            aria-label="Marcar asistencia"
          />
        </td>
        <td className="align-middle text-center">
          <Form.Check
            type="checkbox"
            label=""
            checked={draft.apto}
            onChange={(event) => handleDraftChange('apto', event.target.checked)}
            disabled={disableInputs}
            aria-label="Marcar alumno como apto"
          />
        </td>
        <td className="align-middle text-center">
          <Form.Check
            type="checkbox"
            label=""
            checked={draft.certificado}
            onChange={(event) => handleDraftChange('certificado', event.target.checked)}
            disabled={disableInputs}
            aria-label="Marcar alumno como certificado"
          />
        </td>
        <td className="align-middle text-nowrap">
          <div className="d-flex gap-2 justify-content-end">
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={handleCancel}
              disabled={disableInputs}
            >
              Cancelar
            </Button>
            <Button size="sm" variant="primary" onClick={handleSave} disabled={!canSave}>
              {saving ? <Spinner animation="border" size="sm" role="status" /> : 'Guardar'}
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  const renderStudentRow = (student: SessionStudent) => {
    const rowDisabled = Boolean(editingId && editingId !== student.id);
    const isUpdating = updatingId === student.id && updateMutation.isPending;
    const isDeleting = deletingId === student.id && deleteMutation.isPending;
    const driveUrl = typeof student.drive_url === 'string' ? student.drive_url.trim() : '';
    const nameContent = student.nombre;

    return (
      <tr key={student.id}>
        <td className="align-middle">
          {driveUrl ? (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir certificado en una nueva pestaña"
            >
              {nameContent}
            </a>
          ) : (
            nameContent
          )}
        </td>
        <td className="align-middle">{student.apellido}</td>
        <td className="align-middle text-uppercase">{student.dni}</td>
        <td className="align-middle text-center">
          <Form.Check
            type="checkbox"
            label=""
            checked={student.asistencia}
            disabled={rowDisabled || isUpdating || isDeleting}
            onChange={(event) => handleToggleBoolean(student, 'asistencia', event.target.checked)}
            aria-label={`Cambiar asistencia de ${student.nombre} ${student.apellido}`}
          />
        </td>
        <td className="align-middle text-center">
          <Form.Check
            type="checkbox"
            label=""
            checked={student.apto}
            disabled={rowDisabled || isUpdating || isDeleting}
            onChange={(event) => handleToggleBoolean(student, 'apto', event.target.checked)}
            aria-label={`Cambiar estado apto de ${student.nombre} ${student.apellido}`}
          />
        </td>
        <td className="align-middle text-center">
          <Form.Check
            type="checkbox"
            label=""
            checked={student.certificado}
            disabled={rowDisabled || isUpdating || isDeleting}
            onChange={(event) => handleToggleBoolean(student, 'certificado', event.target.checked)}
            aria-label={`Cambiar certificado de ${student.nombre} ${student.apellido}`}
          />
        </td>
        <td className="align-middle text-nowrap">
          <div className="d-flex gap-2 justify-content-end">
            <Button
              size="sm"
              variant="outline-primary"
              onClick={() => handleEdit(student)}
              disabled={Boolean(editingId)}
            >
              Editar
            </Button>
            <Button
              size="sm"
              variant="outline-danger"
              onClick={() => handleDelete(student)}
              disabled={rowDisabled || isDeleting || isUpdating}
            >
              {isDeleting ? <Spinner animation="border" size="sm" role="status" /> : 'Eliminar'}
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <Accordion.Item eventKey={eventKey ?? `session-students-${sessionId}`}>
      <Accordion.Header>
        <div className="d-flex justify-content-between align-items-center w-100 gap-3">
          <span className="erp-accordion-title">
            Alumnos
            {studentCount > 0 ? <span className="erp-accordion-count">{studentCount}</span> : null}
          </span>
          {headerAddon ? <div className="ms-auto">{headerAddon}</div> : null}
        </div>
      </Accordion.Header>
      <Accordion.Body>
        {bodyPrefix ? <div className="mb-3">{bodyPrefix}</div> : null}
        <div className="d-flex flex-column gap-3 mb-3">
          <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-2">
            <div className="d-flex flex-column flex-sm-row align-items-sm-center gap-2 flex-wrap">
              <Button
                variant="outline-primary"
                size="sm"
                onClick={handleAdd}
                disabled={isNewRow || Boolean(editingStudentId) || saving || studentsLoading}
              >
                Agregar alumno
              </Button>
              {enablePublicLink ? (
                <>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={handleGeneratePublicLink}
                    disabled={publicLinkGenerating || publicLinkLoading}
                    className="d-flex align-items-center gap-2"
                  >
                    {publicLinkGenerating ? (
                      <>
                        <Spinner animation="border" size="sm" role="status" />
                        <span>Generando URL…</span>
                      </>
                    ) : (
                      'Generar URL'
                    )}
                  </Button>
                  {generatedLinks.length ? (
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      {generatedLinks.map((link, index) => {
                        const url = resolvePublicLinkUrl(link);
                        const label = `URL #${index + 1}`;
                        const isActive = Boolean(link.active);
                        const deleteKey = `${link.id ?? ''}-${link.token ?? ''}`;
                        const isDeletingLink =
                          deletePublicLinkMutation.isPending && deletingLinkKey === deleteKey;
                        return (
                          <div
                            key={link.id || `${link.token}-${index}`}
                            className="d-flex align-items-center gap-1"
                          >
                            <Button
                              variant={isActive ? 'outline-primary' : 'outline-secondary'}
                              size="sm"
                              onClick={() => handleOpenPublicLink(url)}
                              disabled={!url}
                              title={url ?? undefined}
                            >
                              {label}
                            </Button>
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              className="d-flex align-items-center justify-content-center p-1"
                              onClick={() => handleCopyPublicLink(url)}
                              disabled={!url}
                              title={url ? `Copiar ${label}` : undefined}
                            >
                              <CopyIcon aria-hidden="true" width={16} height={16} />
                              <span className="visually-hidden">Copiar {label}</span>
                            </Button>
                            <Button
                              variant="outline-danger"
                              size="sm"
                              className="d-flex align-items-center justify-content-center p-1"
                              onClick={() => handleDeletePublicLink(link, label)}
                              disabled={deletePublicLinkMutation.isPending}
                              title={`Eliminar ${label}`}
                            >
                              {isDeletingLink ? (
                                <Spinner animation="border" size="sm" role="status" />
                              ) : (
                                <TrashIcon width={16} height={16} />
                              )}
                              <span className="visually-hidden">Eliminar {label}</span>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="d-flex flex-column flex-sm-row align-items-sm-center gap-2 text-muted small">
              {!studentsLoading && studentsFetching ? <span>Actualizando alumnos…</span> : null}
              {enablePublicLink && publicLinkFetching && !publicLinkLoading ? (
                <span>Actualizando enlace…</span>
              ) : null}
            </div>
          </div>

          {enablePublicLink && publicLinkLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted small">
              <Spinner animation="border" size="sm" role="status" /> Cargando URL pública…
            </div>
          ) : null}

          {enablePublicLink && publicLinkError ? (
            <Alert variant="warning" className="mb-0">
              {publicLinkError}
            </Alert>
          ) : null}

          {enablePublicLink && generatedLinks.length && publicLinkCreatedAt ? (
            <div className="d-flex flex-column gap-2">
              <span className="text-muted small">Creada {publicLinkCreatedAt}</span>
            </div>
          ) : null}
        </div>

        {queryError ? (
          <Alert variant="danger" className="mb-3">
            {queryError}
          </Alert>
        ) : null}

        {formError ? (
          <Alert
            variant={duplicateTarget ? 'warning' : 'danger'}
            className="mb-3 d-flex flex-column flex-sm-row align-items-sm-center gap-2"
          >
            <span className="flex-grow-1">{formError}</span>
            {duplicateTarget ? (
              <Button
                size="sm"
                variant="outline-primary"
                onClick={() => handleEdit(duplicateTarget)}
              >
                Editar alumno existente
              </Button>
            ) : null}
          </Alert>
        ) : null}

        {studentsLoading ? (
          <div className="d-flex align-items-center gap-2 mb-3">
            <Spinner animation="border" size="sm" /> Cargando alumnos…
          </div>
        ) : null}

        <div className="table-responsive">
          <Table striped bordered hover size="sm" className="mb-0">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Apellidos</th>
                <th>DNI</th>
                <th className="text-center">Asistencia</th>
                <th className="text-center">APTO</th>
                <th className="text-center">Certificado</th>
                <th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isNewRow ? renderEditingRow('new-student') : null}
              {students.map((student) =>
                editingStudentId === student.id ? renderEditingRow(student.id) : renderStudentRow(student),
              )}
              {!isNewRow && !students.length && !studentsLoading ? (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-4">
                    Sin alumnos registrados
                  </td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </div>
      </Accordion.Body>
    </Accordion.Item>

  );
}

function SessionDocumentsAccordionItem({
  sessionId,
  dealId,
  onNotify,
  initialDriveUrl,
}: {
  sessionId: string;
  dealId: string;
  onNotify?: (toast: ToastParams) => void;
  initialDriveUrl?: string | null;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [updatingDocumentId, setUpdatingDocumentId] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isPoDocument, setIsPoDocument] = useState(false);
  const [poDocumentReference, setPoDocumentReference] = useState('');
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [driveUrl, setDriveUrl] = useState<string | null>(normalizeDriveUrlValue(initialDriveUrl));

  const documentsQuery = useQuery({
    queryKey: ['session-documents', dealId, sessionId],
    queryFn: () => fetchSessionDocuments(dealId, sessionId),
    enabled: Boolean(dealId && sessionId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setDriveUrl(normalizeDriveUrlValue(initialDriveUrl));
  }, [initialDriveUrl]);

  useEffect(() => {
    const data = documentsQuery.data;
    if (!data) return;
    const normalized = normalizeDriveUrlValue(data.driveUrl);
    setDriveUrl((current) => (current === normalized ? current : normalized));
  }, [documentsQuery.data]);

  const uploadMutation = useMutation({
    mutationFn: (input: {
      files: File[];
      shareWithTrainer: boolean;
      isPoDocument: boolean;
      poDocumentReference: string;
    }) =>
      uploadSessionDocuments({
        dealId,
        sessionId,
        files: input.files,
        shareWithTrainer: input.shareWithTrainer,
        isPoDocument: input.isPoDocument,
        poDocumentReference: input.poDocumentReference,
      }),
  });

  const updateShareMutation = useMutation({
    mutationFn: (input: { documentId: string; share: boolean }) =>
      updateSessionDocumentShare(dealId, sessionId, input.documentId, input.share),
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: (documentId: string) => deleteSessionDocument(dealId, sessionId, documentId),
  });

  useEffect(() => {
    setDocumentError(null);
    setUpdatingDocumentId(null);
    setDeletingDocumentId(null);
    uploadMutation.reset();
    updateShareMutation.reset();
    deleteDocumentMutation.reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [dealId, sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const normalizedDealId = String(dealId ?? '').trim();
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedDealId || !normalizedSessionId) return undefined;

    const handleDocumentsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<SessionDocumentsEventDetail>).detail;
      if (!detail) return;
      if (detail.dealId !== normalizedDealId || detail.sessionId !== normalizedSessionId) return;
      qc.invalidateQueries({ queryKey: ['session-documents', dealId, sessionId] });
    };

    window.addEventListener(SESSION_DOCUMENTS_EVENT, handleDocumentsUpdated as EventListener);
    return () => {
      window.removeEventListener(SESSION_DOCUMENTS_EVENT, handleDocumentsUpdated as EventListener);
    };
  }, [dealId, qc, sessionId]);

  const documents = documentsQuery.data?.documents ?? [];
  const documentsLoading = documentsQuery.isLoading;
  const documentsFetching = documentsQuery.isFetching;
  const queryError = documentsQuery.error
    ? documentsQuery.error instanceof Error
      ? documentsQuery.error.message
      : 'No se pudieron cargar los documentos'
    : null;

  const uploadPending = uploadMutation.isPending;
  const updateSharePending = updateShareMutation.isPending;
  const deletePending = deleteDocumentMutation.isPending;

  const formatAddedAt = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '—';
    try {
      return new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: MADRID_TIMEZONE,
      }).format(date);
    } catch {
      return date.toLocaleString('es-ES');
    }
  };

  const openUploadDialog = () => {
    if (uploadPending) return;
    setPendingUploadFiles([]);
    setIsDragActive(false);
    setDocumentError(null);
    setIsPoDocument(false);
    setPoDocumentReference('');
    setShowUploadDialog(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const closeUploadDialog = () => {
    if (uploadPending) return;
    setShowUploadDialog(false);
    setPendingUploadFiles([]);
    setIsDragActive(false);
    setDocumentError(null);
    setIsPoDocument(false);
    setPoDocumentReference('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const toFileArray = (files: FileList | File[] | null | undefined): File[] =>
    files ? (Array.isArray(files) ? files : Array.from(files)) : [];

  const handleSelectUploadFiles = (
    filesList: FileList | File[] | null | undefined,
  ) => {
    const files = toFileArray(filesList);
    if (!files.length) {
      setPendingUploadFiles([]);
      return;
    }
    const filteredFiles = files.filter(Boolean);

    const oversizedFile = filteredFiles.find((file) => file.size > SESSION_DOCUMENT_SIZE_LIMIT_BYTES);
    if (oversizedFile) {
      const message = SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE;
      setDocumentError(message);
      onNotify?.({ variant: 'danger', message });
      setPendingUploadFiles([]);
      return;
    }

    const totalSize = filteredFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > SESSION_DOCUMENT_SIZE_LIMIT_BYTES) {
      const message = SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE;
      setDocumentError(message);
      onNotify?.({ variant: 'danger', message });
      setPendingUploadFiles([]);
      return;
    }

    setDocumentError(null);
    setPendingUploadFiles(filteredFiles);
  };

  const handleUploadFiles = async (filesInput: File[] | FileList | null | undefined) => {
    if (!filesInput || uploadPending) return;
    const files = (Array.isArray(filesInput) ? filesInput : Array.from(filesInput)).filter(Boolean);
    if (!files.length) return;
    setDocumentError(null);
    try {
      const normalizedPoDocumentReference = poDocumentReference.trim();
      if (isPoDocument && !normalizedPoDocumentReference) {
        const message = 'Indica la referencia alfanumérica para el documento PO';
        setDocumentError(message);
        onNotify?.({ variant: 'danger', message });
        return;
      }

      const result = await uploadMutation.mutateAsync({
        files,
        shareWithTrainer: false,
        isPoDocument,
        poDocumentReference: normalizedPoDocumentReference,
      });
      const normalizedLink = normalizeDriveUrlValue(result?.driveUrl ?? null);
      setDriveUrl(normalizedLink);
      onNotify?.({
        variant: 'success',
        message:
          files.length > 1
            ? 'Documentos subidos correctamente'
            : 'Documento subido correctamente',
      });
      setShowUploadDialog(false);
      setPendingUploadFiles([]);
      setIsDragActive(false);
      setIsPoDocument(false);
    setPoDocumentReference('');
    } catch (error: unknown) {
      const message = formatErrorMessage(error, 'No se pudo subir el documento');
      console.error('[SessionDocumentsAccordionItem] Error al subir documentos de sesión', error);
      setDocumentError(message);
      onNotify?.({ variant: 'danger', message });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await qc.invalidateQueries({ queryKey: ['session-documents', dealId, sessionId] });
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleSelectUploadFiles(event.target.files);
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleUploadClick = () => {
    openUploadDialog();
  };

  const handleBrowseClick = () => {
    if (uploadPending) return;
    fileInputRef.current?.click();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploadPending) return;
    setIsDragActive(true);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploadPending) return;
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsDragActive(false);
  };

  const handleDropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploadPending) return;
    setIsDragActive(false);
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      handleSelectUploadFiles(null);
      return;
    }

    if (dataTransfer.files && dataTransfer.files.length > 0) {
      handleSelectUploadFiles(dataTransfer.files);
      return;
    }

    const itemFiles = dataTransfer.items
      ? Array.from(dataTransfer.items)
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file))
      : [];

    handleSelectUploadFiles(itemFiles.length ? itemFiles : null);
  };

  const handleUploadConfirm = () => {
    void handleUploadFiles(pendingUploadFiles);
  };

  const handleToggleShare = async (doc: SessionDocument, share: boolean) => {
    setDocumentError(null);
    setUpdatingDocumentId(doc.id);
    try {
      await updateShareMutation.mutateAsync({ documentId: doc.id, share });
      onNotify?.({
        variant: 'success',
        message: share
          ? 'Documento marcado para compartir con formador/a'
          : 'Documento marcado como no compartido',
      });
    } catch (error: unknown) {
      const message = formatErrorMessage(
        error,
        'No se pudo actualizar el estado de compartición',
      );
      console.error(
        '[SessionDocumentsAccordionItem] Error al actualizar compartición de documento de sesión',
        error,
      );
      setDocumentError(message);
      onNotify?.({ variant: 'danger', message });
    } finally {
      setUpdatingDocumentId(null);
      await qc.invalidateQueries({ queryKey: ['session-documents', dealId, sessionId] });
    }
  };

  const handleDeleteDocument = async (doc: SessionDocument) => {
    if (deletePending) return;
    const confirmed = confirm('¿Eliminar documento?');
    if (!confirmed) return;

    setDocumentError(null);
    setDeletingDocumentId(doc.id);

    try {
      await deleteDocumentMutation.mutateAsync(doc.id);
      onNotify?.({ variant: 'success', message: 'Documento eliminado correctamente' });
    } catch (error: unknown) {
      const message = formatErrorMessage(error, 'No se pudo eliminar el documento');
      console.error('[SessionDocumentsAccordionItem] Error al eliminar documento de sesión', error);
      setDocumentError(message);
      onNotify?.({ variant: 'danger', message });
    } finally {
      setDeletingDocumentId(null);
      await qc.invalidateQueries({ queryKey: ['session-documents', dealId, sessionId] });
    }
  };

  return (
    <>
      <Accordion.Item eventKey={`session-documents-${sessionId}`}>
        <Accordion.Header>
          <div className="d-flex justify-content-between align-items-center w-100">
            <span className="erp-accordion-title">
              Documentos
              {documents.length > 0 ? (
                <span className="erp-accordion-count">{documents.length}</span>
              ) : null}
            </span>
          </div>
        </Accordion.Header>
      <Accordion.Body>
        <div className="d-flex flex-column flex-md-row align-items-md-center gap-3 mb-3">
          <Button
            type="button"
            variant="outline-primary"
            onClick={handleUploadClick}
            disabled={uploadPending}
          >
            {uploadPending ? <Spinner animation="border" size="sm" role="status" /> : 'Subir documentos'}
          </Button>
          <Button
            type="button"
            variant="outline-secondary"
            href={driveUrl ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            disabled={!driveUrl}
          >
            Carpeta Drive
          </Button>
        </div>

        {queryError ? (
          <Alert variant="danger" className="mb-3">
            {queryError}
          </Alert>
        ) : null}

        {documentError ? (
          <Alert variant="danger" className="mb-3">
            {documentError}
          </Alert>
        ) : null}

        {documentsLoading ? (
          <div className="d-flex align-items-center gap-2 mb-3">
            <Spinner animation="border" size="sm" /> Cargando documentos…
          </div>
        ) : null}

        {!documentsLoading && documentsFetching ? (
          <div className="text-muted small mb-3">Actualizando documentos…</div>
        ) : null}

        {documents.length ? (
          <div className="table-responsive">
            <Table striped bordered hover size="sm" className="mb-0">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Fecha de alta</th>
                  <th>Enlace Drive</th>
                  <th className="text-center">Compartir con formador/a</th>
                  <th className="text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const displayName = (doc.drive_file_name ?? '').trim() || 'Documento';
                  const typeLabel = (doc.file_type ?? '').toUpperCase() || '—';
                  const driveLink = (doc.drive_web_view_link ?? '').trim();
                  const isUpdating = updateSharePending && updatingDocumentId === doc.id;
                  const isDeleting = deletePending && deletingDocumentId === doc.id;

                  return (
                    <tr key={doc.id}>
                      <td className="align-middle">{displayName}</td>
                      <td className="align-middle">{typeLabel}</td>
                      <td className="align-middle">{formatAddedAt(doc.added_at)}</td>
                      <td className="align-middle">
                        {driveLink ? (
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0"
                            href={driveLink}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Abrir
                          </Button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="align-middle">
                        <div className="d-flex align-items-center justify-content-center gap-2">
                          <Form.Check
                            type="switch"
                            id={`session-${sessionId}-doc-share-${doc.id}`}
                            label=""
                            title={
                              doc.compartir_formador
                                ? 'Compartido con formador/a'
                                : 'No compartido con formador/a'
                            }
                            checked={doc.compartir_formador}
                            disabled={isUpdating}
                            onChange={(event) => handleToggleShare(doc, event.target.checked)}
                          />
                          <span className="small text-muted">{doc.compartir_formador ? 'Sí' : 'No'}</span>
                        </div>
                      </td>
                      <td className="align-middle text-center">
                        <button
                          type="button"
                          className="btn btn-link text-danger p-0"
                          title="Eliminar documento"
                          aria-label="Eliminar documento"
                          disabled={deletePending}
                          onClick={() => handleDeleteDocument(doc)}
                        >
                          {isDeleting ? (
                            <Spinner animation="border" size="sm" role="status" />
                          ) : (
                            <DeleteIcon width={18} height={18} />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : !documentsLoading && !queryError ? (
          <p className="text-muted small mb-0">Sin documentos</p>
        ) : null}
      </Accordion.Body>
    </Accordion.Item>

    <Modal
      show={showUploadDialog}
      onHide={closeUploadDialog}
      centered
      backdrop={uploadPending ? 'static' : true}
      keyboard={!uploadPending}
    >
      <Modal.Header closeButton={!uploadPending}>
        <Modal.Title>Subir documento</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="d-none"
          onChange={handleFileInputChange}
        />
        <div
          className={`border border-2 rounded-3 p-4 text-center ${
            isDragActive ? 'border-primary bg-light' : 'border-secondary-subtle'
          }`}
          style={{ borderStyle: 'dashed' }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDropFiles}
        >
          <p className="fw-semibold mb-2">Arrastra un archivo aquí</p>
          <p className="text-muted small mb-3">o</p>
          <Button
            type="button"
            variant="outline-primary"
            onClick={handleBrowseClick}
            disabled={uploadPending}
          >
            Buscar archivo
          </Button>
          <div className="mt-3">
            {pendingUploadFiles.length ? (
              <div className="d-flex flex-column gap-2 small text-start text-md-center">
                {pendingUploadFiles.map((file) => {
                  const sizeLabel =
                    file.size >= 1024 * 1024
                      ? `${Math.round((file.size / (1024 * 1024)) * 100) / 100} MB`
                      : `${Math.round((file.size / 1024) * 10) / 10} KB`;
                  return (
                    <div key={`${file.name}-${file.size}-${file.lastModified}`} className="text-break">
                      <div className="fw-semibold">{file.name}</div>
                      <div className="text-muted">{sizeLabel}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-muted small">Ningún archivo seleccionado</div>
            )}
          </div>
          <p className="text-muted small mt-3 mb-0">
            Tamaño máximo total permitido: {SESSION_DOCUMENT_SIZE_LIMIT_LABEL}
          </p>
        </div>
        <Form.Check
          className="mt-3"
          id={`upload-po-session-document-${sessionId}`}
          type="checkbox"
          label="¿Es un documento de PO?"
          checked={isPoDocument}
          onChange={(event) => {
            const checked = event.target.checked;
            setIsPoDocument(checked);
            if (!checked) {
              setPoDocumentReference('');
            }
          }}
          disabled={uploadPending}
        />
        {isPoDocument ? (
          <Form.Group className="mt-3" controlId={`upload-po-reference-${sessionId}`}>
            <Form.Label className="mb-1">Referencia PO (alfanumérica)</Form.Label>
            <Form.Control
              type="text"
              value={poDocumentReference}
              onChange={(event) => setPoDocumentReference(event.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
              placeholder="Ej: 66gh36986"
              disabled={uploadPending}
            />
          </Form.Group>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button
          type="button"
          variant="outline-secondary"
          onClick={closeUploadDialog}
          disabled={uploadPending}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleUploadConfirm}
          disabled={!pendingUploadFiles.length || uploadPending}
        >
          {uploadPending ? (
            <>
              <Spinner as="span" animation="border" size="sm" role="status" className="me-2" />
              Subiendo...
            </>
          ) : pendingUploadFiles.length > 1 ? (
            'Subir documentos'
          ) : (
            'Subir documento'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  </>
  );
}

function DeleteIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M5 7h14" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M9.5 11.5v5" />
      <path d="M14.5 11.5v5" />
      <path d="M7.5 7l.7 11a2 2 0 0 0 2 1.9h3.6a2 2 0 0 0 2-1.9l.7-11" />
    </svg>
  );
}

function SessionStateBadge({ estado }: { estado: SessionEstado }) {
  const label = SESSION_ESTADO_LABELS[estado] ?? estado;
  const variant = SESSION_ESTADO_VARIANTS[estado] ?? 'secondary';
  return (
    <Badge
      bg={variant}
      className="text-uppercase session-state-badge"
      style={{ fontSize: '0.75rem' }}
    >
      {label}
    </Badge>
  );
}

type SessionFormState = {
  id: string;
  nombre_cache: string;
  sala_id: string | null;
  direccion: string;
  estado: SessionEstado;
  drive_url: string | null;
  trainer_ids: string[];
  unidad_movil_ids: string[];
};

type SaveStatus = {
  saving: boolean;
  error: string | null;
  dirty: boolean;
  savedAt?: number;
};

type DealVariantSelectOption = {
  value: string;
  label: string;
  date: string | null;
  description: string | null;
};

type ApplicableProductInfo = {
  id: string;
  name: string | null;
  code: string | null;
  quantity: number;
  hours: number | null;
  matchIds: string[];
  matchTexts: string[];
};

function isApplicableProduct(product: DealProduct): product is DealProduct & { id: string } {
  const id = product?.id;
  if (!id) return false;

  const type = typeof product?.type === 'string' ? product.type.trim().toUpperCase() : null;
  if (type === 'TRAINING') return true;

  const template = typeof product?.template === 'string' ? product.template.trim().toLowerCase() : '';
  if (template.includes('formacion')) return true;

  const code = typeof product?.code === 'string' ? product.code.trim().toLowerCase() : '';
  if (!code) return false;

  return SESSION_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

function mapSessionToForm(session: SessionDTO): SessionFormState {
  return {
    id: session.id,
    nombre_cache: session.nombre_cache,
    sala_id: session.sala_id ?? null,
    direccion: session.direccion ?? '',
    estado: session.estado,
    drive_url: session.drive_url ?? null,
    trainer_ids: Array.isArray(session.trainer_ids) ? [...session.trainer_ids] : [],
    unidad_movil_ids: Array.isArray(session.unidad_movil_ids) ? [...session.unidad_movil_ids] : [],
  };
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function buildSessionPatchPayload(
  form: SessionFormState,
  saved: SessionFormState | undefined,
): Parameters<typeof patchSession>[1] | null {
  if (!saved) {
    const payload: Parameters<typeof patchSession>[1] = {
      nombre_cache: form.nombre_cache,
    };
    if (ENABLE_ROOMS) {
      payload.sala_id = form.sala_id;
    }
    if (ENABLE_ADDRESS) {
      payload.direccion = form.direccion;
    }
    if (ENABLE_TRAINERS) {
      payload.trainer_ids = [...form.trainer_ids];
    }
    if (ENABLE_MOBILE_UNITS) {
      payload.unidad_movil_ids = [...form.unidad_movil_ids];
    }
    if (ENABLE_SESSION_STATE) {
      payload.estado = form.estado;
    }

    return payload;
  }

  const patch: Parameters<typeof patchSession>[1] = {};
  let hasChanges = false;

  if (form.nombre_cache !== saved.nombre_cache) {
    patch.nombre_cache = form.nombre_cache;
    hasChanges = true;
  }

  if (ENABLE_ROOMS && form.sala_id !== saved.sala_id) {
    patch.sala_id = form.sala_id ?? null;
    hasChanges = true;
  }

  if (ENABLE_ADDRESS && form.direccion !== saved.direccion) {
    patch.direccion = form.direccion ?? '';
    hasChanges = true;
  }

  if (ENABLE_TRAINERS && !areStringArraysEqual(form.trainer_ids, saved.trainer_ids)) {
    patch.trainer_ids = [...form.trainer_ids];
    hasChanges = true;
  }

  if (ENABLE_MOBILE_UNITS && !areStringArraysEqual(form.unidad_movil_ids, saved.unidad_movil_ids)) {
    patch.unidad_movil_ids = [...form.unidad_movil_ids];
    hasChanges = true;
  }

  if (ENABLE_SESSION_STATE && form.estado !== saved.estado) {
    if (MANUAL_SESSION_ESTADO_SET.has(form.estado)) {
      (patch as Record<string, SessionEstado>).estado = form.estado;
      hasChanges = true;
    }
  }

  if (!hasChanges) return null;

  return patch;
}

function sortOptionsByName<T extends { name: string }>(options: T[]): T[] {
  return [...options].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

interface SessionsAccordionAbiertaProps {
  dealId: string;
  dealAddress: string | null;
  dealSedeLabel: string | null;
  dealTrainingDate: string | null;
  dealVariation: string | null;
  products: DealProduct[];
  onNotify?: (toast: ToastParams) => void;
  allowPublicLinkGeneration?: boolean;
}

export function SessionsAccordionAbierta({
  dealId,
  dealAddress,
  dealSedeLabel,
  dealTrainingDate,
  dealVariation,
  products,
  onNotify,
  allowPublicLinkGeneration = true,
}: SessionsAccordionAbiertaProps) {
  const qc = useQueryClient();
  const enablePublicLink = allowPublicLinkGeneration;

  const mapApplicableProduct = useCallback(
    (product: DealProduct & { id: string | number }): ApplicableProductInfo => {
      const id = String(product.id);
      const normalizedId = typeof product.id === 'string' ? product.id.trim() : String(product.id ?? '').trim();
      const normalizedCode = typeof product.code === 'string' ? product.code.trim() : '';
      const normalizedName = typeof product.name === 'string' ? product.name.trim() : '';

      const matchIds = new Set<string>();
      const matchTexts = new Set<string>();

      if (normalizedId) matchIds.add(normalizedId);
      if (normalizedCode) matchIds.add(normalizedCode);

      if (normalizedCode) matchTexts.add(normalizedCode.toLocaleLowerCase('es'));
      if (normalizedName) matchTexts.add(normalizedName.toLocaleLowerCase('es'));

      return {
        id,
        name: normalizedName || null,
        code: normalizedCode || null,
        quantity:
          typeof product.quantity === 'number'
            ? product.quantity
            : product.quantity != null
            ? Number(product.quantity)
            : 0,
        hours:
          typeof product.hours === 'number'
            ? product.hours
            : product.hours != null
            ? Number(product.hours)
            : null,
        matchIds: Array.from(matchIds),
        matchTexts: Array.from(matchTexts),
      };
    },
    [],
  );

  const { applicableProducts, shouldShow, generationKey } = useApplicableDealProducts<ApplicableProductInfo>(
    products,
    {
      filter: isApplicableProduct,
      mapProduct: mapApplicableProduct,
    },
  );

  const normalizedDealSede = useMemo(() => formatSedeLabel(dealSedeLabel), [dealSedeLabel]);

  const [currentDealVariation, setCurrentDealVariation] = useState<string | null>(dealVariation ?? null);
  const [currentDealTrainingDate, setCurrentDealTrainingDate] = useState<string | null>(
    dealTrainingDate ?? null,
  );

  const normalizedCurrentVariation = useMemo(
    () => (typeof currentDealVariation === 'string' ? currentDealVariation.trim() : ''),
    [currentDealVariation],
  );

  useEffect(() => {
    setCurrentDealVariation(dealVariation ?? null);
  }, [dealVariation]);

  useEffect(() => {
    setCurrentDealTrainingDate(dealTrainingDate ?? null);
  }, [dealTrainingDate]);


  const variantDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'long',
      }),
    [],
  );

  const formatVariantDate = useCallback(
    (value: string | null | undefined) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed.length) return null;
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        return trimmed;
      }
      try {
        return variantDateFormatter.format(parsed);
      } catch (error) {
        return trimmed;
      }
    },
    [variantDateFormatter],
  );

  const variantSiblingsQuery = useQuery<VariantSiblingsResponse>({
    queryKey: ['deal', dealId, 'variant-siblings', normalizedCurrentVariation],
    queryFn: () => fetchVariantSiblings({ variantWooId: normalizedCurrentVariation }),
    enabled: Boolean(normalizedCurrentVariation),
    staleTime: 5 * 60 * 1000,
  });

  const variantSiblingsData = variantSiblingsQuery.data ?? null;
  const variantSiblings = variantSiblingsData?.variants ?? [];
  const variantParentName = variantSiblingsData?.parent?.name ?? null;

  const variantLookup = useMemo(() => {
    const map = new Map<string, VariantSiblingOption>();
    for (const variant of variantSiblings) {
      const wooId = typeof variant.wooId === 'string' ? variant.wooId.trim() : '';
      if (wooId.length) {
        map.set(wooId, variant);
      }
      if (variant.id && !map.has(variant.id)) {
        map.set(variant.id, variant);
      }
    }
    return map;
  }, [variantSiblings]);

  const currentVariantInfo = useMemo(() => {
    if (!normalizedCurrentVariation) return null;
    return variantLookup.get(normalizedCurrentVariation) ?? null;
  }, [normalizedCurrentVariation, variantLookup]);

  const currentVariantName = useMemo(() => {
    const label = currentVariantInfo?.name?.trim() ?? '';
    if (label.length) return label;
    return formatVariantDate(currentVariantInfo?.date ?? null) ?? null;
  }, [currentVariantInfo, formatVariantDate]);

  const variantSelectOptions = useMemo(() => {
    const options = variantSiblings
      .map((variant) => {
        const wooId = typeof variant.wooId === 'string' ? variant.wooId.trim() : '';
        if (!wooId.length) return null;
        const formattedDate = formatVariantDate(variant.date ?? null);
        let label = (variant.name ?? '').trim();
        if (!label.length) {
          label = formattedDate ?? `Variante ${wooId}`;
        }
        return {
          value: wooId,
          label,
          date: variant.date ?? null,
          description: formattedDate,
        } satisfies DealVariantSelectOption;
      })
      .filter((option): option is DealVariantSelectOption => option !== null);

    const normalizedCurrent = normalizedCurrentVariation;
    if (normalizedCurrent) {
      const hasCurrentAssigned = options.some(
        (option) => option.value.trim() === normalizedCurrent,
      );

      if (!hasCurrentAssigned) {
        const fallbackDate = currentVariantInfo?.date ?? currentDealTrainingDate ?? null;
        const formattedFallbackDate = formatVariantDate(fallbackDate);
        const fallbackLabelSources = [
          currentVariantInfo?.name ?? null,
          currentVariantName ?? null,
          formattedFallbackDate,
        ];
        let fallbackLabel = fallbackLabelSources
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .find((value) => value.length > 0);

        if (!fallbackLabel) {
          fallbackLabel = `Variante ${normalizedCurrent}`;
        }

        options.unshift({
          value: normalizedCurrent,
          label: fallbackLabel,
          date: fallbackDate,
          description: formattedFallbackDate,
        });
      }
    }

    return options;
  }, [
    currentDealTrainingDate,
    currentVariantInfo,
    currentVariantName,
    formatVariantDate,
    normalizedCurrentVariation,
    variantSiblings,
  ]);

  const variantOptionsLoading = variantSiblingsQuery.isLoading || variantSiblingsQuery.isFetching;
  const [variantSaving, setVariantSaving] = useState(false);

  const handleVariantSelect = useCallback(
    async (nextWooId: string) => {
      const normalizedNext = typeof nextWooId === 'string' ? nextWooId.trim() : '';
      if (!normalizedNext) return false;

      const currentNormalized = normalizedCurrentVariation;
      if (currentNormalized && normalizedNext === currentNormalized) {
        onNotify?.({ variant: 'info', message: 'La variante seleccionada ya está asignada.' });
        return true;
      }

      if (!dealId) {
        onNotify?.({ variant: 'danger', message: 'No se pudo determinar el presupuesto.' });
        return false;
      }

      const variantInfo = variantLookup.get(normalizedNext);
      if (!variantInfo || !variantInfo.wooId) {
        onNotify?.({ variant: 'danger', message: 'No se encontró la variante seleccionada.' });
        return false;
      }

      setVariantSaving(true);
      try {
        await patchDealEditable(dealId, {
          w_id_variation: variantInfo.wooId,
          a_fecha: variantInfo.date ?? null,
        });

        setCurrentDealVariation(variantInfo.wooId);
        setCurrentDealTrainingDate(variantInfo.date ?? null);

        qc.setQueryData<DealDetail | undefined>(['deal', dealId], (current) => {
          if (!current) return current;
          return { ...current, w_id_variation: variantInfo.wooId, a_fecha: variantInfo.date ?? null };
        });

        qc.setQueryData<VariantSiblingsResponse | undefined>(
          ['deal', dealId, 'variant-siblings', variantInfo.wooId],
          (current) => current ?? variantSiblingsData ?? { parent: null, variants: [] },
        );

        void qc.invalidateQueries({ queryKey: ['deal', dealId] });

        onNotify?.({ variant: 'success', message: 'Variante actualizada correctamente' });
        return true;
      } catch (error) {
        const message = isApiError(error)
          ? error.message || 'No se pudo actualizar la variante'
          : 'No se pudo actualizar la variante';
        onNotify?.({ variant: 'danger', message });
        return false;
      } finally {
        setVariantSaving(false);
      }
    },
    [
      dealId,
      normalizedCurrentVariation,
      onNotify,
      qc,
      variantLookup,
      variantSiblingsData,
    ],
  );
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationDone, setGenerationDone] = useState(false);
  const [mapAddress, setMapAddress] = useState<string | null>(null);
  const [showMapModal, setShowMapModal] = useState(false);

  const generateMutation = useMutation({
    mutationFn: (id: string) => generateSessionsFromDeal(id),
    onSuccess: () => {
      setGenerationDone(true);
      setGenerationError(null);
    },
    onError: (error: unknown) => {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudieron generar las sesiones';
      setGenerationError(message);
      setGenerationDone(true);
    },
  });

  useEffect(() => {
    setGenerationError(null);
    if (!dealId) {
      setGenerationDone(true);
      return;
    }
    setGenerationDone(false);
    generateMutation.mutate(dealId);
  }, [dealId, generationKey]);

  const [pageByProduct, setPageByProduct] = useState<Record<string, number>>({});

  const handleOpenMap = (address: string) => {
    if (!ENABLE_ADDRESS) return;
    const trimmed = address.trim();
    if (!trimmed) return;
    setMapAddress(trimmed);
    setShowMapModal(true);
  };

  const handleCloseMap = () => {
    if (!ENABLE_ADDRESS) return;
    setShowMapModal(false);
    setMapAddress(null);
  };

  useEffect(() => {
    setPageByProduct((current) => {
      const next: Record<string, number> = {};
      for (const product of applicableProducts) {
        next[product.id] = current[product.id] ?? 1;
      }
      return next;
    });
  }, [applicableProducts]);

  const trainersQuery = ENABLE_TRAINERS
    ? useQuery({
        queryKey: ['trainers', 'active'],
        queryFn: fetchActiveTrainers,
        enabled: shouldShow,
        staleTime: 5 * 60 * 1000,
      })
    : ({ data: undefined, isLoading: false, isFetching: false, error: null } as const);

  const roomsQuery = ENABLE_ROOMS
    ? useQuery({
        queryKey: ['rooms', 'catalog'],
        queryFn: fetchRoomsCatalog,
        enabled: shouldShow,
        staleTime: 5 * 60 * 1000,
      })
    : ({ data: undefined, isLoading: false, isFetching: false, error: null } as const);

  const unitsQuery = ENABLE_MOBILE_UNITS
    ? useQuery({
        queryKey: ['mobile-units', 'catalog'],
        queryFn: fetchMobileUnitsCatalog,
        enabled: shouldShow,
        staleTime: 5 * 60 * 1000,
      })
    : ({ data: undefined, isLoading: false, isFetching: false, error: null } as const);

  const sessionQueries = useQueries({
    queries: applicableProducts.map((product) => {
      const currentPage = pageByProduct[product.id] ?? 1;
      return {
        queryKey: ['dealSessions', dealId, product.id, currentPage, SESSION_LIMIT],
        queryFn: async () => {
          const groups = await fetchDealSessions(dealId, {
            productId: product.id,
            page: currentPage,
            limit: SESSION_LIMIT,
          });
          return groups[0] ?? null;
        },
        enabled: shouldShow && generationDone,
        staleTime: 0,
        refetchOnWindowFocus: false,
      };
    }),
  });

  const formsRef = useRef<Record<string, SessionFormState>>({});
  const [forms, setForms] = useState<Record<string, SessionFormState>>({});
  const lastSavedRef = useRef<Record<string, SessionFormState>>({});
  const sessionProductRef = useRef<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const [activeSession, setActiveSession] = useState<
    | {
        sessionId: string;
        productId: string;
        productName: string;
        displayIndex: number;
      }
    | null
  >(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

  const queriesUpdatedKey = sessionQueries.map((query) => query.dataUpdatedAt).join('|');

  const totalSessionsCount = generationDone
    ? sessionQueries.reduce((total, query) => {
        const group = (query.data as SessionGroupDTO | null) ?? null;
        const pagination = group?.pagination;
        return total + (pagination?.total ?? 0);
      }, 0)
    : 0;

  useEffect(() => {
    if (!generationDone) return;
    const nextForms: Record<string, SessionFormState> = {};
    const nextSaved: Record<string, SessionFormState> = {};
    const productMap: Record<string, string> = {};

    sessionQueries.forEach((query, index) => {
      const group = query.data as SessionGroupDTO | null;
      if (!group) return;
      const product = applicableProducts[index];
      const productId = product?.id ?? group.product.id;
      group.sessions.forEach((session) => {
        const form = mapSessionToForm(session);
        nextForms[session.id] = form;
        nextSaved[session.id] = form;
        productMap[session.id] = productId;
      });
    });

    formsRef.current = nextForms;
    lastSavedRef.current = nextSaved;
    sessionProductRef.current = productMap;
    setForms(nextForms);
    setSaveStatus(() => {
      const next: Record<string, SaveStatus> = {};
      for (const sessionId of Object.keys(nextForms)) {
        next[sessionId] = { saving: false, error: null, dirty: false };
      }
      return next;
    });
  }, [generationDone, queriesUpdatedKey, applicableProducts]);

  const patchMutation = useMutation({
    mutationFn: ({ sessionId, payload }: { sessionId: string; payload: Parameters<typeof patchSession>[1] }) =>
      patchSession(sessionId, payload),
  });

  const createMutation = useMutation({
    mutationFn: (input: {
      deal_id: string;
      deal_product_id: string;
      direccion?: string | null;
      trainer_ids?: string[];
      unidad_movil_ids?: string[];
      sala_id?: string | null;
      force_estado_borrador?: boolean;
    }) =>
      createSession({
        ...input,
        fecha_inicio_utc: null,
        fecha_fin_utc: null,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
  });

  const handleFieldChange = (sessionId: string, updater: (current: SessionFormState) => SessionFormState) => {
    setForms((current) => {
      const existing = current[sessionId];
      if (!existing) return current;
      const next = updater(existing);
      const nextMap = { ...current, [sessionId]: next };
      formsRef.current = nextMap;
      return nextMap;
    });
    setSaveStatus((current) => ({
      ...current,
      [sessionId]: { saving: false, error: null, dirty: true },
    }));
  };

  const hasSessionChanges = useCallback(
    (sessionId: string) => {
      const form = formsRef.current[sessionId];
      const saved = lastSavedRef.current[sessionId];
      if (!form) return false;
      const patchResult = buildSessionPatchPayload(form, saved);
      return patchResult !== null;
    },
    [],
  );

  const runSave = useCallback(
    async (sessionId: string, { notifyOnSuccess = true }: { notifyOnSuccess?: boolean } = {}) => {
      const form = formsRef.current[sessionId];
      const saved = lastSavedRef.current[sessionId];
      if (!form) return false;

      const patchResult = buildSessionPatchPayload(form, saved);
      if (patchResult === null) {
        setSaveStatus((current) => ({
          ...current,
          [sessionId]: { saving: false, error: null, dirty: false, savedAt: Date.now() },
        }));
        return true;
      }

      const payload = patchResult;

      setSaveStatus((current) => ({
        ...current,
        [sessionId]: { saving: true, error: null, dirty: true },
      }));

      try {
        const updated = await patchMutation.mutateAsync({ sessionId, payload });
        const updatedForm = mapSessionToForm(updated);
        formsRef.current[sessionId] = updatedForm;
        lastSavedRef.current[sessionId] = updatedForm;
        setForms((current) => ({ ...current, [sessionId]: updatedForm }));
        setSaveStatus((current) => ({
          ...current,
          [sessionId]: { saving: false, error: null, dirty: false, savedAt: Date.now() },
        }));
        await qc.invalidateQueries({ queryKey: ['calendarSessions'] });
        if (notifyOnSuccess) {
          onNotify?.({ variant: 'success', message: 'Sesión guardada correctamente' });
        }
        return true;
      } catch (error) {
        const message = isApiError(error)
          ? error.message
          : error instanceof Error
          ? error.message
          : 'No se pudo guardar la sesión';
        setSaveStatus((current) => ({
          ...current,
          [sessionId]: { saving: false, error: message, dirty: true },
        }));
        onNotify?.({ variant: 'danger', message });
        return false;
      }
    },
    [onNotify, patchMutation, qc],
  );

  const handleSaveSession = useCallback(
    (sessionId: string, options?: { notifyOnSuccess?: boolean }) => runSave(sessionId, options),
    [runSave],
  );

  const revertSessionChanges = useCallback((sessionId: string) => {
    const savedForm = lastSavedRef.current[sessionId];
    if (savedForm) {
      formsRef.current[sessionId] = savedForm;
      setForms((current) => ({ ...current, [sessionId]: savedForm }));
    }
    setSaveStatus((current) => ({
      ...current,
      [sessionId]: { saving: false, error: null, dirty: false },
    }));
  }, []);

  const handleCloseSession = useCallback(
    async (sessionId: string) => {
      const status = saveStatus[sessionId];
      if (status?.saving) {
        onNotify?.({ variant: 'info', message: 'Espera a que termine el guardado en curso.' });
        return;
      }

      const hasChanges = hasSessionChanges(sessionId);
      if (!hasChanges) {
        setActiveSession(null);
        return;
      }

      const shouldSave = window.confirm('Tienes cambios sin guardar. ¿Deseas guardarlos antes de cerrar?');
      if (shouldSave) {
        const savedSuccessfully = await runSave(sessionId, { notifyOnSuccess: true });
        if (savedSuccessfully) {
          setActiveSession(null);
        }
      } else {
        revertSessionChanges(sessionId);
        setActiveSession(null);
      }
    },
    [hasSessionChanges, onNotify, runSave, revertSessionChanges, saveStatus],
  );

  const requestCloseActiveSession = useCallback(() => {
    if (!activeSession) return;
    void handleCloseSession(activeSession.sessionId);
  }, [activeSession, handleCloseSession]);

  const handleSelectSession = useCallback(
    async ({
      sessionId,
      productId,
      productName,
      displayIndex,
    }: {
      sessionId: string;
      productId: string;
      productName: string;
      displayIndex: number;
    }) => {
      if (activeSession && activeSession.sessionId !== sessionId) {
        const currentId = activeSession.sessionId;
        const status = saveStatus[currentId];
        if (status?.saving) {
          onNotify?.({ variant: 'info', message: 'Espera a que termine el guardado en curso.' });
          return;
        }
        if (hasSessionChanges(currentId)) {
          const shouldSave = window.confirm(
            'Tienes cambios sin guardar. ¿Deseas guardarlos antes de cambiar de sesión?',
          );
          if (shouldSave) {
            const saved = await runSave(currentId, { notifyOnSuccess: true });
            if (!saved) {
              return;
            }
          } else {
            revertSessionChanges(currentId);
          }
        }
      }

      setActiveSession({ sessionId, productId, productName, displayIndex });
    },
    [activeSession, hasSessionChanges, onNotify, revertSessionChanges, runSave, saveStatus],
  );

  const invalidateProductSessions = async (productId: string) => {
    const currentPage = pageByProduct[productId] ?? 1;
    await qc.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === 'dealSessions' && key[1] === dealId && key[2] === productId;
      },
    });
  };

  const handleDuplicate = async (sessionId: string) => {
    const session = formsRef.current[sessionId];
    const productId = sessionProductRef.current[sessionId];
    if (!session || !productId) return;
    try {
      const payload: Parameters<typeof createSession>[0] = {
        deal_id: dealId,
        deal_product_id: productId,
      };
      if (ENABLE_ADDRESS) {
        payload.direccion = session.direccion ?? dealAddress ?? '';
      }
      if (ENABLE_TRAINERS) {
        payload.trainer_ids = session.trainer_ids;
      }
      if (ENABLE_MOBILE_UNITS) {
        payload.unidad_movil_ids = session.unidad_movil_ids;
      }
      if (ENABLE_ROOMS) {
        payload.sala_id = session.sala_id;
      }

      payload.force_estado_borrador = true;

      await createMutation.mutateAsync(payload);
      await invalidateProductSessions(productId);
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo duplicar la sesión';
      alert(message);
    }
  };

  const loadDeleteDialogCounts = async (sessionId: string) => {
    try {
      const counts = await fetchSessionCounts(sessionId);
      setDeleteDialog((current) => {
        if (!current || current.sessionId !== sessionId) return current;
        return { ...current, counts, status: 'ready', error: null };
      });
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudieron obtener los contenidos asociados a la sesión';
      setDeleteDialog((current) => {
        if (!current || current.sessionId !== sessionId) return current;
        return { ...current, status: 'failed', error: message };
      });
    }
  };

  const handleOpenDeleteDialog = ({
    sessionId,
    productId,
    sessionName,
  }: {
    sessionId: string;
    productId: string;
    sessionName: string;
  }) => {
    if (!sessionId || !productId) return;
    setDeleteDialog({
      sessionId,
      productId,
      sessionName,
      status: 'loading',
      counts: null,
      error: null,
    });
    void loadDeleteDialogCounts(sessionId);
  };

  const handleCloseDeleteDialog = () => {
    if (deleteDialog && deleteMutation.isPending && deletingSessionId === deleteDialog.sessionId) {
      return;
    }
    setDeleteDialog(null);
    setDeletingSessionId(null);
  };

  const handleConfirmDeleteDialog = async () => {
    if (!deleteDialog) return;
    const { sessionId, productId } = deleteDialog;
    setDeletingSessionId(sessionId);
    try {
      await deleteMutation.mutateAsync(sessionId);

      setForms((current) => {
        if (!current[sessionId]) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });

      const nextFormsRef = { ...formsRef.current };
      delete nextFormsRef[sessionId];
      formsRef.current = nextFormsRef;

      const nextSavedRef = { ...lastSavedRef.current };
      delete nextSavedRef[sessionId];
      lastSavedRef.current = nextSavedRef;

      const nextSessionProducts = { ...sessionProductRef.current };
      delete nextSessionProducts[sessionId];
      sessionProductRef.current = nextSessionProducts;

      setSaveStatus((current) => {
        if (!current[sessionId]) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });

      setActiveSession((current) => (current?.sessionId === sessionId ? null : current));

      await invalidateProductSessions(productId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['session-students', dealId, sessionId] }),
        qc.invalidateQueries({ queryKey: ['session-documents', dealId, sessionId] }),
        qc.invalidateQueries({ queryKey: ['session-comments', sessionId] }),
        qc.invalidateQueries({ queryKey: ['deal', dealId] }),
        qc.invalidateQueries({ queryKey: ['calendarSessions'] }),
      ]);

      setDeleteDialog(null);
      setDeletingSessionId(null);
      onNotify?.({ variant: 'success', message: 'Sesión eliminada correctamente' });
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo eliminar la sesión';
      setDeleteDialog((current) => {
        if (!current || current.sessionId !== sessionId) return current;
        return { ...current, error: message };
      });
      onNotify?.({ variant: 'danger', message });
    } finally {
      setDeletingSessionId(null);
    }
  };

  const activeForm = activeSession ? forms[activeSession.sessionId] ?? null : null;
  useEffect(() => {
    if (activeSession && !forms[activeSession.sessionId]) {
      setActiveSession(null);
    }
  }, [activeSession, forms]);

  if (!shouldShow) return null;

  const trainers = ENABLE_TRAINERS && trainersQuery.data ? sortOptionsByName(trainersQuery.data) : [];
  const allRooms = ENABLE_ROOMS && roomsQuery.data ? sortOptionsByName(roomsQuery.data) : [];
  const rooms = useMemo(() => {
    if (!ENABLE_ROOMS) return [];
    if (!allRooms.length) return allRooms;
    if (!normalizedDealSede) return allRooms;
    if (normalizedDealSede === 'In Company') {
      return allRooms;
    }
    return allRooms.filter((room) => formatSedeLabel(room.sede) === normalizedDealSede);
  }, [allRooms, normalizedDealSede]);
  const units = ENABLE_MOBILE_UNITS && unitsQuery.data ? sortOptionsByName(unitsQuery.data) : [];
  const activeStatus = activeSession
    ? saveStatus[activeSession.sessionId] ?? { saving: false, error: null, dirty: false }
    : { saving: false, error: null, dirty: false };

  const deleteDialogCounts = deleteDialog?.counts ?? null;
  const deleteDialogHasContent = deleteDialogCounts
    ? (ENABLE_SESSION_COMMENTS && deleteDialogCounts.comentarios > 0) ||
      (ENABLE_SESSION_DOCUMENTS && deleteDialogCounts.documentos > 0) ||
      deleteDialogCounts.alumnos > 0 ||
      deleteDialogCounts.tokens > 0
    : false;
  const isDeleteDialogDeleting =
    !!deleteDialog && deleteMutation.isPending && deletingSessionId === deleteDialog.sessionId;

  return (
    <Accordion.Item eventKey="sessions">
      <Accordion.Header>
        <div className="d-flex justify-content-between align-items-center w-100">
          <span className="erp-accordion-title">
            Sesiones
            {totalSessionsCount > 0 ? (
              <span className="erp-accordion-count">{totalSessionsCount}</span>
            ) : null}
          </span>
        </div>
      </Accordion.Header>
      <Accordion.Body>
        {!generationDone && (
          <div className="d-flex align-items-center gap-2 mb-3">
            <Spinner animation="border" size="sm" /> Generando sesiones…
          </div>
        )}
        {generationError && (
          <Alert variant="danger" className="mb-3">
            {generationError}
          </Alert>
        )}
        {generationDone && !generationError && applicableProducts.length === 0 && (
          <p className="text-muted mb-0">No hay sesiones configurables para este presupuesto.</p>
        )}
        {generationDone && !generationError && applicableProducts.map((product, index) => {
          const query = sessionQueries[index];
          const group = (query?.data as SessionGroupDTO | null) ?? null;
          const sessions = group?.sessions ?? [];
          const pagination = group?.pagination ?? { page: 1, totalPages: 1, total: 0 };
          const currentPage = pageByProduct[product.id] ?? 1;
          const isLoading = query.isLoading || query.isFetching;
          const queryError = query.error;

          return (
            <div key={product.id} className="mb-4">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div>
                  <h5 className="mb-1">{product.name ?? product.code ?? 'Producto'}</h5>
                  <div className="text-muted small">Total sesiones: {pagination.total}</div>
                </div>
              </div>
              {isLoading && (
                <div className="d-flex align-items-center gap-2 mb-2">
                  <Spinner animation="border" size="sm" /> Cargando sesiones…
                </div>
              )}
              {queryError && (
                <Alert variant="danger">
                  {queryError instanceof Error ? queryError.message : 'No se pudieron cargar las sesiones'}
                </Alert>
              )}
              {!isLoading && !queryError && !sessions.length && (
                <p className="text-muted">Sin sesiones para este producto.</p>
              )}
              {!!sessions.length && (
                <ListGroup as="ol" numbered className="mb-0">
                  {sessions.map((session, sessionIndex) => {
                    const form = forms[session.id];
                    const status =
                      saveStatus[session.id] ?? { saving: false, error: null, dirty: false };
                    if (!form) return null;
                    const displayIndex =
                      ((pagination.page ?? currentPage) - 1) * SESSION_LIMIT + sessionIndex + 1;
                    const productName = product.name ?? product.code ?? 'Producto';
                    const sessionName = buildSessionDisplayName(form.nombre_cache, displayIndex);
                    return (
                      <ListGroup.Item
                        key={session.id}
                        as="li"
                        action
                        value={displayIndex}
                        className="session-list-item d-flex justify-content-between align-items-center gap-3"
                        onClick={() =>
                          void handleSelectSession({
                            sessionId: session.id,
                            productId: product.id,
                            productName,
                            displayIndex,
                          })
                        }
                      >
                        <div
                          className="session-item-name flex-grow-1 me-3"
                          title={sessionName}
                        >
                          <div className="fw-semibold text-truncate">{sessionName}</div>
                        </div>
                        <div className="d-flex align-items-center gap-3">
                          <div className="text-end text-nowrap">
                            {status.saving ? (
                              <span className="text-primary d-inline-flex align-items-center gap-1">
                                <Spinner animation="border" size="sm" /> Guardando…
                              </span>
                            ) : status.error ? (
                              <span className="text-danger">{status.error}</span>
                            ) : status.dirty ? (
                              <span className="text-warning">Cambios sin guardar</span>
                            ) : ENABLE_SESSION_STATE ? (
                              <SessionStateBadge estado={form.estado} />
                            ) : null}
                          </div>
                        </div>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}
              {pagination.totalPages > 1 && (
                <div className="d-flex justify-content-center mt-3">
                  <Pagination size="sm">
                    <Pagination.Prev
                      disabled={currentPage <= 1}
                      onClick={() =>
                        setPageByProduct((current) => ({ ...current, [product.id]: Math.max(1, currentPage - 1) }))
                      }
                    />
                    <Pagination.Item active>{currentPage}</Pagination.Item>
                    <Pagination.Next
                      disabled={currentPage >= pagination.totalPages}
                      onClick={() =>
                        setPageByProduct((current) => ({
                          ...current,
                          [product.id]: Math.min(pagination.totalPages, currentPage + 1),
                        }))
                      }
                    />
                  </Pagination>
                </div>
              )}
            </div>
          );
        })}
        <Modal
          show={!!deleteDialog}
          onHide={handleCloseDeleteDialog}
          centered
          backdrop={isDeleteDialogDeleting ? 'static' : true}
          keyboard={!isDeleteDialogDeleting}
        >
          <Modal.Header closeButton={!!deleteDialog && !isDeleteDialogDeleting}>
            <Modal.Title>Eliminar sesión</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {deleteDialog ? (
              <>
                <p>
                  Estás a punto de eliminar la sesión{' '}
                  <strong>{deleteDialog.sessionName}</strong>.
                </p>
                {deleteDialog.status === 'loading' ? (
                  <div className="d-flex align-items-center gap-2 text-muted">
                    <Spinner animation="border" size="sm" /> Consultando contenido asociado…
                  </div>
                ) : (
                  <>
                    {deleteDialog.error ? (
                      <Alert
                        variant={deleteDialog.status === 'failed' ? 'warning' : 'danger'}
                        className="mb-3"
                      >
                        {deleteDialog.error}
                      </Alert>
                    ) : null}
                    {deleteDialog.status === 'ready' && deleteDialogCounts ? (
                      deleteDialogHasContent ? (
                        <Alert variant="warning" className="mb-0">
                          <p className="mb-2">Esta sesión tiene contenido asociado:</p>
                          <ul className="mb-2 ps-3">
                            {ENABLE_SESSION_COMMENTS ? (
                              <li>
                                <strong>{deleteDialogCounts.comentarios}</strong> comentarios
                              </li>
                            ) : null}
                            {ENABLE_SESSION_DOCUMENTS ? (
                              <li>
                                <strong>{deleteDialogCounts.documentos}</strong> documentos
                              </li>
                            ) : null}
                            <li>
                              <strong>{deleteDialogCounts.alumnos}</strong> alumnos
                            </li>
                            <li>
                              <strong>{deleteDialogCounts.tokens}</strong> tokens de URL generadas
                            </li>
                          </ul>
                          <p className="mb-0">
                            ¿Seguro que quieres eliminarla? Se borrará todo y no se podrá deshacer.
                          </p>
                        </Alert>
                      ) : (
                        <p className="mb-0">
                          ¿Seguro que quieres eliminar esta sesión? Esta acción no se puede deshacer.
                        </p>
                      )
                    ) : (
                      <p className="mb-0">
                        ¿Seguro que quieres eliminar esta sesión? Esta acción no se puede deshacer.
                      </p>
                    )}
                  </>
                )}
              </>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleCloseDeleteDialog} disabled={isDeleteDialogDeleting}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDeleteDialog}
              disabled={!deleteDialog || deleteDialog.status === 'loading' || isDeleteDialogDeleting}
            >
              {isDeleteDialogDeleting ? (
                <span className="d-inline-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" role="status" aria-hidden="true" /> Eliminando…
                </span>
              ) : (
                'Eliminar definitivamente'
              )}
            </Button>
          </Modal.Footer>
        </Modal>
        {activeSession && (
          <Modal
            show={Boolean(activeForm)}
            onHide={requestCloseActiveSession}
            size="lg"
            centered
            scrollable
            contentClassName="session-modal"
            backdrop={activeStatus.saving ? 'static' : true}
            keyboard={!activeStatus.saving}
          >
            <Modal.Header closeButton closeVariant="white" className="border-0">
              <Modal.Title className="session-modal-title d-flex align-items-center justify-content-between gap-3">
                <span>
                  {buildSessionDisplayName(
                    activeForm?.nombre_cache,
                    activeSession.displayIndex,
                  )}
                </span>
                {ENABLE_SESSION_STATE && activeForm ? (
                  <SessionStateBadge estado={activeForm.estado} />
                ) : null}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {activeForm ? (
                <SessionEditor
                  form={activeForm}
                  status={activeStatus}
                  trainers={trainers}
                  rooms={rooms}
                  units={units}
                  onChange={(updater) => handleFieldChange(activeSession.sessionId, updater)}
                  onOpenMap={handleOpenMap}
                  onSave={(options) => handleSaveSession(activeSession.sessionId, options)}
                  dealId={dealId}
                  dealSede={normalizedDealSede}
                  dealTrainingDate={currentDealTrainingDate}
                  dealVariation={currentDealVariation}
                  dealVariationName={currentVariantName}
                  variantOptions={variantSelectOptions}
                  variantOptionsLoading={variantOptionsLoading}
                  variantSaving={variantSaving}
                  onVariantSelect={handleVariantSelect}
                  onNotify={onNotify}
                  variantParentName={variantParentName}
                />
              ) : (
                <p className="text-muted mb-0">No se pudo cargar la sesión seleccionada.</p>
              )}
            </Modal.Body>
          </Modal>
        )}
        {ENABLE_ADDRESS ? (
          <Modal show={showMapModal} onHide={handleCloseMap} size="lg" centered>
            <Modal.Header closeButton>
              <Modal.Title>Ubicación</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {mapAddress ? (
                <div className="ratio ratio-16x9">
                  <iframe
                    src={`https://www.google.com/maps?q=${encodeURIComponent(mapAddress)}&output=embed`}
                    title={`Mapa de ${mapAddress}`}
                    allowFullScreen
                  />
                </div>
              ) : (
                <p className="text-muted mb-0">No se ha especificado una dirección.</p>
              )}
            </Modal.Body>
          </Modal>
        ) : null}
      </Accordion.Body>
    </Accordion.Item>
  );
}

interface SessionEditorProps {
  form: SessionFormState;
  status: SaveStatus;
  trainers: TrainerOption[];
  rooms: RoomOption[];
  units: MobileUnitOption[];
  onChange: (updater: (current: SessionFormState) => SessionFormState) => void;
  onOpenMap: (address: string) => void;
  onSave: (options?: { notifyOnSuccess?: boolean }) => Promise<boolean> | boolean;
  dealId: string;
  dealSede: string | null;
  dealTrainingDate: string | null;
  dealVariation: string | null;
  dealVariationName: string | null;
  variantOptions: DealVariantSelectOption[];
  variantOptionsLoading?: boolean;
  variantSaving?: boolean;
  onVariantSelect?: (variantWooId: string) => Promise<boolean>;
  onNotify?: (toast: ToastParams) => void;
  variantParentName: string | null;
}

function SessionEditor({
  form,
  status,
  trainers,
  rooms,
  units,
  onChange,
  onOpenMap,
  onSave,
  dealId,
  dealSede,
  dealTrainingDate,
  dealVariation,
  dealVariationName,
  variantOptions,
  variantOptionsLoading,
  variantSaving,
  onVariantSelect,
  onNotify,
  variantParentName,
}: SessionEditorProps) {
  const [trainerFilter, setTrainerFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [trainerListOpen, setTrainerListOpen] = useState(false);
  const [unitListOpen, setUnitListOpen] = useState(false);
  const [pendingVariantSelection, setPendingVariantSelection] = useState<string | null>(null);
  const trainerFieldRef = useRef<HTMLDivElement | null>(null);
  const unitFieldRef = useRef<HTMLDivElement | null>(null);
  const trainerPointerInteractingRef = useRef(false);
  const unitPointerInteractingRef = useRef(false);
  const isInCompany = dealSede === 'In Company';
  const normalizedCurrentVariation = useMemo(
    () => (typeof dealVariation === 'string' ? dealVariation.trim() : ''),
    [dealVariation],
  );
  const normalizeVariantValue = useCallback((value: string) => value.trim(), []);
  const effectiveTrainers = ENABLE_TRAINERS ? trainers : [];
  const effectiveUnits = ENABLE_MOBILE_UNITS ? units : [];
  const effectiveRooms = ENABLE_ROOMS ? rooms : [];
  const handleManualSave = useCallback(() => {
    void onSave();
  }, [onSave]);

  const filteredTrainers = useMemo(() => {
    const search = trainerFilter.trim().toLowerCase();
    if (!search) return effectiveTrainers;
    return effectiveTrainers.filter((trainer) => {
      const label = `${trainer.name} ${trainer.apellido ?? ''}`.toLowerCase();
      return label.includes(search);
    });
  }, [effectiveTrainers, trainerFilter]);

  const filteredUnits = useMemo(() => {
    const search = unitFilter.trim().toLowerCase();
    if (!search) return effectiveUnits;
    return effectiveUnits.filter((unit) => {
      const label = `${unit.name} ${unit.matricula ?? ''}`.toLowerCase();
      return label.includes(search);
    });
  }, [effectiveUnits, unitFilter]);

  const selectedTrainers = useMemo(() => {
    if (!ENABLE_TRAINERS) return [];
    const selected = new Set(form.trainer_ids);
    return effectiveTrainers.filter((trainer) => selected.has(trainer.trainer_id));
  }, [effectiveTrainers, form.trainer_ids]);

  const selectedUnits = useMemo(() => {
    if (!ENABLE_MOBILE_UNITS) return [];
    const selected = new Set(form.unidad_movil_ids);
    return effectiveUnits.filter((unit) => selected.has(unit.unidad_id));
  }, [effectiveUnits, form.unidad_movil_ids]);

  const trainerSummary = selectedTrainers
    .map((trainer) => `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`)
    .join(', ');
  const unitSummary = selectedUnits
    .map((unit) => (unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name))
    .join(', ');

  const blockedTrainers = useMemo(() => new Set<string>(), []);
  const blockedRooms = useMemo(() => new Set<string>(), []);
  const blockedUnits = useMemo(() => new Set<string>(), []);

  const selectedRoomLabel = useMemo(() => {
    if (!ENABLE_ROOMS) return '';
    if (isInCompany && !form.sala_id) return 'In Company';
    if (!form.sala_id) return '';
    const room = rooms.find((item) => item.sala_id === form.sala_id);
    if (!room) return '';
    const baseLabel = room.sede ? `${room.name} (${room.sede})` : room.name;
    const blocked = blockedRooms.has(room.sala_id);
    return blocked ? `${baseLabel} · No disponible` : baseLabel;
  }, [blockedRooms, form.sala_id, isInCompany, rooms]);

  const roomSelectValue = !ENABLE_ROOMS
    ? ''
    : form.sala_id ?? (isInCompany ? IN_COMPANY_ROOM_VALUE : '');

  const variationDisplay = useMemo(() => {
    const name = typeof dealVariationName === 'string' ? dealVariationName.trim() : '';
    if (name.length) return name;
    if (typeof dealVariation === 'string') {
      const trimmed = dealVariation.trim();
      return trimmed.length ? trimmed : '—';
    }
    return '—';
  }, [dealVariation, dealVariationName]);

  const variationTooltip = useMemo(() => {
    const name = typeof dealVariationName === 'string' ? dealVariationName.trim() : '';
    const id = typeof dealVariation === 'string' ? dealVariation.trim() : '';
    if (name && id && name !== id) {
      return `${name} · ID ${id}`;
    }
    return name || id;
  }, [dealVariation, dealVariationName]);

  const trainingDateDisplay = useMemo(() => {
    if (typeof dealTrainingDate !== 'string') return '—';
    const trimmed = dealTrainingDate.trim();
    if (!trimmed.length) return '—';
    const parsed = new Date(trimmed);
    if (Number.isFinite(parsed.getTime())) {
      try {
        return new Intl.DateTimeFormat('es-ES').format(parsed);
      } catch (error) {
        return trimmed;
      }
    }
    return trimmed;
  }, [dealTrainingDate]);

  const trainingDateTooltip = useMemo(() => {
    if (typeof dealTrainingDate !== 'string') return '';
    return dealTrainingDate.trim();
  }, [dealTrainingDate]);

  const variantSelectDisabled = variantSaving || variantOptionsLoading || variantOptions.length === 0;

  const variantSelectPlaceholder = useMemo(() => {
    if (variantOptionsLoading) return 'Cargando variantes…';
    if (!variantOptions.length) return 'No hay variantes disponibles';
    return 'Selecciona una variante…';
  }, [variantOptionsLoading, variantOptions.length]);

  const handleVariantOptionClick = useCallback(
    async (value: string) => {
      if (variantSelectDisabled) return;

      const normalized = normalizeVariantValue(value);
      setPendingVariantSelection(normalized);
      try {
        if (onVariantSelect) {
          await onVariantSelect(value);
        }
      } finally {
        setPendingVariantSelection(null);
      }
    },
    [normalizeVariantValue, onVariantSelect, variantSelectDisabled],
  );

  useEffect(() => {
    if (!ENABLE_ROOMS) return;
    if (!form.sala_id) return;
    if (rooms.some((room) => room.sala_id === form.sala_id)) return;
    const hadDirtyFields = status.dirty;
    onChange((current) => ({ ...current, sala_id: null }));
    if (!hadDirtyFields && !status.saving) {
      void Promise.resolve(onSave({ notifyOnSuccess: false })).catch(() => undefined);
    }
  }, [form.sala_id, onChange, onSave, rooms, status.dirty, status.saving]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trainerFieldRef.current && !trainerFieldRef.current.contains(target)) {
        setTrainerListOpen(false);
      }
      if (unitFieldRef.current && !unitFieldRef.current.contains(target)) {
        setUnitListOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setTrainerListOpen(false);
    setUnitListOpen(false);
    setPendingVariantSelection(null);
  }, [form.id]);

  useEffect(() => {
    setPendingVariantSelection(null);
  }, [dealVariation]);

  return (
    <div className="session-editor bg-white rounded-3 p-3">
      <Row className="g-3">
        <Col md={6} lg={4}>
          <Form.Group controlId={`session-${form.id}-variation`}>
            <Form.Label>Variante</Form.Label>
            <Form.Control
              plaintext
              readOnly
              value={variationDisplay}
              title={buildFieldTooltip(variationTooltip || variationDisplay)}
            />
            <div className="mt-2">
              {variantOptionsLoading ? (
                <div className="d-flex align-items-center gap-2 text-muted small">
                  <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
                  Cargando variantes…
                </div>
              ) : null}

              {!variantOptionsLoading && variantOptions.length ? (
                <>
                  <div className="text-muted small mb-2">
                    {variantParentName ? (
                      <>
                        Variantes disponibles para <strong>{variantParentName}</strong>
                      </>
                    ) : (
                      'Selecciona la fecha disponible que deseas asignar.'
                    )}
                  </div>
                  <ListGroup
                    as="div"
                    role="listbox"
                    aria-label="Variantes compatibles con el presupuesto"
                    className="variant-selection-list"
                  >
                    {variantOptions.map((option) => {
                      const normalizedValue = normalizeVariantValue(option.value);
                      const isActive = normalizedValue === normalizedCurrentVariation;
                      const isPending =
                        pendingVariantSelection !== null &&
                        pendingVariantSelection === normalizedValue &&
                        variantSaving;
                      return (
                        <ListGroup.Item
                          key={option.value}
                          as="button"
                          type="button"
                          role="option"
                          action
                          active={isActive}
                          aria-selected={isActive}
                          disabled={variantSelectDisabled}
                          onClick={() => {
                            void handleVariantOptionClick(option.value);
                          }}
                          className="d-flex justify-content-between align-items-center gap-3 text-start"
                        >
                          <div className="flex-grow-1">
                            <div className="fw-semibold">{option.label}</div>
                            {option.description ? (
                              <div className="text-muted small">{option.description}</div>
                            ) : null}
                          </div>
                          <span className="d-flex align-items-center gap-2">
                            {isPending ? (
                              <Spinner
                                animation="border"
                                size="sm"
                                role="status"
                                aria-hidden="true"
                              />
                            ) : null}
                            {isActive ? (
                              <Badge bg="light" text="dark">
                                Asignada
                              </Badge>
                            ) : null}
                          </span>
                        </ListGroup.Item>
                      );
                    })}
                  </ListGroup>
                </>
              ) : null}

              {!variantOptionsLoading && !variantOptions.length ? (
                <div className="text-muted small">{variantSelectPlaceholder}</div>
              ) : null}

              {variantSaving ? (
                <div className="d-flex align-items-center gap-2 text-muted mt-2 small">
                  <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
                  Actualizando variante…
                </div>
              ) : null}
            </div>
          </Form.Group>
        </Col>
        <Col md={6} lg={4}>
          <Form.Group controlId={`session-${form.id}-training-date`}>
            <Form.Label>Fecha Formación</Form.Label>
            <Form.Control
              plaintext
              readOnly
              value={trainingDateDisplay}
              title={buildFieldTooltip(trainingDateTooltip || trainingDateDisplay)}
            />
          </Form.Group>
        </Col>
        {ENABLE_SESSION_STATE ? (
          <Col md={6} lg={4}>
            <Form.Group controlId={`session-${form.id}-estado`}>
              <Form.Label>Estado</Form.Label>
              <Form.Select
                value={form.estado}
                onChange={(event) => {
                  const nextValue = event.target.value as SessionEstado;
                  if (!MANUAL_SESSION_ESTADO_SET.has(nextValue)) {
                    return;
                  }
                  onChange((current) => ({ ...current, estado: nextValue }));
                }}
                title={buildFieldTooltip(SESSION_ESTADO_LABELS[form.estado])}
              >
                <option value="BORRADOR">
                  {SESSION_ESTADO_LABELS.BORRADOR}
                </option>
                <option value="PLANIFICADA" disabled>
                  {SESSION_ESTADO_LABELS.PLANIFICADA}
                </option>
                <option value="SUSPENDIDA">{SESSION_ESTADO_LABELS.SUSPENDIDA}</option>
                <option value="CANCELADA">{SESSION_ESTADO_LABELS.CANCELADA}</option>
                <option value="FINALIZADA">{SESSION_ESTADO_LABELS.FINALIZADA}</option>
              </Form.Select>
            </Form.Group>
          </Col>
        ) : null}
      </Row>

      <Row className="g-3 mt-1">
        {ENABLE_TRAINERS ? (
          <Col md={6}>
            <Form.Group controlId={`session-${form.id}-trainers`}>
            <Form.Label>Formadores / Bomberos</Form.Label>
            <div ref={trainerFieldRef} className="session-multiselect">
              <Form.Control
                type="text"
                readOnly
                placeholder="Selecciona formadores"
                value={trainerSummary}
                aria-expanded={trainerListOpen}
                aria-controls={`session-${form.id}-trainers-options`}
                className="session-multiselect-summary"
                onMouseDown={() => {
                  trainerPointerInteractingRef.current = true;
                }}
                onClick={() => {
                  setTrainerListOpen((open) => !open);
                  trainerPointerInteractingRef.current = false;
                }}
                onFocus={() => {
                  if (!trainerPointerInteractingRef.current) {
                    setTrainerListOpen(true);
                  }
                }}
                onBlur={() => {
                  trainerPointerInteractingRef.current = false;
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setTrainerListOpen((open) => !open);
                  }
                }}
                title={buildFieldTooltip(trainerSummary)}
              />
              <Collapse in={trainerListOpen}>
                <div
                  id={`session-${form.id}-trainers-options`}
                  className="session-multiselect-panel mt-2"
                >
                  <Form.Control
                    type="search"
                    placeholder="Buscar"
                    value={trainerFilter}
                    onChange={(event) => setTrainerFilter(event.target.value)}
                    className="mb-2"
                    title={buildFieldTooltip(trainerFilter)}
                  />
                  <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                    <ListGroup variant="flush">
                      {filteredTrainers.map((trainer) => {
                        const label = `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`;
                        const checked = form.trainer_ids.includes(trainer.trainer_id);
                        const blocked = blockedTrainers.has(trainer.trainer_id);
                        const displayLabel = blocked ? `${label} · No disponible` : label;
                        return (
                          <ListGroup.Item
                            key={trainer.trainer_id}
                            className={`py-1${blocked ? ' session-option-unavailable' : ''}`}
                          >
                            <Form.Check
                              type="checkbox"
                              id={`session-${form.id}-trainer-${trainer.trainer_id}`}
                              className={blocked ? 'session-option-unavailable' : undefined}
                              label={displayLabel}
                              checked={checked}
                              disabled={blocked && !checked}
                              onChange={(event) =>
                                onChange((current) => {
                                  const set = new Set(current.trainer_ids);
                                  if (event.target.checked) {
                                    set.add(trainer.trainer_id);
                                  } else {
                                    set.delete(trainer.trainer_id);
                                  }
                                  return { ...current, trainer_ids: Array.from(set) };
                                })
                              }
                            />
                          </ListGroup.Item>
                        );
                      })}
                      {!filteredTrainers.length && (
                        <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                      )}
                    </ListGroup>
                  </div>
                </div>
              </Collapse>
            </div>
          </Form.Group>
        </Col>
        ) : null}
        {ENABLE_MOBILE_UNITS ? (
          <Col md={6}>
          <Form.Group controlId={`session-${form.id}-units`}>
            <Form.Label>Unidades móviles</Form.Label>
            <div ref={unitFieldRef} className="session-multiselect">
              <Form.Control
                type="text"
                readOnly
                placeholder="Selecciona unidades móviles"
                value={unitSummary}
                aria-expanded={unitListOpen}
                aria-controls={`session-${form.id}-units-options`}
                className="session-multiselect-summary"
                onMouseDown={() => {
                  unitPointerInteractingRef.current = true;
                }}
                onClick={() => {
                  setUnitListOpen((open) => !open);
                  unitPointerInteractingRef.current = false;
                }}
                onFocus={() => {
                  if (!unitPointerInteractingRef.current) {
                    setUnitListOpen(true);
                  }
                }}
                onBlur={() => {
                  unitPointerInteractingRef.current = false;
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setUnitListOpen((open) => !open);
                  }
                }}
                title={buildFieldTooltip(unitSummary)}
              />
              <Collapse in={unitListOpen}>
                <div id={`session-${form.id}-units-options`} className="session-multiselect-panel mt-2">
                  <Form.Control
                    type="search"
                    placeholder="Buscar"
                    value={unitFilter}
                    onChange={(event) => setUnitFilter(event.target.value)}
                    className="mb-2"
                    title={buildFieldTooltip(unitFilter)}
                  />
                  <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                    <ListGroup variant="flush">
                      {filteredUnits.map((unit) => {
                        const label = unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name;
                        const checked = form.unidad_movil_ids.includes(unit.unidad_id);
                        const blocked = blockedUnits.has(unit.unidad_id);
                        const displayLabel = blocked ? `${label} · No disponible` : label;
                        return (
                          <ListGroup.Item
                            key={unit.unidad_id}
                            className={`py-1${blocked ? ' session-option-unavailable' : ''}`}
                          >
                            <Form.Check
                              type="checkbox"
                              id={`session-${form.id}-unit-${unit.unidad_id}`}
                              className={blocked ? 'session-option-unavailable' : undefined}
                              label={displayLabel}
                              checked={checked}
                              disabled={blocked && !checked}
                              onChange={(event) =>
                                onChange((current) => {
                                  const set = new Set(current.unidad_movil_ids);
                                  if (event.target.checked) {
                                    set.add(unit.unidad_id);
                                  } else {
                                    set.delete(unit.unidad_id);
                                  }
                                  return { ...current, unidad_movil_ids: Array.from(set) };
                                })
                              }
                            />
                          </ListGroup.Item>
                        );
                      })}
                      {!filteredUnits.length && (
                        <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                      )}
                    </ListGroup>
                  </div>
                </div>
              </Collapse>
            </div>
          </Form.Group>
          </Col>
        ) : null}
      </Row>

      <Row className="g-3 mt-1">
        {ENABLE_ROOMS ? (
          <Col md={6} lg={4}>
            <Form.Group controlId={`session-${form.id}-sala`}>
            <Form.Label>Sala</Form.Label>
            <Form.Select
              value={roomSelectValue}
              onChange={(event) =>
                onChange((current) => {
                  const nextValue = event.target.value;
                  return {
                    ...current,
                    sala_id: nextValue && nextValue !== IN_COMPANY_ROOM_VALUE ? nextValue : null,
                  };
                })
              }
              title={buildFieldTooltip(selectedRoomLabel)}
            >
              {isInCompany && (
                <option value={IN_COMPANY_ROOM_VALUE}>In Company</option>
              )}
              <option value="">Sin sala asignada</option>
              {rooms.map((room) => {
                const label = room.sede ? `${room.name} (${room.sede})` : room.name;
                const blocked = blockedRooms.has(room.sala_id);
                const displayLabel = blocked ? `${label} · No disponible` : label;
                return (
                  <option
                    key={room.sala_id}
                    value={room.sala_id}
                    disabled={blocked && form.sala_id !== room.sala_id}
                    className={blocked ? 'session-option-unavailable' : undefined}
                    style={blocked ? { color: '#dc3545', fontWeight: 600 } : undefined}
                  >
                    {displayLabel}
                  </option>
                );
              })}
            </Form.Select>
          </Form.Group>
        </Col>
        ) : null}
        {ENABLE_ADDRESS ? (
          <Col md={ENABLE_ROOMS ? 6 : 12} lg={ENABLE_ROOMS ? 8 : 8}>
            <Form.Group controlId={`session-${form.id}-direccion`}>
              <Form.Label>Dirección</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control
                  value={form.direccion}
                  onChange={(event) =>
                    onChange((current) => ({ ...current, direccion: event.target.value ?? '' }))
                  }
                  title={buildFieldTooltip(form.direccion)}
                />
                <Button
                  variant="outline-primary"
                  onClick={() => {
                    if (form.direccion.trim()) {
                      onOpenMap(form.direccion);
                    }
                  }}
                  disabled={!form.direccion.trim()}
                >
                  Ver
                </Button>
              </div>
            </Form.Group>
          </Col>
        ) : null}
      </Row>

      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3 mt-3">
        <div className="text-md-start text-end flex-grow-1">
          {status.saving ? (
            <span className="text-primary d-inline-flex align-items-center gap-2">
              <Spinner size="sm" animation="border" /> Guardando…
            </span>
          ) : status.error ? (
            <span className="text-danger">{status.error}</span>
          ) : status.dirty ? (
            <span className="text-warning">Cambios sin guardar</span>
          ) : status.savedAt ? (
            <span className="text-success">Guardado ✓</span>
          ) : null}
        </div>
        <div className="d-flex justify-content-end">
          <Button variant="primary" onClick={handleManualSave} disabled={!status.dirty || status.saving}>
            {status.saving ? (
              <span className="d-inline-flex align-items-center gap-2">
                <Spinner size="sm" animation="border" role="status" aria-hidden="true" /> Guardando…
              </span>
            ) : (
              'Guardar cambios'
            )}
          </Button>
        </div>
      </div>

      {ENABLE_SESSION_COMMENTS ? (
        <SessionCommentsSection
          sessionId={form.id}
          dealId={dealId}
          onNotify={onNotify}
          driveUrl={form.drive_url ?? null}
        />
      ) : null}
    </div>
  );
}

function SessionCommentsSection({
  sessionId,
  dealId,
  onNotify,
  driveUrl,
}: {
  sessionId: string;
  dealId: string;
  onNotify?: (toast: ToastParams) => void;
  driveUrl?: string | null;
}) {
  const { userId, userName } = useCurrentUserIdentity();

  const qc = useQueryClient();

  const [newCommentContent, setNewCommentContent] = useState('');
  const [newCommentShare, setNewCommentShare] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentContent, setEditingCommentContent] = useState('');
  const [editingCommentShare, setEditingCommentShare] = useState(false);
  const [viewingComment, setViewingComment] = useState<SessionComment | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [updatingCommentId, setUpdatingCommentId] = useState<string | null>(null);

  useEffect(() => {
    setEditingCommentId(null);
    setEditingCommentContent('');
    setEditingCommentShare(false);
    setViewingComment(null);
    setCommentError(null);
    setDeletingCommentId(null);
    setUpdatingCommentId(null);
    setNewCommentContent('');
    setNewCommentShare(false);
  }, [sessionId]);

  const commentsQuery = useQuery({
    queryKey: ['session-comments', sessionId],
    queryFn: () => fetchSessionComments(sessionId),
    enabled: Boolean(sessionId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const comments = commentsQuery.data ?? [];
  const commentsLoading = commentsQuery.isLoading;
  const commentsFetching = commentsQuery.isFetching;
  const queryError =
    commentsQuery.error instanceof Error ? commentsQuery.error.message : commentsQuery.error ? 'No se pudieron cargar los comentarios' : null;

  const createCommentMutation = useMutation({
    mutationFn: (input: { content: string; compartir_formador: boolean }) =>
      createSessionComment(
        sessionId,
        { content: input.content, compartir_formador: input.compartir_formador },
        { id: userId, name: userName },
      ),
  });

  const updateCommentMutation = useMutation({
    mutationFn: (
      input: { commentId: string; content?: string; compartir_formador?: boolean },
    ) =>
      updateSessionComment(
        sessionId,
        input.commentId,
        { content: input.content, compartir_formador: input.compartir_formador },
        {
          id: userId,
          name: userName,
        },
      ),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) =>
      deleteSessionComment(sessionId, commentId, { id: userId, name: userName }),
  });

  const displayOrDash = (value?: string | null) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length ? text : '—';
  };

  const handleCreateComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newCommentContent.trim();
    if (!trimmed) return;
    setCommentError(null);
    try {
      await createCommentMutation.mutateAsync({
        content: trimmed,
        compartir_formador: newCommentShare,
      });
      setNewCommentContent('');
      setNewCommentShare(false);
      await qc.invalidateQueries({ queryKey: ['session-comments', sessionId] });
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo guardar el comentario';
      setCommentError(message);
    }
  };

  const startEditingComment = (comment: SessionComment) => {
    if (!comment?.id) return;
    setEditingCommentId(comment.id);
    setEditingCommentContent(comment.content ?? '');
    setEditingCommentShare(Boolean(comment.compartir_formador));
    setCommentError(null);
  };

  const cancelEditingComment = () => {
    setEditingCommentId(null);
    setEditingCommentContent('');
    setEditingCommentShare(false);
    setUpdatingCommentId(null);
  };

  const handleUpdateComment = async (comment: SessionComment) => {
    if (!comment?.id) return;
    const trimmed = editingCommentContent.trim();
    if (!trimmed) return;
    setCommentError(null);
    setUpdatingCommentId(comment.id);
    try {
      await updateCommentMutation.mutateAsync({
        commentId: comment.id,
        content: trimmed,
        compartir_formador: editingCommentShare,
      });
      cancelEditingComment();
      await qc.invalidateQueries({ queryKey: ['session-comments', sessionId] });
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo actualizar el comentario';
      setCommentError(message);
    } finally {
      setUpdatingCommentId(null);
    }
  };

  const handleToggleCommentShare = async (comment: SessionComment, checked: boolean) => {
    if (!comment?.id) return;
    setCommentError(null);
    setUpdatingCommentId(comment.id);
    try {
      await updateCommentMutation.mutateAsync({
        commentId: comment.id,
        compartir_formador: checked,
      });
      setViewingComment((current) =>
        current && current.id === comment.id ? { ...current, compartir_formador: checked } : current,
      );
      await qc.invalidateQueries({ queryKey: ['session-comments', sessionId] });
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo actualizar el comentario';
      setCommentError(message);
    } finally {
      setUpdatingCommentId(null);
    }
  };

  const handleDeleteComment = async (comment: SessionComment) => {
    if (!comment?.id) return;
    setCommentError(null);
    setDeletingCommentId(comment.id);
    try {
      await deleteCommentMutation.mutateAsync(comment.id);
      if (viewingComment?.id === comment.id) {
        setViewingComment(null);
      }
      await qc.invalidateQueries({ queryKey: ['session-comments', sessionId] });
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo eliminar el comentario';
      setCommentError(message);
    } finally {
      setDeletingCommentId(null);
    }
  };

  const commentCount = comments.length;

  return (
    <>
      <Accordion defaultActiveKey={[]} alwaysOpen className="mt-4">
        <Accordion.Item eventKey={`session-comments-${sessionId}`}>
          <Accordion.Header>
            <div className="d-flex justify-content-between align-items-center w-100">
              <span className="erp-accordion-title">
                Comentarios
                {commentCount > 0 ? <span className="erp-accordion-count">{commentCount}</span> : null}
              </span>
            </div>
          </Accordion.Header>
          <Accordion.Body>
            {queryError ? (
              <Alert variant="danger" className="mb-3">
                {queryError}
              </Alert>
            ) : null}
            {commentError ? (
              <Alert variant="danger" className="mb-3">
                {commentError}
              </Alert>
            ) : null}
            {commentsLoading ? (
              <div className="d-flex align-items-center gap-2 mb-3">
                <Spinner animation="border" size="sm" /> Cargando comentarios…
              </div>
            ) : null}
            {!commentsLoading && commentsFetching ? (
              <div className="text-muted small mb-3">Actualizando comentarios…</div>
            ) : null}
            {comments.length ? (
              <ListGroup className="mb-3">
                {comments.map((comment, index) => {
                  const key = comment.id ?? `session-comment-${index}`;
                  const authorName = comment.author ?? '';
                  const normalizedAuthor = authorName.trim().toLowerCase();
                  const normalizedUser = userName.trim().toLowerCase();
                  const canEdit = normalizedAuthor.length && normalizedAuthor === normalizedUser;
                  const isEditing = editingCommentId === comment.id;
                  const isDeleting = deletingCommentId === comment.id;
                  const isUpdating = updatingCommentId === comment.id && updateCommentMutation.isPending;
                  const canOpen = !isEditing && !isDeleting;

                  return (
                    <ListGroup.Item
                      key={key}
                      action={canOpen}
                      disabled={isDeleting}
                      onClick={canOpen ? () => setViewingComment(comment) : undefined}
                    >
                      {isEditing ? (
                        <>
                          <Form.Control
                            as="textarea"
                            rows={3}
                            value={editingCommentContent}
                            onChange={(event) => setEditingCommentContent(event.target.value)}
                            disabled={isUpdating}
                            title={buildFieldTooltip(editingCommentContent)}
                          />
                          <Form.Check
                            type="switch"
                            id={`session-comment-share-edit-${comment.id}`}
                            className="mt-2"
                            label="Compartir con formador"
                            checked={editingCommentShare}
                            onChange={(event) => setEditingCommentShare(event.target.checked)}
                            onClick={(event) => event.stopPropagation()}
                            disabled={isUpdating}
                          />
                          <div className="d-flex justify-content-end gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                cancelEditingComment();
                              }}
                              disabled={isUpdating}
                            >
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleUpdateComment(comment);
                              }}
                              disabled={isUpdating || !editingCommentContent.trim().length}
                            >
                              {isUpdating ? <Spinner animation="border" size="sm" role="status" /> : 'Guardar'}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="d-flex flex-column flex-sm-row justify-content-between align-items-sm-start gap-2">
                            <p className="mb-2 flex-grow-1 text-break" style={{ whiteSpace: 'pre-line' }}>
                              {displayOrDash(comment.content)}
                            </p>
                            <Form.Check
                              type="switch"
                              id={`session-comment-share-${comment.id}`}
                              className="mt-sm-1"
                              label="Compartir con formador"
                              checked={Boolean(comment.compartir_formador)}
                              onChange={(event) => {
                                event.stopPropagation();
                                if (!canEdit) return;
                                handleToggleCommentShare(comment, event.target.checked);
                              }}
                              onClick={(event) => event.stopPropagation()}
                              disabled={isDeleting || isUpdating || !canEdit}
                            />
                          </div>
                          <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                            <small className="text-muted mb-0">Autor: {displayOrDash(comment.author)}</small>
                            {canEdit ? (
                              <div className="d-flex align-items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    startEditingComment(comment);
                                  }}
                                  disabled={isDeleting}
                                >
                                  Editar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline-danger"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteComment(comment);
                                  }}
                                  disabled={isDeleting}
                                >
                                  {isDeleting ? (
                                    <Spinner animation="border" size="sm" role="status" />
                                  ) : (
                                    'Eliminar'
                                  )}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </>
                      )}
                    </ListGroup.Item>
                  );
                })}
              </ListGroup>
            ) : null}

            <Form onSubmit={handleCreateComment} className="mb-3">
              <Form.Group controlId={`session-${sessionId}-comment-content`}>
                <Form.Label className="fw-semibold">Añadir comentario</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={newCommentContent}
                  onChange={(event) => setNewCommentContent(event.target.value)}
                  disabled={createCommentMutation.isPending}
                  placeholder="Escribe un comentario"
                  title={buildFieldTooltip(newCommentContent)}
                />
                <Form.Check
                  type="switch"
                  id={`session-${sessionId}-comment-share`}
                  className="mt-2"
                  label="Compartir con formador"
                  checked={newCommentShare}
                  onChange={(event) => setNewCommentShare(event.target.checked)}
                  disabled={createCommentMutation.isPending}
                />
              </Form.Group>
              <div className="d-flex justify-content-end align-items-center gap-2 mt-2">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={createCommentMutation.isPending || !newCommentContent.trim().length}
                >
                  {createCommentMutation.isPending ? (
                    <Spinner size="sm" animation="border" role="status" />
                  ) : (
                    'Guardar comentario'
                  )}
                </Button>
              </div>
            </Form>

            {commentCount === 0 && !commentsLoading ? (
              <>
                <hr className="text-muted" />
                <p className="text-muted small mb-0">Sin comentarios</p>
              </>
            ) : null}
          </Accordion.Body>
        </Accordion.Item>
        {ENABLE_SESSION_DOCUMENTS ? (
          <SessionDocumentsAccordionItem
            sessionId={sessionId}
            dealId={dealId}
            onNotify={onNotify}
            initialDriveUrl={driveUrl ?? null}
          />
        ) : null}
        <SessionStudentsAccordionItem
          dealId={dealId}
          sessionId={sessionId}
          onNotify={onNotify}
        />
      </Accordion>

      <Modal show={!!viewingComment} onHide={() => setViewingComment(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Comentario</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            <strong>Autor:</strong> {displayOrDash(viewingComment?.author ?? null)}
          </p>
          <p className="mb-0 text-break" style={{ whiteSpace: 'pre-line' }}>
            {displayOrDash(viewingComment?.content ?? null)}
          </p>
        </Modal.Body>
      </Modal>
    </>
  );
}
