import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, ListGroup, Badge, Row, Col, Alert, Spinner } from 'react-bootstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDealDetail,
  patchDealEditable,
  getDocPreviewUrl,
  getUploadUrl,
  createDocumentMeta,
  deleteDocument
} from './api';
import type { DealSummary } from '../../types/deal';

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
  if (Array.isArray(summary.trainingNames) && summary.trainingNames.length) {
    return summary.trainingNames.join(', ');
  }

  if (Array.isArray(summary.training) && summary.training.length) {
    const names = summary.training
      .map((product) => (product?.name || product?.code || '')?.toString().trim())
      .filter((value): value is string => Boolean(value));
    if (names.length) return names.join(', ');
  }

  return '';
}

function toBooleanValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || ['false', '0', 'no', 'n'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'y', 'si', 'sí', 's'].includes(normalized)) return true;
    return Boolean(normalized);
  }
  return Boolean(value);
}

export function BudgetDetailModal({ dealId, summary, onClose }: Props) {
  const qc = useQueryClient();
  const { userId, userName } = useAuth();

  const detailQuery = useQuery({
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

  const [form, setForm] = useState<any>(null);
  const [newComment, setNewComment] = useState('');
  const [editComments, setEditComments] = useState<Record<string, string>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inicializa solo los 7 campos
  useEffect(() => {
    if (deal) {
      setForm({
        sede_label: deal.sede_label ?? '',
        hours: deal.hours ?? 0,
        Dirección: deal.training_address ?? '',
        CAES: !!deal.caes_label,
        FUNDAE: !!deal.fundae_label,
        Hotel: !!deal.hotel_label,
        Alumnos: deal.alumnos ?? 0
      });
    } else if (summary) {
      setForm({
        Sede: summary.sede_label ?? '',
        Horas: summary.hours ?? 0,
        Dirección: summary.training_address ?? '',
        CAES: toBooleanValue(summary.caes_label),
        FUNDAE: toBooleanValue(summary.fundae_label),
        Hotel: toBooleanValue(summary.hotel_label),
        Alumnos: summary.alumnos ?? 0
      });
    }
  }, [deal, summary]);

  const initialEditable = useMemo(() => {
    const source = deal ?? summary;
    if (!source) return null;
    return {
      sede_label: source.sede_label ?? '',
      hours: source.hours ?? 0,
      training_address: source.training_address ?? source.dealDirection ?? source.direction ?? '',
      caes_label: toBooleanValue((source as any).caes_label ?? (source as any).caes_label),
      fundae_label: toBooleanValue((source as any).fundae_label ?? (source as any).fundae_label),
      hotel_label: toBooleanValue((source as any).hotel_label ?? (source as any).hotelNight),
      alumnos: source.alumnos ?? 0
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
    const detailId = (deal?.deal_id ?? deal?.id) as string | number | undefined;
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
    const detailTitle = (deal?.deal_title ?? deal?.title) as string | undefined;
    if (detailTitle && detailTitle.trim()) return detailTitle.trim();
    return summary?.title ?? '';
  }, [deal, summary]);

  const clientDisplay = useMemo(() => {
    const possibleValues = [
      (deal?.organization && (deal.organization as any).name) ?? undefined,
      (deal as any)?.organization_name,
      (deal as any)?.organizationName,
      (deal as any)?.cliente
    ];
    for (const value of possibleValues) {
      if (value !== undefined && value !== null) {
        const label = String(value).trim();
        if (label) return label;
      }
    }
    return summary?.clientName || summary?.organizationName || '';
  }, [deal, summary]);

  const productDisplay = useMemo(() => {
    if (deal?.training) {
      if (Array.isArray(deal.training) && deal.training.length) {
        const names = (deal.training as any[])
          .map((item) => (item?.name || item?.code || '')?.toString().trim())
          .filter((value: string | undefined): value is string => Boolean(value));
        if (names.length) return names.join(', ');
      }
      if (typeof deal.training === 'string') {
        const trimmed = deal.training.trim();
        if (trimmed) return trimmed;
      }
    }
    const summaryProducts = formatProductNamesFromSummary(summary);
    if (summaryProducts) return summaryProducts;
    return '';
  }, [deal, summary]);

  const detailErrorMessage = detailQuery.isError
    ? detailQuery.error instanceof Error
      ? detailQuery.error.message
      : 'No se pudo cargar el detalle del presupuesto.'
    : null;

  if (!dealId) return null;

  async function handleSave() {
    if (!deal) return;
    const patch: any = {};
    if (form.sede_label !== (initialEditable?.sede_label ?? '')) patch.sede_label = String(form.sede_label ?? '');
    if (Number(form.hours ?? 0) !== Number(initialEditable?.hours ?? 0)) patch.hours = Number(form.hours ?? 0);
    if ((form.training_address || '') !== (initialEditable?.training_address || '')) patch.training_address = String(form.training_address || '');
    if (!!form.caes_label !== !!initialEditable?.caes_label) patch.caes_label = !!form.caes_label;
    if (!!form.fundae_label !== !!initialEditable?.fundae_label) patch.fundae_label = !!form.fundae_label;
    if (!!form.hotel_label !== !!initialEditable?.hotel_label) patch.hotel_label = !!form.hotel_label;
    if (Number(form.alumnos ?? 0) !== Number(initialEditable?.alumnos ?? 0)) patch.alumnos = Number(form.alumnos ?? 0);

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
        {(presupuestoDisplay || titleDisplay || clientDisplay || productDisplay) && (
          <Row className="g-3 mb-4">
            <Col md={4}>
              <Form.Label>Presupuesto</Form.Label>
              <Form.Control value={presupuestoDisplay || '—'} readOnly />
            </Col>
            <Col md={8}>
              <Form.Label>Título</Form.Label>
              <Form.Control value={titleDisplay || '—'} readOnly />
            </Col>
            <Col md={6}>
              <Form.Label>Cliente</Form.Label>
              <Form.Control value={clientDisplay || '—'} readOnly />
            </Col>
            <Col md={6}>
              <Form.Label>Producto</Form.Label>
              <Form.Control value={productDisplay || '—'} readOnly title={productDisplay || undefined} />
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
        {!isLoading && deal && (
          <>
            <Row className="g-3">
              <Col md={4}>
                <Form.Label>sede_label</Form.Label>
                <Form.Control value={form?.sede_label || ''} onChange={(e) => setForm({ ...form, sede_label: e.target.value })} />
              </Col>
              <Col md={2}>
                <Form.Label>Horas</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  value={form?.hours ?? 0}
                  onChange={(e) => setForm({ ...form, hours: e.target.value })}
                />
              </Col>
              <Col md={6}>
                <Form.Label>Dirección del deal</Form.Label>
                <Form.Control
                  value={form?.training_address || ''}
                  onChange={(e) => setForm({ ...form, training_address: e.target.value })}
                />
              </Col>
              <Col md={2} className="d-flex align-items-center">
                <Form.Check
                  id="caes_label"
                  label="CAE/S"
                  checked={!!form?.caes_label}
                  onChange={(e) => setForm({ ...form, caes_label: e.target.checked })}
                />
              </Col>
              <Col md={2} className="d-flex align-items-center">
                <Form.Check
                  id="fundae_label"
                  label="fundae_label"
                  checked={!!form?.fundae_label}
                  onChange={(e) => setForm({ ...form, fundae_label: e.target.checked })}
                />
              </Col>
              <Col md={2} className="d-flex align-items-center">
                <Form.Check
                  id="hotel"
                  label="Hotel/Noche"
                  checked={!!form?.hotel_label}
                  onChange={(e) => setForm({ ...form, hotel_label: e.target.checked })}
                />
              </Col>
              <Col md={2}>
                <Form.Label>Alumnos</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  value={form?.alumnos ?? 0}
                  onChange={(e) => setForm({ ...form, alumnos: e.target.value })}
                />
              </Col>
            </Row>

            <hr className="my-4" />
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
