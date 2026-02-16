import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  Modal,
  Button,
  Form,
  ListGroup,
  Row,
  Col,
  Alert,
  Spinner,
  Table,
  Accordion,
  Badge,
} from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDealDetail,
  patchDealEditable,
  importDeal,
  getDocPreviewUrl,
  uploadManualDocument,
  deleteDocument,
  buildDealDetailViewModel,
  createDealNote,
  updateDealNote,
  deleteDealNote,
  fetchDealSessions,
  fetchDealStudents,
  createSessionStudent,
  updateSessionStudent,
  isApiError,
  MANUAL_DOCUMENT_SIZE_LIMIT_BYTES,
  MANUAL_DOCUMENT_SIZE_LIMIT_MESSAGE,
  type SessionDTO,
  type SessionStudent,
} from '../api';
import {
  DEAL_NOT_WON_ERROR_CODE,
  DEAL_NOT_WON_ERROR_MESSAGE,
  normalizeImportDealResult,
} from '../importDealUtils';
import { formatSedeLabel } from '../formatSedeLabel';
import { SessionStudentsAccordionItem, SessionsAccordionAbierta } from './sessions/SessionsAccordionAbierta';
import type { DealEditablePatch, DealProductEditablePatch } from '../api';
import type { DealDetail, DealDetailViewModel, DealDocument, DealSummary } from '../../../types/deal';
import { buildFieldTooltip } from '../../../utils/fieldTooltip';
import {
  FOLLOW_UP_FIELDS,
  isAffirmativeLabel,
  useDealFollowUpToggle,
  type FollowUpFieldKey,
} from '../hooks/useDealFollowUpToggle';
import { DEALS_QUERY_KEY } from '../queryKeys';
import { useCurrentUserIdentity } from '../useCurrentUserIdentity';

function normalizeId(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function mergeById<T extends { id?: string | null }>(
  primary: readonly T[] | null | undefined,
  fallback: readonly T[] | null | undefined,
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();

  const addItem = (item: T | null | undefined) => {
    if (!item) return;
    const id = normalizeId(item.id);
    if (id.length) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    result.push(item);
  };

  primary?.forEach(addItem);
  fallback?.forEach(addItem);

  return result;
}

function mergeDealDetailData(current: DealDetail | undefined, next: DealDetail): DealDetail {
  if (!current) return next;

  const manualDocuments = (current.documents ?? []).filter(
    (doc): doc is DealDocument => !!doc && (doc.source === 'MANUAL' || doc.source === 'S3'),
  );

  return {
    ...next,
    notes: mergeById(next.notes ?? [], current.notes ?? []),
    documents: mergeById(next.documents ?? [], manualDocuments),
  };
}

const EMPTY_DOCUMENTS: DealDocument[] = [];
const PIPELINE_LABEL = 'Formación Abierta';

interface Props {
  dealId: string | null;
  summary?: DealSummary | null;
  onClose: () => void;
  onShowProductComment?: (payload: { productName: string; comment: string }) => void;
  onNotify?: (toast: { variant: 'success' | 'danger' | 'info'; message: string }) => void;
  autoRefreshOnOpen?: boolean;
  highlightSessionId?: string | null;
}

type BudgetFormValuesAbierta = {
  sede_label: string;
  fundae_label: string;
};

type DealNoteView = DealDetailViewModel['notes'][number];

const HIDDEN_NOTE_PATTERNS = ['detalles del documentacion', 'alumnos del deal'];

function normalizeHiddenNoteText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function shouldHideDealNote(note: DealNoteView): boolean {
  const normalizedContent = normalizeHiddenNoteText(note.content ?? '');
  if (!normalizedContent.length) return false;
  return HIDDEN_NOTE_PATTERNS.some((pattern) => normalizedContent.includes(pattern));
}

function normalizeHoursMapValue(value?: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function areHourMapsEqual(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (normalizeHoursMapValue(a[key]) !== normalizeHoursMapValue(b[key])) return false;
  }
  return true;
}

function formatInitialHours(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  const trimmed = String(value).trim();
  if (!trimmed.length) return '';
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) return String(Math.round(parsed));
  return trimmed;
}

function buildCommentPreview(comment: string, maxLength = 120): string {
  const normalized = comment.replace(/\s+/g, ' ').trim();
  if (!normalized.length) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function resolveDocumentPreviewUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();

    if (host === 'drive.google.com' || host.endsWith('.drive.google.com')) {
      const fileIdMatch = parsedUrl.pathname.match(/\/file\/d\/([^/]+)/);
      const searchId = parsedUrl.searchParams.get('id');

      const fileId = fileIdMatch?.[1] ?? searchId ?? null;
      if (fileId) {
        return `https://drive.google.com/file/d/${fileId}/preview`;
      }
    }

    if (host === 'docs.google.com' || host.endsWith('.docs.google.com')) {
      const docMatch = parsedUrl.pathname.match(/\/(document|presentation|spreadsheets|forms)\/d\/([^/]+)/);
      if (docMatch) {
        const [, type, id] = docMatch;
        return `https://docs.google.com/${type}/d/${id}/preview`;
      }
    }
  } catch (error) {
    // Ignore URL parsing issues and fall back to original URL
  }

  return url;
}

type NoteStudentEntry = { nombre: string; apellido: string; dni: string };

function normalizeNoteWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeNoteContent(content: string): string {
  return content
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[“”]/g, '"')
    .replace(/^["']+/, '')
    .replace(/["']+$/, '')
    .trim();
}

function parseNoteStudents(content: string): NoteStudentEntry[] {
  if (!content.trim().length) return [];

  const cleaned = sanitizeNoteContent(content);
  const headerIndex = cleaned.toLowerCase().indexOf('alumnos del deal');
  if (headerIndex === -1) {
    return [];
  }

  const afterHeader = cleaned.slice(headerIndex + 'alumnos del deal'.length).replace(/^[:\-\s"']+/, '');
  if (!afterHeader.trim().length) {
    return [];
  }

  const normalizedBody = afterHeader
    .replace(/\n+/g, ' ')
    .replace(/\s*;\s*/g, ';')
    .replace(/\s*\|\s*/g, '|')
    .trim();

  if (!normalizedBody.length) {
    return [];
  }

  const seen = new Set<string>();
  const result: NoteStudentEntry[] = [];

  normalizedBody
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .forEach((entry) => {
      const rawParts = entry
        .split('|')
        .map((part) => normalizeNoteWhitespace(part.replace(/^["']+/, '').replace(/["']+$/, '')));

      const parts = rawParts.filter((part) => part.length > 0);
      if (parts.length < 3) {
        return;
      }

      const nombre = parts[0];
      const apellido = parts.slice(1, -1).join(' ').trim();
      const dni = parts[parts.length - 1].toUpperCase().replace(/[^A-Z0-9]/g, '');

      if (!nombre.length || !apellido.length || !dni.length) {
        return;
      }

      if (seen.has(dni)) {
        return;
      }
      seen.add(dni);
      result.push({ nombre, apellido, dni });
    });

  return result;
}

function buildNoteStudentsSignature(noteId: string | null, students: readonly NoteStudentEntry[]): string {
  const sorted = students
    .map((student) => ({
      nombre: normalizeNoteWhitespace(student.nombre),
      apellido: normalizeNoteWhitespace(student.apellido),
      dni: student.dni.trim().toUpperCase(),
    }))
    .sort((a, b) => {
      const dniCompare = a.dni.localeCompare(b.dni, 'es');
      if (dniCompare !== 0) return dniCompare;
      const lastCompare = a.apellido.localeCompare(b.apellido, 'es');
      if (lastCompare !== 0) return lastCompare;
      return a.nombre.localeCompare(b.nombre, 'es');
    });

  const serialized = sorted
    .map((student) => `${student.dni}|${student.nombre}|${student.apellido}`)
    .join(';');

  return `${noteId ?? 'unknown'}|${serialized}`;
}

function extractNoteStudents(
  notes: DealDetail['notes'] | undefined | null,
): { noteId: string | null; signature: string | null; students: NoteStudentEntry[] } {
  if (!Array.isArray(notes)) {
    return { noteId: null, signature: null, students: [] };
  }

  for (const note of notes) {
    const content = typeof note?.content === 'string' ? note.content : '';
    if (!content.trim().length) {
      continue;
    }
    const students = parseNoteStudents(content);
    if (!students.length) {
      continue;
    }
    const noteId = typeof note?.id === 'string' && note.id.trim().length ? note.id.trim() : null;
    return {
      noteId,
      signature: buildNoteStudentsSignature(noteId, students),
      students,
    };
  }

  return { noteId: null, signature: null, students: [] };
}

function pickDefaultSessionId(sessions: readonly SessionDTO[] | null | undefined): string | null {
  if (!sessions || sessions.length === 0) {
    return null;
  }

  const filtered = sessions.filter(
    (session): session is SessionDTO => Boolean(session && typeof session.id === 'string' && session.id.trim().length),
  );

  if (!filtered.length) {
    return null;
  }

  const preferred = filtered.filter((session) => session.estado !== 'CANCELADA');
  const candidates = preferred.length ? preferred : filtered;

  const sorted = candidates.slice().sort((a, b) => {
    const startA = (a.fecha_inicio_utc ?? '').trim();
    const startB = (b.fecha_inicio_utc ?? '').trim();
    if (startA && startB) {
      const compare = startA.localeCompare(startB);
      if (compare !== 0) {
        return compare;
      }
    } else if (startA) {
      return -1;
    } else if (startB) {
      return 1;
    }

    const nameA = (a.nombre_cache ?? '').trim().toLowerCase();
    const nameB = (b.nombre_cache ?? '').trim().toLowerCase();
    const nameCompare = nameA.localeCompare(nameB, 'es');
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return a.id.localeCompare(b.id, 'es');
  });

  return sorted[0]?.id ?? null;
}

export function BudgetDetailModalAbierta({
  dealId,
  summary,
  onClose,
  onShowProductComment,
  onNotify,
  autoRefreshOnOpen = false,
  highlightSessionId: _highlightSessionId = null,
}: Props) {
  void _highlightSessionId;
  const qc = useQueryClient();
  const { userId, userName } = useCurrentUserIdentity();

  const normalizedDealId =
    typeof dealId === 'string' ? dealId.trim() : dealId != null ? String(dealId) : '';

  const detailQueryKey = ['deal', normalizedDealId] as const;

  const detailQuery = useQuery<DealDetail>({
    queryKey: detailQueryKey,
    queryFn: () => fetchDealDetail(normalizedDealId),
    enabled: normalizedDealId.length > 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
    staleTime: Infinity
  });

  const deal = detailQuery.data ?? null;
  const isLoading = detailQuery.isLoading;

  const {
    toggleFollowUp,
    isLoading: followUpLoading,
    pendingField: followUpPendingField,
  } = useDealFollowUpToggle({
    dealId: deal?.deal_id ?? (normalizedDealId.length ? normalizedDealId : null),
    detailQueryKey,
    userId,
    userName,
  });

  const lastManualRefreshRef = useRef(false);

  const refreshMutation = useMutation({
    mutationFn: (dealId: string) => importDeal(dealId),
    onSuccess: (payload) => {
      const { deal: nextDeal, warnings } = normalizeImportDealResult(payload);
      if (nextDeal) {
        qc.setQueryData(detailQueryKey, (current: DealDetail | undefined) =>
          mergeDealDetailData(current, nextDeal as DealDetail),
        );
      }
      qc.invalidateQueries({ queryKey: detailQueryKey });
      qc.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ['calendarSessions'] });
      qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) &&
            key.length > 1 &&
            key[0] === 'dealSessions' &&
            key[1] === normalizedDealId
          );
        },
      });
      qc.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) &&
            key.length > 1 &&
            key[0] === 'dealSessionsForStudents' &&
            key[1] === normalizedDealId
          );
        },
      });

      if (warnings.length) {
        alert(`Presupuesto actualizado con avisos:\n\n${warnings.join('\n')}`);
      }

      const message = lastManualRefreshRef.current
        ? 'Presupuesto actualizado'
        : 'Presupuesto importado';
      lastManualRefreshRef.current = false;

      if (onNotify) {
        onNotify({ variant: 'success', message });
      }
    },
    onError: (error: unknown) => {
      lastManualRefreshRef.current = false;
      if (isApiError(error) && error.code === DEAL_NOT_WON_ERROR_CODE) {
        const message = DEAL_NOT_WON_ERROR_MESSAGE;
        if (onNotify) {
          onNotify({ variant: 'danger', message });
        } else {
          alert(message);
        }
        return;
      }
      const defaultMessage = 'No se ha podido importar el presupuesto. Inténtalo de nuevo más tarde.';
      const notifyMessage = isApiError(error)
        ? `No se pudo importar. [${error.code}] ${error.message}`
        : `No se pudo importar. [UNKNOWN_ERROR] ${
            error instanceof Error && error.message ? error.message : defaultMessage
          }`;

      if (onNotify) {
        onNotify({ variant: 'danger', message: notifyMessage });
      } else {
        alert(notifyMessage);
      }
    }
  });

  const detailView: DealDetailViewModel = useMemo(
    () => buildDealDetailViewModel(deal, summary ?? null),
    [deal, summary]
  );

  const [form, setForm] = useState<BudgetFormValuesAbierta | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [selectedStudentsSessionId, setSelectedStudentsSessionId] = useState<string | null>(null);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [creatingNote, setCreatingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [updatingNote, setUpdatingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [viewingNote, setViewingNote] = useState<DealNoteView | null>(null);
  const [productHours, setProductHours] = useState<Record<string, string>>({});
  const [viewingComment, setViewingComment] = useState<
    { productName: string; comment: string } | null
  >(null);
  const [previewDocument, setPreviewDocument] = useState<DealDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ name?: string | null; mime_type?: string | null } | null>(
    null
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [isPoDocument, setIsPoDocument] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const processedNoteSignatureRef = useRef<string | null>(null);
  const processedNoteDealIdRef = useRef<string | null>(null);
  const noteWarningSignatureRef = useRef<string | null>(null);
  const autoRefreshTriggeredRef = useRef(false);
  const lastAutoRefreshDealIdRef = useRef<string | null>(null);

  const isFollowUpFieldLoading = (field: FollowUpFieldKey) =>
    followUpLoading && followUpPendingField === field;

  const getFollowUpValue = (field: FollowUpFieldKey): boolean => {
    const detailValue = deal?.[field];
    if (typeof detailValue === 'boolean') return detailValue;
    const summaryValue = summary?.[field as keyof DealSummary];
    return typeof summaryValue === 'boolean' ? summaryValue : false;
  };

  const getFollowUpSourceValue = (
    source: (typeof FOLLOW_UP_FIELDS)[number]['source'],
  ): string | null => {
    switch (source) {
      case 'caes_label':
        return deal?.caes_label ?? summary?.caes_label ?? null;
      case 'fundae_label':
        return form?.fundae_label ?? deal?.fundae_label ?? summary?.fundae_label ?? null;
      case 'hotel_label':
        return deal?.hotel_label ?? summary?.hotel_label ?? null;
      case 'transporte':
        return deal?.transporte ?? summary?.transporte ?? null;
      case 'po':
        return deal?.po ?? summary?.po ?? null;
      default:
        return null;
    }
  };

  const handleFollowUpToggle = async (
    field: FollowUpFieldKey,
    nextValue: boolean,
    label: string,
  ) => {
    try {
      await toggleFollowUp(field, nextValue);
    } catch (error) {
      const fallback = `No se pudo actualizar el seguimiento de ${label}.`;
      const message =
        error instanceof Error && error.message && error.message.trim().length
          ? error.message
          : fallback;
      if (onNotify) {
        onNotify({ variant: 'danger', message });
      } else {
        alert(message);
      }
    }
  };

  const renderFollowUpBlock = (field: FollowUpFieldKey) => {
    const config = FOLLOW_UP_FIELDS.find((entry) => entry.field === field);
    if (!config) return null;
    const sourceValue = getFollowUpSourceValue(config.source);
    if (!isAffirmativeLabel(sourceValue) && field !== 'fundae_val') return null;

    const checked = getFollowUpValue(field);
    const baseId = deal?.deal_id ?? (normalizedDealId.length ? normalizedDealId : null);
    const inputId = `${field}-${baseId ?? 'deal'}`;

    return (
      <Form.Check
        id={inputId}
        type="checkbox"
        className="budget-follow-up-checkbox mb-0"
        title={`Seguimiento ${config.label}`}
        checked={checked}
        disabled={isFollowUpFieldLoading(field)}
        onChange={(event) => handleFollowUpToggle(field, event.target.checked, config.label)}
      />
    );
  };

  const getDocumentDisplayName = (doc: DealDocument | null | undefined): string => {
    if (!doc) return 'Documento';
    const driveName = (doc.drive_file_name ?? '').trim();
    if (driveName.length) return driveName;
    const fallback = (doc.name ?? '').trim();
    return fallback.length ? fallback : 'Documento';
  };

  const getDocumentHref = (doc: DealDocument): string | null => {
    const rawLink = doc.drive_web_view_link ?? '';
    const trimmed = rawLink.trim();
    return trimmed.length ? trimmed : null;
  };

  const canUploadDocument = Boolean(deal?.deal_id);

  const openUploadDialog = () => {
    if (!canUploadDocument) return;
    setPendingUploadFile(null);
    setIsDragActive(false);
    setIsPoDocument(false);
    setShowUploadDialog(true);
  };

  const closeUploadDialog = () => {
    if (uploadingDocument) return;
    setShowUploadDialog(false);
    setPendingUploadFile(null);
    setIsDragActive(false);
    setIsPoDocument(false);
  };

  const toFileArray = (files: FileList | File[] | null | undefined): File[] =>
    files ? (Array.isArray(files) ? files : Array.from(files)) : [];

  const handleSelectUploadFile = (files: FileList | File[] | null | undefined) => {
    const fileArray = toFileArray(files);
    if (!fileArray.length) {
      setPendingUploadFile(null);
      return;
    }
    const [file] = fileArray;
    setPendingUploadFile(file);
  };

  const handleUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleSelectUploadFile(event.target.files);
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleBrowseClick = () => {
    uploadInputRef.current?.click();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploadingDocument) return;
    setIsDragActive(true);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploadingDocument) return;
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

  const handleDropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploadingDocument) return;
    setIsDragActive(false);
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      handleSelectUploadFile(null);
      return;
    }

    if (dataTransfer.files && dataTransfer.files.length > 0) {
      handleSelectUploadFile(dataTransfer.files);
      return;
    }

    const itemFiles = dataTransfer.items
      ? Array.from(dataTransfer.items)
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file))
      : [];

    handleSelectUploadFile(itemFiles.length ? itemFiles : null);
  };

  const handleUploadDocument = async () => {
    if (!deal?.deal_id || !pendingUploadFile) return;
    try {
      setUploadingDocument(true);
      await uploadManualDocument(
        deal.deal_id,
        pendingUploadFile,
        { id: userId, name: userName },
        { isPoDocument },
      );
      await qc.invalidateQueries({ queryKey: detailQueryKey });
      setShowUploadDialog(false);
      setPendingUploadFile(null);
      setIsDragActive(false);
      setIsPoDocument(false);
    } catch (error: unknown) {
      console.error('[BudgetDetailModalAbierta] Error al subir documento del presupuesto', error);
      const fallbackMessage = 'No se pudo subir el documento';
      const sizeLimitMessage = MANUAL_DOCUMENT_SIZE_LIMIT_MESSAGE;
      const fileTooLarge = pendingUploadFile.size > MANUAL_DOCUMENT_SIZE_LIMIT_BYTES;
      let message = fallbackMessage;

      if (isApiError(error)) {
        const { code, status, message: baseMessageRaw } = error;
        const normalizedBaseMessage = baseMessageRaw?.trim().length ? baseMessageRaw : fallbackMessage;
        if (
          code === 'PAYLOAD_TOO_LARGE' ||
          status === 413 ||
          (fileTooLarge && (status === 500 || status === 502 || code === 'HTTP_500'))
        ) {
          message = sizeLimitMessage;
        } else {
          const parts: string[] = [normalizedBaseMessage];
          const meta: string[] = [];
          if (code?.trim().length) {
            meta.push(`código: ${code}`);
          }
          if (typeof status === 'number') {
            meta.push(`estado: ${status}`);
          }
          if (meta.length) {
            parts.push(`(${meta.join(', ')})`);
          }
          message = parts.join(' ');
        }
      } else if (error instanceof Error) {
        const normalizedErrorMessage = error.message?.trim().length ? error.message : fallbackMessage;
        message = fileTooLarge ? sizeLimitMessage : normalizedErrorMessage;
      } else if (fileTooLarge) {
        message = sizeLimitMessage;
      }

      alert(message);
    } finally {
      setUploadingDocument(false);
    }
  };

  const updateForm = (field: keyof BudgetFormValuesAbierta, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  // Inicializa solo los campos editables
  useEffect(() => {
    if (deal) {
      setForm({
        sede_label: deal.sede_label ?? '',
        fundae_label: deal.fundae_label ?? '',
      });
    } else if (summary) {
      setForm({
        sede_label: summary.sede_label ?? '',
        fundae_label: summary.fundae_label ?? '',
      });
    } else {
      setForm(null);
    }
    setShowConfirm(false);
  }, [deal, summary]);

  useEffect(() => {
    setShowConfirm(false);
  }, [dealId]);

  const initialEditable = useMemo(() => {
    const source = deal ?? summary;
    if (!source) return null;
    return {
      sede_label: source.sede_label ?? '',
      fundae_label: source.fundae_label ?? '',
    };
  }, [deal, summary]);

  const detailProducts = detailView.products;
  const detailNotes = useMemo(
    () => detailView.notes.filter((note) => !shouldHideDealNote(note)),
    [detailView],
  );
  const documents = deal?.documents ?? EMPTY_DOCUMENTS;
  const driveFolderLink = useMemo(() => {
    for (const document of documents) {
      if (!document) continue;
      const link =
        typeof document.drive_web_view_link === 'string'
          ? document.drive_web_view_link.trim()
          : '';
      if (!link.length) continue;

      const mime = typeof document.mime_type === 'string' ? document.mime_type.toLowerCase() : '';
      if (mime === 'application/vnd.google-apps.folder' || link.includes('/folders/')) {
        return link;
      }
    }

    return null;
  }, [documents]);

  const defaultSessionAddress = deal?.training_address ?? summary?.training_address ?? null;

  const rawDealSedeLabel =
    form?.sede_label?.trim()?.length
      ? form.sede_label
      : detailView.sedeLabel ?? null;
  const dealSedeLabel = formatSedeLabel(rawDealSedeLabel);

  const trainingProducts = useMemo(
    () =>
      detailProducts.filter((product) => {
        const code = product?.code ?? '';
        return typeof code === 'string' ? !code.toLowerCase().startsWith('ext-') : true;
      }),
    [detailProducts]
  );

  const initialProductHours = useMemo(() => {
    const map: Record<string, string> = {};
    trainingProducts.forEach((product) => {
      const productId = product?.id != null ? String(product.id) : null;
      if (!productId) return;
      map[productId] = formatInitialHours(product?.hours ?? null);
    });
    return map;
  }, [trainingProducts]);

  useEffect(() => {
    setProductHours((current) => {
      if (areHourMapsEqual(current, initialProductHours)) return current;
      return { ...initialProductHours };
    });
  }, [initialProductHours]);

  const trainingProductIdList = useMemo(
    () => Object.keys(initialProductHours),
    [initialProductHours]
  );

  const trainingProductIds = useMemo(
    () => new Set(trainingProductIdList),
    [trainingProductIdList]
  );

  const trainingProductKey = useMemo(
    () => trainingProductIdList.slice().sort().join('|'),
    [trainingProductIdList]
  );

  const dealSessionsQuery = useQuery({
    queryKey: ['dealSessionsForStudents', normalizedDealId, trainingProductKey],
    enabled: Boolean(normalizedDealId && trainingProductIdList.length > 0),
    queryFn: async (): Promise<SessionDTO[]> => {
      if (!normalizedDealId || !trainingProductIdList.length) {
        return [];
      }

      const sessionsMap = new Map<string, SessionDTO>();
      const pageSize = 200;

      for (const productId of trainingProductIdList) {
        if (!productId?.trim().length) continue;

        let page = 1;

        while (true) {
          const groups = await fetchDealSessions(normalizedDealId, {
            productId,
            page,
            limit: pageSize,
          });

          if (!Array.isArray(groups) || !groups.length) {
            break;
          }

          for (const group of groups) {
            if (!group || !Array.isArray(group.sessions)) {
              continue;
            }
            for (const session of group.sessions) {
              if (!session || typeof session.id !== 'string') {
                continue;
              }
              const trimmedId = session.id.trim();
              if (!trimmedId.length) {
                continue;
              }
              sessionsMap.set(trimmedId, session);
            }
          }

          const pagination = groups[0]?.pagination ?? null;
          if (!pagination) {
            break;
          }

          const totalPages = Number(pagination.totalPages ?? 1);
          if (!Number.isFinite(totalPages) || totalPages <= page) {
            break;
          }

          page += 1;
        }
      }

      return Array.from(sessionsMap.values());
    },
    staleTime: 60 * 1000,
  });

  const dealSessions = dealSessionsQuery.data ?? [];
  const sessionsLoading = dealSessionsQuery.isLoading;
  const defaultSessionId = useMemo(() => pickDefaultSessionId(dealSessions), [dealSessions]);
  const sessionsById = useMemo(() => {
    const map = new Map<string, SessionDTO>();
    dealSessions.forEach((session) => {
      if (!session || typeof session.id !== 'string') return;
      const trimmedId = session.id.trim();
      if (!trimmedId.length) return;
      map.set(trimmedId, session);
    });
    return map;
  }, [dealSessions]);
  const selectedStudentsSession = useMemo(() => {
    if (!selectedStudentsSessionId) return null;
    const trimmedId = selectedStudentsSessionId.trim();
    if (!trimmedId.length) return null;
    return sessionsById.get(trimmedId) ?? null;
  }, [selectedStudentsSessionId, sessionsById]);
  const selectedStudentsSessionLabel = useMemo(() => {
    if (!selectedStudentsSession) return null;
    const name = (selectedStudentsSession.nombre_cache ?? '').trim();
    if (name.length) return name;
    const id = (selectedStudentsSession.id ?? '').trim();
    return id.length ? `Sesión ${id}` : 'Sesión sin nombre';
  }, [selectedStudentsSession]);
  const studentsSessionOptions = useMemo(
    () =>
      dealSessions
        .map((session) => {
          if (!session || typeof session.id !== 'string') return null;
          const trimmedId = session.id.trim();
          if (!trimmedId.length) return null;
          const name = (session.nombre_cache ?? '').trim();
          const label = name.length ? name : `Sesión ${trimmedId}`;
          return { id: trimmedId, label };
        })
        .filter((option): option is { id: string; label: string } => Boolean(option)),
    [dealSessions],
  );
  const automaticStudentsSessionId = useMemo(() => {
    const normalizedDefault = (defaultSessionId ?? '').trim();
    if (normalizedDefault.length) {
      return normalizedDefault;
    }

    for (const option of studentsSessionOptions) {
      const trimmedId = option.id.trim();
      if (trimmedId.length) {
        return trimmedId;
      }
    }

    return null;
  }, [defaultSessionId, studentsSessionOptions]);
  const effectiveStudentsSessionId = useMemo(() => {
    const trimmed = (selectedStudentsSessionId ?? '').trim();
    if (trimmed.length) {
      return trimmed;
    }
    return studentsSessionOptions[0]?.id ?? '';
  }, [selectedStudentsSessionId, studentsSessionOptions]);

  const dealStudentsQuery = useQuery({
    queryKey: ['dealStudents', normalizedDealId],
    enabled: Boolean(normalizedDealId),
    queryFn: () => fetchDealStudents(normalizedDealId),
    staleTime: 60 * 1000,
  });

  const students = dealStudentsQuery.data ?? [];
  const studentsLoading = dealStudentsQuery.isLoading;

  const noteStudentsInfo = useMemo(
    () => extractNoteStudents(deal?.notes ?? []),
    [deal?.notes],
  );
  const noteStudents = noteStudentsInfo.students;
  const noteSignature = noteStudentsInfo.signature;

  const importStudentsFromNoteMutation = useMutation({
    mutationFn: async (payload: {
      dealId: string;
      sessionId: string;
      toCreate: NoteStudentEntry[];
      toUpdate: { id: string; nombre: string; apellido: string }[];
      noteSignature: string;
    }): Promise<{ created: SessionStudent[]; updated: SessionStudent[] }> => {
      const created: SessionStudent[] = [];
      const updated: SessionStudent[] = [];

      for (const update of payload.toUpdate) {
        try {
          const result = await updateSessionStudent(update.id, {
            nombre: update.nombre,
            apellido: update.apellido,
          });
          updated.push(result);
        } catch (error) {
          if (isApiError(error)) {
            if (error.code === 'NOT_FOUND') {
              continue;
            }
          }
          throw error;
        }
      }

      for (const student of payload.toCreate) {
        try {
          const result = await createSessionStudent({
            dealId: payload.dealId,
            sessionId: payload.sessionId,
            nombre: student.nombre,
            apellido: student.apellido,
            dni: student.dni,
          });
          created.push(result);
        } catch (error) {
          if (isApiError(error) && error.code === 'DUPLICATE_DNI') {
            continue;
          }
          throw error;
        }
      }

      return { created, updated };
    },
    onSuccess: (result, variables) => {
      processedNoteSignatureRef.current = variables.noteSignature;
      if (normalizedDealId) {
        void qc.invalidateQueries({ queryKey: ['dealStudents', normalizedDealId] });
      }
      if (normalizedDealId && variables.sessionId) {
        void qc.invalidateQueries({
          queryKey: ['session-students', normalizedDealId, variables.sessionId],
        });
      }
      if (onNotify && (result.created.length > 0 || result.updated.length > 0)) {
        const parts: string[] = [];
        if (result.created.length > 0) {
          parts.push(
            `${result.created.length} ${
              result.created.length === 1 ? 'alumno creado' : 'alumnos creados'
            }`,
          );
        }
        if (result.updated.length > 0) {
          parts.push(
            `${result.updated.length} ${
              result.updated.length === 1 ? 'alumno actualizado' : 'alumnos actualizados'
            }`,
          );
        }
        onNotify({
          variant: 'success',
          message: `Alumnos sincronizados desde la nota (${parts.join(' y ')})`,
        });
      }
    },
    onError: (error) => {
      processedNoteSignatureRef.current = null;
      if (onNotify) {
        const baseMessage = isApiError(error)
          ? `No se pudieron sincronizar los alumnos de la nota. [${error.code}] ${error.message}`
          : error instanceof Error
          ? `No se pudieron sincronizar los alumnos de la nota. ${error.message}`
          : 'No se pudieron sincronizar los alumnos de la nota.';
        onNotify({ variant: 'danger', message: baseMessage });
      } else if (error instanceof Error) {
        console.error('[BudgetDetailModalAbierta] Error al sincronizar alumnos de nota', error);
      }
    },
  });

  const performNoteStudentsSync = useCallback(
    (
      sessionId: string,
      options?: { notifyOnNoChanges?: boolean; notifyOnMissingNote?: boolean },
    ): boolean => {
      if (!normalizedDealId) return false;
      const trimmedSessionId = sessionId.trim();
      if (!trimmedSessionId.length) return false;
      if (!noteSignature || !noteStudents.length) {
        if (options?.notifyOnMissingNote && onNotify) {
          onNotify({
            variant: 'info',
            message: 'No se encontraron alumnos en las notas para sincronizar.',
          });
        }
        return false;
      }
      if (importStudentsFromNoteMutation.isPending) {
        return false;
      }

      const normalizeName = (value: string) => normalizeNoteWhitespace(value).toUpperCase();
      const existingByDni = new Map<string, SessionStudent>();

      students.forEach((student) => {
        const dni = (student.dni ?? '').trim().toUpperCase();
        if (!dni.length || existingByDni.has(dni)) return;
        existingByDni.set(dni, student);
      });

      const toCreate: NoteStudentEntry[] = [];
      const toUpdate: { id: string; nombre: string; apellido: string }[] = [];

      noteStudents.forEach((student) => {
        const dni = student.dni.trim().toUpperCase();
        if (!dni.length) return;
        const existing = existingByDni.get(dni);
        if (!existing) {
          toCreate.push(student);
          return;
        }

        const existingNombre = normalizeName(existing.nombre ?? '');
        const existingApellido = normalizeName(existing.apellido ?? '');
        const incomingNombre = normalizeName(student.nombre);
        const incomingApellido = normalizeName(student.apellido);

        if (existingNombre !== incomingNombre || existingApellido !== incomingApellido) {
          toUpdate.push({ id: existing.id, nombre: student.nombre, apellido: student.apellido });
        }
      });

      if (!toCreate.length && !toUpdate.length) {
        processedNoteDealIdRef.current = normalizedDealId;
        processedNoteSignatureRef.current = noteSignature;
        if (options?.notifyOnNoChanges && onNotify) {
          onNotify({
            variant: 'info',
            message: 'Los alumnos de la nota ya están sincronizados.',
          });
        }
        return false;
      }

      processedNoteDealIdRef.current = normalizedDealId;
      processedNoteSignatureRef.current = noteSignature;

      importStudentsFromNoteMutation.mutate({
        dealId: normalizedDealId,
        sessionId: trimmedSessionId,
        toCreate,
        toUpdate,
        noteSignature,
      });

      return true;
    },
    [
      normalizedDealId,
      noteSignature,
      noteStudents,
      students,
      importStudentsFromNoteMutation,
      onNotify,
    ],
  );

  useEffect(() => {
    const trimmedDealId = normalizedDealId.trim();
    if (!trimmedDealId.length) {
      return;
    }
    if (processedNoteDealIdRef.current === trimmedDealId) {
      return;
    }
    processedNoteDealIdRef.current = trimmedDealId;
    processedNoteSignatureRef.current = null;
    noteWarningSignatureRef.current = null;
  }, [normalizedDealId]);

  useEffect(() => {
    if (!normalizedDealId) return;
    if (!noteSignature || !noteStudents.length) return;
    if (!automaticStudentsSessionId) return;
    if (studentsLoading || sessionsLoading) return;
    const trimmedDealId = normalizedDealId.trim();
    if (
      processedNoteDealIdRef.current === trimmedDealId &&
      processedNoteSignatureRef.current === noteSignature
    ) {
      return;
    }

    performNoteStudentsSync(automaticStudentsSessionId);
  }, [
    normalizedDealId,
    noteSignature,
    noteStudents,
    automaticStudentsSessionId,
    studentsLoading,
    sessionsLoading,
    performNoteStudentsSync,
  ]);

  useEffect(() => {
    setSelectedStudentsSessionId((current) => {
      const available = dealSessions
        .map((session) => (session?.id ?? '').trim())
        .filter((value) => value.length);
      if (!available.length) {
        return null;
      }
      if (current) {
        const normalizedCurrent = current.trim();
        if (normalizedCurrent.length && available.includes(normalizedCurrent)) {
          return normalizedCurrent;
        }
      }
      if (defaultSessionId) {
        const normalizedDefault = defaultSessionId.trim();
        if (normalizedDefault.length && available.includes(normalizedDefault)) {
          return normalizedDefault;
        }
      }
      return available[0];
    });
  }, [dealSessions, defaultSessionId]);

  const studentsAccordionBodyPrefix = noteStudents.length
    ? null
    : (
        <Alert variant="secondary" className="mb-0">
          No se encontraron alumnos en las notas.
        </Alert>
      );

  useEffect(() => {
    if (!noteSignature || !noteStudents.length) {
      return;
    }
    if (sessionsLoading) {
      return;
    }
    if (automaticStudentsSessionId) {
      return;
    }
    if (noteWarningSignatureRef.current === noteSignature) {
      return;
    }
    noteWarningSignatureRef.current = noteSignature;

    const message =
      'Se ha detectado un alumno en notas, en unos segundos se añadirá al deal';

    if (onNotify) {
      onNotify({ variant: 'info', message });
    } else {
      console.info('[BudgetDetailModalAbierta] ' + message);
    }
  }, [noteSignature, noteStudents, sessionsLoading, automaticStudentsSessionId, onNotify]);

  const dirtyProducts = useMemo(
    () => !areHourMapsEqual(productHours, initialProductHours),
    [productHours, initialProductHours]
  );

  const dirtyDeal = !!initialEditable && !!form && JSON.stringify(initialEditable) !== JSON.stringify(form);
  const isDirty = dirtyDeal || dirtyProducts;
  const isRefetching = detailQuery.isRefetching || refreshMutation.isPending;
  const isModalVisible = normalizedDealId.length > 0;

  const presupuestoDisplay = detailView.dealId;
  const presupuestoHeaderLabel = presupuestoDisplay?.trim().length
    ? `Presupuesto ${presupuestoDisplay}`
    : 'Presupuesto';
  const titleDisplay = detailView.title ?? '';
  const organizationDisplay = detailView.organizationName ?? '';
  const clientDisplay = detailView.clientName ?? '';
  const clientPhoneDisplay = detailView.clientPhone ?? '';
  const clientEmailDisplay = detailView.clientEmail ?? '';

  const modalTitle = organizationDisplay || 'Detalle presupuesto';
  const truncatedModalTitle = truncateText(modalTitle, 60);
  const modalTitleTooltip = truncatedModalTitle !== modalTitle ? modalTitle : undefined;

  const displayOrDash = (value?: string | number | null) => {
    if (value === null || value === undefined) return '—';
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : '—';
  };

  const handleHoursChange = (productId: string, value: string) => {
    if (!trainingProductIds.has(productId)) return;
    if (value === '' || /^\d+$/.test(value)) {
      setProductHours((current) => ({ ...current, [productId]: value }));
    }
  };

  const handleOpenProductComment = (product: DealDetailViewModel['products'][number]) => {
    const rawComment = (product?.comments ?? '').trim();
    if (!rawComment.length) return;
    const productName = displayOrDash(product?.name ?? product?.code ?? '');
    if (onShowProductComment) {
      onShowProductComment({ productName, comment: rawComment });
      return;
    }
    setViewingComment({ productName, comment: rawComment });
  };

  const handleCloseCommentModal = () => {
    if (onShowProductComment) return;
    setViewingComment(null);
  };

  const handleCreateNote = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmed = newNoteContent.trim();
    if (!trimmed.length || creatingNote) return;

    setCreatingNote(true);
    setNoteError(null);
    try {
      const created = await createDealNote(normalizedDealId, trimmed, { id: userId, name: userName });
      qc.setQueryData(detailQueryKey, (current: DealDetail | undefined) => {
        if (!current) return current;
        const nextNotes = [created, ...(current.notes ?? [])];
        return { ...current, notes: nextNotes };
      });
      setNewNoteContent('');
    } catch (error: unknown) {
      if (isApiError(error)) {
        setNoteError(error.message);
      } else {
        setNoteError('No se pudo crear la nota. Inténtalo de nuevo.');
      }
    } finally {
      setCreatingNote(false);
    }
  };

  const triggerRefresh = useCallback(
    (manual: boolean) => {
      if (!normalizedDealId || refreshMutation.isPending) return;
      lastManualRefreshRef.current = manual;
      refreshMutation.mutate(normalizedDealId);
    },
    [normalizedDealId, refreshMutation],
  );

  const handleRefresh = useCallback(() => {
    triggerRefresh(true);
  }, [triggerRefresh]);

  useEffect(() => {
    if (!dealId || !autoRefreshOnOpen) {
      autoRefreshTriggeredRef.current = false;
      lastAutoRefreshDealIdRef.current = null;
      return;
    }

    if (lastAutoRefreshDealIdRef.current !== dealId) {
      autoRefreshTriggeredRef.current = false;
      lastAutoRefreshDealIdRef.current = dealId;
    }

    if (autoRefreshTriggeredRef.current) {
      return;
    }

    if (isLoading || refreshMutation.isPending) {
      return;
    }

    autoRefreshTriggeredRef.current = true;
    triggerRefresh(false);
  }, [
    dealId,
    autoRefreshOnOpen,
    isLoading,
    refreshMutation.isPending,
    triggerRefresh,
  ]);

  const startEditingNote = (note: DealDetailViewModel['notes'][number]) => {
    if (!note?.id) return;
    setEditingNoteId(note.id);
    setEditingNoteContent(note.content ?? '');
    setNoteError(null);
  };

  const cancelEditingNote = () => {
    setEditingNoteId(null);
    setEditingNoteContent('');
    setUpdatingNote(false);
  };

  const handleUpdateNote = async (note: DealDetailViewModel['notes'][number]) => {
    if (!note?.id) return;
    const trimmed = editingNoteContent.trim();
    if (!trimmed.length || updatingNote) return;

    setUpdatingNote(true);
    setNoteError(null);
    try {
      const updated = await updateDealNote(normalizedDealId, note.id, trimmed, {
        id: userId,
        name: userName,
      });
      qc.setQueryData(detailQueryKey, (current: DealDetail | undefined) => {
        if (!current) return current;
        const nextNotes = (current.notes ?? []).map((n) => (n.id === updated.id ? updated : n));
        return { ...current, notes: nextNotes };
      });
      setViewingNote((current) =>
        current?.id === updated.id
          ? {
              ...current,
              content: updated.content ?? '',
              author: updated.author ?? null,
            }
          : current
      );
      cancelEditingNote();
    } catch (error: unknown) {
      if (isApiError(error)) {
        setNoteError(error.message);
      } else {
        setNoteError('No se pudo actualizar la nota. Inténtalo de nuevo.');
      }
    } finally {
      setUpdatingNote(false);
    }
  };

  const handleDeleteNote = async (note: DealNoteView) => {
    if (!note?.id || deletingNoteId === note.id) return;

    setDeletingNoteId(note.id);
    setNoteError(null);
    try {
      await deleteDealNote(normalizedDealId, note.id, { id: userId, name: userName });
      qc.setQueryData(detailQueryKey, (current: DealDetail | undefined) => {
        if (!current) return current;
        const nextNotes = (current.notes ?? []).filter((n) => n.id !== note.id);
        return { ...current, notes: nextNotes };
      });
      if (editingNoteId === note.id) {
        cancelEditingNote();
      }
      setViewingNote((current) => (current?.id === note.id ? null : current));
    } catch (error: unknown) {
      if (isApiError(error)) {
        setNoteError(error.message);
      } else {
        setNoteError('No se pudo eliminar la nota. Inténtalo de nuevo.');
      }
    } finally {
      setDeletingNoteId(null);
    }
  };

  const handleOpenNoteModal = (note: DealNoteView) => {
    setViewingNote(note);
  };

  const handleCloseNoteModal = () => {
    setViewingNote(null);
  };

  const normalizeAffirmative = (value?: string | number | null) => {
    if (value === null || value === undefined) return '';
    const raw = String(value).trim().toLowerCase();
    return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };

  const isAffirmative = (value?: string | number | null) => normalizeAffirmative(value) === 'si';

  const affirmativeBorder = (value?: string | number | null) =>
    isAffirmative(value) ? { borderColor: '#e4032d' } : undefined;

  const handleAccordionSelect = (eventKey: string | string[] | null | undefined) => {
    if (eventKey === null || eventKey === undefined) {
      setOpenSections([]);
      return;
    }

    if (Array.isArray(eventKey)) {
      setOpenSections(eventKey);
      return;
    }

    setOpenSections((current) =>
      current.includes(eventKey)
        ? current.filter((key) => key !== eventKey)
        : [...current, eventKey]
    );
  };

  const detailErrorMessage = detailQuery.isError
    ? detailQuery.error instanceof Error
      ? detailQuery.error.message
      : 'No se pudo cargar el detalle del presupuesto.'
    : null;

  async function handleSave() {
    if (!deal || !deal.deal_id) return;
    const patch: Partial<DealEditablePatch> = {};

    const normalizeString = (value: string | undefined | null) => (value ?? '').trim();
    const toNullableString = (value: string | undefined | null) => {
      const trimmed = normalizeString(value);
      return trimmed.length ? trimmed : null;
    };

    if (normalizeString(form?.sede_label) !== normalizeString(initialEditable?.sede_label)) {
      patch.sede_label = toNullableString(form?.sede_label);
    }
    if (normalizeString(form?.fundae_label) !== normalizeString(initialEditable?.fundae_label)) {
      patch.fundae_label = toNullableString(form?.fundae_label);
    }

    const productPatches: DealProductEditablePatch[] = [];

    for (const [productId, currentValueRaw] of Object.entries(productHours)) {
      if (!trainingProductIds.has(productId)) continue;
      const currentValue = currentValueRaw.trim();
      const initialValue = (initialProductHours[productId] ?? '').trim();

      if (currentValue === initialValue) continue;

      if (!currentValue.length) {
        productPatches.push({ id: productId, hours: null });
        continue;
      }

      if (!/^\d+$/.test(currentValue)) {
        alert('Las horas deben ser un número entero mayor o igual que cero.');
        return;
      }

      const parsed = parseInt(currentValue, 10);
      if (!Number.isFinite(parsed)) {
        alert('Las horas deben ser un número entero válido.');
        return;
      }

      productPatches.push({ id: productId, hours: parsed });
    }

    const hasDealPatch = Object.keys(patch).length > 0;
    const hasProductPatch = productPatches.length > 0;

    if (!hasDealPatch && !hasProductPatch) return;

    setSaving(true);
    try {
      await patchDealEditable(
        deal.deal_id,
        patch,
        { id: userId, name: userName },
        { products: productPatches }
      );
      await qc.invalidateQueries({ queryKey: detailQueryKey });
      await qc.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['calendarSessions'] });
      setShowConfirm(false);
    } catch (e: any) {
      alert(e?.message || 'No se pudieron guardar los cambios');
    } finally {
      setSaving(false);
    }
  }

  async function handleView(doc: DealDocument) {
    if (!deal?.deal_id) return;
    const directUrl = doc.url ? resolveDocumentPreviewUrl(doc.url) : null;

    setPreviewLoading(!directUrl);
    setPreviewError(null);
    setPreviewUrl(directUrl);
    setPreviewMeta({ name: getDocumentDisplayName(doc), mime_type: doc.mime_type ?? null });
    setPreviewDocument(doc);

    if (directUrl) return;

    try {
      const response = await getDocPreviewUrl(deal.deal_id, doc.id);
      if (!response?.url) {
        throw new Error('URL de previsualización no disponible');
      }
      setPreviewUrl(response.url);
      setPreviewMeta((current) => ({
        name: response.name ?? current?.name ?? getDocumentDisplayName(doc),
        mime_type: response.mime_type ?? current?.mime_type ?? doc.mime_type ?? null,
      }));
    } catch (e: any) {
      setPreviewError(e?.message || 'No se pudo abrir el documento');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDelete(docId: string) {
    const ok = confirm('¿Eliminar documento?');
    if (!ok) return;
    if (!deal?.deal_id) return;
    try {
      await deleteDocument(deal.deal_id, docId);
      if (previewDocument && previewDocument.id === docId) {
        closePreview();
      }
      await qc.invalidateQueries({ queryKey: detailQueryKey });
    } catch (e: any) {
      alert(e?.message || 'No se pudo eliminar el documento');
    }
  }

  function requestClose() {
    if (isDirty) {
      setShowConfirm(true);
    } else {
      setShowConfirm(false);
      onClose();
    }
  }

  const handleDiscardChanges = () => {
    setShowConfirm(false);
    onClose();
  };

  function closePreview() {
    setPreviewDocument(null);
    setPreviewUrl(null);
    setPreviewMeta(null);
    setPreviewLoading(false);
    setPreviewError(null);
  }

  if (!isModalVisible) {
    return null;
  }

  return (
    <>
      <Modal
        show={isModalVisible}
        onHide={requestClose}
        size="lg"
        backdrop="static"
        centered
        contentClassName="erp-modal-content"
      >
      <Modal.Header className="erp-modal-header border-0 pb-0">
        <Modal.Title as="div" className="erp-modal-header-main">
          <div className="erp-modal-title text-truncate" title={modalTitleTooltip}>
            {truncatedModalTitle}
          </div>
          <div className="erp-modal-subtitle d-flex align-items-center gap-2 flex-wrap">
            <span className="text-truncate">{presupuestoHeaderLabel}</span>
            <Badge bg="info" text="dark" className="fw-semibold text-nowrap">
              {PIPELINE_LABEL}
            </Badge>
          </div>
        </Modal.Title>
        <div className="erp-modal-header-actions">
          <Button
            variant="light"
            size="sm"
            className="erp-modal-action"
            onClick={handleRefresh}
            disabled={isLoading || isRefetching}
          >
            {isRefetching ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                />
                Actualizando...
              </>
            ) : (
              'Actualizar'
            )}
          </Button>
          <Button
            variant="outline-light"
            size="sm"
            className="erp-modal-action"
            onClick={requestClose}
          >
            Cerrar
          </Button>
        </div>
      </Modal.Header>
      <Modal.Body className="erp-modal-body">
        {!isLoading && (titleDisplay || clientDisplay || clientPhoneDisplay || clientEmailDisplay || deal) && (
          <div className="mb-4">
            <Row className="erp-summary-row g-3">
              <Col md={3}>
                <Form.Label>Título</Form.Label>
                <Form.Control
                  value={displayOrDash(titleDisplay)}
                  readOnly
                  title={buildFieldTooltip(titleDisplay)}
                />
              </Col>
              <Col md={3}>
                <Form.Label>Cliente</Form.Label>
                <Form.Control
                  value={displayOrDash(clientDisplay)}
                  readOnly
                  title={buildFieldTooltip(clientDisplay)}
                />
              </Col>
              <Col md={3}>
                <Form.Label>Teléfono</Form.Label>
                <Form.Control
                  value={displayOrDash(clientPhoneDisplay)}
                  readOnly
                  title={buildFieldTooltip(clientPhoneDisplay)}
                />
              </Col>
              <Col md={3}>
                <Form.Label>Mail</Form.Label>
                <Form.Control
                  value={displayOrDash(clientEmailDisplay)}
                  readOnly
                  title={buildFieldTooltip(clientEmailDisplay)}
                />
              </Col>
            </Row>
          </div>
        )}
        {detailErrorMessage && !summary && (
          <Alert variant="danger" className="mb-3">
            {detailErrorMessage}
          </Alert>
        )}
        {isLoading && (
          <div className="d-flex align-items-center gap-2">
            <Spinner size="sm" /> Cargando…
          </div>
        )}
        {!isLoading && deal && form && (
          <>
            {/* Editables */}
            <Row className="g-3 align-items-end">
              <Col md={3}>
                <Form.Label>Sede</Form.Label>
                <Form.Control
                  value={formatSedeLabel(form.sede_label) ?? ''}
                  onChange={(e) => updateForm('sede_label', e.target.value)}
                  title={buildFieldTooltip(form.sede_label)}
                />
              </Col>
              <Col md={3} className="budget-field-narrow">
                <div className="d-flex justify-content-between align-items-center gap-2">
                  <Form.Label className="mb-0">FUNDAE</Form.Label>
                  {renderFollowUpBlock('fundae_val')}
                </div>
                <Form.Control
                  value={form.fundae_label}
                  onChange={(e) => updateForm('fundae_label', e.target.value)}
                  style={affirmativeBorder(form.fundae_label)}
                  title={buildFieldTooltip(form.fundae_label)}
                />
              </Col>
              <Col md={3} className="budget-field-wide">
                <div className="d-flex justify-content-between align-items-center gap-2">
                  <Form.Label className="mb-0">PO</Form.Label>
                  {renderFollowUpBlock('po_val')}
                </div>
                <Form.Control
                  value={displayOrDash(deal.po ?? null)}
                  readOnly
                  title={buildFieldTooltip(deal.po ?? null)}
                />
              </Col>
              <Col md={3} className="budget-field-wide">
                <Form.Label className="mb-0">Mail Factura</Form.Label>
                <Form.Control
                  value={displayOrDash(deal.mail_invoice ?? null)}
                  readOnly
                  title={buildFieldTooltip(deal.mail_invoice ?? null)}
                />
              </Col>
            </Row>

            <hr className="my-4" />
            {trainingProducts.length ? (
              <Table size="sm" bordered responsive className="mb-4">
                <thead>
                  <tr>
                    <th>Formación</th>
                    <th style={{ width: 60 }}>Horas</th>
                    <th style={{ width: 189 }}>Comentarios</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingProducts.map((product, index) => {
                    const productId = product?.id != null ? String(product.id) : null;
                    const productLabel = displayOrDash(product?.name ?? product?.code ?? '');
                    const isEditable = !!productId && trainingProductIds.has(productId);
                    const hoursValue = isEditable
                      ? productHours[productId] ?? ''
                      : formatInitialHours(product?.hours ?? null);
                    const commentText = (product?.comments ?? '').trim();
                    const commentPreview = buildCommentPreview(commentText);
                    return (
                      <tr key={product?.id ?? `${product?.name ?? 'producto'}-${index}`}>
                        <td>{productLabel}</td>
                        <td style={{ width: 60 }}>
                          {isEditable ? (
                            <Form.Control
                              type="text"
                              size="sm"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={hoursValue}
                              placeholder="0"
                              onChange={(event) => handleHoursChange(productId!, event.target.value)}
                              className="text-center"
                              aria-label={`Horas de ${productLabel}`}
                              title={buildFieldTooltip(hoursValue)}
                            />
                          ) : (
                            <span className="text-muted">{displayOrDash(product?.hours ?? null)}</span>
                          )}
                        </td>
                        <td style={{ width: 189 }}>
                          {commentPreview ? (
                            <Button
                              type="button"
                              variant="link"
                              className="p-0 text-start text-decoration-none"
                              onClick={() => handleOpenProductComment(product)}
                              aria-label={`Ver comentario de ${productLabel}`}
                            >
                              <span
                                className="d-inline-block text-truncate"
                                style={{ maxWidth: 189 }}
                                title={commentText}
                              >
                                {commentPreview}
                              </span>
                            </Button>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <p className="text-muted small mb-4">No hay formaciones asociadas.</p>
            )}
            <Accordion
              activeKey={openSections}
              onSelect={handleAccordionSelect}
              alwaysOpen
              className="mb-4"
            >
              <SessionsAccordionAbierta
                dealId={normalizedDealId}
                dealAddress={defaultSessionAddress ?? null}
                dealSedeLabel={dealSedeLabel ?? null}
                dealTrainingDate={detailView.aFecha ?? null}
                dealVariation={detailView.wIdVariation ?? null}
                products={detailProducts}
                onNotify={onNotify}
                allowPublicLinkGeneration={false}
              />
              {effectiveStudentsSessionId ? (
                <SessionStudentsAccordionItem
                  dealId={normalizedDealId}
                  sessionId={effectiveStudentsSessionId}
                  onNotify={onNotify}
                  eventKey="students"
                  bodyPrefix={studentsAccordionBodyPrefix}
                  enablePublicLink={false}
                />
              ) : (
                <Accordion.Item eventKey="students">
                  <Accordion.Header>
                    <div className="d-flex justify-content-between align-items-center w-100">
                      <span className="erp-accordion-title">Alumnos</span>
                    </div>
                  </Accordion.Header>
                  <Accordion.Body>
                    {sessionsLoading ? (
                      <div className="d-flex align-items-center gap-2 text-muted small">
                        <Spinner animation="border" size="sm" role="status" /> Cargando sesiones…
                      </div>
                    ) : (
                      <p className="text-muted small mb-0">
                        No hay sesiones disponibles para gestionar alumnos.
                      </p>
                    )}
                  </Accordion.Body>
                </Accordion.Item>
              )}
              <Accordion.Item eventKey="notes">
                <Accordion.Header>
                  <div className="d-flex justify-content-between align-items-center w-100">
                    <span className="erp-accordion-title">
                      Notas
                      {detailNotes.length > 0 ? (
                        <span className="erp-accordion-count">{detailNotes.length}</span>
                      ) : null}
                    </span>
                  </div>
                </Accordion.Header>
                <Accordion.Body>
                  {noteError ? (
                    <Alert variant="danger" className="mb-3">
                      {noteError}
                    </Alert>
                  ) : null}
                  {detailNotes.length ? (
                    <ListGroup className="mb-3">
                      {detailNotes.map((note, index) => {
                        const key = note.id ?? `note-${index}`;
                        const canEdit =
                          !!note.author &&
                          !!userName &&
                          note.author.trim().toLowerCase() === userName.trim().toLowerCase();
                        const isEditing = editingNoteId === note.id;
                        const isDeleting = deletingNoteId === note.id;
                        const canOpenNote = !isEditing && !isDeleting;
                        return (
                          <ListGroup.Item
                            key={key}
                            action={canOpenNote}
                            disabled={isDeleting}
                            onClick={canOpenNote ? () => handleOpenNoteModal(note) : undefined}
                          >
                            {isEditing ? (
                              <>
                                <Form.Control
                                  as="textarea"
                                  rows={3}
                                  value={editingNoteContent}
                                  onChange={(event) => setEditingNoteContent(event.target.value)}
                                  disabled={updatingNote}
                                  title={buildFieldTooltip(editingNoteContent)}
                                />
                                <div className="d-flex justify-content-end gap-2 mt-2">
                                  <Button
                                    size="sm"
                                    variant="outline-secondary"
                                    onClick={cancelEditingNote}
                                    disabled={updatingNote}
                                  >
                                    Cancelar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    disabled={updatingNote || !editingNoteContent.trim().length}
                                    onClick={() => handleUpdateNote(note)}
                                  >
                                    {updatingNote ? (
                                      <Spinner animation="border" size="sm" role="status" />
                                    ) : (
                                      'Guardar'
                                    )}
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="mb-2 text-break" style={{ whiteSpace: 'pre-line' }}>
                                  {displayOrDash(note.content)}
                                </p>
                                <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                                  <small className="text-muted mb-0">
                                    Autor: {displayOrDash(note.author ?? null)}
                                  </small>
                                  {canEdit ? (
                                    <div className="d-flex align-items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline-primary"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          startEditingNote(note);
                                        }}
                                      >
                                        Editar
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline-danger"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleDeleteNote(note);
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
                  <Form onSubmit={handleCreateNote} className="mb-3">
                    <Form.Group controlId="deal-note-content">
                      <Form.Label className="fw-semibold">Añadir nota</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={newNoteContent}
                        onChange={(event) => setNewNoteContent(event.target.value)}
                        disabled={creatingNote}
                        placeholder="Escribe una nota"
                        title={buildFieldTooltip(newNoteContent)}
                      />
                    </Form.Group>
                    <div className="d-flex justify-content-end align-items-center gap-2 mt-2">
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={creatingNote || !newNoteContent.trim().length}
                      >
                        {creatingNote ? <Spinner size="sm" animation="border" role="status" /> : 'Guardar nota'}
                      </Button>
                    </div>
                  </Form>
                  {detailNotes.length ? null : (
                    <>
                      <hr className="text-muted" />
                      <p className="text-muted small mb-0">Sin Notas</p>
                    </>
                  )}
                </Accordion.Body>
              </Accordion.Item>

              <Accordion.Item eventKey="documents">
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
                  <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                    <Button
                      type="button"
                      variant="outline-primary"
                      onClick={openUploadDialog}
                      disabled={!canUploadDocument}
                    >
                      Subir Documento
                    </Button>
                    <Button
                      variant="outline-secondary"
                      href={driveFolderLink ?? undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                      disabled={!driveFolderLink}
                    >
                      Ir a G.Drive
                    </Button>
                  </div>
                  {documents.length ? (
                    <ListGroup>
                      {documents.map((d) => {
                        const displayName = getDocumentDisplayName(d);
                        const documentHref = getDocumentHref(d);
                        const sizeLabel =
                          typeof d.size === 'number' && Number.isFinite(d.size) && d.size > 0
                            ? `${Math.round((d.size / 1024) * 10) / 10} KB`
                            : null;
                        const sourceLabel =
                          d.source === 'PIPEDRIVE'
                            ? 'Pipedrive'
                            : d.source === 'MANUAL'
                            ? 'Manual'
                            : 'Interno';
                        return (
                          <ListGroup.Item
                            key={d.id}
                            className="d-flex justify-content-between align-items-start flex-column flex-md-row gap-2"
                          >
                            <div className="d-flex flex-column">
                              {documentHref ? (
                                <a
                                  className="btn btn-link p-0 text-start align-baseline fw-semibold"
                                  href={documentHref}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  title={displayName}
                                >
                                  {displayName}
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-link p-0 text-start align-baseline fw-semibold"
                                  onClick={() => handleView(d)}
                                  title={displayName}
                                >
                                  {displayName}
                                </button>
                              )}
                              <div className="text-muted small d-flex align-items-center gap-2 flex-wrap">
                                {sizeLabel ? <span>{sizeLabel}</span> : null}
                                <span>({sourceLabel})</span>
                              </div>
                            </div>
                            {d.source !== 'PIPEDRIVE' ? (
                              <div className="d-flex gap-2">
                                <Button size="sm" variant="outline-danger" onClick={() => handleDelete(d.id)}>
                                  Eliminar
                                </Button>
                              </div>
                            ) : null}
                          </ListGroup.Item>
                        );
                      })}
                    </ListGroup>
                  ) : (
                    <p className="text-muted small mb-0">Sin documentos</p>
                  )}
                </Accordion.Body>
              </Accordion.Item>

            </Accordion>

          </>
        )}
      </Modal.Body>
      <Modal.Footer className="erp-modal-footer border-0 pt-0">
        <Button variant="outline-secondary" onClick={requestClose} disabled={saving}>
          Cerrar
        </Button>
        {isDirty && deal && (
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar Cambios'}
          </Button>
        )}
      </Modal.Footer>
    </Modal>

    <Modal
      show={showUploadDialog}
      onHide={closeUploadDialog}
      centered
      backdrop={uploadingDocument ? 'static' : true}
      keyboard={!uploadingDocument}
    >
      <Modal.Header closeButton={!uploadingDocument}>
        <Modal.Title>Subir documento</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <input
          ref={uploadInputRef}
          type="file"
          className="d-none"
          onChange={handleUploadInputChange}
        />
        <div
          className={`border border-2 rounded-3 p-4 text-center ${
            isDragActive ? 'border-primary bg-light' : 'border-secondary-subtle'
          }`}
          style={{ borderStyle: 'dashed' }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDropFile}
        >
          <p className="fw-semibold mb-2">Arrastra un archivo aquí</p>
          <p className="text-muted small mb-3">o</p>
          <Button
            type="button"
            variant="outline-primary"
            onClick={handleBrowseClick}
            disabled={uploadingDocument}
          >
            Buscar archivo
          </Button>
          <div className="mt-3">
            {pendingUploadFile ? (
              <div className="small">
                <div className="fw-semibold text-break">{pendingUploadFile.name}</div>
                <div className="text-muted">
                  {pendingUploadFile.size >= 1024 * 1024
                    ? `${Math.round((pendingUploadFile.size / (1024 * 1024)) * 100) / 100} MB`
                    : `${Math.round((pendingUploadFile.size / 1024) * 10) / 10} KB`}
                </div>
              </div>
            ) : (
              <div className="text-muted small">Ningún archivo seleccionado</div>
            )}
          </div>
        </div>
        <Form.Check
          className="mt-3"
          id="upload-po-document"
          type="checkbox"
          label="¿Es un documento de PO?"
          checked={isPoDocument}
          onChange={(event) => setIsPoDocument(event.target.checked)}
          disabled={uploadingDocument}
        />
      </Modal.Body>
      <Modal.Footer>
        <Button
          type="button"
          variant="outline-secondary"
          onClick={closeUploadDialog}
          disabled={uploadingDocument}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleUploadDocument}
          disabled={!pendingUploadFile || uploadingDocument}
        >
          {uploadingDocument ? (
            <>
              <Spinner as="span" animation="border" size="sm" role="status" className="me-2" />
              Subiendo...
            </>
          ) : (
            'Subir documento'
          )}
        </Button>
      </Modal.Footer>
    </Modal>

    <Modal show={!!previewDocument} onHide={closePreview} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title as="div">
          <div className="fw-semibold">{getDocumentDisplayName(previewDocument)}</div>
          <div className="text-muted small">
            {previewDocument?.source === 'PIPEDRIVE'
              ? 'Documento de Pipedrive'
              : previewDocument?.source === 'MANUAL'
              ? 'Documento subido manualmente'
              : 'Documento interno'}
          </div>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {previewLoading ? (
          <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '50vh' }}>
            <Spinner animation="border" role="status" />
          </div>
        ) : previewError ? (
          <Alert variant="danger" className="mb-0">
            <p className="mb-2">{previewError}</p>
            {previewUrl ? (
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => window.open(previewUrl, '_blank', 'noopener')}
              >
                Abrir en una nueva pestaña
              </Button>
            ) : null}
          </Alert>
        ) : previewUrl ? (
          <div className="border rounded overflow-hidden" style={{ minHeight: '60vh' }}>
            <iframe
              src={previewUrl}
              title={getDocumentDisplayName(previewDocument)}
              style={{ border: 0, width: '100%', height: '100%' }}
            />
          </div>
        ) : (
          <p className="text-muted mb-0">Previsualización no disponible para este documento.</p>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <Button variant="outline-secondary" onClick={closePreview}>
          Cerrar
        </Button>
        <div className="d-flex gap-2">
          {previewUrl ? (
            <Button variant="outline-primary" onClick={() => window.open(previewUrl, '_blank', 'noopener')}>
              Abrir en nueva pestaña
            </Button>
          ) : null}
        </div>
      </Modal.Footer>
    </Modal>

    <Modal show={!!viewingNote} onHide={handleCloseNoteModal} centered>
      <Modal.Header closeButton>
        <Modal.Title>Detalle de la nota</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-2">
          <strong>Autor:</strong> {displayOrDash(viewingNote?.author ?? null)}
        </div>
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {displayOrDash(viewingNote?.content ?? null)}
        </div>
      </Modal.Body>
    </Modal>

    {!onShowProductComment ? (
      <Modal show={!!viewingComment} onHide={handleCloseCommentModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Comentario de la formación</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {viewingComment?.productName ? (
            <div className="mb-2">
              <strong>Formación:</strong> {viewingComment.productName}
            </div>
          ) : null}
          <div style={{ whiteSpace: 'pre-wrap' }}>{viewingComment?.comment ?? ''}</div>
        </Modal.Body>
      </Modal>
    ) : null}

    {/* Confirmación cambios pendientes */}
    <Modal show={showConfirm} onHide={() => setShowConfirm(false)} centered>
      <Modal.Header closeButton>
        <Modal.Title>Cambios sin guardar</Modal.Title>
      </Modal.Header>
      <Modal.Body>Tienes cambios pendientes de guardar</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowConfirm(false)}>
          Seguir con los cambios
        </Button>
        <Button variant="danger" onClick={handleDiscardChanges}>
          Salir sin guardar
        </Button>
      </Modal.Footer>
    </Modal>

  </>
  );
}
