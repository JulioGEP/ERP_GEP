import { useEffect, useMemo, useState } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDealDetail,
  patchDealEditable,
  getDocPreviewUrl,
  getUploadUrl,
  createDocumentMeta,
  deleteDocument,
  buildDealDetailViewModel
} from './api';
import { formatSedeLabel } from './formatSedeLabel';
import type { DealEditablePatch } from './api';
import type { DealDetail, DealDetailViewModel, DealSummary } from '../../types/deal';

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

type EditableDealForm = {
  sede_label: string;
  training_address: string; // <- schema vigente
  caes_label: string;
  fundae_label: string;
  hotel_label: string;
  alumnos: string;
};

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

  const detailView: DealDetailViewModel = useMemo(
    () => buildDealDetailViewModel(deal, summary ?? null),
    [deal, summary]
  );

  const [form, setForm] = useState<EditableDealForm | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [mapAddress, setMapAddress] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<string[]>([]);

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

  const dirtyDeal = !!initialEditable && !!form && JSON.stringify(initialEditable) !== JSON.stringify(form);
  const isDirty = dirtyDeal;

  if (!dealId) return null;

  const presupuestoDisplay = detailView.dealId;
  const titleDisplay = detailView.title ?? '';
  const organizationDisplay = detailView.organizationName ?? '';
  const clientDisplay = detailView.clientName ?? '';
  const clientPhoneDisplay = detailView.clientPhone ?? '';
  const clientEmailDisplay = detailView.clientEmail ?? '';
  const detailProducts = detailView.products;
  const detailNotes = detailView.notes;
  const documents = deal?.documents ?? [];

  const trainingProducts = detailProducts.filter((product) => {
    const code = product?.code ?? '';
    return typeof code === 'string' ? !code.toLowerCase().startsWith('ext-') : true;
  });

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

    if (!Object.keys(patch).length) return;

    setSaving(true);
    try {
      await patchDealEditable(deal.deal_id, patch, { id: userId, name: userName });
      await qc.invalidateQueries({ queryKey: detailQueryKey });
      await qc.invalidateQueries({ queryKey: ['deals', 'noSessions'] });
      onClose();
    } catch (e: any) {
      alert(e?.message || 'No se pudieron guardar los cambios');
    } finally {
      setSaving(false);
    }
  }

  async function handleView(docId: string) {
    if (!deal?.deal_id) return;
    try {
      const url = await getDocPreviewUrl(deal.deal_id, docId);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      alert(e?.message || 'No se pudo abrir el documento');
    }
  }

  async function handleDelete(docId: string) {
    const ok = confirm('¿Eliminar documento?');
    if (!ok) return;
    if (!deal?.deal_id) return;
    try {
      await deleteDocument(deal.deal_id, docId);
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

  return (
    <Modal
      show={!!dealId}
      onHide={requestClose}
      size="lg"
      backdrop="static"
      centered
      contentClassName="erp-modal-content"
    >
      <Modal.Header closeButton className="erp-modal-header border-0 pb-0">
        <Modal.Title as="div">
          <div className="erp-modal-title text-truncate">{modalTitle}</div>
          {presupuestoDisplay ? (
            <div className="erp-modal-subtitle text-truncate">
              Presupuesto {presupuestoDisplay}
            </div>
          ) : null}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="erp-modal-body">
        {(titleDisplay || clientDisplay || clientPhoneDisplay || clientEmailDisplay || deal) && (
          <div className="mb-4">
            <Row className="erp-summary-row gy-3 gx-0">
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
              <Col md={6}>
                <Form.Label>Sede</Form.Label>
                <Form.Control
                  value={formatSedeLabel(form.sede_label) ?? ''}
                  onChange={(e) => updateForm('sede_label', e.target.value)}
                />
              </Col>
              <Col md={6}>
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
                  {detailNotes.length ? (
                    <ListGroup>
                      {detailNotes.map((note, index) => (
                        <ListGroup.Item key={note.id ?? `note-${index}`}>
                          <p className="mb-1">{displayOrDash(note.content)}</p>
                          <small className="text-muted">Autor: {displayOrDash(note.author ?? null)}</small>
                        </ListGroup.Item>
                      ))}
                    </ListGroup>
                  ) : (
                    <p className="text-muted small mb-0">Sin Notas</p>
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
                      {documents.map((d) => (
                        <ListGroup.Item key={d.id} className="d-flex justify-content-between align-items-center">
                          <div>
                            <strong>{d.name}</strong>{' '}
                            <small className="text-muted">
                              ({Math.round(((d.size || 0) as number) / 1024)} KB) •{' '}
                              <Badge bg={d.source === 'S3' ? 'primary' : 'secondary'}>{d.source}</Badge>
                            </small>
                          </div>
                          <div className="d-flex gap-2">
                            <Button size="sm" variant="outline-secondary" onClick={() => handleView(d.id)}>
                              Ver
                            </Button>
                            {d.source === 'S3' && (
                              <Button size="sm" variant="outline-danger" onClick={() => handleDelete(d.id)}>
                                Eliminar
                              </Button>
                            )}
                          </div>
                        </ListGroup.Item>
                      ))}
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
                    <th>Comentarios</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingProducts.map((product, index) => {
                    const comments = product?.comments ?? '';
                    return (
                      <tr key={product?.id ?? `${product?.name ?? 'producto'}-${index}`}>
                        <td>{displayOrDash(product?.name ?? product?.code ?? '')}</td>
                        <td>
                          {comments ? (
                            <span>{comments}</span>
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
    </Modal>
  );
}
