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
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
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
} from '../../../api/trainer-sessions';
import {
  fetchSessionComments,
  createSessionComment,
  updateSessionComment,
  deleteSessionComment,
} from '../../../features/presupuestos/api/sessions.api';
import {
  fetchSessionDocuments,
  uploadSessionDocuments,
  deleteSessionDocument,
} from '../../../features/presupuestos/api/documents.api';
import {
  createSessionStudent,
  deleteSessionStudent,
  fetchSessionStudents,
  updateSessionStudent,
  type UpdateSessionStudentInput,
} from '../../../features/presupuestos/api/students.api';
import type { SessionComment, SessionStudent } from '../../../api/sessions.types';
import { useCurrentUserIdentity } from '../../../features/presupuestos/useCurrentUserIdentity';
import type { SessionDocumentsPayload } from '../../../api/sessions.types';
import type { ReportDraft, ReportSessionInfo } from '../../../features/informes/ReportsFlow';

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

function formatDateForInput(value: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed.length) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function calculateDurationHours(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return '';
  const hours = diffMs / (1000 * 60 * 60);
  if (!Number.isFinite(hours) || hours <= 0) return '';
  const rounded = Math.round(hours * 100) / 100;
  return String(rounded);
}

function renderBooleanField(field: { value: boolean | null; label: string | null }): string {
  if (field.label && field.label.trim().length) {
    return field.label.trim();
  }
  if (field.value === true) return 'Sí';
  if (field.value === false) return 'No';
  return '—';
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

function SessionDetailCard({ session }: SessionDetailCardProps) {
  const queryClient = useQueryClient();
  const { userId, userName } = useCurrentUserIdentity();
  const mapsUrl = session.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(session.address)}`
    : null;
  const isGepServices = session.isGepServices;
  const isCompanyTraining = session.isCompanyTraining;

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
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);
  const [newStudent, setNewStudent] = useState({
    nombre: '',
    apellido: '',
    dni: '',
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
      apto,
    }: {
      nombre: string;
      apellido: string;
      dni: string;
      apto: boolean;
    }) =>
      createSessionStudent({
        dealId: session.dealId,
        sessionId: session.sessionId,
        nombre,
        apellido,
        dni,
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
      setNewStudent({ nombre: '', apellido: '', dni: '', apto: false });
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setStudentError(error.message);
      } else {
        setStudentError('No se pudo añadir el alumno.');
      }
    },
  });

  const deleteStudentMutation = useMutation({
    mutationFn: (studentId: string) => deleteSessionStudent(studentId),
    onMutate: (studentId: string) => {
      setStudentError(null);
      setDeletingStudentId(studentId);
    },
    onSuccess: (_, studentId) => {
      studentsOriginalRef.current.delete(studentId);
      setStudents((prev) => prev.filter((student) => student.id !== studentId));
      queryClient.setQueryData<SessionStudent[] | undefined>(
        ['trainer', 'session', session.sessionId, 'students'],
        (previous) => previous?.filter((student) => student.id !== studentId),
      );
      setDeletingStudentId(null);
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        setStudentError(error.message);
      } else {
        setStudentError('No se pudo eliminar el alumno.');
      }
      setDeletingStudentId(null);
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

  const reportLinkState = useMemo(() => {
    const dealId = session.dealId?.trim();
    if (!dealId) return undefined;

    const alumnosCount = students.length;
    const alumnosValue = !isGepServices && alumnosCount > 0 ? String(alumnosCount) : undefined;
    const durationValue = calculateDurationHours(session.startDate, session.endDate);
    const dateValue = formatDateForInput(session.startDate);

    const datos: Record<string, unknown> = {
      tipo: isGepServices ? 'preventivo' : 'formacion',
      idioma: 'ES',
    };
    if (!isGepServices) {
      datos.sesiones = 1;
    }
    if (session.organizationName) datos.cliente = session.organizationName;
    if (session.commercialName) datos.comercial = session.commercialName;
    if (session.clientName) datos.contacto = session.clientName;
    if (session.address) datos.sede = session.address;
    if (trainerDisplayName) datos.formadorNombre = trainerDisplayName;
    if (dateValue) datos.fecha = dateValue;
    if (alumnosValue) datos.alumnos = alumnosValue;
    if (!isGepServices && durationValue) datos.duracion = durationValue;
    if (isGepServices) {
      datos.preventivo = {
        trabajos: '',
        tareas: '',
        observaciones: '',
        incidencias: '',
      };
    }
    const templateValue = session.formationTemplate?.trim();
    const formationTitle = session.formationName ?? session.sessionTitle;
    if (!isGepServices) {
      if (templateValue) {
        datos.formacionTitulo = templateValue;
      } else if (formationTitle) {
        datos.formacionTitulo = formationTitle;
      }
    }

    const sessionInfo: ReportSessionInfo | null = session.sessionId
      ? {
          id: session.sessionId,
          number: null,
          label: session.sessionTitle ?? session.formationName ?? null,
          direccion: session.address ?? null,
          nombre: session.formationName ?? session.sessionTitle ?? null,
          fecha: session.startDate ?? null,
        }
      : null;

    const prefill: Partial<ReportDraft> = {
      type: isGepServices ? 'preventivo' : 'formacion',
      dealId,
      datos,
      formador: { nombre: trainerDisplayName, idioma: 'ES' },
    };

    if (sessionInfo) {
      prefill.session = sessionInfo;
      prefill.sessionOptions = [sessionInfo];
    }

    return { reportPrefill: prefill };
  }, [isGepServices, session, students, trainerDisplayName]);

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

  const handleStudentDelete = useCallback(
    (studentId: string) => {
      const confirmed = window.confirm('¿Eliminar este alumno?');
      if (!confirmed) {
        return;
      }
      deleteStudentMutation.mutate(studentId);
    },
    [deleteStudentMutation],
  );

  const handleNewStudentFieldChange = useCallback(
    (field: 'nombre' | 'apellido' | 'dni', value: string) => {
      setNewStudent((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

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
                      <th className="text-center">Apto</th>
                      <th className="text-center">Acciones</th>
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
                              checked={Boolean(student.apto)}
                              onChange={(event) =>
                                handleStudentAptoToggle(student.id, event.target.checked)
                              }
                              disabled={updateStudentMutation.isPending}
                            />
                          </td>
                          <td className="text-center">
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleStudentDelete(student.id)}
                              disabled={
                                (deleteStudentMutation.isPending &&
                                  deletingStudentId === student.id) ||
                                updateStudentMutation.isPending
                              }
                            >
                              {deleteStudentMutation.isPending &&
                              deletingStudentId === student.id ? (
                                <Spinner animation="border" size="sm" />
                              ) : (
                                'Eliminar'
                              )}
                            </Button>
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
                Si falta algún alumn@ elimina de la tabla, y añade un comentario del nombre de la persona
                que ha faltado
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

          <Row className="g-4">
            <Col xs={12} xl={6}>
              <div>
                <h5 className="fw-semibold mb-3">Comentarios</h5>
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
                        const canEdit =
                          Boolean(authorLower.length) && authorLower === normalizedUserName;
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
                                      disabled={
                                        isSaving || !editingCommentContent.trim().length
                                      }
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
                                <Stack gap={2}>
                                  <p className="mb-0 text-break" style={{ whiteSpace: 'pre-line' }}>
                                    {displayContent}
                                  </p>
                                  {canEdit ? (
                                    <div className="d-flex flex-wrap gap-2">
                                      <Button
                                        variant="outline-primary"
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
                                </Stack>
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
              <div>
                <h5 className="fw-semibold mb-3">Documentos</h5>
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
                    label="¿Gasto?"
                    checked={isExpense}
                    onChange={(event) => setIsExpense(event.target.checked)}
                    disabled={documentMutation.isPending}
                  />
                  <Form.Control
                    type="file"
                    multiple
                    onChange={handleDocumentUpload}
                    ref={documentInputRef}
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
                <div className="mt-4">
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
                {isCompanyTraining || isGepServices ? (
                  <div className="mt-4">
                    <h5 className="fw-semibold mb-2">
                      Haz un informe sobre {isGepServices ? 'el servicio' : 'la formación'}
                    </h5>
                    <p className="mb-0">
                      <Link
                        to={
                          isGepServices
                            ? '/usuarios/trainer/informes/preventivo'
                            : '/usuarios/trainer/informes/formacion'
                        }
                        className="text-decoration-none"
                        state={reportLinkState}
                      >
                        {isGepServices
                          ? 'https://erpgep.netlify.app/usuarios/trainer/informes/preventivo'
                          : 'https://erpgep.netlify.app/usuarios/trainer/informes/formacion'}
                      </Link>
                    </p>
                  </div>
                ) : null}
              </div>
            </Col>
          </Row>
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
  const sessionsQuery = useQuery({
    queryKey: ['trainer', 'sessions'],
    queryFn: fetchTrainerSessions,
    staleTime: 5 * 60 * 1000,
  });

  const dateEntries = sessionsQuery.data?.dates ?? [];
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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

  const variantCount = selectedEntry?.variants.length ?? 0;

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
                      ? `También tienes ${variantCount} variante${variantCount === 1 ? '' : 's'} asignada${variantCount === 1 ? '' : 's'} en esta fecha.`
                      : 'Solo hay sesiones asignadas en esta fecha.'}
                  </Col>
                ) : null}
              </Form.Group>
            </Form>
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
              No tienes sesiones ni variantes asignadas en el calendario.
            </p>
          </Card.Body>
        </Card>
      ) : null}

      {selectedEntry && !companyAndServiceSessions.length ? (
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
    </Stack>
  );
}
