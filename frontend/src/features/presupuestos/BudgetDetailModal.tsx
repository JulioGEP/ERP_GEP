import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, ListGroup, Badge, Row, Col, Alert, Spinner, Table } from 'react-bootstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDealDetail,
  patchDealEditable,
  getDocPreviewUrl,
  getUploadUrl,
  createDocumentMeta,
  deleteDocument
} from './api';
import type { DealEditablePatch } from './api';
import type { DealDetail, DealSummary } from '../../types/deal';

interface Props {
  dealId: string | null;
  summary?: DealSummary | null;
  onClose: () => void;
}

function useAuth() {
  // Ajusta a tu sistema real de auth
  const userId = localStorage.getItem('userId') || 'user@example.com';
  const userName = localStorage.getItem('userName') || 'Usuario';
  return { userId, userName };
}

function formatProductNamesFromSummary(summary?: DealSummary | null): string {
  if (!summary) return '';
  if (Array.isArray(summary.productNames) && summary.productNames.length) {
    return summary.productNames.join(', ');
  }

  if (Array.isArray(summary.products) && summary.products.length) {
    const names = summary.products
      .map((product) => (product?.name || product?.code || '')?.toString().trim())
      .filter((value): value is string => Boolean(value));
    if (names.length) return names.join(', ');
  }

  return '';
}

type EditableDealForm = {
  sede_label: string;
  hours: string;
  training_address: string;
  caes_label: string;
  fundae_label: string;
  hotel_label: string;
  alumnos: string;
};

