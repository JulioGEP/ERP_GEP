// frontend/src/pages/usuarios/trainer/TrainerSessionsPage.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  ListGroup,
  Row,
  Spinner,
  Stack,
  Table,
} from 'react-bootstrap';
import {
  fetchTrainerSessions,
  fetchTrainerSessionTimeLog,
  saveTrainerSessionTimeLog,
  type TrainerSessionDetail,
  type TrainerSessionsDateEntry,
  type TrainerSessionTrainer,
  type TrainerSessionTimeLog,
  type TrainerVariantDeal,
  type TrainerVariantDetail,
} from '../../../api/trainer-sessions';
import {
  fetchSessionComments,
  createSessionComment,
  updateSessionComment,
  deleteSessionComment,
  fetchDealSessions,
} from '../../../features/presupuestos/api/sessions.api';
import {
  fetchSessionDocuments,
  uploadSessionDocuments,
  deleteSessionDocument,
} from '../../../features/presupuestos/api/documents.api';
import {
  createSessionStudent,
  fetchDealStudents,
  fetchSessionStudents,
  updateSessionStudent,
  type UpdateSessionStudentInput,
} from '../../../features/presupuestos/api/students.api';
import { createVariantComment, fetchVariantComments } from '../../../features/formacion_abierta/api';
import type { VariantComment } from '../../../features/formacion_abierta/types';
import type { SessionComment, SessionStudent } from '../../../api/sessions.types';
import type { ReportDraft, ReportSessionInfo } from '../../../features/informes/ReportsFlow';
import { useCurrentUserIdentity } from '../../../features/presupuestos/useCurrentUserIdentity';
import { fetchDealDetail, uploadManualDocument, deleteDocument } from '../../../features/presupuestos/api/deals.api';
import type { DealDocument, DealNote } from '../../../types/deal';
import type { SessionDocumentsPayload } from '../../../api/sessions.types';

const TRAINER_EXPENSE_FOLDER_NAME = 'Gastos Formador';

