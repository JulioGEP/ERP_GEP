import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  Badge,
  Accordion
} from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDealDetail,
  patchDealEditable,
  importDeal,
  getDocPreviewUrl,
  getUploadUrl,
  createDocumentMeta,
  deleteDocument,
  buildDealDetailViewModel,
  createDealNote,
  updateDealNote,
  deleteDealNote,
  isApiError
} from './api';
import { formatSedeLabel } from './formatSedeLabel';
import type { DealEditablePatch, DealProductEditablePatch } from './api';
import type { DealDetail, DealDetailViewModel, DealDocument, DealSummary } from '../../types/deal';
import { SessionPlanner } from './SessionPlanner';

interface Props {
  dealId: string | null;
  summary?: DealSummary | null;
  onClose: () => void;
}

function useAuth() {
  // Ajusta a tu sistema real de auth
  const fallbackUser = 'erp_user';
  const userId = localStorage.getItem('userId') || fallbackUser;
  const userName = localStorage.getItem('userName') || fallbackUser;
  return { userId, userName };
}

type EditableDealForm = {
  sede_label: string;
  training_address: string; // <- schema vigente
  caes_label: string;
  fundae_label: string;
  hotel_label: string;
  alumnos: string;
};

type DealNoteView = DealDetailViewModel['notes'][number];

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

