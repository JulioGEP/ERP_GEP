import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  isApiError,
  MANUAL_DOCUMENT_SIZE_LIMIT_BYTES,
  MANUAL_DOCUMENT_SIZE_LIMIT_MESSAGE
} from '../api';
import {
  DEAL_NOT_WON_ERROR_CODE,
  DEAL_NOT_WON_ERROR_MESSAGE,
  normalizeImportDealResult,
} from '../importDealUtils';
import { SessionsAccordionServices } from './sessions/SessionsAccordionServices';
import type { DealEditablePatch } from '../api';
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
const FALLBACK_PIPELINE_LABEL = 'Preventivos';

function normalizeComparableValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isPciCategoryProduct(product: DealDetailViewModel['products'][number]): boolean {
  return normalizeComparableValue(product?.categoryLabel) === 'pci';
}

function isLegacyExtraProduct(product: DealDetailViewModel['products'][number]): boolean {
  const normalizedCode = normalizeComparableValue(product?.code ?? null);
  return normalizedCode.startsWith('ext-') || normalizedCode.startsWith('ces-');
}

interface Props {
  dealId: string | null;
  summary?: DealSummary | null;
  onClose: () => void;
  onShowProductComment?: (payload: { productName: string; comment: string }) => void;
  onNotify?: (toast: { variant: 'success' | 'danger' | 'info'; message: string }) => void;
  autoRefreshOnOpen?: boolean;
  highlightSessionId?: string | null;
}

type BudgetFormValuesServices = {
  training_address: string; // <- schema vigente
  caes_label: string;
  hotel_label: string;
};

type DealNoteView = DealDetailViewModel['notes'][number];

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