export function BudgetDetailModal({ dealId, summary, onClose }: Props) {
  const qc = useQueryClient();
  const { userId, userName } = useAuth();

  const detailQuery = useQuery<DealDetail>({
    queryKey: ['deal', dealId],
    queryFn: () => fetchDealDetail(dealId as string),
    enabled: typeof dealId === 'string' && dealId.length > 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
    staleTime: Infinity
  });

  const deal = detailQuery.data;
  const isLoading = detailQuery.isLoading;

  const [form, setForm] = useState<EditableDealForm | null>(null);
  const [newComment, setNewComment] = useState('');
  const [editComments, setEditComments] = useState<Record<string, string>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateForm = (field: keyof EditableDealForm, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  // Inicializa solo los 7 campos
  useEffect(() => {
    if (deal) {
      setForm({
        sede_label: deal.sede_label ?? '',
        hours: deal.hours != null ? String(deal.hours) : '',
        training_address: deal.training_address ?? '',
        caes_label: deal.caes_label ?? '',
        fundae_label: deal.fundae_label ?? '',
        hotel_label: deal.hotel_label ?? '',
        alumnos: deal.alumnos != null ? String(deal.alumnos) : ''
      });
    } else if (summary) {
      setForm({
        sede_label: summary.sede_label ?? '',
        hours: summary.hours != null ? String(summary.hours) : '',
        training_address: summary.training_address ?? '',
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
      hours: source.hours != null ? String(source.hours) : '',
      training_address: source.training_address ?? '',
      caes_label: (source as any).caes_label ?? '',
      fundae_label: (source as any).fundae_label ?? '',
      hotel_label: (source as any).hotel_label ?? '',
      alumnos: source.alumnos != null ? String(source.alumnos) : ''
    };
  }, [deal, summary]);

  const dirtyDeal =
    !!initialEditable &&
    !!form &&
    JSON.stringify(initialEditable) !== JSON.stringify(form);

  const dirtyComments =
    (newComment.trim().length > 0) || Object.keys(editComments).length > 0;

  const isDirty = dirtyDeal || dirtyComments;

  const presupuestoDisplay = useMemo(() => {
    const detailId = deal?.deal_id;
    if (detailId !== undefined && detailId !== null) {
      const label = String(detailId).trim();
      if (label) return label;
    }
    const summaryId = summary?.dealId?.trim();
    if (summaryId) return summaryId;
    if (summary?.dealNumericId != null) return String(summary.dealNumericId);
    return '';
  }, [deal, summary]);

  const titleDisplay = useMemo(() => {
    const detailTitle = deal?.title;
    if (detailTitle && detailTitle.trim()) return detailTitle.trim();
    return summary?.title ?? '';
  }, [deal, summary]);

  const clientDisplay = useMemo(() => {
    const firstName = deal?.person?.first_name ?? summary?.person?.first_name ?? '';
    const lastName = deal?.person?.last_name ?? summary?.person?.last_name ?? '';
    const parts = [firstName, lastName]
      .map((value) => (value ?? '').trim())
      .filter((value) => value.length > 0);
    return parts.join(' ');
  }, [deal, summary]);

  const organizationDisplay = useMemo(() => {
    const possibleValues = [deal?.organization?.name, summary?.organization?.name];
    for (const value of possibleValues) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  }, [deal, summary]);

  const pipelineDisplay = useMemo(() => {
    const values = [deal?.pipeline_id, summary?.pipeline_id];
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  }, [deal, summary]);

  const productDisplay = useMemo(() => {
    const products = Array.isArray(deal?.deal_products) ? deal?.deal_products : undefined;
    if (products && products.length) {
      const names = products
        .map((product) => (product?.name || product?.code || '')?.toString().trim())
        .filter((value): value is string => Boolean(value));
      if (names.length) return names.join(', ');
    }
    const summaryProducts = formatProductNamesFromSummary(summary);
    if (summaryProducts) return summaryProducts;
    return '';
  }, [deal, summary]);

  const extrasValue = deal?.prodextra ?? summary?.prodextra ?? null;
  const parsedExtras = useMemo(() => {
    if (typeof extrasValue === 'string') {
      try {
        return JSON.parse(extrasValue);
      } catch {
        return extrasValue;
      }
    }
    return extrasValue;
  }, [extrasValue]);
  const detailProducts = useMemo(() => {
    if (Array.isArray(deal?.deal_products)) return deal.deal_products;
    if (Array.isArray(summary?.products)) return summary.products;
    return [];
  }, [deal, summary]);
  const dealNotes = useMemo(() => (Array.isArray(deal?.deal_notes) ? deal.deal_notes : []), [deal]);
  const displayOrDash = (value?: string | null) => {
    if (typeof value !== 'string') return '—';
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '—';
  };

  const renderExtras = () => {
    const value = parsedExtras;
    if (value == null) return <span className="text-muted">-</span>;
    if (Array.isArray(value)) {
      if (!value.length) return <span className="text-muted">-</span>;
      return (
        <div className="d-flex flex-wrap gap-2">
          {value.map((item, index) => {
            let label = '';
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
              label = String(item);
            } else if (item && typeof item === 'object') {
              const entry = item as Record<string, unknown>;
              const mainKey = ['name', 'label', 'title'].find(
                (key) => typeof entry[key] === 'string' && String(entry[key]).trim().length
              );
              if (mainKey) {
                label = String(entry[mainKey]);
              } else {
                const pairs = Object.entries(entry)
                  .filter(([, val]) => val !== null && val !== '')
                  .map(([key, val]) => `${key}: ${String(val)}`);
                label = pairs.join(' · ');
              }
            }
            const finalLabel = label.trim() || `Extra ${index + 1}`;
            return (
              <Badge key={index} bg="light" text="dark">
                {finalLabel}
              </Badge>
            );
          })}
        </div>
      );
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).filter(([, val]) => val !== null && val !== '');
      if (!entries.length) return <span className="text-muted">-</span>;
      return (
        <ListGroup className="mt-2">
          {entries.map(([key, val]) => (
            <ListGroup.Item key={key} className="d-flex justify-content-between align-items-start gap-2">
              <span className="fw-semibold text-capitalize">{key}</span>
              <span>{String(val)}</span>
            </ListGroup.Item>
          ))}
        </ListGroup>
      );
    }
    const stringValue = String(value);
    return stringValue.trim() ? <span>{stringValue}</span> : <span className="text-muted">-</span>;
  };

  const detailErrorMessage = detailQuery.isError
    ? detailQuery.error instanceof Error
      ? detailQuery.error.message
      : 'No se pudo cargar el detalle del presupuesto.'
    : null;

  if (!dealId) return null;

  async function handleSave() {
    if (!deal) return;
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
    if (normalizeString(form?.hours) !== normalizeString(initialEditable?.hours)) {
      patch.hours = toNullableNumber(form?.hours);
    }
    if (normalizeString(form?.training_address) !== normalizeString(initialEditable?.training_address)) {
      patch.training_address = toNullableString(form?.training_address);
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

    const create = newComment.trim().length ? [{ content: newComment.trim(), author_name: userName }] : [];
    const update = Object.entries(editComments).map(([comment_id, content]) => ({ comment_id, content: String(content).trim() }));

    setSaving(true);
    try {
      await patchDealEditable(deal.id, patch, { create, update }, { id: userId, name: userName });
      await qc.invalidateQueries({ queryKey: ['deal', deal.id] });
      await qc.invalidateQueries({ queryKey: ['deals', 'noSessions'] });
      onClose();
    } catch (e: any) {
      alert(e?.message || 'No se pudieron guardar los cambios');
    } finally {
      setSaving(false);
    }
  }

  async function handleView(docId: string) {
    try {
      const url = await getDocPreviewUrl(deal!.id, docId);
      window.open(url, '_blank');
    } catch (e: any) {
      alert(e?.message || 'No se pudo abrir el documento');
    }
  }

  async function handleDelete(docId: string) {
    const ok = confirm('¿Eliminar documento?');
    if (!ok) return;
    try {
      await deleteDocument(deal!.id, docId);
      await qc.invalidateQueries({ queryKey: ['deal', deal!.id] });
    } catch (e: any) {
      alert(e?.message || 'No se pudo eliminar el documento');
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !deal) return;
    try {
      const { uploadUrl, storageKey } = await getUploadUrl(deal.id, file);
      await fetch(uploadUrl, { method: 'PUT', body: file }); // subida directa a S3
      await createDocumentMeta(
        deal.id,
        { file_name: file.name, file_size: file.size, mime_type: file.type, storage_key: storageKey },
        { id: userId, name: userName }
      );
      await qc.invalidateQueries({ queryKey: ['deal', deal.id] });
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

  return (
    <Modal show={!!dealId} onHide={requestClose} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          Detalle presupuesto
          {presupuestoDisplay ? <span className="text-muted ms-2">· {presupuestoDisplay}</span> : null}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {(presupuestoDisplay || titleDisplay || organizationDisplay || clientDisplay || productDisplay || pipelineDisplay) && (
          <Row className="g-3 mb-4">
            <Col md={4}>
              <Form.Label>Presupuesto</Form.Label>
              <Form.Control value={displayOrDash(presupuestoDisplay)} readOnly />
            </Col>
            <Col md={8}>
              <Form.Label>Título</Form.Label>
              <Form.Control value={displayOrDash(titleDisplay)} readOnly />
            </Col>
            <Col md={6}>
              <Form.Label>Empresa</Form.Label>
              <Form.Control value={displayOrDash(organizationDisplay)} readOnly />
            </Col>
            <Col md={6}>
              <Form.Label>Cliente</Form.Label>
              <Form.Control value={displayOrDash(clientDisplay)} readOnly />
            </Col>
            <Col md={6}>
              <Form.Label>Tipo de Formación</Form.Label>
              <Form.Control value={displayOrDash(pipelineDisplay)} readOnly />
            </Col>
            <Col md={6}>
              <Form.Label>Formación</Form.Label>
              <Form.Control value={displayOrDash(productDisplay)} readOnly title={productDisplay || undefined} />
            </Col>
          </Row>
        )}
        {detailErrorMessage && (
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
            <Row className="g-3">
              <Col md={4}>
                <Form.Label>Sede</Form.Label>
                <Form.Control value={form.sede_label} onChange={(e) => updateForm('sede_label', e.target.value)} />
              </Col>
              <Col md={2}>
                <Form.Label>Horas</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  value={form.hours}
                  onChange={(e) => updateForm('hours', e.target.value)}
                />
              </Col>
              <Col md={2}>
                <Form.Label>Alumnos</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  value={form.alumnos}
                  onChange={(e) => updateForm('alumnos', e.target.value)}
                />
              </Col>
              <Col md={4}>
                <Form.Label>Dirección</Form.Label>
                <Form.Control value={form.training_address} onChange={(e) => updateForm('training_address', e.target.value)} />
              </Col>
              <Col md={4}>
                <Form.Label>CAES</Form.Label>
                <Form.Control value={form.caes_label} onChange={(e) => updateForm('caes_label', e.target.value)} />
              </Col>
              <Col md={4}>
                <Form.Label>FUNDAE</Form.Label>
                <Form.Control value={form.fundae_label} onChange={(e) => updateForm('fundae_label', e.target.value)} />
              </Col>
              <Col md={4}>
                <Form.Label>Hotel</Form.Label>
                <Form.Control value={form.hotel_label} onChange={(e) => updateForm('hotel_label', e.target.value)} />
              </Col>
            </Row>

            <hr className="my-4" />
            <h6>Extras</h6>
            {renderExtras()}

            <hr className="my-4" />
            <h6>Notas</h6>
            {dealNotes.length ? (
              <ListGroup className="mb-3">
                {dealNotes.map((note, index) => (
                  <ListGroup.Item key={note.id ?? `${note.deal_id ?? 'nota'}-${index}`}>
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <span>{displayOrDash(note.content ?? '')}</span>
                      <Badge bg="light" text="dark">{displayOrDash(note.author ?? '')}</Badge>
                    </div>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            ) : (
              <p className="text-muted small mb-3">No hay notas registradas.</p>
            )}

            <h6>Formaciones</h6>
            {detailProducts.length ? (
              <Table size="sm" bordered responsive className="mb-4">
                <thead>
                  <tr>
                    <th>Formación</th>
                    <th className="text-end">Sesiones</th>
                  </tr>
                </thead>
                <tbody>
                  {detailProducts.map((product, index) => {
                    const quantity =
                      product?.quantity != null && !Number.isNaN(Number(product.quantity))
                        ? Number(product.quantity)
                        : null;
                    return (
                      <tr key={product?.id ?? `${product?.name ?? 'producto'}-${index}`}>
                        <td>{displayOrDash(product?.name ?? product?.code ?? '')}</td>
                        <td className="text-end">{quantity ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <p className="text-muted small mb-4">No hay formaciones asociadas.</p>
            )}

            <h6>Comentarios</h6>
            <Form.Control
              as="textarea"
              rows={2}
              placeholder="Añadir comentario…"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
            <small className="text-muted">El comentario se guardará al pulsar “Guardar Cambios”.</small>

            <ListGroup className="mt-3">
              {(deal.comments || []).map((c: any) => {
                const isMine = c.authorId === userId || c.author_id === userId;
                const id = c.id || c.comment_id;
                const value = (id && editComments[id]) ?? c.content;
                return (
                  <ListGroup.Item key={id}>
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <Badge bg="light" text="dark">
                          {c.authorName || c.author_id || 'Anónimo'}
                        </Badge>{' '}
                        <small className="text-muted">
                          {new Date(c.createdAt || c.created_at).toLocaleString()}
                        </small>
                      </div>
                    </div>
                    {isMine ? (
                      <Form.Control
                        as="textarea"
                        className="mt-2"
                        rows={2}
                        value={value}
                        onChange={(e) => setEditComments((s) => ({ ...s, [id]: e.target.value }))}
                      />
                    ) : (
                      <p className="mt-2 mb-0">{c.content}</p>
                    )}
                  </ListGroup.Item>
                );
              })}
            </ListGroup>

            <hr className="my-4" />
            <h6>Documentos</h6>
            <Form.Control type="file" onChange={handleFile} />
            <ListGroup className="mt-3">
              {(deal.documents || []).map((d: any) => (
                <ListGroup.Item key={d.id || d.doc_id} className="d-flex justify-content-between align-items-center">
                  <div>
                    <strong>{d.fileName || d.file_name}</strong>{' '}
                    <small className="text-muted">
                      ({Math.round(((d.fileSize || d.file_size || 0) as number) / 1024)} KB){' '}
                      • {d.origin}
                    </small>
                  </div>
                  <div className="d-flex gap-2">
                    <Button size="sm" variant="outline-secondary" onClick={() => handleView(d.id || d.doc_id)}>
                      Ver
                    </Button>
                    {(d.origin === 'user_upload') && (
                      <Button size="sm" variant="outline-danger" onClick={() => handleDelete(d.id || d.doc_id)}>
                        Eliminar
                      </Button>
                    )}
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={requestClose} disabled={saving}>
          Cerrar
        </Button>
        {isDirty && deal && (
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar Cambios'}
          </Button>
        )}
      </Modal.Footer>

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
          <Button variant="danger" onClick={onClose}>
            Salir sin guardar
          </Button>
        </Modal.Footer>
      </Modal>
    </Modal>
  );
}
