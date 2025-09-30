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

interface Props {
  dealId: number | null;
  onClose: () => void;
}

function useAuth() {
  // Ajusta a tu sistema real de auth
  const userId = localStorage.getItem('userId') || 'user@example.com';
  const userName = localStorage.getItem('userName') || 'Usuario';
  return { userId, userName };
}

export function BudgetDetailModal({ dealId, onClose }: Props) {
  const qc = useQueryClient();
  const { userId, userName } = useAuth();

  const detailQuery = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => fetchDealDetail(dealId as number),
    enabled: typeof dealId === 'number',
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
        sede: deal.sede ?? '',
        hours: deal.hours ?? 0,
        deal_direction: deal.deal_direction ?? deal.direction ?? '',
        CAES: !!deal.CAES,
        FUNDAE: !!deal.FUNDAE,
        Hotel_Night: !!deal.Hotel_Night,
        alumnos: deal.alumnos ?? 0
      });
    }
  }, [deal]);

  const initialEditable = useMemo(() => {
    if (!deal) return null;
    return {
      sede: deal.sede ?? '',
      hours: deal.hours ?? 0,
      deal_direction: deal.deal_direction ?? deal.direction ?? '',
      CAES: !!deal.CAES,
      FUNDAE: !!deal.FUNDAE,
      Hotel_Night: !!deal.Hotel_Night,
      alumnos: deal.alumnos ?? 0
    };
  }, [deal]);

  const dirtyDeal =
    !!initialEditable &&
    !!form &&
    JSON.stringify(initialEditable) !== JSON.stringify(form);

  const dirtyComments =
    (newComment.trim().length > 0) || Object.keys(editComments).length > 0;

  const isDirty = dirtyDeal || dirtyComments;

  if (!dealId) return null;

  async function handleSave() {
    if (!deal) return;
    const patch: any = {};
    if (form.sede !== (initialEditable?.sede ?? '')) patch.sede = String(form.sede ?? '');
    if (Number(form.hours ?? 0) !== Number(initialEditable?.hours ?? 0)) patch.hours = Number(form.hours ?? 0);
    if ((form.deal_direction || '') !== (initialEditable?.deal_direction || '')) patch.deal_direction = String(form.deal_direction || '');
    if (!!form.CAES !== !!initialEditable?.CAES) patch.CAES = !!form.CAES;
    if (!!form.FUNDAE !== !!initialEditable?.FUNDAE) patch.FUNDAE = !!form.FUNDAE;
    if (!!form.Hotel_Night !== !!initialEditable?.Hotel_Night) patch.Hotel_Night = !!form.Hotel_Night;
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
        <Modal.Title>Detalle presupuesto</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {isLoading && (
          <div className="d-flex align-items-center gap-2">
            <Spinner size="sm" /> Cargando…
          </div>
        )}
        {!isLoading && deal && (
          <>
            <Row className="g-3">
              <Col md={4}>
                <Form.Label>Sede</Form.Label>
                <Form.Control value={form?.sede || ''} onChange={(e) => setForm({ ...form, sede: e.target.value })} />
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
                  value={form?.deal_direction || ''}
                  onChange={(e) => setForm({ ...form, deal_direction: e.target.value })}
                />
              </Col>
              <Col md={2} className="d-flex align-items-center">
                <Form.Check
                  id="caes"
                  label="CAE/S"
                  checked={!!form?.CAES}
                  onChange={(e) => setForm({ ...form, CAES: e.target.checked })}
                />
              </Col>
              <Col md={2} className="d-flex align-items-center">
                <Form.Check
                  id="fundae"
                  label="FUNDAE"
                  checked={!!form?.FUNDAE}
                  onChange={(e) => setForm({ ...form, FUNDAE: e.target.checked })}
                />
              </Col>
              <Col md={2} className="d-flex align-items-center">
                <Form.Check
                  id="hotel"
                  label="Hotel/Noche"
                  checked={!!form?.Hotel_Night}
                  onChange={(e) => setForm({ ...form, Hotel_Night: e.target.checked })}
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
        {isDirty && (
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