function formatDateLabel(date: string): string {
  const parts = date.split('-').map((value) => Number.parseInt(value, 10));
  if (parts.length !== 3 || parts.some((value) => Number.isNaN(value))) {
    return date;
  }
  const [year, month, day] = parts;
  const formatter = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const label = formatter.format(new Date(Date.UTC(year, month - 1, day)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return formatter.format(parsed);
}

function formatDateTimeLocalInput(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTimeLocalInput(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function renderBooleanField(field: { value: boolean | null; label: string | null }): string {
  if (field.label && field.label.trim().length) {
    return field.label.trim();
  }
  if (field.value === true) return 'Sí';
  if (field.value === false) return 'No';
  return '—';
}

function isSessionConfirmed(session: TrainerSessionDetail): boolean {
  const status = session.trainerInviteStatus;
  return status === 'CONFIRMED';
}

function isSessionPending(session: TrainerSessionDetail): boolean {
  return session.trainerInviteStatus === 'PENDING';
}

function formatTrainerName(trainer: TrainerSessionTrainer): string {
  const parts = [trainer.name ?? '', trainer.lastName ?? '']
    .map((value) => value.trim())
    .filter((value) => value.length);
  if (parts.length) {
    return parts.join(' ');
  }
  return trainer.trainerId;
}

type InfoFieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

function InfoField({ label, children, className }: InfoFieldProps) {
  return (
    <div className={className}>
      <span className="text-uppercase text-muted small fw-semibold d-block">{label}</span>
      <div className="text-break">{children}</div>
    </div>
  );
}

type SessionDetailCardProps = {
  session: TrainerSessionDetail;
};

export function SessionDetailCard({ session }: SessionDetailCardProps) {
  const queryClient = useQueryClient();
  const { userId, userName } = useCurrentUserIdentity();
  const mapsUrl = session.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(session.address)}`
    : null;
  const isGepServices = session.isGepServices;
  const isCompanyTraining = session.isCompanyTraining;

  const reportType = useMemo(() => {
    if (isCompanyTraining) return 'formacion' as const;
    if (isGepServices) {
      const template = (session.formationTemplate ?? '').trim().toLowerCase();
      if (template.includes('simulacro')) return 'simulacro' as const;
      if (template.includes('ebro')) return 'preventivo-ebro' as const;
      return 'preventivo' as const;
    }
    return null;
  }, [isCompanyTraining, isGepServices, session.formationTemplate]);

  const reportPrefill = useMemo<Partial<ReportDraft> | null>(() => {
    if (!reportType) return null;

    const sessionInfo: ReportSessionInfo = {
      id: session.sessionId,
      number: session.budgetNumber,
      nombre: session.formationName ?? session.sessionTitle ?? null,
      direccion: session.address ?? null,
      fecha: session.startDate ?? null,
      label: session.sessionTitle ?? session.formationName ?? null,
    };

    const datos: Record<string, string> = {};
    if (session.organizationName) datos.cliente = session.organizationName;
    if (session.address) datos.sede = session.address;
    if (session.clientName) datos.contacto = session.clientName;
    if (session.commercialName) datos.comercial = session.commercialName;
    if (userName) datos.formadorNombre = userName;
    if (session.startDate) datos.fecha = session.startDate;
    if (session.formationName) datos.formacionTitulo = session.formationName;

    return {
      dealId: session.dealId,
      datos,
      session: sessionInfo,
      sessionOptions: [sessionInfo],
    } satisfies Partial<ReportDraft>;
  }, [reportType, session.address, session.budgetNumber, session.clientName, session.commercialName, session.dealId, session.formationName, session.sessionId, session.sessionTitle, session.startDate, session.organizationName, userName]);

  const reportLink = useMemo(() => {
    if (!reportType || !reportPrefill) return null;
    const pathSegment = reportType === 'preventivo-ebro' ? 'recurso_preventivo_ebro' : reportType;
    const label =
      reportType === 'formacion'
        ? 'Generar informe de formación'
        : reportType === 'simulacro'
        ? 'Generar informe de simulacro'
        : 'Generar informe de servicios';

    return {
      to: `/usuarios/trainer/informes/${pathSegment}`,
      label,
      state: { reportPrefill },
    } as const;
  }, [reportPrefill, reportType]);

  const timeLogQuery = useQuery<TrainerSessionTimeLog | null>({
    queryKey: ['trainer', 'session', session.sessionId, 'time-log'],
    queryFn: () => fetchTrainerSessionTimeLog({ sessionId: session.sessionId }),
  });

  const commentsQuery = useQuery({
    queryKey: ['trainer', 'session', session.sessionId, 'comments'],
    queryFn: () => fetchSessionComments(session.sessionId),
  });

  const filteredComments = useMemo(() => {
    return (commentsQuery.data ?? []).filter((comment) => comment.compartir_formador);
  }, [commentsQuery.data]);

  const [timeLogEntryValue, setTimeLogEntryValue] = useState('');
  const [timeLogExitValue, setTimeLogExitValue] = useState('');
  const [timeLogError, setTimeLogError] = useState<string | null>(null);
  const [timeLogSuccess, setTimeLogSuccess] = useState(false);
  const timeLogInitializedRef = useRef(false);
  const timeLogKeyRef = useRef<string | null>(null);

  useEffect(() => {
    timeLogInitializedRef.current = false;
    timeLogKeyRef.current = null;
    setTimeLogError(null);
    setTimeLogSuccess(false);
  }, [session.sessionId]);

  useEffect(() => {
    if (timeLogQuery.isLoading) return;
    const record = timeLogQuery.data ?? null;
    const entrySource = record?.checkIn ?? record?.scheduledStart ?? session.startDate ?? null;
    const exitSource = record?.checkOut ?? record?.scheduledEnd ?? session.endDate ?? null;
    const key = record
      ? `${record.checkIn ?? ''}|${record.checkOut ?? ''}|${record.updatedAt ?? ''}`
      : `session:${session.startDate ?? ''}|${session.endDate ?? ''}`;
    if (timeLogInitializedRef.current && timeLogKeyRef.current === key) {
      return;
    }
    timeLogInitializedRef.current = true;
    timeLogKeyRef.current = key;
    setTimeLogEntryValue(formatDateTimeLocalInput(entrySource));
    setTimeLogExitValue(formatDateTimeLocalInput(exitSource));
    if (!timeLogQuery.isError) {
      setTimeLogError(null);
    }
  }, [
    session.endDate,
    session.startDate,
    timeLogQuery.data,
    timeLogQuery.isError,
    timeLogQuery.isLoading,
  ]);

  useEffect(() => {
    if (!timeLogSuccess) return;
    const timeout = window.setTimeout(() => setTimeLogSuccess(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [timeLogSuccess]);

  const timeLogLoadErrorMessage = useMemo(() => {
    if (!timeLogQuery.isError) return null;
    const error = timeLogQuery.error;
    if (error instanceof Error) {
      const message = error.message?.trim();
      if (message?.length) {
        return message;
      }
    }
    return 'No se pudo cargar el registro horario.';
  }, [timeLogQuery.error, timeLogQuery.isError]);

  const formattedTimeLogUpdated = useMemo(
    () => formatDateTime(timeLogQuery.data?.updatedAt ?? null),
    [timeLogQuery.data?.updatedAt],
  );

  const hasExistingTimeLog = useMemo(() => {
    const log = timeLogQuery.data;
    if (!log) return false;
    return Boolean(log.id ?? log.checkIn ?? log.checkOut ?? log.updatedAt);
  }, [timeLogQuery.data]);

  const saveTimeLogMutation = useMutation({
    mutationFn: async ({ entry, exit }: { entry: string; exit: string }) =>
      saveTrainerSessionTimeLog({
        sessionId: session.sessionId,
        checkIn: entry,
        checkOut: exit,
        scheduledStart: session.startDate ?? null,
        scheduledEnd: session.endDate ?? null,
      }),
    onSuccess: (log) => {
      queryClient.setQueryData<TrainerSessionTimeLog | null>(
        ['trainer', 'session', session.sessionId, 'time-log'],
        log,
      );
      setTimeLogEntryValue(
        formatDateTimeLocalInput(
          log.checkIn ?? log.scheduledStart ?? session.startDate ?? null,
        ),
      );
      setTimeLogExitValue(
        formatDateTimeLocalInput(
          log.checkOut ?? log.scheduledEnd ?? session.endDate ?? null,
        ),
      );
      const key = `${log.checkIn ?? ''}|${log.checkOut ?? ''}|${log.updatedAt ?? ''}`;
      timeLogKeyRef.current = key;
      timeLogInitializedRef.current = true;
      setTimeLogError(null);
      setTimeLogSuccess(true);
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setTimeLogError(error.message);
      } else {
        setTimeLogError('No se pudo guardar el registro horario.');
      }
    },
  });

  const handleTimeLogSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setTimeLogError(null);
      const entryIso = parseDateTimeLocalInput(timeLogEntryValue);
      const exitIso = parseDateTimeLocalInput(timeLogExitValue);
      if (!entryIso || !exitIso) {
        setTimeLogError('Introduce fechas y horas válidas para el registro.');
        return;
      }
      if (new Date(exitIso).getTime() <= new Date(entryIso).getTime()) {
        setTimeLogError('La hora de salida debe ser posterior a la hora de entrada.');
        return;
      }
      saveTimeLogMutation.mutate({ entry: entryIso, exit: exitIso });
    },
    [saveTimeLogMutation, timeLogEntryValue, timeLogExitValue],
  );

  const [commentContent, setCommentContent] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentContent, setEditingCommentContent] = useState('');
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const commentMutation = useMutation({
    mutationFn: async (content: string) =>
      createSessionComment(
        session.sessionId,
        { content, compartir_formador: true },
        { id: userId, name: userName },
      ),
    onSuccess: (created) => {
      setCommentError(null);
      setCommentContent('');
      queryClient.setQueryData<SessionComment[] | undefined>(
        ['trainer', 'session', session.sessionId, 'comments'],
        (previous) => (previous ? [created, ...previous] : [created]),
      );
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setCommentError(error.message);
      } else {
        setCommentError('No se pudo guardar el comentario.');
      }
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, content }: { commentId: string; content: string }) =>
      updateSessionComment(
        session.sessionId,
        commentId,
        { content },
        { id: userId, name: userName },
      ),
    onSuccess: (updated) => {
      setCommentError(null);
      setEditingCommentId(null);
      setEditingCommentContent('');
      setSavingCommentId(null);
      queryClient.setQueryData<SessionComment[] | undefined>(
        ['trainer', 'session', session.sessionId, 'comments'],
        (previous) =>
          previous
            ? previous.map((comment) => (comment.id === updated.id ? updated : comment))
            : previous,
      );
    },
    onError: (error: unknown) => {
      setSavingCommentId(null);
      if (error instanceof Error) {
        setCommentError(error.message);
      } else {
        setCommentError('No se pudo actualizar el comentario.');
      }
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) =>
      deleteSessionComment(session.sessionId, commentId, { id: userId, name: userName }),
    onSuccess: (_data, commentId) => {
      setCommentError(null);
      setDeletingCommentId(null);
      setEditingCommentId((current) => {
        if (current === commentId) {
          setEditingCommentContent('');
          return null;
        }
        return current;
      });
      setSavingCommentId((current) => (current === commentId ? null : current));
      queryClient.setQueryData<SessionComment[] | undefined>(
        ['trainer', 'session', session.sessionId, 'comments'],
        (previous) =>
          previous ? previous.filter((comment) => comment.id !== commentId) : previous,
      );
    },
    onError: (error: unknown) => {
      setDeletingCommentId(null);
      if (error instanceof Error) {
        setCommentError(error.message);
      } else {
        setCommentError('No se pudo eliminar el comentario.');
      }
    },
  });

  const documentsQuery = useQuery({
    queryKey: ['trainer', 'session', session.sessionId, 'documents'],
    queryFn: () => fetchSessionDocuments(session.dealId, session.sessionId),
  });

  const sharedDocuments = useMemo(() => {
    return documentsQuery.data?.documents.filter((doc) => doc.compartir_formador) ?? [];
  }, [documentsQuery.data]);

  const normalizedUserId = useMemo(() => userId.trim().toLowerCase(), [userId]);
  const normalizedUserName = useMemo(() => userName.trim().toLowerCase(), [userName]);
  const trainerDisplayName = useMemo(() => userName.trim(), [userName]);

  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isExpense, setIsExpense] = useState(false);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const trainerDocumentStorageKey = useMemo(
    () => `trainer-session-${session.sessionId}-${userId}-documents`,
    [session.sessionId, userId],
  );

  const [trainerDocumentIds, setTrainerDocumentIds] = useState<string[]>([]);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(trainerDocumentStorageKey);
      if (!stored) {
        setTrainerDocumentIds([]);
        return;
      }
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length);
        setTrainerDocumentIds(normalized);
      } else {
        setTrainerDocumentIds([]);
      }
    } catch {
      setTrainerDocumentIds([]);
    }
  }, [trainerDocumentStorageKey]);

  const persistTrainerDocumentIds = useCallback(
    (ids: string[]) => {
      if (typeof window === 'undefined') return;
      if (!ids.length) {
        window.localStorage.removeItem(trainerDocumentStorageKey);
        return;
      }
      window.localStorage.setItem(trainerDocumentStorageKey, JSON.stringify(ids));
    },
    [trainerDocumentStorageKey],
  );

  const updateTrainerDocumentIds = useCallback(
    (updater: (current: Set<string>) => Set<string>) => {
      setTrainerDocumentIds((currentList) => {
        const currentSet = new Set(currentList);
        const nextSet = updater(currentSet);
        const currentSorted = Array.from(currentSet).sort();
        const nextSorted = Array.from(nextSet).sort();
        const isSame =
          currentSorted.length === nextSorted.length &&
          currentSorted.every((value, index) => value === nextSorted[index]);
        if (isSame) return currentList;
        const nextList = Array.from(nextSet);
        persistTrainerDocumentIds(nextList);
        return nextList;
      });
    },
    [persistTrainerDocumentIds],
  );

  useEffect(() => {
    if (!documentsQuery.isFetched || documentsQuery.isError) return;
    updateTrainerDocumentIds((current) => {
      if (!sharedDocuments.length) return new Set<string>();
      const available = new Set(sharedDocuments.map((doc) => doc.id));
      const next = new Set<string>();
      current.forEach((value) => {
        if (available.has(value)) {
          next.add(value);
        }
      });
      return next;
    });
  }, [documentsQuery.isError, documentsQuery.isFetched, sharedDocuments, updateTrainerDocumentIds]);

  const trainerDocumentIdSet = useMemo(() => new Set(trainerDocumentIds), [trainerDocumentIds]);

  const documentMutation = useMutation({
    mutationFn: async ({ files, trainerExpense }: { files: File[]; trainerExpense: boolean }) =>
      uploadSessionDocuments({
        dealId: session.dealId,
        sessionId: session.sessionId,
        files,
        shareWithTrainer: true,
        trainerExpense,
        trainerName: trainerDisplayName,
        expenseFolderName: TRAINER_EXPENSE_FOLDER_NAME,
      }),
    onSuccess: (payload) => {
      setDocumentError(null);
      if (documentInputRef.current) {
        documentInputRef.current.value = '';
      }
      updateTrainerDocumentIds((current) => {
        const next = new Set(current);
        payload.documents.forEach((doc) => {
          if (doc.id) {
            next.add(doc.id);
          }
        });
        return next;
      });
      queryClient.setQueryData<SessionDocumentsPayload | undefined>(
        ['trainer', 'session', session.sessionId, 'documents'],
        (previous) => {
          const previousDocs = previous?.documents ?? [];
          const existingIds = new Set(payload.documents.map((doc) => doc.id));
          const combinedDocs = [
            ...payload.documents,
            ...previousDocs.filter((doc) => !existingIds.has(doc.id)),
          ];
          const driveUrl = payload.driveUrl ?? previous?.driveUrl ?? null;
          return { documents: combinedDocs, driveUrl };
        },
      );
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setDocumentError(error.message);
      } else {
        setDocumentError('No se pudieron subir los documentos.');
      }
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: string) =>
      deleteSessionDocument(session.dealId, session.sessionId, documentId),
    onSuccess: (_data, documentId) => {
      setDocumentError(null);
      setDeletingDocumentId(null);
      updateTrainerDocumentIds((current) => {
        const next = new Set(current);
        next.delete(documentId);
        return next;
      });
      queryClient.setQueryData<SessionDocumentsPayload | undefined>(
        ['trainer', 'session', session.sessionId, 'documents'],
        (previous) => {
          if (!previous) return previous;
          return {
            driveUrl: previous.driveUrl,
            documents: previous.documents.filter((doc) => doc.id !== documentId),
          };
        },
      );
    },
    onError: (error: unknown) => {
      setDeletingDocumentId(null);
      if (error instanceof Error) {
        setDocumentError(error.message);
      } else {
        setDocumentError('No se pudo eliminar el documento.');
      }
    },
  });

  const studentsQuery = useQuery({
    queryKey: ['trainer', 'session', session.sessionId, 'students'],
    queryFn: () => fetchSessionStudents(session.dealId, session.sessionId),
    enabled: !isGepServices,
  });

  const [students, setStudents] = useState<SessionStudent[]>([]);
  const studentsOriginalRef = useRef<Map<string, SessionStudent>>(new Map());
  const [studentError, setStudentError] = useState<string | null>(null);
  const [newStudent, setNewStudent] = useState({
    nombre: '',
    apellido: '',
    dni: '',
    asistencia: false,
    apto: false,
  });

  useEffect(() => {
    if (isGepServices) {
      setStudents([]);
      studentsOriginalRef.current = new Map();
      return;
    }

    if (studentsQuery.data) {
      setStudents(studentsQuery.data);
      const map = new Map<string, SessionStudent>();
      studentsQuery.data.forEach((student) => {
        map.set(student.id, student);
      });
      studentsOriginalRef.current = map;
    } else if (!studentsQuery.isLoading && !studentsQuery.isError) {
      setStudents([]);
      studentsOriginalRef.current = new Map();
    }
  }, [isGepServices, studentsQuery.data, studentsQuery.isError, studentsQuery.isLoading]);

  const updateStudentMutation = useMutation({
    mutationFn: ({
      studentId,
      data,
    }: {
      studentId: string;
      data: UpdateSessionStudentInput;
    }) => updateSessionStudent(studentId, data),
    onMutate: () => {
      setStudentError(null);
    },
    onSuccess: (updated) => {
      studentsOriginalRef.current.set(updated.id, updated);
      setStudents((prev) =>
        prev.map((student) => (student.id === updated.id ? updated : student)),
      );
    },
    onError: (error: unknown, variables, context) => {
      if (error instanceof Error) {
        setStudentError(error.message);
      } else {
        setStudentError('No se pudo actualizar el alumno.');
      }
      const original = studentsOriginalRef.current.get(variables.studentId);
      if (original) {
        setStudents((prev) =>
          prev.map((student) => (student.id === original.id ? original : student)),
        );
      }
    },
  });

  const createStudentMutation = useMutation({
    mutationFn: ({
      nombre,
      apellido,
      dni,
      asistencia,
      apto,
    }: {
      nombre: string;
      apellido: string;
      dni: string;
      asistencia: boolean;
      apto: boolean;
    }) =>
      createSessionStudent({
        dealId: session.dealId,
        sessionId: session.sessionId,
        nombre,
        apellido,
        dni,
        asistencia,
        apto,
      }),
    onMutate: () => {
      setStudentError(null);
    },
    onSuccess: (created) => {
      studentsOriginalRef.current.set(created.id, created);
      setStudents((prev) => [...prev, created]);
      queryClient.setQueryData<SessionStudent[] | undefined>(
        ['trainer', 'session', session.sessionId, 'students'],
        (previous) => (previous ? [...previous, created] : [created]),
      );
      setNewStudent({ nombre: '', apellido: '', dni: '', asistencia: false, apto: false });
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setStudentError(error.message);
      } else {
        setStudentError('No se pudo añadir el alumno.');
      }
    },
  });

  const handleCommentSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = commentContent.trim();
      if (!trimmed.length) return;
      commentMutation.mutate(trimmed);
    },
    [commentContent, commentMutation],
  );

  const startEditingComment = useCallback((comment: SessionComment) => {
    setEditingCommentId(comment.id);
    setEditingCommentContent(comment.content ?? '');
    setCommentError(null);
  }, []);

  const cancelEditingComment = useCallback(() => {
    setEditingCommentId(null);
    setEditingCommentContent('');
    setSavingCommentId(null);
  }, []);

  const handleCommentSave = useCallback(
    async (comment: SessionComment) => {
      const trimmed = editingCommentContent.trim();
      if (!trimmed.length) {
        setCommentError('El comentario no puede estar vacío.');
        return;
      }
      setSavingCommentId(comment.id);
      try {
        await updateCommentMutation.mutateAsync({ commentId: comment.id, content: trimmed });
      } catch (error) {
        if (!(error instanceof Error)) {
          setCommentError('No se pudo actualizar el comentario.');
        }
      }
    },
    [editingCommentContent, updateCommentMutation],
  );

  const handleCommentDelete = useCallback(
    async (comment: SessionComment) => {
      const confirmed = window.confirm('¿Eliminar este comentario?');
      if (!confirmed) return;
      setDeletingCommentId(comment.id);
      setCommentError(null);
      try {
        await deleteCommentMutation.mutateAsync(comment.id);
      } catch (error) {
        if (!(error instanceof Error)) {
          setCommentError('No se pudo eliminar el comentario.');
        }
      }
    },
    [deleteCommentMutation],
  );

  const handleDocumentUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || !fileList.length) return;
      const files = Array.from(fileList);
      documentMutation.mutate({ files, trainerExpense: isExpense });
    },
    [documentMutation, isExpense],
  );

  const handleDocumentDelete = useCallback(
    async (documentId: string) => {
      if (!documentId) return;
      const confirmed = window.confirm('¿Eliminar este documento?');
      if (!confirmed) return;
      setDocumentError(null);
      setDeletingDocumentId(documentId);
      try {
        await deleteDocumentMutation.mutateAsync(documentId);
      } catch (error) {
        if (!(error instanceof Error)) {
          setDocumentError('No se pudo eliminar el documento.');
        }
      }
    },
    [deleteDocumentMutation],
  );

  const handleStudentFieldChange = useCallback(
    (studentId: string, field: 'nombre' | 'apellido' | 'dni', value: string) => {
      setStudents((prev) =>
        prev.map((student) =>
          student.id === studentId ? { ...student, [field]: value } : student,
        ),
      );
    },
    [],
  );

  const handleStudentFieldBlur = useCallback(
    (studentId: string, field: 'nombre' | 'apellido' | 'dni') => {
      const current = students.find((student) => student.id === studentId);
      const original = studentsOriginalRef.current.get(studentId);
      if (!current || !original) return;
      const currentValue = (current as Record<typeof field, string>)[field] ?? '';
      const originalValue = (original as Record<typeof field, string>)[field] ?? '';
      if (currentValue === originalValue) return;
      const payload = { [field]: currentValue } as UpdateSessionStudentInput;
      updateStudentMutation.mutate({ studentId, data: payload });
    },
    [students, updateStudentMutation],
  );

  const handleStudentAttendanceToggle = useCallback(
    (studentId: string, checked: boolean) => {
      setStudents((prev) =>
        prev.map((student) =>
          student.id === studentId ? { ...student, asistencia: checked } : student,
        ),
      );
      const original = studentsOriginalRef.current.get(studentId);
      if (original && original.asistencia === checked) {
        return;
      }
      updateStudentMutation.mutate({ studentId, data: { asistencia: checked } });
    },
    [updateStudentMutation],
  );

  const handleStudentAptoToggle = useCallback(
    (studentId: string, checked: boolean) => {
      setStudents((prev) =>
        prev.map((student) =>
          student.id === studentId ? { ...student, apto: checked } : student,
        ),
      );
      const original = studentsOriginalRef.current.get(studentId);
      if (original && original.apto === checked) {
        return;
      }
      updateStudentMutation.mutate({ studentId, data: { apto: checked } });
    },
    [updateStudentMutation],
  );

  const handleNewStudentFieldChange = useCallback(
    (field: 'nombre' | 'apellido' | 'dni', value: string) => {
      setNewStudent((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleNewStudentAttendanceChange = useCallback((checked: boolean) => {
    setNewStudent((prev) => ({ ...prev, asistencia: checked }));
  }, []);

  const handleNewStudentAptoChange = useCallback((checked: boolean) => {
    setNewStudent((prev) => ({ ...prev, apto: checked }));
  }, []);

  const handleNewStudentSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nombre = newStudent.nombre.trim();
      const apellido = newStudent.apellido.trim();
      const dni = newStudent.dni.trim();
      if (!nombre.length || !apellido.length || !dni.length) {
        setStudentError('Nombre, apellidos y DNI son obligatorios.');
        return;
      }
      if (!session.dealId) {
        setStudentError('No se puede añadir alumnos a esta sesión.');
        return;
      }
      createStudentMutation.mutate({
        nombre,
        apellido,
        dni,
        asistencia: newStudent.asistencia,
        apto: newStudent.apto,
      });
    },
    [createStudentMutation, newStudent, session.dealId],
  );

  const startLabel = formatDateTime(session.startDate);
  const endLabel = formatDateTime(session.endDate);
  const scheduleDateLabel =
    startLabel && endLabel
      ? `${startLabel} · ${endLabel}`
      : startLabel ?? endLabel ?? null;
  const phoneHref = session.clientPhone
    ? `tel:${session.clientPhone.replace(/\s+/g, '')}`
    : null;
  const mailHref = session.clientEmail ? `mailto:${session.clientEmail}` : null;

  return (
    <Card className="shadow-sm border-0">
      <Card.Body>
        <Stack gap={4}>
          <Stack gap={3}>
            <div className="row g-4">
              <InfoField className="col-12 col-md-6 col-xl-3" label="Presupuesto">
                {session.budgetNumber ?? '—'}
              </InfoField>
              <InfoField className="col-12 col-md-6 col-xl-3" label="Organización">
                {session.organizationName ?? '—'}
              </InfoField>
              <InfoField className="col-12 col-md-6 col-xl-3" label="Comercial">
                {session.commercialName ?? '—'}
              </InfoField>
              <InfoField
                className="col-12 col-md-6 col-xl-3"
                label={isGepServices ? 'Fecha del servicio' : 'Fecha de la formación'}
              >
                {scheduleDateLabel ?? '—'}
              </InfoField>
            </div>

            <div className="row g-4">
              <InfoField className="col-12 col-md-6 col-xl-4" label="Cliente">
                {session.clientName ?? '—'}
              </InfoField>
              <InfoField className="col-12 col-md-6 col-xl-4" label="Teléfono">
                {session.clientPhone ? (
                  <a href={phoneHref ?? undefined} className="text-decoration-none">
                    {session.clientPhone}
                  </a>
                ) : (
                  '—'
                )}
              </InfoField>
              <InfoField className="col-12 col-md-6 col-xl-4" label="Mail">
                {session.clientEmail ? (
                  <a href={mailHref ?? undefined} className="text-decoration-none">
                    {session.clientEmail}
                  </a>
                ) : (
                  '—'
                )}
              </InfoField>
            </div>

            <div className="row g-4">
              <InfoField
                className="col-12 col-md-6"
                label={isGepServices ? 'Dirección del servicio' : 'Dirección de la sesión'}
              >
                {session.address ? (
                  <div className="d-flex align-items-start gap-2 flex-wrap">
                    <div>{session.address}</div>
                    {mapsUrl ? (
                      <Button
                        as="a"
                        variant="outline-primary"
                        size="sm"
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ver en Maps
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  '—'
                )}
              </InfoField>
              <InfoField className="col-12 col-md-2" label="CAES">
                {renderBooleanField(session.caes)}
              </InfoField>
              {!isGepServices ? (
                <InfoField className="col-12 col-md-2" label="FUNDAE">
                  {renderBooleanField(session.fundae)}
                </InfoField>
              ) : null}
              <InfoField className="col-12 col-md-2" label="Acompañantes">
                {session.companionTrainers.length ? (
                  <div className="d-flex flex-column gap-1">
                    {session.companionTrainers.map((trainer) => (
                      <span key={trainer.trainerId}>{formatTrainerName(trainer)}</span>
                    ))}
                  </div>
                ) : (
                  '—'
                )}
              </InfoField>
            </div>

            <div className="row g-4">
              <InfoField
                className="col-12 col-md-6 col-xl-4"
                label={isGepServices ? 'Servicio' : 'Formación'}
              >
                {session.formationName ?? session.sessionTitle ?? '—'}
              </InfoField>
              {!isGepServices ? (
                <InfoField className="col-12 col-md-6 col-xl-4" label="Presentación">
                  {session.formationUrl ? (
                    <a href={session.formationUrl} target="_blank" rel="noopener noreferrer">
                      {session.formationUrl}
                    </a>
                  ) : (
                    '—'
                  )}
                </InfoField>
              ) : null}
              {session.mobileUnits.length ? (
                <InfoField className="col-12 col-xl-4" label="Unidades móviles">
                  <div className="d-flex flex-wrap gap-2">
                    {session.mobileUnits.map((unit) => (
                      <Badge key={unit.id} bg="info">
                        {unit.name ?? unit.id}
                        {unit.plate ? ` · ${unit.plate}` : ''}
                      </Badge>
                    ))}
                  </div>
                </InfoField>
              ) : null}
            </div>
          </Stack>

          {!isGepServices ? (
            <div>
              <h5 className="fw-semibold mb-3">Alumnos</h5>
              {studentError ? <Alert variant="danger">{studentError}</Alert> : null}
              {studentsQuery.isError ? (
                <Alert variant="danger">No se pudieron cargar los alumnos de la sesión.</Alert>
              ) : null}
              {studentsQuery.isLoading ? (
                <div className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" />
                  <span>Cargando alumnos…</span>
                </div>
              ) : (
                <Table responsive bordered hover size="sm">
                  <thead className="table-light">
                    <tr>
                      <th>Nombre</th>
                      <th>Apellidos</th>
                      <th>DNI</th>
                      <th className="text-center">Asistencia</th>
                      <th className="text-center">Apto</th>
                  </tr>
                </thead>
                <tbody>
                    {students.length ? (
                      students.map((student) => (
                        <tr key={student.id}>
                          <td>
                            <Form.Control
                              type="text"
                              value={student.nombre}
                              onChange={(event) =>
                                handleStudentFieldChange(
                                  student.id,
                                  'nombre',
                                  event.target.value,
                                )
                              }
                              onBlur={() => handleStudentFieldBlur(student.id, 'nombre')}
                              disabled={updateStudentMutation.isPending}
                            />
                          </td>
                          <td>
                            <Form.Control
                              type="text"
                              value={student.apellido}
                              onChange={(event) =>
                                handleStudentFieldChange(
                                  student.id,
                                  'apellido',
                                  event.target.value,
                                )
                              }
                              onBlur={() => handleStudentFieldBlur(student.id, 'apellido')}
                              disabled={updateStudentMutation.isPending}
                            />
                          </td>
                          <td>
                            <Form.Control
                              type="text"
                              value={student.dni}
                              onChange={(event) =>
                                handleStudentFieldChange(student.id, 'dni', event.target.value)
                              }
                              onBlur={() => handleStudentFieldBlur(student.id, 'dni')}
                              disabled={updateStudentMutation.isPending}
                            />
                          </td>
                          <td className="text-center">
                            <Form.Check
                              type="checkbox"
                              checked={Boolean(student.asistencia)}
                              onChange={(event) =>
                                handleStudentAttendanceToggle(student.id, event.target.checked)
                              }
                              disabled={updateStudentMutation.isPending}
                            />
                          </td>
                          <td className="text-center">
                            <Form.Check
                              type="checkbox"
                              checked={Boolean(student.apto)}
                              onChange={(event) =>
                                handleStudentAptoToggle(student.id, event.target.checked)
                              }
                              disabled={updateStudentMutation.isPending}
                            />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="text-center text-muted">
                          No hay alumnos registrados para esta sesión.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              )}
              <p className="text-muted small mt-2">
                Si falta algún alumn@, añade un comentario con el nombre de la persona que ha faltado.
              </p>
              <h6 className="fw-semibold mt-4">Añadir alumn@ a la sesión</h6>
              <Form className="mt-2" onSubmit={handleNewStudentSubmit}>
                <Row className="g-2 align-items-end">
                  <Col xs={12} md={3}>
                    <Form.Group
                      controlId={`trainer-session-${session.sessionId}-new-student-nombre`}
                    >
                      <Form.Label>Nombre</Form.Label>
                      <Form.Control
                        type="text"
                        value={newStudent.nombre}
                        onChange={(event) =>
                          handleNewStudentFieldChange('nombre', event.target.value)
                        }
                        placeholder="Nombre"
                        disabled={createStudentMutation.isPending}
                      />
                    </Form.Group>
                  </Col>
                  <Col xs={12} md={3}>
                    <Form.Group
                      controlId={`trainer-session-${session.sessionId}-new-student-apellido`}
                    >
                      <Form.Label>Apellidos</Form.Label>
                      <Form.Control
                        type="text"
                        value={newStudent.apellido}
                        onChange={(event) =>
                          handleNewStudentFieldChange('apellido', event.target.value)
                        }
                        placeholder="Apellidos"
                        disabled={createStudentMutation.isPending}
                      />
                    </Form.Group>
                  </Col>
                  <Col xs={12} md={3}>
                    <Form.Group
                      controlId={`trainer-session-${session.sessionId}-new-student-dni`}
                    >
                      <Form.Label>DNI</Form.Label>
                      <Form.Control
                        type="text"
                        value={newStudent.dni}
                        onChange={(event) => handleNewStudentFieldChange('dni', event.target.value)}
                        placeholder="DNI"
                        disabled={createStudentMutation.isPending}
                      />
                    </Form.Group>
                  </Col>
                  <Col xs={12} md="auto">
                    <Form.Group
                      controlId={`trainer-session-${session.sessionId}-new-student-asistencia`}
                      className="mb-0"
                    >
                      <Form.Check
                        type="checkbox"
                        label="Asistencia"
                        checked={newStudent.asistencia}
                        onChange={(event) =>
                          handleNewStudentAttendanceChange(event.target.checked)
                        }
                        disabled={createStudentMutation.isPending}
                      />
                    </Form.Group>
                  </Col>
                  <Col xs={12} md="auto">
                    <Form.Group
                      controlId={`trainer-session-${session.sessionId}-new-student-apto`}
                      className="mb-0"
                    >
                      <Form.Check
                        type="checkbox"
                        label="Apto"
                        checked={newStudent.apto}
                        onChange={(event) => handleNewStudentAptoChange(event.target.checked)}
                        disabled={createStudentMutation.isPending}
                      />
                    </Form.Group>
                  </Col>
                  <Col xs={12} md="auto">
                    <Button type="submit" disabled={createStudentMutation.isPending}>
                      {createStudentMutation.isPending ? (
                        <>
                          <Spinner
                            as="span"
                            animation="border"
                            size="sm"
                            role="status"
                            aria-hidden="true"
                          />{' '}
                          Guardando…
                        </>
                      ) : (
                        'Añadir alumn@'
                      )}
                    </Button>
                  </Col>
                </Row>
              </Form>
            </div>
          ) : null}

          <div className="trainer-session-actions p-4 rounded-3">
            <Row className="g-4">
              <Col xs={12} xl={6}>
                <div className="trainer-session-section h-100 d-flex flex-column gap-3">
                  <div>
                    <h5 className="fw-semibold mb-1">Comentarios</h5>
                    <p className="text-muted mb-2 small">
                      Añade comentarios o revisa los mensajes compartidos para esta sesión.
                    </p>
                  </div>
                  {commentError ? <Alert variant="danger">{commentError}</Alert> : null}
                  {commentsQuery.isError ? (
                    <Alert variant="danger">No se pudieron cargar los comentarios.</Alert>
                  ) : null}
                  {commentsQuery.isLoading ? (
                    <div className="d-flex align-items-center gap-2">
                      <Spinner animation="border" size="sm" />
                      <span>Cargando comentarios…</span>
                    </div>
                  ) : (
                    <Stack gap={3} className="mb-3">
                      {filteredComments.length ? (
                        filteredComments.map((comment) => {
                          const author = (comment.author ?? '—').trim();
                          const authorLower = author.toLowerCase();
                          const authorId = comment.author_id?.trim().toLowerCase() ?? null;
                          const canEdit =
                            (authorId && authorId === normalizedUserId) ||
                            (Boolean(authorLower.length) && authorLower === normalizedUserName);
                          const isEditing = editingCommentId === comment.id;
                          const isSaving =
                            savingCommentId === comment.id && updateCommentMutation.isPending;
                          const isDeleting =
                            deletingCommentId === comment.id && deleteCommentMutation.isPending;
                          const createdLabel = comment.created_at
                            ? formatDateTime(comment.created_at)
                            : '—';
                          const updatedLabel =
                            comment.updated_at && comment.updated_at !== comment.created_at
                              ? formatDateTime(comment.updated_at)
                              : null;
                          const displayContent = comment.content?.trim().length
                            ? comment.content
                            : '—';

                          return (
                            <Card key={comment.id} className="border-0 bg-light">
                              <Card.Body>
                                <div className="text-muted small mb-2">
                                  {author.length ? author : '—'} · {createdLabel}
                                  {updatedLabel ? (
                                    <span className="ms-2">Actualizado: {updatedLabel}</span>
                                  ) : null}
                                </div>
                                {isEditing ? (
                                  <Stack gap={2}>
                                    <Form.Control
                                      as="textarea"
                                      rows={3}
                                      value={editingCommentContent}
                                      onChange={(event) => setEditingCommentContent(event.target.value)}
                                      disabled={isSaving}
                                    />
                                    <div className="d-flex justify-content-end gap-2">
                                      <Button
                                        variant="outline-secondary"
                                        size="sm"
                                        onClick={cancelEditingComment}
                                        disabled={isSaving}
                                      >
                                        Cancelar
                                      </Button>
                                      <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => handleCommentSave(comment)}
                                        disabled={isSaving}
                                      >
                                        {isSaving ? (
                                          <Spinner animation="border" size="sm" role="status" />
                                        ) : (
                                          'Guardar'
                                        )}
                                      </Button>
                                    </div>
                                  </Stack>
                                ) : (
                                  <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2">
                                    <div className="text-break">{displayContent}</div>
                                    {canEdit ? (
                                      <div className="d-flex gap-2">
                                        <Button
                                          variant="outline-secondary"
                                          size="sm"
                                          onClick={() => startEditingComment(comment)}
                                          disabled={isDeleting}
                                        >
                                          Editar
                                        </Button>
                                        <Button
                                          variant="outline-danger"
                                          size="sm"
                                          onClick={() => handleCommentDelete(comment)}
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
                                )}
                              </Card.Body>
                            </Card>
                          );
                        })
                      ) : (
                        <p className="text-muted mb-0">No hay comentarios compartidos.</p>
                      )}
                    </Stack>
                  )}
                  <Form onSubmit={handleCommentSubmit} className="d-grid gap-3">
                    <Form.Group controlId={`trainer-session-${session.sessionId}-comment`}>
                      <Form.Label>Nuevo comentario</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={commentContent}
                        onChange={(event) => setCommentContent(event.target.value)}
                        placeholder="Escribe un comentario para el equipo del ERP"
                        disabled={commentMutation.isPending}
                        required
                      />
                    </Form.Group>
                    <div>
                      <Button
                        type="submit"
                        disabled={commentMutation.isPending || !commentContent.trim().length}
                      >
                        {commentMutation.isPending ? 'Guardando…' : 'Añadir comentario'}
                      </Button>
                    </div>
                  </Form>
                </div>
              </Col>

              <Col xs={12} xl={6}>
                <div className="trainer-session-section h-100 d-flex flex-column gap-3">
                  <div>
                    <h5 className="fw-semibold mb-1">Documentos</h5>
                    <p className="text-muted mb-2 small">
                      Comparte documentos relevantes con el equipo del ERP y marca los gastos cuando corresponda.
                    </p>
                  </div>
                  {documentError ? <Alert variant="danger">{documentError}</Alert> : null}
                  {documentsQuery.isError ? (
                    <Alert variant="danger">No se pudieron cargar los documentos.</Alert>
                  ) : null}
                  {documentsQuery.isLoading ? (
                    <div className="d-flex align-items-center gap-2">
                      <Spinner animation="border" size="sm" />
                      <span>Cargando documentos…</span>
                    </div>
                  ) : (
                    <Stack gap={2} className="mb-3">
                      {sharedDocuments.length ? (
                        sharedDocuments.map((doc) => {
                          const canDeleteDoc = trainerDocumentIdSet.has(doc.id);
                          const isDeletingDoc =
                            deletingDocumentId === doc.id && deleteDocumentMutation.isPending;
                          return (
                            <div
                              key={doc.id}
                              className={`d-flex flex-column flex-md-row align-items-start align-items-md-center gap-2 ${
                                doc.trainer_expense ? 'rounded border border-warning-subtle bg-warning-subtle p-2' : ''
                              }`}
                            >
                              <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center gap-2 flex-grow-1">
                                {doc.drive_web_view_link ? (
                                  <a
                                    href={doc.drive_web_view_link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="fw-semibold text-break text-decoration-none"
                                  >
                                    {doc.drive_file_name ?? 'Documento'}
                                  </a>
                                ) : (
                                  <span className="fw-semibold text-break">
                                    {doc.drive_file_name ?? 'Documento'}
                                  </span>
                                )}
                                {doc.trainer_expense ? (
                                  <Badge bg="warning" text="dark" className="text-uppercase fw-semibold">
                                    Gasto
                                  </Badge>
                                ) : null}
                              </div>
                              <span className="text-muted small">
                                {doc.added_at ? formatDateTime(doc.added_at) : 'Sin fecha'}
                              </span>
                              <div className="d-flex align-items-center gap-2">
                                {canDeleteDoc ? (
                                  <Button
                                    variant="outline-danger"
                                    size="sm"
                                    onClick={() => handleDocumentDelete(doc.id)}
                                    disabled={isDeletingDoc}
                                  >
                                    {isDeletingDoc ? (
                                      <Spinner animation="border" size="sm" role="status" />
                                    ) : (
                                      'Eliminar'
                                    )}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-muted mb-0">No hay documentos compartidos.</p>
                      )}
                    </Stack>
                  )}
                  <Form.Group
                    controlId={`trainer-session-${session.sessionId}-documents`}
                    className="d-grid gap-2"
                  >
                    <Form.Label>Subir documentos</Form.Label>
                    <Form.Check
                      type="checkbox"
                      id={`trainer-session-${session.sessionId}-documents-expense`}
                      label={
                        <>
                          ¿Gasto?
                          <span className="text-muted ms-2">
                            Si el archivo es un gasto, antes de subirlo marca la casilla
                          </span>
                        </>
                      }
                      checked={isExpense}
                      onChange={(event) => setIsExpense(event.target.checked)}
                      disabled={documentMutation.isPending}
                    />
                    <Form.Control
                      type="file"
                      multiple
                      onChange={handleDocumentUpload}
                      ref={documentInputRef}
                      className="trainer-file-input"
                      disabled={documentMutation.isPending}
                    />
                    <div className="text-muted small">
                      Los documentos se compartirán automáticamente con el equipo del ERP.
                      {isExpense
                        ? ` Se subirán a la carpeta "${TRAINER_EXPENSE_FOLDER_NAME}" y se añadirá tu nombre al archivo.`
                        : null}
                    </div>
                    {documentMutation.isPending ? (
                      <div className="d-flex align-items-center gap-2 text-muted small">
                        <Spinner animation="border" size="sm" role="status" />
                        <span>Subiendo documentos…</span>
                      </div>
                    ) : null}
                  </Form.Group>
                  <div className="trainer-session-section mt-2">
                    <h5 className="fw-semibold mb-2">Fichar sesión</h5>
                    {timeLogLoadErrorMessage ? (
                      <Alert variant="danger">{timeLogLoadErrorMessage}</Alert>
                    ) : null}
                    {timeLogError ? <Alert variant="danger">{timeLogError}</Alert> : null}
                    {timeLogSuccess ? (
                      <Alert variant="success">Registro horario guardado correctamente.</Alert>
                    ) : null}
                    {timeLogQuery.isLoading ? (
                      <div className="d-flex align-items-center gap-2">
                        <Spinner animation="border" size="sm" />
                        <span>Cargando registro horario…</span>
                      </div>
                    ) : (
                      <Form onSubmit={handleTimeLogSubmit} className="d-grid gap-3">
                        <Row className="g-3">
                          <Col xs={12} sm={6}>
                            <Form.Group
                              controlId={`trainer-session-${session.sessionId}-time-entry`}
                            >
                              <Form.Label>Hora de entrada</Form.Label>
                              <Form.Control
                                type="datetime-local"
                                value={timeLogEntryValue}
                                onChange={(event) => setTimeLogEntryValue(event.target.value)}
                                disabled={saveTimeLogMutation.isPending}
                                required
                              />
                            </Form.Group>
                          </Col>
                          <Col xs={12} sm={6}>
                            <Form.Group
                              controlId={`trainer-session-${session.sessionId}-time-exit`}
                            >
                              <Form.Label>Hora de salida</Form.Label>
                              <Form.Control
                                type="datetime-local"
                                value={timeLogExitValue}
                                onChange={(event) => setTimeLogExitValue(event.target.value)}
                                disabled={saveTimeLogMutation.isPending}
                                required
                              />
                            </Form.Group>
                          </Col>
                        </Row>
                        <div className="d-flex justify-content-end">
                          <Button
                            type="submit"
                            disabled={saveTimeLogMutation.isPending}
                            style={
                              hasExistingTimeLog
                                ? {
                                    backgroundColor: '#F5C147',
                                    borderColor: '#F5C147',
                                    color: '#212529',
                                  }
                                : undefined
                            }
                          >
                            {saveTimeLogMutation.isPending
                              ? 'Guardando…'
                              : hasExistingTimeLog
                              ? 'Modificar'
                              : 'Guardar registro'}
                          </Button>
                        </div>
                        {formattedTimeLogUpdated ? (
                          <div className="text-muted small">
                            Última actualización: {formattedTimeLogUpdated}
                          </div>
                        ) : null}
                      </Form>
                    )}
                  </div>
                </div>
              </Col>
            </Row>
            {reportLink ? (
              <Row className="g-4">
                <Col xs={12}>
                  <div className="trainer-session-section h-100 d-flex flex-column gap-3">
                    <div>
                      <h5 className="fw-semibold mb-1">Genera el informe de la sesión</h5>
                      <p className="text-muted mb-2 small">
                        Completa el informe y comparte los detalles con el equipo del ERP.
                      </p>
                    </div>
                    <div className="d-flex justify-content-start">
                      <Button
                        as={Link as any}
                        to={reportLink.to}
                        state={reportLink.state}
                        variant="primary"
                      >
                        {reportLink.label}
                      </Button>
                    </div>
                  </div>
                </Col>
              </Row>
            ) : null}
          </div>
        </Stack>
      </Card.Body>
    </Card>
  );
}

type VariantDealAccordionItemProps = {
  variantId: string;
  deal: TrainerVariantDeal;
  eventKey: string;
};

function VariantDealAccordionItem({ variantId, deal, eventKey }: VariantDealAccordionItemProps) {
  const queryClient = useQueryClient();
  const { userId, userName } = useCurrentUserIdentity();

  const detailQueryKey = useMemo(
    () => ['trainer', 'variant', variantId, 'deal', deal.dealId] as const,
    [deal.dealId, variantId],
  );

  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => fetchDealDetail(deal.dealId),
  });

  const documents: DealDocument[] = detailQuery.data?.documents ?? [];
  const documentCount = documents.length;
  const notesSource: DealNote[] = detailQuery.data?.notes ?? [];

  const filteredNotes = useMemo(() => {
    const blockedPhrases = ['detalles del documentación', 'alumnos del deal'];
    return notesSource.filter((note) => {
      const content = (note.content ?? '').trim();
      if (!content.length) return false;
      const normalized = content.toLowerCase();
      return !blockedPhrases.some((phrase) => normalized.includes(phrase));
    });
  }, [notesSource]);

  const noteCount = filteredNotes.length;
  const totalRecordCount = documentCount + noteCount;

  const organizationName = (deal.organizationName ?? '').trim() || 'Organización sin nombre';

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const storageKey = useMemo(
    () => `trainer-variant-${variantId}-deal-${deal.dealId}-${userId}-documents`,
    [deal.dealId, userId, variantId],
  );

  const [ownedDocumentIds, setOwnedDocumentIds] = useState<string[]>([]);
  const [pendingBaseline, setPendingBaseline] = useState<string[] | null>(null);
  const ownedDocumentIdSet = useMemo(() => new Set(ownedDocumentIds), [ownedDocumentIds]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        setOwnedDocumentIds([]);
        return;
      }
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length);
        setOwnedDocumentIds(normalized);
      } else {
        setOwnedDocumentIds([]);
      }
    } catch {
      setOwnedDocumentIds([]);
    }
  }, [storageKey]);

  const persistOwnedDocumentIds = useCallback(
    (ids: string[]) => {
      if (typeof window === 'undefined') return;
      if (!ids.length) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(ids));
      } catch {
        // Ignore storage errors
      }
    },
    [storageKey],
  );

  const updateOwnedDocumentIds = useCallback(
    (updater: (current: Set<string>) => Set<string>) => {
      setOwnedDocumentIds((currentList) => {
        const currentSet = new Set(currentList);
        const nextSet = updater(currentSet);
        const currentSorted = Array.from(currentSet).sort();
        const nextList = Array.from(nextSet);
        const nextSorted = nextList.slice().sort();
        const isSame =
          currentSorted.length === nextSorted.length &&
          currentSorted.every((value, index) => value === nextSorted[index]);
        if (isSame) return currentList;
        persistOwnedDocumentIds(nextList);
        return nextList;
      });
    },
    [persistOwnedDocumentIds],
  );

  useEffect(() => {
    if (!pendingBaseline) return;
    if (detailQuery.isLoading) return;
    const baselineSet = new Set(pendingBaseline);
    const newIds = documents
      .map((doc) => doc.id)
      .filter((id) => id && !baselineSet.has(id));
    if (newIds.length) {
      updateOwnedDocumentIds((current) => {
        const next = new Set(current);
        newIds.forEach((id) => next.add(id));
        return next;
      });
    }
    setPendingBaseline(null);
  }, [detailQuery.isLoading, documents, pendingBaseline, updateOwnedDocumentIds]);

  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        await uploadManualDocument(deal.dealId, file, { id: userId, name: userName });
      }
    },
    onMutate: async () => {
      setUploadError(null);
      return { previousDocIds: documents.map((doc) => doc.id) };
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setUploadError(error.message);
      } else {
        setUploadError('No se pudieron subir los documentos.');
      }
    },
    onSuccess: (_data, _files, context) => {
      setPendingBaseline(context?.previousDocIds ?? documents.map((doc) => doc.id));
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      await deleteDocument(deal.dealId, documentId);
    },
    onMutate: (documentId: string) => {
      setDeleteError(null);
      setDeletingDocumentId(documentId);
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setDeleteError(error.message);
      } else {
        setDeleteError('No se pudo eliminar el documento.');
      }
    },
    onSuccess: (_data, documentId) => {
      updateOwnedDocumentIds((current) => {
        const next = new Set(current);
        next.delete(documentId);
        return next;
      });
    },
    onSettled: () => {
      setDeletingDocumentId(null);
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
    },
  });

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { files } = event.target;
      if (!files || files.length === 0) {
        return;
      }
      const fileList = Array.from(files).filter((file): file is File => file instanceof File);
      if (!fileList.length) return;
      uploadMutation.mutate(fileList);
    },
    [uploadMutation],
  );

  const handleDocumentDelete = useCallback(
    (documentId: string) => {
      deleteMutation.mutate(documentId);
    },
    [deleteMutation],
  );

  const recordCountLabel = detailQuery.isLoading
    ? '…'
    : detailQuery.isError
    ? '—'
    : String(totalRecordCount);

  const isUploading = uploadMutation.isPending;

  return (
    <Accordion.Item eventKey={eventKey}>
      <Accordion.Header>
        <div className="d-flex justify-content-between align-items-center w-100">
          <span className="fw-semibold text-break">{organizationName}</span>
          <Badge bg="secondary" pill>
            {recordCountLabel}
          </Badge>
        </div>
      </Accordion.Header>
      <Accordion.Body>
        {detailQuery.isLoading && !detailQuery.data ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner animation="border" size="sm" role="status" />
            <span>Cargando documentos…</span>
          </div>
        ) : null}
        {detailQuery.isError ? (
          <Alert variant="danger" className="mb-3">
            No se pudo cargar la información del presupuesto.
          </Alert>
        ) : null}
        {!detailQuery.isLoading && !detailQuery.isError ? (
          <Stack gap={3}>
            <div>
              <div className="text-muted small">Presupuesto: {deal.dealId}</div>
              {deal.studentCount ? (
                <div className="text-muted small">Alumnos asignados: {deal.studentCount}</div>
              ) : null}
              {deal.fundaeLabel ? (
                <div className="text-muted small">FUNDAE: {deal.fundaeLabel}</div>
              ) : null}
            </div>

            {uploadError ? <Alert variant="danger">{uploadError}</Alert> : null}
            {deleteError ? <Alert variant="danger">{deleteError}</Alert> : null}

            <div>
              <h6 className="fw-semibold">Documentos</h6>
              {documents.length ? (
                <ListGroup>
                  {documents.map((doc) => {
                    const href = doc.url ?? doc.drive_web_view_link ?? null;
                    const displayName = doc.name ?? doc.drive_file_name ?? 'Documento';
                    const addedAtLabel = doc.created_at ? formatDateTime(doc.created_at) : null;
                    const canDelete = ownedDocumentIdSet.has(doc.id);
                    const isDeleting = deleteMutation.isPending && deletingDocumentId === doc.id;
                    return (
                      <ListGroup.Item
                        key={doc.id}
                        className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2"
                      >
                        <div className="d-flex flex-column">
                          {href ? (
                            <a
                              className="fw-semibold text-break"
                              href={href}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              {displayName}
                            </a>
                          ) : (
                            <span className="fw-semibold text-break">{displayName}</span>
                          )}
                          <div className="text-muted small">
                            {addedAtLabel ? addedAtLabel : 'Sin fecha'}
                          </div>
                        </div>
                        {canDelete ? (
                          <div className="d-flex justify-content-end">
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleDocumentDelete(doc.id)}
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
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              ) : (
                <p className="text-muted small mb-0">No hay documentos disponibles.</p>
              )}
            </div>

            <Form.Group controlId={`trainer-variant-${variantId}-deal-${deal.dealId}-upload`}>
              <Form.Label className="fw-semibold">Subir documentos</Form.Label>
              <Form.Control
                type="file"
                multiple
                onChange={handleFileInputChange}
                ref={fileInputRef}
                disabled={isUploading}
              />
              <div className="text-muted small mt-1">
                Los archivos se guardarán en la jerarquía del presupuesto correspondiente.
              </div>
              {isUploading ? (
                <div className="d-flex align-items-center gap-2 text-muted small mt-2">
                  <Spinner animation="border" size="sm" role="status" />
                  <span>Subiendo documentos…</span>
                </div>
              ) : null}
            </Form.Group>

            <div>
              <h6 className="fw-semibold">Notas del presupuesto</h6>
              {filteredNotes.length ? (
                <ListGroup>
                  {filteredNotes.map((note) => {
                    const content = (note.content ?? '').trim();
                    const createdLabel = note.created_at ? formatDateTime(note.created_at) : null;
                    return (
                      <ListGroup.Item key={note.id ?? `${deal.dealId}-${content.slice(0, 12)}`}>
                        <div className="d-flex flex-column gap-1">
                          <div className="d-flex flex-wrap gap-2 text-muted small">
                            {note.author ? <span>{note.author}</span> : null}
                            {createdLabel ? <span>{createdLabel}</span> : null}
                          </div>
                          <p className="mb-0" style={{ whiteSpace: 'pre-line' }}>
                            {content}
                          </p>
                        </div>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              ) : (
                <p className="text-muted small mb-0">No hay notas disponibles.</p>
              )}
            </div>
          </Stack>
        ) : null}
      </Accordion.Body>
    </Accordion.Item>
  );
}

type VariantDetailCardProps = {
  variant: TrainerVariantDetail;
};

type VariantStudentsQueryData = {
  list: SessionStudent[];
  byDeal: Record<string, SessionStudent[]>;
};

function VariantDetailCard({ variant }: VariantDetailCardProps) {
  const queryClient = useQueryClient();
  const { userId, userName } = useCurrentUserIdentity();
  const formattedDate = useMemo(() => formatDateTime(variant.date), [variant.date]);

  const variantCommentsQueryKey = useMemo(
    () => ['trainer', 'variant', variant.variantId, 'comments'] as const,
    [variant.variantId],
  );

  const variantCommentsQuery = useQuery({
    queryKey: variantCommentsQueryKey,
    queryFn: () => fetchVariantComments(variant.variantId),
    staleTime: 5 * 60 * 1000,
  });

  const variantComments = variantCommentsQuery.data ?? [];

  const [variantCommentContent, setVariantCommentContent] = useState('');
  const [variantCommentError, setVariantCommentError] = useState<string | null>(null);

  const createVariantCommentMutation = useMutation({
    mutationFn: (content: string) => {
      const user = userId ? { id: userId, name: userName ?? undefined } : undefined;
      return createVariantComment(variant.variantId, { content }, user);
    },
    onMutate: () => {
      setVariantCommentError(null);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<VariantComment[] | undefined>(variantCommentsQueryKey, (previous) =>
        previous ? [...previous, created] : [created],
      );
      setVariantCommentContent('');
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setVariantCommentError(error.message);
      } else {
        setVariantCommentError('No se pudo guardar el comentario.');
      }
    },
  });

  const timeLogQuery = useQuery<TrainerSessionTimeLog | null>({
    queryKey: ['trainer', 'variant', variant.variantId, 'time-log'],
    queryFn: () => fetchTrainerSessionTimeLog({ variantId: variant.variantId }),
  });

  const [timeLogEntryValue, setTimeLogEntryValue] = useState('');
  const [timeLogExitValue, setTimeLogExitValue] = useState('');
  const [timeLogError, setTimeLogError] = useState<string | null>(null);
  const [timeLogSuccess, setTimeLogSuccess] = useState(false);
  const timeLogInitializedRef = useRef(false);
  const timeLogKeyRef = useRef<string | null>(null);

  useEffect(() => {
    timeLogInitializedRef.current = false;
    timeLogKeyRef.current = null;
    setTimeLogError(null);
    setTimeLogSuccess(false);
  }, [variant.variantId]);

  useEffect(() => {
    if (timeLogQuery.isLoading) return;
    const record = timeLogQuery.data ?? null;
    const entrySource = record?.checkIn ?? record?.scheduledStart ?? variant.date ?? null;
    const exitSource = record?.checkOut ?? record?.scheduledEnd ?? variant.date ?? null;
    const key = record
      ? `${record.checkIn ?? ''}|${record.checkOut ?? ''}|${record.updatedAt ?? ''}`
      : `variant:${variant.date ?? ''}`;
    if (timeLogInitializedRef.current && timeLogKeyRef.current === key) {
      return;
    }
    timeLogInitializedRef.current = true;
    timeLogKeyRef.current = key;
    setTimeLogEntryValue(formatDateTimeLocalInput(entrySource));
    setTimeLogExitValue(formatDateTimeLocalInput(exitSource));
    if (!timeLogQuery.isError) {
      setTimeLogError(null);
    }
  }, [timeLogQuery.data, timeLogQuery.isError, timeLogQuery.isLoading, variant.date]);

  useEffect(() => {
    if (!timeLogSuccess) return;
    const timeout = window.setTimeout(() => setTimeLogSuccess(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [timeLogSuccess]);

  const timeLogLoadErrorMessage = useMemo(() => {
    if (!timeLogQuery.isError) return null;
    const error = timeLogQuery.error;
    if (error instanceof Error) {
      const message = error.message?.trim();
      if (message?.length) {
        return message;
      }
    }
    return 'No se pudo cargar el registro horario.';
  }, [timeLogQuery.error, timeLogQuery.isError]);

  const formattedTimeLogUpdated = useMemo(
    () => formatDateTime(timeLogQuery.data?.updatedAt ?? null),
    [timeLogQuery.data?.updatedAt],
  );

  const hasExistingTimeLog = useMemo(() => {
    const log = timeLogQuery.data;
    if (!log) return false;
    return Boolean(log.id ?? log.checkIn ?? log.checkOut ?? log.updatedAt);
  }, [timeLogQuery.data]);

  const saveTimeLogMutation = useMutation({
    mutationFn: async ({ entry, exit }: { entry: string; exit: string }) =>
      saveTrainerSessionTimeLog({
        variantId: variant.variantId,
        checkIn: entry,
        checkOut: exit,
        scheduledStart: variant.date ?? null,
        scheduledEnd: variant.date ?? null,
      }),
    onSuccess: (log) => {
      queryClient.setQueryData<TrainerSessionTimeLog | null>(
        ['trainer', 'variant', variant.variantId, 'time-log'],
        log,
      );
      setTimeLogEntryValue(
        formatDateTimeLocalInput(log.checkIn ?? log.scheduledStart ?? variant.date ?? null),
      );
      setTimeLogExitValue(
        formatDateTimeLocalInput(log.checkOut ?? log.scheduledEnd ?? variant.date ?? null),
      );
      const key = `${log.checkIn ?? ''}|${log.checkOut ?? ''}|${log.updatedAt ?? ''}`;
      timeLogKeyRef.current = key;
      timeLogInitializedRef.current = true;
      setTimeLogError(null);
      setTimeLogSuccess(true);
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setTimeLogError(error.message);
      } else {
        setTimeLogError('No se pudo guardar el registro horario.');
      }
    },
  });

  const handleTimeLogSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setTimeLogError(null);
      const entryIso = parseDateTimeLocalInput(timeLogEntryValue);
      const exitIso = parseDateTimeLocalInput(timeLogExitValue);
      if (!entryIso || !exitIso) {
        setTimeLogError('Introduce fechas y horas válidas para el registro.');
        return;
      }
      if (new Date(exitIso).getTime() <= new Date(entryIso).getTime()) {
        setTimeLogError('La hora de salida debe ser posterior a la hora de entrada.');
        return;
      }
      saveTimeLogMutation.mutate({ entry: entryIso, exit: exitIso });
    },
    [saveTimeLogMutation, timeLogEntryValue, timeLogExitValue],
  );

  const handleVariantCommentSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = variantCommentContent.trim();
      if (!trimmed.length) return;
      createVariantCommentMutation.mutate(trimmed);
    },
    [createVariantCommentMutation, variantCommentContent],
  );

  const dealsWithKeys = useMemo(() => {
    const seenDealIds = new Set<string>();
    const entries: Array<{ deal: TrainerVariantDeal; eventKey: string }> = [];
    variant.deals.forEach((deal, index) => {
      const normalizedId = (deal.dealId ?? '').trim();
      if (normalizedId.length) {
        if (seenDealIds.has(normalizedId)) {
          return;
        }
        seenDealIds.add(normalizedId);
      }
      const eventKey = normalizedId.length ? normalizedId : `${variant.variantId}-deal-${index}`;
      entries.push({ deal, eventKey });
    });
    return entries;
  }, [variant.deals, variant.variantId]);

  const [openDealKeys, setOpenDealKeys] = useState<string[]>([]);

  useEffect(() => {
    const validKeys = new Set(dealsWithKeys.map((entry) => entry.eventKey));
    setOpenDealKeys((current) => {
      const filtered = current.filter((key) => validKeys.has(key));
      if (filtered.length === current.length) return current;
      return filtered;
    });
  }, [dealsWithKeys]);

  const handleDealAccordionSelect = useCallback((eventKey: string | string[] | null | undefined) => {
    if (Array.isArray(eventKey)) {
      const sanitizedKeys = eventKey.filter((key): key is string => typeof key === 'string' && key.length > 0);
      setOpenDealKeys(sanitizedKeys);
      return;
    }

    if (typeof eventKey === 'string') {
      setOpenDealKeys((current) => {
        if (current.includes(eventKey)) {
          return current.filter((key) => key !== eventKey);
        }
        return [...current, eventKey];
      });
      return;
    }

    setOpenDealKeys([]);
  }, []);

  const dealMetadata = useMemo(() => {
    const map: Record<string, { organizationName: string | null; fundaeLabel: string | null }> = {};
    variant.deals.forEach((deal) => {
      const id = (deal.dealId ?? '').trim();
      if (!id.length) return;
      map[id] = {
        organizationName: deal.organizationName ?? null,
        fundaeLabel: deal.fundaeLabel ?? null,
      };
    });
    return map;
  }, [variant.deals]);

  const dealIds = useMemo(() => {
    const ids: string[] = [];
    variant.deals.forEach((deal) => {
      const id = (deal.dealId ?? '').trim();
      if (!id.length || ids.includes(id)) {
        return;
      }
      ids.push(id);
    });
    return ids;
  }, [variant.deals]);

  const studentsQueryKey = useMemo(
    () => ['trainer', 'variant', variant.variantId, 'deal-students', dealIds] as const,
    [variant.variantId, dealIds],
  );

  const studentsQuery = useQuery<VariantStudentsQueryData>({
    queryKey: studentsQueryKey,
    queryFn: async () => {
      const results = await Promise.all(
        dealIds.map(async (dealId) => {
          const students = await fetchDealStudents(dealId);
          return { dealId, students };
        }),
      );
      const byDeal: Record<string, SessionStudent[]> = {};
      const list: SessionStudent[] = [];
      results.forEach(({ dealId, students }) => {
        byDeal[dealId] = students;
        list.push(...students);
      });
      return { list, byDeal } satisfies VariantStudentsQueryData;
    },
    enabled: dealIds.length > 0,
  });

  const [students, setStudents] = useState<SessionStudent[]>([]);
  const studentsOriginalRef = useRef<Map<string, SessionStudent>>(new Map());
  const [studentError, setStudentError] = useState<string | null>(null);
  const [dealSessionMap, setDealSessionMap] = useState<Map<string, string>>(() => new Map());
  const [newStudent, setNewStudent] = useState({
    dealId: '',
    nombre: '',
    apellido: '',
    dni: '',
    asistencia: false,
    apto: false,
  });

  useEffect(() => {
    if (!dealIds.length) {
      setStudents([]);
      studentsOriginalRef.current = new Map();
    }
  }, [dealIds]);

  useEffect(() => {
    setNewStudent((prev) => {
      if (!dealIds.length) {
        if (!prev.dealId.length && !prev.nombre.length && !prev.apellido.length && !prev.dni.length && !prev.apto) {
          return prev;
        }
        return { ...prev, dealId: '' };
      }
      if (prev.dealId && dealIds.includes(prev.dealId)) {
        return prev;
      }
      return { ...prev, dealId: dealIds[0] };
    });
  }, [dealIds]);

  useEffect(() => {
    if (studentsQuery.data) {
      const { list } = studentsQuery.data;
      setStudents(list);
      const map = new Map<string, SessionStudent>();
      list.forEach((student) => {
        map.set(student.id, student);
      });
      studentsOriginalRef.current = map;
      setDealSessionMap((current) => {
        let changed = false;
        const next = new Map(current);
        list.forEach((student) => {
          const dealId = (student.deal_id ?? '').trim();
          const sessionId = (student.sesion_id ?? '').trim();
          if (dealId.length && sessionId.length && !next.has(dealId)) {
            next.set(dealId, sessionId);
            changed = true;
          }
        });
        return changed ? next : current;
      });
    } else if (!studentsQuery.isLoading && !studentsQuery.isError) {
      setStudents([]);
      studentsOriginalRef.current = new Map();
    }
  }, [studentsQuery.data, studentsQuery.isError, studentsQuery.isLoading]);

  const resolveDealSessionId = useCallback(
    async (dealId: string) => {
      const normalized = dealId.trim();
      if (!normalized.length) {
        return null;
      }
      const existing = dealSessionMap.get(normalized);
      if (existing) {
        return existing;
      }
      const groups = await fetchDealSessions(normalized);
      for (const group of groups) {
        if (!group) continue;
        for (const session of group.sessions ?? []) {
          const sessionId = (session?.id ?? '').trim();
          if (!sessionId.length) continue;
          setDealSessionMap((current) => {
            const currentValue = current.get(normalized);
            if (currentValue === sessionId) {
              return current;
            }
            const next = new Map(current);
            next.set(normalized, sessionId);
            return next;
          });
          return sessionId;
        }
      }
      return null;
    },
    [dealSessionMap],
  );

  const updateStudentMutation = useMutation({
    mutationFn: ({
      studentId,
      data,
    }: {
      studentId: string;
      data: UpdateSessionStudentInput;
    }) => updateSessionStudent(studentId, data),
    onMutate: () => {
      setStudentError(null);
    },
    onSuccess: (updated) => {
      studentsOriginalRef.current.set(updated.id, updated);
      setStudents((prev) => prev.map((student) => (student.id === updated.id ? updated : student)));
      queryClient.setQueryData<VariantStudentsQueryData | undefined>(studentsQueryKey, (previous) => {
        if (!previous) {
          const byDeal: Record<string, SessionStudent[]> = {};
          if (updated.deal_id) {
            byDeal[updated.deal_id] = [updated];
          }
          return { list: [updated], byDeal } satisfies VariantStudentsQueryData;
        }
        const list = previous.list.map((student) => (student.id === updated.id ? updated : student));
        const byDeal: Record<string, SessionStudent[]> = {};
        Object.entries(previous.byDeal).forEach(([dealId, entries]) => {
          byDeal[dealId] = entries.map((student) => (student.id === updated.id ? updated : student));
        });
        if (updated.deal_id && !byDeal[updated.deal_id]) {
          byDeal[updated.deal_id] = [updated];
        }
        return { list, byDeal } satisfies VariantStudentsQueryData;
      });
    },
    onError: (error: unknown, variables) => {
      if (error instanceof Error) {
        setStudentError(error.message);
      } else {
        setStudentError('No se pudo actualizar el alumno.');
      }
      const original = studentsOriginalRef.current.get(variables.studentId);
      if (original) {
        setStudents((prev) => prev.map((student) => (student.id === original.id ? original : student)));
      }
    },
  });

  const createStudentMutation = useMutation({
    mutationFn: ({
      dealId,
      sessionId,
      nombre,
      apellido,
      dni,
      asistencia,
      apto,
    }: {
      dealId: string;
      sessionId: string;
      nombre: string;
      apellido: string;
      dni: string;
      asistencia: boolean;
      apto: boolean;
    }) =>
      createSessionStudent({
        dealId,
        sessionId,
        nombre,
        apellido,
        dni,
        asistencia,
        apto,
      }),
    onMutate: () => {
      setStudentError(null);
    },
    onSuccess: (created) => {
      studentsOriginalRef.current.set(created.id, created);
      setStudents((prev) => [...prev, created]);
      setDealSessionMap((current) => {
        if (!created.deal_id || !created.sesion_id) {
          return current;
        }
        const existing = current.get(created.deal_id);
        if (existing === created.sesion_id) {
          return current;
        }
        const next = new Map(current);
        next.set(created.deal_id, created.sesion_id);
        return next;
      });
      queryClient.setQueryData<VariantStudentsQueryData | undefined>(studentsQueryKey, (previous) => {
        if (!previous) {
          return {
            list: [created],
            byDeal: created.deal_id ? { [created.deal_id]: [created] } : {},
          } satisfies VariantStudentsQueryData;
        }
        const list = [...previous.list, created];
        const byDeal: Record<string, SessionStudent[]> = { ...previous.byDeal };
        const dealId = created.deal_id ?? '';
        if (dealId.length) {
          const existing = byDeal[dealId] ?? [];
          byDeal[dealId] = [...existing, created];
        }
        return { list, byDeal } satisfies VariantStudentsQueryData;
      });
      setNewStudent((prev) => ({
        dealId: prev.dealId,
        nombre: '',
        apellido: '',
        dni: '',
        asistencia: false,
        apto: false,
      }));
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setStudentError(error.message);
      } else {
        setStudentError('No se pudo añadir el alumno.');
      }
    },
  });

  const handleStudentFieldChange = useCallback(
    (studentId: string, field: 'nombre' | 'apellido' | 'dni', value: string) => {
      setStudents((prev) =>
        prev.map((student) => (student.id === studentId ? { ...student, [field]: value } : student)),
      );
      setStudentError(null);
    },
    [],
  );

  const handleStudentFieldBlur = useCallback(
    (studentId: string, field: 'nombre' | 'apellido' | 'dni') => {
      const current = students.find((student) => student.id === studentId);
      const original = studentsOriginalRef.current.get(studentId);
      if (!current || !original) {
        return;
      }
      const currentValue = (current as Record<typeof field, string>)[field] ?? '';
      const originalValue = (original as Record<typeof field, string>)[field] ?? '';
      if (currentValue === originalValue) {
        return;
      }
      const payload = { [field]: currentValue } as UpdateSessionStudentInput;
      updateStudentMutation.mutate({ studentId, data: payload });
    },
    [students, updateStudentMutation],
  );

  const handleStudentAttendanceToggle = useCallback(
    (studentId: string, checked: boolean) => {
      setStudents((prev) =>
        prev.map((student) => (student.id === studentId ? { ...student, asistencia: checked } : student)),
      );
      const original = studentsOriginalRef.current.get(studentId);
      if (original && original.asistencia === checked) {
        return;
      }
      updateStudentMutation.mutate({ studentId, data: { asistencia: checked } });
    },
    [updateStudentMutation],
  );

  const handleStudentAptoToggle = useCallback(
    (studentId: string, checked: boolean) => {
      setStudents((prev) =>
        prev.map((student) => (student.id === studentId ? { ...student, apto: checked } : student)),
      );
      const original = studentsOriginalRef.current.get(studentId);
      if (original && original.apto === checked) {
        return;
      }
      updateStudentMutation.mutate({ studentId, data: { apto: checked } });
    },
    [updateStudentMutation],
  );

  const handleNewStudentFieldChange = useCallback(
    (field: 'dealId' | 'nombre' | 'apellido' | 'dni', value: string) => {
      setNewStudent((prev) => ({ ...prev, [field]: value }));
      setStudentError(null);
    },
    [],
  );

  const handleNewStudentAttendanceChange = useCallback((checked: boolean) => {
    setNewStudent((prev) => ({ ...prev, asistencia: checked }));
    setStudentError(null);
  }, []);

  const handleNewStudentAptoChange = useCallback((checked: boolean) => {
    setNewStudent((prev) => ({ ...prev, apto: checked }));
    setStudentError(null);
  }, []);

  const handleNewStudentSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const dealId = newStudent.dealId.trim();
      const nombre = newStudent.nombre.trim();
      const apellido = newStudent.apellido.trim();
      const dni = newStudent.dni.trim();
      if (!dealId.length) {
        setStudentError('Selecciona la empresa del alumn@.');
        return;
      }
      if (!nombre.length || !apellido.length || !dni.length) {
        setStudentError('Nombre, apellidos y DNI son obligatorios.');
        return;
      }
      try {
        let sessionId = dealSessionMap.get(dealId) ?? null;
        if (!sessionId) {
          sessionId = await resolveDealSessionId(dealId);
        }
        if (!sessionId) {
          setStudentError('No se encontró una sesión asociada a la empresa seleccionada.');
          return;
        }
        createStudentMutation.mutate({
          dealId,
          sessionId,
          nombre,
          apellido,
          dni,
          asistencia: newStudent.asistencia,
          apto: newStudent.apto,
        });
      } catch (error: unknown) {
        if (error instanceof Error) {
          setStudentError(error.message);
        } else {
          setStudentError('No se pudo determinar la sesión para el nuevo alumno.');
        }
      }
    },
    [createStudentMutation, dealSessionMap, newStudent, resolveDealSessionId],
  );

  const studentCount = useMemo(() => {
    if (students.length) {
      return students.length;
    }
    const count = typeof variant.studentCount === 'number' ? variant.studentCount : 0;
    return count > 0 ? count : variant.students.length;
  }, [students.length, variant.studentCount, variant.students.length]);

  const organizationList = useMemo(() => {
    const names = new Set<string>();
    if (students.length) {
      students.forEach((student) => {
        const dealId = (student.deal_id ?? '').trim();
        if (!dealId.length) return;
        const name = (dealMetadata[dealId]?.organizationName ?? '').trim();
        if (name.length) {
          names.add(name);
        }
      });
      if (names.size) {
        return Array.from(names);
      }
    }
    if (variant.organizationNames.length) {
      return variant.organizationNames;
    }
    variant.students.forEach((student) => {
      const name = (student.organizationName ?? '').trim();
      if (name.length) {
        names.add(name);
      }
    });
    return Array.from(names);
  }, [dealMetadata, students, variant.organizationNames, variant.students]);

  const sortedStudents = useMemo(() => {
    return students.slice().sort((a, b) => {
      const orgA = (dealMetadata[a.deal_id ?? '']?.organizationName ?? '').toLowerCase();
      const orgB = (dealMetadata[b.deal_id ?? '']?.organizationName ?? '').toLowerCase();
      if (orgA && orgB) {
        const compare = orgA.localeCompare(orgB, 'es');
        if (compare !== 0) return compare;
      } else if (orgA) {
        return -1;
      } else if (orgB) {
        return 1;
      }

      const lastA = (a.apellido ?? '').toLowerCase();
      const lastB = (b.apellido ?? '').toLowerCase();
      if (lastA && lastB) {
        const compare = lastA.localeCompare(lastB, 'es');
        if (compare !== 0) return compare;
      } else if (lastA) {
        return -1;
      } else if (lastB) {
        return 1;
      }

      const firstA = (a.nombre ?? '').toLowerCase();
      const firstB = (b.nombre ?? '').toLowerCase();
      if (firstA && firstB) {
        const compare = firstA.localeCompare(firstB, 'es');
        if (compare !== 0) return compare;
      } else if (firstA) {
        return -1;
      } else if (firstB) {
        return 1;
      }

      const dniA = (a.dni ?? '').toUpperCase();
      const dniB = (b.dni ?? '').toUpperCase();
      if (dniA && dniB) {
        const compare = dniA.localeCompare(dniB, 'es');
        if (compare !== 0) return compare;
      } else if (dniA) {
        return -1;
      } else if (dniB) {
        return 1;
      }

      return a.id.localeCompare(b.id, 'es');
    });
  }, [dealMetadata, students]);

  return (
    <Card className="shadow-sm border-0">
      <Card.Body>
        <Stack gap={3}>
            <div>
            <h4 className="fw-semibold mb-1">{variant.productName ?? 'Formación abierta'}</h4>
            <p className="text-muted mb-0">
              Formación abierta en {variant.site ?? '—'}
            </p>
            </div>

          <Stack gap={3}>
            <div className="row g-4">
              <InfoField className="col-12 col-md-6 col-xl-4" label="Formación">
                {variant.productName ?? '—'}
              </InfoField>
              <InfoField className="col-12 col-md-6 col-xl-4" label="Fecha de la formación">
                {formattedDate ?? '—'}
              </InfoField>
              <InfoField className="col-12 col-md-6 col-xl-4" label="Alumnos">
                {studentCount}
              </InfoField>
            </div>

            <div className="row g-4">
              <InfoField className="col-12 col-md-6 col-xl-6" label="Organización">
                {organizationList.length ? (
                  <div className="d-flex flex-column gap-1">
                    {organizationList.map((name) => (
                      <span key={name}>{name}</span>
                    ))}
                  </div>
                ) : (
                  '—'
                )}
              </InfoField>
            </div>

            <div>
              <h5 className="fw-semibold mb-3">Alumnos</h5>
              {studentError ? <Alert variant="danger">{studentError}</Alert> : null}
              {studentsQuery.isError ? (
                <Alert variant="danger">No se pudieron cargar los alumnos de las organizaciones.</Alert>
              ) : null}
              {studentsQuery.isLoading ? (
                <div className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" role="status" />
                  <span>Cargando alumnos…</span>
                </div>
              ) : (
                <Table responsive bordered hover size="sm">
                  <thead className="table-light">
                    <tr>
                      <th>Presupuesto</th>
                      <th>Empresa</th>
                      <th>FUNDAE</th>
                      <th>Nombre</th>
                      <th>Apellidos</th>
                      <th>DNI</th>
                      <th className="text-center">Asistencia</th>
                      <th className="text-center">Apto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStudents.length ? (
                      sortedStudents.map((student) => {
                        const dealId = student.deal_id ?? '';
                        const organizationName = (dealMetadata[dealId]?.organizationName ?? '').trim();
                        const fundaeLabel = (dealMetadata[dealId]?.fundaeLabel ?? '').trim();
                        return (
                          <tr key={student.id}>
                            <td>{student.deal_id}</td>
                            <td>{organizationName.length ? organizationName : '—'}</td>
                            <td>{fundaeLabel.length ? fundaeLabel : '—'}</td>
                            <td>
                              <Form.Control
                                type="text"
                                value={student.nombre}
                                onChange={(event) =>
                                  handleStudentFieldChange(student.id, 'nombre', event.target.value)
                                }
                                onBlur={() => handleStudentFieldBlur(student.id, 'nombre')}
                                disabled={updateStudentMutation.isPending}
                              />
                            </td>
                            <td>
                              <Form.Control
                                type="text"
                                value={student.apellido}
                                onChange={(event) =>
                                  handleStudentFieldChange(student.id, 'apellido', event.target.value)
                                }
                                onBlur={() => handleStudentFieldBlur(student.id, 'apellido')}
                                disabled={updateStudentMutation.isPending}
                              />
                            </td>
                            <td>
                              <Form.Control
                                type="text"
                                value={student.dni}
                                onChange={(event) =>
                                  handleStudentFieldChange(student.id, 'dni', event.target.value)
                                }
                                onBlur={() => handleStudentFieldBlur(student.id, 'dni')}
                                disabled={updateStudentMutation.isPending}
                              />
                            </td>
                            <td className="text-center">
                              <Form.Check
                                type="checkbox"
                                checked={Boolean(student.asistencia)}
                                onChange={(event) =>
                                  handleStudentAttendanceToggle(student.id, event.target.checked)
                                }
                                disabled={updateStudentMutation.isPending}
                              />
                            </td>
                            <td className="text-center">
                              <Form.Check
                                type="checkbox"
                                checked={Boolean(student.apto)}
                                onChange={(event) =>
                                  handleStudentAptoToggle(student.id, event.target.checked)
                                }
                                disabled={updateStudentMutation.isPending}
                              />
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="text-center text-muted">
                          No hay alumnos registrados para esta variante.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              )}
              {dealIds.length ? (
                <>
                  <h6 className="fw-semibold mt-4">Añadir alumn@ a la sesión</h6>
                  <Form className="mt-2" onSubmit={handleNewStudentSubmit}>
                    <Row className="g-2 align-items-end">
                      <Col xs={12} md={3}>
                        <Form.Group controlId={`variant-${variant.variantId}-new-student-deal`}>
                          <Form.Label>Empresa</Form.Label>
                          <Form.Select
                            value={newStudent.dealId}
                            onChange={(event) =>
                              handleNewStudentFieldChange('dealId', event.target.value)
                            }
                            disabled={createStudentMutation.isPending}
                            required
                          >
                            <option value="">Selecciona empresa</option>
                            {dealIds.map((dealId) => {
                              const name = (dealMetadata[dealId]?.organizationName ?? '').trim();
                              return (
                                <option key={dealId} value={dealId}>
                                  {name.length ? `${name} · ${dealId}` : dealId}
                                </option>
                              );
                            })}
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col xs={12} md={3}>
                        <Form.Group
                          controlId={`variant-${variant.variantId}-new-student-nombre`}
                        >
                          <Form.Label>Nombre</Form.Label>
                          <Form.Control
                            type="text"
                            value={newStudent.nombre}
                            onChange={(event) =>
                              handleNewStudentFieldChange('nombre', event.target.value)
                            }
                            placeholder="Nombre"
                            disabled={createStudentMutation.isPending}
                          />
                        </Form.Group>
                      </Col>
                      <Col xs={12} md={3}>
                        <Form.Group
                          controlId={`variant-${variant.variantId}-new-student-apellido`}
                        >
                          <Form.Label>Apellidos</Form.Label>
                          <Form.Control
                            type="text"
                            value={newStudent.apellido}
                            onChange={(event) =>
                              handleNewStudentFieldChange('apellido', event.target.value)
                            }
                            placeholder="Apellidos"
                            disabled={createStudentMutation.isPending}
                          />
                        </Form.Group>
                      </Col>
                      <Col xs={12} md={2}>
                        <Form.Group controlId={`variant-${variant.variantId}-new-student-dni`}>
                          <Form.Label>DNI</Form.Label>
                          <Form.Control
                            type="text"
                            value={newStudent.dni}
                            onChange={(event) =>
                              handleNewStudentFieldChange('dni', event.target.value)
                            }
                            placeholder="DNI"
                            disabled={createStudentMutation.isPending}
                          />
                        </Form.Group>
                      </Col>
                      <Col xs={12} md="auto">
                        <Form.Group
                          controlId={`variant-${variant.variantId}-new-student-asistencia`}
                          className="mb-0"
                        >
                          <Form.Check
                            type="checkbox"
                            label="Asistencia"
                            checked={newStudent.asistencia}
                            onChange={(event) =>
                              handleNewStudentAttendanceChange(event.target.checked)
                            }
                            disabled={createStudentMutation.isPending}
                          />
                        </Form.Group>
                      </Col>
                      <Col xs={12} md="auto">
                        <Form.Group
                          controlId={`variant-${variant.variantId}-new-student-apto`}
                          className="mb-0"
                        >
                          <Form.Check
                            type="checkbox"
                            label="Apto"
                            checked={newStudent.apto}
                            onChange={(event) => handleNewStudentAptoChange(event.target.checked)}
                            disabled={createStudentMutation.isPending}
                          />
                        </Form.Group>
                      </Col>
                      <Col xs={12} md="auto">
                        <Button type="submit" disabled={createStudentMutation.isPending}>
                          {createStudentMutation.isPending ? (
                            <>
                              <Spinner
                                as="span"
                                animation="border"
                                size="sm"
                                role="status"
                                aria-hidden="true"
                              />{' '}
                              Guardando…
                            </>
                          ) : (
                            'Añadir alumn@'
                          )}
                        </Button>
                      </Col>
                    </Row>
                  </Form>
                </>
              ) : null}
            </div>

            <div>
              <h5 className="fw-semibold mb-3">Comentarios</h5>
              {variantCommentError ? <Alert variant="danger">{variantCommentError}</Alert> : null}
              {variantCommentsQuery.isError ? (
                <Alert variant="danger">No se pudieron cargar los comentarios.</Alert>
              ) : null}
              {variantCommentsQuery.isLoading ? (
                <div className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" role="status" />
                  <span>Cargando comentarios…</span>
                </div>
              ) : variantComments.length ? (
                <ListGroup className="mb-3">
                  {variantComments.map((comment) => {
                    const timestamp = comment.updated_at ?? comment.created_at ?? null;
                    const formatted = formatDateTime(timestamp);
                    return (
                      <ListGroup.Item key={comment.id}>
                        <div className="d-flex justify-content-between align-items-start">
                          <div className="fw-semibold">{comment.author}</div>
                          {formatted ? (
                            <div className="text-muted small">{formatted}</div>
                          ) : null}
                        </div>
                        <div className="text-break" style={{ whiteSpace: 'pre-line' }}>
                          {comment.content}
                        </div>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              ) : (
                <p className="text-muted small mb-3">No hay comentarios registrados.</p>
              )}

              <Form onSubmit={handleVariantCommentSubmit} className="d-grid gap-2">
                <Form.Group controlId={`variant-${variant.variantId}-comment`}>
                  <Form.Label>Agregar comentario</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={variantCommentContent}
                    onChange={(event) => setVariantCommentContent(event.target.value)}
                    placeholder="Escribe tus comentarios sobre la formación abierta"
                    disabled={createVariantCommentMutation.isPending}
                  />
                </Form.Group>
                <div className="d-flex justify-content-end">
                  <Button
                    type="submit"
                    disabled={
                      createVariantCommentMutation.isPending || !variantCommentContent.trim().length
                    }
                  >
                    {createVariantCommentMutation.isPending ? 'Guardando…' : 'Añadir comentario'}
                  </Button>
                </div>
              </Form>
            </div>

            {dealsWithKeys.length ? (
              <div>
                <h5 className="fw-semibold mb-3">Documentación por organización</h5>
                <Accordion
                  alwaysOpen
                  activeKey={openDealKeys}
                  onSelect={handleDealAccordionSelect}
                >
                  {dealsWithKeys.map(({ deal, eventKey }) => (
                    <VariantDealAccordionItem
                      key={eventKey}
                      variantId={variant.variantId}
                      deal={deal}
                      eventKey={eventKey}
                    />
                  ))}
                </Accordion>
              </div>
            ) : null}

            <div>
              <h5 className="fw-semibold mb-2">Fichar sesión</h5>
              {timeLogLoadErrorMessage ? <Alert variant="danger">{timeLogLoadErrorMessage}</Alert> : null}
              {timeLogError ? <Alert variant="danger">{timeLogError}</Alert> : null}
              {timeLogSuccess ? (
                <Alert variant="success">Registro horario guardado correctamente.</Alert>
              ) : null}
              {timeLogQuery.isLoading ? (
                <div className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" />
                  <span>Cargando registro horario…</span>
                </div>
              ) : (
                <Form onSubmit={handleTimeLogSubmit} className="d-grid gap-3">
                  <Row className="g-3">
                    <Col xs={12} sm={6}>
                      <Form.Group controlId={`trainer-variant-${variant.variantId}-time-entry`}>
                        <Form.Label>Hora de entrada</Form.Label>
                        <Form.Control
                          type="datetime-local"
                          value={timeLogEntryValue}
                          onChange={(event) => setTimeLogEntryValue(event.target.value)}
                          disabled={saveTimeLogMutation.isPending}
                          required
                        />
                      </Form.Group>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Group controlId={`trainer-variant-${variant.variantId}-time-exit`}>
                        <Form.Label>Hora de salida</Form.Label>
                        <Form.Control
                          type="datetime-local"
                          value={timeLogExitValue}
                          onChange={(event) => setTimeLogExitValue(event.target.value)}
                          disabled={saveTimeLogMutation.isPending}
                          required
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                  <div className="d-flex justify-content-end">
                    <Button
                      type="submit"
                      disabled={saveTimeLogMutation.isPending}
                      style={
                        hasExistingTimeLog
                          ? {
                              backgroundColor: '#F5C147',
                              borderColor: '#F5C147',
                              color: '#212529',
                            }
                          : undefined
                      }
                    >
                      {saveTimeLogMutation.isPending
                        ? 'Guardando…'
                        : hasExistingTimeLog
                        ? 'Modificar'
                        : 'Guardar registro'}
                    </Button>
                  </div>
                  {formattedTimeLogUpdated ? (
                    <div className="text-muted small">Última actualización: {formattedTimeLogUpdated}</div>
                  ) : null}
                </Form>
              )}
            </div>
          </Stack>
        </Stack>
      </Card.Body>
    </Card>
  );
}

function selectDefaultDate(entries: TrainerSessionsDateEntry[]): string | null {
  if (!entries.length) return null;
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const upcoming = entries.find((entry) => entry.date >= todayKey);
  return (upcoming ?? entries[0]).date;
}

export default function TrainerSessionsPage() {
  const location = useLocation();
  const locationState = (location.state ?? null) as
    | { trainerSessionId?: unknown; trainerVariantId?: unknown }
    | null;
  const preselectedSessionId =
    typeof locationState?.trainerSessionId === 'string' ? locationState.trainerSessionId : null;
  const preselectedVariantId =
    typeof locationState?.trainerVariantId === 'string' ? locationState.trainerVariantId : null;

  const sessionsQuery = useQuery({
    queryKey: ['trainer', 'sessions'],
    queryFn: fetchTrainerSessions,
    staleTime: 5 * 60 * 1000,
  });

  const allDateEntries = sessionsQuery.data?.dates ?? [];
  const dateEntries = useMemo(() => {
    if (!allDateEntries.length) return [] as TrainerSessionsDateEntry[];
    return allDateEntries
      .map((entry) => {
        const confirmedSessions = entry.sessions.filter(isSessionConfirmed);
        if (confirmedSessions.length === entry.sessions.length) {
          return entry;
        }
        return { ...entry, sessions: confirmedSessions } satisfies TrainerSessionsDateEntry;
      })
      .filter((entry) => entry.sessions.length || entry.variants.length);
  }, [allDateEntries]);

  const hasPendingSessions = useMemo(
    () => allDateEntries.some((entry) => entry.sessions.some(isSessionPending)),
    [allDateEntries],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const preselectedDate = useMemo(() => {
    if (!dateEntries.length) return null;
    if (preselectedSessionId) {
      const entry = dateEntries.find((dateEntry) =>
        dateEntry.sessions.some((session) => session.sessionId === preselectedSessionId),
      );
      if (entry) return entry.date;
    }
    if (preselectedVariantId) {
      const entry = dateEntries.find((dateEntry) =>
        dateEntry.variants.some((variant) => variant.variantId === preselectedVariantId),
      );
      if (entry) return entry.date;
    }
    return null;
  }, [dateEntries, preselectedSessionId, preselectedVariantId]);

  useEffect(() => {
    if (!dateEntries.length) {
      setSelectedDate(null);
      return;
    }
    setSelectedDate((previous) => {
      if (previous && dateEntries.some((entry) => entry.date === previous)) {
        return previous;
      }
      return selectDefaultDate(dateEntries);
    });
  }, [dateEntries]);

  useEffect(() => {
    if (!preselectedDate) return;
    setSelectedDate(preselectedDate);
  }, [preselectedDate]);

  const handleDateChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedDate(value ? value : null);
  }, []);

  const selectedEntry = useMemo(() => {
    if (!selectedDate) return null;
    return dateEntries.find((entry) => entry.date === selectedDate) ?? null;
  }, [dateEntries, selectedDate]);

  const companyAndServiceSessions = useMemo(() => {
    if (!selectedEntry) return [];
    return selectedEntry.sessions.filter(
      (session) => session.isCompanyTraining || session.isGepServices,
    );
  }, [selectedEntry]);

  const variants = selectedEntry?.variants ?? [];
  const variantCount = variants.length;

  return (
    <Stack gap={4} className="trainer-sessions-page">
      <Card className="shadow-sm border-0">
        <Card.Body>
          <Stack gap={3}>
            <div>
              <h1 className="h3 fw-bold mb-0">Mis sesiones asignadas</h1>
              <p className="text-muted mb-0">
                Consulta la información y comparte documentación con el equipo del ERP.
              </p>
            </div>
            <Form>
              <Form.Group as={Row} className="align-items-center g-2" controlId="trainer-sessions-date">
                <Form.Label column sm={12} md={3} className="text-md-end fw-semibold">
                  Selecciona una fecha
                </Form.Label>
                <Col sm={12} md={6} lg={5}>
                  <Form.Select value={selectedDate ?? ''} onChange={handleDateChange} disabled={!dateEntries.length}>
                    <option value="" disabled>
                      {sessionsQuery.isLoading ? 'Cargando fechas…' : 'Selecciona una fecha con asignaciones'}
                    </option>
                    {dateEntries.map((entry) => {
                      const label = formatDateLabel(entry.date);
                      const suffixParts = [] as string[];

                      const sessionCounts = entry.sessions.reduce(
                        (acc, session) => {
                          if (session.isCompanyTraining) {
                            acc.company += 1;
                          } else if (session.isGepServices) {
                            acc.services += 1;
                          } else {
                            acc.other += 1;
                          }
                          return acc;
                        },
                        { company: 0, services: 0, other: 0 },
                      );

                      if (sessionCounts.company) {
                        suffixParts.push(
                          `${sessionCounts.company} sesión${sessionCounts.company === 1 ? '' : 'es'} F.Empresa`,
                        );
                      }

                      if (sessionCounts.services) {
                        suffixParts.push(
                          `${sessionCounts.services} sesión${sessionCounts.services === 1 ? '' : 'es'} Services`,
                        );
                      }

                      if (sessionCounts.other) {
                        suffixParts.push(
                          `${sessionCounts.other} sesión${sessionCounts.other === 1 ? '' : 'es'}`,
                        );
                      }

                      const variantCountEntry = entry.variants.length;
                      if (variantCountEntry) {
                        suffixParts.push(
                          `${variantCountEntry} sesión${variantCountEntry === 1 ? '' : 'es'} F. Abierta`,
                        );
                      }
                      const suffix = suffixParts.length ? ` · ${suffixParts.join(' · ')}` : '';
                      return (
                        <option key={entry.date} value={entry.date}>
                          {label}
                          {suffix}
                        </option>
                      );
                    })}
                  </Form.Select>
                </Col>
                {selectedEntry ? (
                  <Col sm={12} md={3} className="text-md-start text-muted small">
                    {variantCount
                      ? `También tienes ${variantCount} ${variantCount === 1 ? 'formación abierta asignada' : 'formaciones abiertas asignadas'} en esta fecha.`
                      : 'Solo hay sesiones asignadas en esta fecha.'}
                  </Col>
                ) : null}
              </Form.Group>
            </Form>
            {hasPendingSessions ? (
              <p className="text-muted small mb-0">
                Tienes sesiones pendientes de confirmar en la sección{' '}
                <Link to="/usuarios/trainer/pendientes">Pendientes</Link>.
              </p>
            ) : null}
          </Stack>
        </Card.Body>
      </Card>

      {sessionsQuery.isLoading ? (
        <Card className="shadow-sm border-0">
          <Card.Body className="d-flex align-items-center gap-2">
            <Spinner animation="border" role="status" />
            <span>Cargando sesiones asignadas…</span>
          </Card.Body>
        </Card>
      ) : null}

      {sessionsQuery.isError ? (
        <Alert variant="danger">
          No se pudo cargar la información de tus sesiones. Inténtalo de nuevo más tarde.
        </Alert>
      ) : null}

      {!sessionsQuery.isLoading && !sessionsQuery.isError && !dateEntries.length ? (
        <Card className="shadow-sm border-0">
          <Card.Body>
            <p className="text-muted mb-0">
              {hasPendingSessions
                ? 'No tienes sesiones confirmadas todavía. Revisa la sección Pendientes para aceptar o rechazar tus invitaciones.'
                : 'No tienes sesiones ni variantes asignadas en el calendario.'}
            </p>
          </Card.Body>
        </Card>
      ) : null}

      {selectedEntry && !companyAndServiceSessions.length && !variants.length ? (
        <Card className="shadow-sm border-0">
          <Card.Body>
            <p className="text-muted mb-0">
              En esta fecha no tienes sesiones de formación empresa ni servicios asignados.
            </p>
          </Card.Body>
        </Card>
      ) : null}

      {companyAndServiceSessions.map((session) => (
        <SessionDetailCard key={session.sessionId} session={session} />
      ))}
      {variants.map((variant) => (
        <VariantDetailCard key={variant.variantId} variant={variant} />
      ))}
    </Stack>
  );
}