export function BudgetDetailModalServices({
  dealId,
  summary,
  onClose,
  onShowProductComment,
  onNotify,
  autoRefreshOnOpen: _autoRefreshOnOpen,
  highlightSessionId,
}: Props) {
  void _autoRefreshOnOpen;
  const qc = useQueryClient();
  const { userId, userName } = useCurrentUserIdentity();

  const pipelineLabel = useMemo(() => {
    const rawLabel = summary?.pipeline_label ?? summary?.pipeline_id ?? null;
    const normalized = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    return normalized.length ? normalized : FALLBACK_PIPELINE_LABEL;
  }, [summary?.pipeline_id, summary?.pipeline_label]);

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

  const [form, setForm] = useState<BudgetFormValuesServices | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [mapAddress, setMapAddress] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [creatingNote, setCreatingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [updatingNote, setUpdatingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [viewingNote, setViewingNote] = useState<DealNoteView | null>(null);
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
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

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
        return form?.caes_label ?? deal?.caes_label ?? summary?.caes_label ?? null;
      case 'fundae_label':
        return deal?.fundae_label ?? summary?.fundae_label ?? null;
      case 'hotel_label':
        return form?.hotel_label ?? deal?.hotel_label ?? summary?.hotel_label ?? null;
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
    if (!isAffirmativeLabel(sourceValue)) return null;

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
    setShowUploadDialog(true);
  };

  const closeUploadDialog = () => {
    if (uploadingDocument) return;
    setShowUploadDialog(false);
    setPendingUploadFile(null);
    setIsDragActive(false);
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
      await uploadManualDocument(deal.deal_id, pendingUploadFile, { id: userId, name: userName });
      await qc.invalidateQueries({ queryKey: detailQueryKey });
      setShowUploadDialog(false);
      setPendingUploadFile(null);
      setIsDragActive(false);
    } catch (error: unknown) {
      console.error('[BudgetDetailModalServices] Error al subir documento del presupuesto', error);
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

  const updateForm = (field: keyof BudgetFormValuesServices, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  // Inicializa solo los campos editables (schema con training_address)
  useEffect(() => {
    if (deal) {
      setForm({
        training_address: deal.training_address ?? '', // <- aquí
        caes_label: deal.caes_label ?? '',
        hotel_label: deal.hotel_label ?? ''
      });
    } else if (summary) {
      setForm({
        training_address: summary.training_address ?? '', // <- aquí
        caes_label: summary.caes_label ?? '',
        hotel_label: summary.hotel_label ?? ''
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
      training_address: source.training_address ?? '', // <- aquí
      caes_label: source.caes_label ?? '',
      hotel_label: source.hotel_label ?? ''
    };
  }, [deal, summary]);

  const detailProducts = detailView.products;
  const detailNotes = detailView.notes;
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

  const defaultSessionAddress =
    form?.training_address?.trim()?.length
      ? form.training_address
      : deal?.training_address ?? summary?.training_address ?? null;

  const trainingProducts = useMemo(
    () => {
      const isPciPipeline = normalizeComparableValue(pipelineLabel) === 'pci';
      if (isPciPipeline) {
        return detailProducts.filter((product) => isPciCategoryProduct(product));
      }

      return detailProducts.filter((product) => !isLegacyExtraProduct(product));
    },
    [detailProducts, pipelineLabel]
  );

  const dirtyDeal = !!initialEditable && !!form && JSON.stringify(initialEditable) !== JSON.stringify(form);
  const isDirty = dirtyDeal;
  const isRefetching = detailQuery.isRefetching || refreshMutation.isPending;

  if (!dealId) return null;

  const presupuestoDisplay = detailView.dealId;
  const presupuestoHeaderLabel = presupuestoDisplay?.trim().length
    ? `Presupuesto ${presupuestoDisplay}`
    : 'Presupuesto';
  const titleDisplay = detailView.title ?? '';
  const organizationDisplay = detailView.organizationName ?? '';
  const clientDisplay = detailView.clientName ?? '';
  const clientPhoneDisplay = detailView.clientPhone ?? '';
  const clientEmailDisplay = detailView.clientEmail ?? '';
  const comercialDisplay = detailView.comercial ?? deal?.comercial ?? summary?.comercial ?? '';

  const extraProducts = useMemo(() => {
    const isPciPipeline = normalizeComparableValue(pipelineLabel) === 'pci';
    if (isPciPipeline) {
      return detailProducts.filter((product) => !isPciCategoryProduct(product));
    }

    return detailProducts.filter((product) => isLegacyExtraProduct(product));
  }, [detailProducts, pipelineLabel]);

  const modalTitle = organizationDisplay || 'Detalle presupuesto';
  const truncatedModalTitle = truncateText(modalTitle, 60);
  const modalTitleTooltip = truncatedModalTitle !== modalTitle ? modalTitle : undefined;

  const displayOrDash = (value?: string | number | null) => {
    if (value === null || value === undefined) return '—';
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : '—';
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

  const handleRefresh = () => {
    if (!normalizedDealId || refreshMutation.isPending) return;
    lastManualRefreshRef.current = true;
    refreshMutation.mutate(normalizedDealId);
  };

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

  const handleOpenMap = () => {
    const address = form?.training_address?.trim();
    if (!address) return;
    setMapAddress(address);
    setShowMapModal(true);
  };

  const handleCloseMap = () => {
    setShowMapModal(false);
    setMapAddress(null);
  };

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

    if (normalizeString(form?.training_address) !== normalizeString(initialEditable?.training_address)) {
      patch.training_address = toNullableString(form?.training_address); // <- schema correcto
    }
    if (normalizeString(form?.caes_label) !== normalizeString(initialEditable?.caes_label)) {
      patch.caes_label = toNullableString(form?.caes_label);
    }
    if (normalizeString(form?.hotel_label) !== normalizeString(initialEditable?.hotel_label)) {
      patch.hotel_label = toNullableString(form?.hotel_label);
    }

    const hasDealPatch = Object.keys(patch).length > 0;
    if (!hasDealPatch) return;

    setSaving(true);
    try {
      await patchDealEditable(
        deal.deal_id,
        patch,
        { id: userId, name: userName }
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

  return (
    <>
      <Modal
      show={!!dealId}
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
              {pipelineLabel}
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
              <Col md={4}>
                <Form.Label>Comercial</Form.Label>
                <Form.Control
                  value={displayOrDash(comercialDisplay)}
                  readOnly
                  title={buildFieldTooltip(comercialDisplay)}
                />
              </Col>
              <Col md={8}>
                <Form.Label>Dirección</Form.Label>
                <div className="d-flex gap-2 align-items-start">
                  <Form.Control
                    className="flex-grow-1"
                    value={form.training_address}
                    onChange={(e) => updateForm('training_address', e.target.value)}
                    title={buildFieldTooltip(form.training_address)}
                  />
                  <Button
                    variant="outline-primary"
                    onClick={handleOpenMap}
                    disabled={!form.training_address?.trim()}
                  >
                    Ver
                  </Button>
                </div>
              </Col>
              <Col md={2} className="budget-field-narrow">
                <div className="d-flex justify-content-between align-items-center gap-2">
                  <Form.Label className="mb-0">CAES</Form.Label>
                  {renderFollowUpBlock('caes_val')}
                </div>
                <Form.Control
                  value={form.caes_label}
                  onChange={(e) => updateForm('caes_label', e.target.value)}
                  style={affirmativeBorder(form.caes_label)}
                  title={buildFieldTooltip(form.caes_label)}
                />
              </Col>
              <Col md={2} className="budget-field-narrow">
                <div className="d-flex justify-content-between align-items-center gap-2">
                  <Form.Label className="mb-0">Hotel</Form.Label>
                  {renderFollowUpBlock('hotel_val')}
                </div>
                <Form.Control
                  value={form.hotel_label}
                  onChange={(e) => updateForm('hotel_label', e.target.value)}
                  style={affirmativeBorder(form.hotel_label)}
                  title={buildFieldTooltip(form.hotel_label)}
                />
              </Col>
              <Col md={2} className="budget-field-wide">
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
              <Col md={2} className="budget-field-wide">
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
                    <th>Servicio</th>
                    <th style={{ width: 60 }}>Horas</th>
                    <th style={{ width: 189 }}>Comentarios</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingProducts.map((product, index) => {
                    const productLabel = displayOrDash(product?.name ?? product?.code ?? '');
                    const hoursValue = formatInitialHours(product?.quantity ?? null);
                    const commentText = (product?.comments ?? '').trim();
                    const commentPreview = buildCommentPreview(commentText);
                    return (
                      <tr key={product?.id ?? `${product?.name ?? 'producto'}-${index}`}>
                        <td>{productLabel}</td>
                        <td style={{ width: 60 }}>
                          <span className="text-muted">
                            {hoursValue.length ? hoursValue : '—'}
                          </span>
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
              <p className="text-muted small mb-4">No hay servicios asociados.</p>
            )}
            <Accordion
              activeKey={openSections}
              onSelect={handleAccordionSelect}
              alwaysOpen
              className="mb-4"
            >
              <SessionsAccordionServices
                dealId={normalizedDealId}
                dealAddress={defaultSessionAddress ?? null}
                products={detailProducts}
                onNotify={onNotify}
                highlightSessionId={highlightSessionId ?? null}
              />
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

              <Accordion.Item eventKey="extra-products">
                <Accordion.Header>
                  <div className="d-flex justify-content-between align-items-center w-100">
                    <span className="erp-accordion-title">
                      Productos Extra
                      {extraProducts.length > 0 ? (
                        <span className="erp-accordion-count">{extraProducts.length}</span>
                      ) : null}
                    </span>
                  </div>
                </Accordion.Header>
                <Accordion.Body>
                  {extraProducts.length ? (
                    <ListGroup>
                      {extraProducts.map((product, index) => (
                        <ListGroup.Item key={product?.id ?? `${product?.code ?? 'extra'}-${index}`}>
                          <div className="fw-semibold">{displayOrDash(product?.name ?? product?.code ?? '')}</div>
                          {product?.comments ? (
                            <div className="text-muted small">{product.comments}</div>
                          ) : null}
                        </ListGroup.Item>
                      ))}
                    </ListGroup>
                  ) : (
                    <p className="text-muted small mb-0">Sin Extras</p>
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
          <Modal.Title>Comentario del servicio</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {viewingComment?.productName ? (
            <div className="mb-2">
              <strong>Servicio:</strong> {viewingComment.productName}
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
  </>
  );
}