export function BudgetDetailModal({ dealId, summary, onClose }: Props) {
  const qc = useQueryClient();
  const { userId, userName } = useAuth();

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

  const refreshMutation = useMutation({
    mutationFn: (dealId: string) => importDeal(dealId),
    onSuccess: (payload) => {
      const nextDeal = payload?.deal ?? null;
      if (nextDeal) {
        qc.setQueryData(detailQueryKey, nextDeal);
      } else {
        qc.invalidateQueries({ queryKey: detailQueryKey });
      }
      qc.invalidateQueries({ queryKey: ['deals', 'noSessions'] });

      const warnings = Array.isArray(payload?.warnings)
        ? payload.warnings.filter((warning) => typeof warning === 'string' && warning.trim().length)
        : [];
      if (warnings.length) {
        alert(`Presupuesto actualizado con avisos:\n\n${warnings.join('\n')}`);
      }
    },
    onError: (error: unknown) => {
      if (isApiError(error)) {
        alert(`No se pudo actualizar el presupuesto. [${error.code}] ${error.message}`);
      } else {
        const message = error instanceof Error ? error.message : 'No se pudo actualizar la información';
        alert(message);
      }
    }
  });

  const detailView: DealDetailViewModel = useMemo(
    () => buildDealDetailViewModel(deal, summary ?? null),
    [deal, summary]
  );

  const [form, setForm] = useState<EditableDealForm | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [mapAddress, setMapAddress] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<string[]>(['sessions']);
  const sessionsSectionRef = useRef<HTMLDivElement | null>(null);
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

  const updateForm = (field: keyof EditableDealForm, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  // Inicializa solo los campos editables (schema con training_address)
  useEffect(() => {
    if (deal) {
      setForm({
        sede_label: deal.sede_label ?? '',
        training_address: deal.training_address ?? '', // <- aquí
        caes_label: deal.caes_label ?? '',
        fundae_label: deal.fundae_label ?? '',
        hotel_label: deal.hotel_label ?? '',
        alumnos: deal.alumnos != null ? String(deal.alumnos) : ''
      });
    } else if (summary) {
      setForm({
        sede_label: summary.sede_label ?? '',
        training_address: summary.training_address ?? '', // <- aquí
        caes_label: summary.caes_label ?? '',
        fundae_label: summary.fundae_label ?? '',
        hotel_label: summary.hotel_label ?? '',
        alumnos: summary.alumnos != null ? String(summary.alumnos) : ''
      });
    } else {
      setForm(null);
    }
  }, [deal, summary]);

  const initialEditable = useMemo(() => {
    const source = deal ?? summary;
    if (!source) return null;
    return {
      sede_label: source.sede_label ?? '',
      training_address: source.training_address ?? '', // <- aquí
      caes_label: source.caes_label ?? '',
      fundae_label: source.fundae_label ?? '',
      hotel_label: source.hotel_label ?? '',
      alumnos: source.alumnos != null ? String(source.alumnos) : ''
    };
  }, [deal, summary]);

  const detailProducts = detailView.products;
  const detailNotes = detailView.notes;
  const documents = deal?.documents ?? [];

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

  const trainingProductIds = useMemo(
    () => new Set(Object.keys(initialProductHours)),
    [initialProductHours]
  );

  const dirtyProducts = useMemo(
    () => !areHourMapsEqual(productHours, initialProductHours),
    [productHours, initialProductHours]
  );

  const dirtyDeal = !!initialEditable && !!form && JSON.stringify(initialEditable) !== JSON.stringify(form);
  const isDirty = dirtyDeal || dirtyProducts;
  const isRefetching = detailQuery.isRefetching || refreshMutation.isPending;

  if (!dealId) return null;

  const presupuestoDisplay = detailView.dealId;
  const titleDisplay = detailView.title ?? '';
  const organizationDisplay = detailView.organizationName ?? '';
  const clientDisplay = detailView.clientName ?? '';
  const clientPhoneDisplay = detailView.clientPhone ?? '';
  const clientEmailDisplay = detailView.clientEmail ?? '';

  const extraProducts = detailProducts.filter((product) => {
    const code = product?.code ?? '';
    return typeof code === 'string' ? code.toLowerCase().startsWith('ext-') : false;
  });

  const modalTitle = organizationDisplay || 'Detalle presupuesto';

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
    setViewingComment({ productName, comment: rawComment });
  };

  const handleCloseCommentModal = () => {
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
    const toNullableNumber = (value: string | undefined | null) => {
      const trimmed = normalizeString(value);
      if (!trimmed.length) return null;
      const parsed = Number(trimmed);
      return Number.isNaN(parsed) ? null : parsed;
    };

    if (normalizeString(form?.sede_label) !== normalizeString(initialEditable?.sede_label)) {
      patch.sede_label = toNullableString(form?.sede_label);
    }
    if (normalizeString(form?.training_address) !== normalizeString(initialEditable?.training_address)) {
      patch.training_address = toNullableString(form?.training_address); // <- schema correcto
    }
    if (normalizeString(form?.caes_label) !== normalizeString(initialEditable?.caes_label)) {
      patch.caes_label = toNullableString(form?.caes_label);
    }
    if (normalizeString(form?.fundae_label) !== normalizeString(initialEditable?.fundae_label)) {
      patch.fundae_label = toNullableString(form?.fundae_label);
    }
    if (normalizeString(form?.hotel_label) !== normalizeString(initialEditable?.hotel_label)) {
      patch.hotel_label = toNullableString(form?.hotel_label);
    }
    if (normalizeString(form?.alumnos) !== normalizeString(initialEditable?.alumnos)) {
      patch.alumnos = toNullableNumber(form?.alumnos);
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
      await qc.invalidateQueries({ queryKey: ['deals', 'noSessions'] });
      setShowConfirm(false);
    } catch (e: any) {
      alert(e?.message || 'No se pudieron guardar los cambios');
    } finally {
      setSaving(false);
    }
  }

  async function handleView(doc: DealDocument) {
    if (!deal?.deal_id) return;
    const directUrl = doc.url ?? null;

    setPreviewLoading(!directUrl);
    setPreviewError(null);
    setPreviewUrl(directUrl);
    setPreviewMeta({ name: doc.name, mime_type: doc.mime_type ?? null });
    setPreviewDocument(doc);

    if (directUrl) return;

    try {
      const response = await getDocPreviewUrl(deal.deal_id, doc.id);
      if (!response?.url) {
        throw new Error('URL de previsualización no disponible');
      }
      setPreviewUrl(response.url);
      setPreviewMeta((current) => ({
        name: response.name ?? current?.name ?? doc.name,
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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !deal?.deal_id) return;
    try {
      const { uploadUrl, storageKey } = await getUploadUrl(deal.deal_id, file);
      await fetch(uploadUrl, { method: 'PUT', body: file }); // subida directa a S3
      await createDocumentMeta(
        deal.deal_id,
        { file_name: file.name, file_size: file.size, mime_type: file.type, storage_key: storageKey },
        { id: userId, name: userName }
      );
      await qc.invalidateQueries({ queryKey: detailQueryKey });
    } catch (e: any) {
      alert(e?.message || 'No se pudo subir el documento');
    } finally {
      (e.target as HTMLInputElement).value = '';
    }
  }

  function requestClose() {
    if (isDirty) setShowConfirm(true);
    else onClose();
  }

  function exitWithoutSaving() {
    setShowConfirm(false);
    onClose();
  }

  function closePreview() {
    setPreviewDocument(null);
    setPreviewUrl(null);
    setPreviewMeta(null);
    setPreviewLoading(false);
    setPreviewError(null);
  }

  const previewDownloadName = previewMeta?.name ?? previewDocument?.name ?? undefined;

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
          <div className="erp-modal-title text-truncate">{modalTitle}</div>
          {presupuestoDisplay ? (
            <div className="erp-modal-subtitle text-truncate">
              Presupuesto {presupuestoDisplay}
            </div>
          ) : null}
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
        {(titleDisplay || clientDisplay || clientPhoneDisplay || clientEmailDisplay || deal) && (
          <div className="mb-4">
            <Row className="erp-summary-row g-3">
              <Col md={3}>
                <Form.Label>Título</Form.Label>
                <Form.Control value={displayOrDash(titleDisplay)} readOnly />
              </Col>
              <Col md={3}>
                <Form.Label>Cliente</Form.Label>
                <Form.Control value={displayOrDash(clientDisplay)} readOnly />
              </Col>
              <Col md={3}>
                <Form.Label>Teléfono</Form.Label>
                <Form.Control value={displayOrDash(clientPhoneDisplay)} readOnly />
              </Col>
              <Col md={3}>
                <Form.Label>Mail</Form.Label>
                <Form.Control value={displayOrDash(clientEmailDisplay)} readOnly />
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
            <Row className="g-3">
              <Col md={4}>
                <Form.Label>Sede</Form.Label>
                <Form.Control
                  value={formatSedeLabel(form.sede_label) ?? ''}
                  onChange={(e) => updateForm('sede_label', e.target.value)}
                />
              </Col>
              <Col md={8}>
                <Form.Label>Dirección</Form.Label>
                <div className="d-flex gap-2 align-items-start">
                  <Form.Control
                    className="flex-grow-1"
                    value={form.training_address}
                    onChange={(e) => updateForm('training_address', e.target.value)}
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
              <Col md={2}>
                <Form.Label>CAES</Form.Label>
                <Form.Control
                  value={form.caes_label}
                  onChange={(e) => updateForm('caes_label', e.target.value)}
                  style={affirmativeBorder(form.caes_label)}
                />
              </Col>
              <Col md={2}>
                <Form.Label>FUNDAE</Form.Label>
                <Form.Control
                  value={form.fundae_label}
                  onChange={(e) => updateForm('fundae_label', e.target.value)}
                  style={affirmativeBorder(form.fundae_label)}
                />
              </Col>
              <Col md={2}>
                <Form.Label>Hotel</Form.Label>
                <Form.Control
                  value={form.hotel_label}
                  onChange={(e) => updateForm('hotel_label', e.target.value)}
                  style={affirmativeBorder(form.hotel_label)}
                />
              </Col>
              <Col md={2}>
                <Form.Label>Transporte</Form.Label>
                <Form.Control
                  value={displayOrDash(deal.transporte ?? null)}
                  readOnly
                  style={affirmativeBorder(deal.transporte ?? null)}
                />
              </Col>
              <Col md={4}>
                <Form.Label>PO</Form.Label>
                <Form.Control value={displayOrDash(deal.po ?? null)} readOnly />
              </Col>
            </Row>

            <hr className="my-4" />
            <Accordion
              activeKey={openSections}
              onSelect={handleAccordionSelect}
              alwaysOpen
              className="mb-4"
            >
              <Accordion.Item eventKey="sessions">
                <Accordion.Header>
                  <div className="d-flex justify-content-between align-items-center w-100">
                    <span className="erp-accordion-title">Planificación de sesiones</span>
                  </div>
                </Accordion.Header>
                <Accordion.Body>
                  <div ref={sessionsSectionRef}>
                    <SessionPlanner
                      dealId={deal.deal_id}
                      dealTitle={deal.title ?? summary?.title ?? null}
                    />
                  </div>
                </Accordion.Body>
              </Accordion.Item>
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
                  <Form.Control type="file" onChange={handleFile} className="mb-3" />
                  {documents.length ? (
                    <ListGroup>
                      {documents.map((d) => {
                        const sizeLabel =
                          typeof d.size === 'number' && Number.isFinite(d.size) && d.size > 0
                            ? `${Math.round((d.size / 1024) * 10) / 10} KB`
                            : null;
                        return (
                          <ListGroup.Item
                            key={d.id}
                            className="d-flex justify-content-between align-items-start flex-column flex-md-row gap-2"
                          >
                            <div className="d-flex flex-column">
                              <button
                                type="button"
                                className="btn btn-link p-0 text-start align-baseline fw-semibold"
                                onClick={() => handleView(d)}
                              >
                                {d.name || 'Documento'}
                              </button>
                              <div className="text-muted small d-flex align-items-center gap-2 flex-wrap">
                                {sizeLabel ? <span>{sizeLabel}</span> : null}
                                <Badge bg={d.source === 'S3' ? 'primary' : 'secondary'}>{d.source}</Badge>
                              </div>
                            </div>
                            {d.source === 'S3' ? (
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

            {trainingProducts.length ? (
              <Table size="sm" bordered responsive className="mb-4">
                <thead>
                  <tr>
                    <th>Formación</th>
                    <th style={{ width: 60 }}>Horas</th>
                    <th style={{ width: 130 }}>Comentarios</th>
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
                            />
                          ) : (
                            <span className="text-muted">{displayOrDash(product?.hours ?? null)}</span>
                          )}
                        </td>
                        <td style={{ width: 130 }}>
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
                                style={{ maxWidth: 130 }}
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

    <Modal show={!!previewDocument} onHide={closePreview} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title as="div">
          <div className="fw-semibold">{previewDocument?.name ?? 'Documento'}</div>
          <div className="text-muted small">
            {previewDocument?.source === 'S3' ? 'Documento interno' : 'Documento de Pipedrive'}
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
              title={previewDocument?.name ?? 'Documento'}
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
          {previewUrl ? (
            <Button
              as="a"
              href={previewUrl}
              target="_blank"
              rel="noopener"
              download={previewDownloadName || undefined}
            >
              Descargar
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
        <Button variant="danger" onClick={exitWithoutSaving}>
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
