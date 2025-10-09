import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Form, Spinner, Alert, Row, Col, Badge } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDealSession,
  deleteDealSession,
  fetchDealSessions,
  updateDealSession,
  isApiError,
  type DealSessionPayload,
  type DealSessionStatus,
} from './api';
import { fetchTrainers } from '../recursos/api';
import { fetchRooms } from '../recursos/rooms.api';
import { fetchMobileUnits } from '../recursos/mobileUnits.api';
import type { Trainer } from '../../types/trainer';
import type { Room } from '../../types/room';
import type { MobileUnit } from '../../types/mobile-unit';
import type { DealSession } from '../../types/deal';

const STATUS_LABELS: Record<DealSessionStatus, string> = {
  BORRADOR: 'Borrador',
  PLANIFICADA: 'Planificada',
  SUSPENDIDO: 'Suspendido',
  CANCELADO: 'Cancelado',
};

const STATUS_BACKGROUND: Record<DealSessionStatus, string> = {
  BORRADOR: '#f3f4f6',
  PLANIFICADA: '#e6f4ea',
  SUSPENDIDO: '#fff8d6',
  CANCELADO: '#fde2e1',
};

const NO_MOBILE_UNIT_VALUE = '__NONE__';

type DealSessionForm = {
  id: string;
  status: DealSessionStatus;
  start: string | null;
  end: string | null;
  sede: string;
  address: string;
  roomId: string;
  trainerIds: string[];
  mobileUnitIds: string[];
  comment: string;
};

type DealSessionsModalProps = {
  show: boolean;
  dealId: string | null;
  dealTitle?: string | null;
  defaultSede?: string | null;
  defaultAddress?: string | null;
  defaultDurationHours?: number | null;
  onClose: () => void;
};

function toInputDateValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromInputDateValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function createFormFromSession(
  session: DealSession,
  defaults: { sede: string; address: string }
): DealSessionForm {
  return {
    id: session.id,
    status: session.status ?? 'BORRADOR',
    start: session.start ?? null,
    end: session.end ?? null,
    sede: session.sede ?? defaults.sede,
    address: session.address ?? defaults.address,
    roomId: session.roomId ?? '',
    trainerIds: Array.isArray(session.trainerIds) ? [...session.trainerIds] : [],
    mobileUnitIds: Array.isArray(session.mobileUnitIds) ? [...session.mobileUnitIds] : [],
    comment: session.comment ?? '',
  };
}

function computeAutomaticStatus(form: DealSessionForm): DealSessionStatus {
  const hasMandatory =
    !!form.start &&
    !!form.end &&
    form.sede.trim().length > 0 &&
    form.address.trim().length > 0 &&
    form.roomId.trim().length > 0 &&
    form.trainerIds.length > 0;

  return hasMandatory ? 'PLANIFICADA' : 'BORRADOR';
}

function formatTrainerName(trainer: Trainer): string {
  const parts = [trainer.name ?? '', trainer.apellido ?? '']
    .map((value) => value?.trim())
    .filter((value) => !!value && value.length > 0);
  return parts.join(' ');
}

function formatMobileUnit(unit: MobileUnit): string {
  const label = unit.name?.trim() ?? '';
  const matricula = unit.matricula?.trim() ?? '';
  return matricula ? `${label} (${matricula})` : label;
}

export function DealSessionsModal({
  show,
  dealId,
  dealTitle,
  defaultSede,
  defaultAddress,
  defaultDurationHours,
  onClose,
}: DealSessionsModalProps) {
  const normalizedDealId = (dealId ?? '').trim();
  const defaultSedeValue = (defaultSede ?? '').trim();
  const defaultAddressValue = (defaultAddress ?? '').trim();
  const durationMs = useMemo(() => {
    if (defaultDurationHours === null || defaultDurationHours === undefined) return null;
    const parsed = Number(defaultDurationHours);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed * 60 * 60 * 1000);
  }, [defaultDurationHours]);

  const defaults = useMemo(
    () => ({ sede: defaultSedeValue, address: defaultAddressValue }),
    [defaultSedeValue, defaultAddressValue]
  );

  const queryClient = useQueryClient();
  const sessionQueryKey = useMemo(
    () => ['dealSessions', normalizedDealId] as const,
    [normalizedDealId]
  );

  const sessionsQuery = useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => fetchDealSessions(normalizedDealId),
    enabled: show && normalizedDealId.length > 0,
    refetchOnWindowFocus: false,
  });

  const trainersQuery = useQuery({
    queryKey: ['trainers', 'all'],
    queryFn: fetchTrainers,
    enabled: show,
    staleTime: 5 * 60 * 1000,
  });

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'all'],
    queryFn: () => fetchRooms(),
    enabled: show,
    staleTime: 5 * 60 * 1000,
  });

  const mobileUnitsQuery = useQuery({
    queryKey: ['mobileUnits', 'all'],
    queryFn: fetchMobileUnits,
    enabled: show,
    staleTime: 5 * 60 * 1000,
  });

  const collator = useMemo(() => new Intl.Collator('es', { sensitivity: 'base' }), []);

  const trainers = useMemo(() => {
    const items = trainersQuery.data ?? [];
    return [...items]
      .filter((trainer) => trainer.activo)
      .sort((a, b) => collator.compare(formatTrainerName(a), formatTrainerName(b)));
  }, [trainersQuery.data, collator]);

  const rooms = useMemo(() => {
    const items = roomsQuery.data ?? [];
    return [...items].sort((a, b) => {
      const aPriority = a.sede && defaultSedeValue
        ? a.sede.toLowerCase() === defaultSedeValue.toLowerCase() ? 0 : 1
        : 1;
      const bPriority = b.sede && defaultSedeValue
        ? b.sede.toLowerCase() === defaultSedeValue.toLowerCase() ? 0 : 1
        : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return collator.compare(a.name ?? '', b.name ?? '');
    });
  }, [roomsQuery.data, collator, defaultSedeValue]);

  const mobileUnits = useMemo(() => {
    const items = mobileUnitsQuery.data ?? [];
    return [...items].sort((a, b) => collator.compare(a.name ?? '', b.name ?? ''));
  }, [mobileUnitsQuery.data, collator]);

  const [forms, setForms] = useState<Record<string, DealSessionForm>>({});
  const [sessionOrder, setSessionOrder] = useState<string[]>([]);
  const [errorBySession, setErrorBySession] = useState<Record<string, string | null>>({});
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null);
  const [duplicatingSessionId, setDuplicatingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [successMap, setSuccessMap] = useState<Record<string, number>>({});
  const successTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!show) {
      setErrorBySession({});
      setSavingSessionId(null);
      setDuplicatingSessionId(null);
      setDeletingSessionId(null);
    }
  }, [show]);

  useEffect(() => {
    return () => {
      Object.values(successTimeouts.current).forEach((timeoutId) => clearTimeout(timeoutId));
      successTimeouts.current = {};
    };
  }, []);

  useEffect(() => {
    const data = sessionsQuery.data;
    if (!data || !Array.isArray(data)) {
      setForms({});
      setSessionOrder([]);
      return;
    }

    const nextForms: Record<string, DealSessionForm> = {};
    const nextOrder: string[] = [];

    data.forEach((session) => {
      nextForms[session.id] = createFormFromSession(session, defaults);
      nextOrder.push(session.id);
    });

    setForms(nextForms);
    setSessionOrder(nextOrder);
  }, [sessionsQuery.data, defaults]);

  const updateForm = (sessionId: string, updater: (current: DealSessionForm) => DealSessionForm) => {
    setForms((current) => {
      const existing = current[sessionId];
      if (!existing) return current;
      return { ...current, [sessionId]: updater(existing) };
    });
  };

  const markSuccess = (sessionId: string) => {
    setSuccessMap((current) => ({ ...current, [sessionId]: Date.now() }));
    if (successTimeouts.current[sessionId]) {
      clearTimeout(successTimeouts.current[sessionId]!);
    }
    successTimeouts.current[sessionId] = setTimeout(() => {
      setSuccessMap((current) => {
        const { [sessionId]: _removed, ...rest } = current;
        return rest;
      });
      delete successTimeouts.current[sessionId];
    }, 3500);
  };

  const updateMutation = useMutation({
    mutationFn: ({ sessionId, payload }: { sessionId: string; payload: DealSessionPayload }) =>
      updateDealSession(sessionId, payload),
    onSuccess: (session) => {
      if (!normalizedDealId) return;
      queryClient.setQueryData<DealSession[]>(sessionQueryKey, (current) => {
        if (!current) return [session];
        return current.map((item) => (item.id === session.id ? session : item));
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: ({ dealId, payload }: { dealId: string; payload: DealSessionPayload }) =>
      createDealSession(dealId, payload),
    onSuccess: (session) => {
      if (!normalizedDealId) return;
      queryClient.setQueryData<DealSession[]>(sessionQueryKey, (current) => {
        if (!current) return [session];
        return [...current, session];
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteDealSession(sessionId),
    onSuccess: (_, sessionId) => {
      if (!normalizedDealId) return;
      queryClient.setQueryData<DealSession[]>(sessionQueryKey, (current) => {
        if (!current) return current;
        return current.filter((session) => session.id !== sessionId);
      });
    },
  });

  const handleStartChange = (sessionId: string, value: string) => {
    updateForm(sessionId, (form) => {
      const startIso = fromInputDateValue(value);
      let endIso = form.end;
      if (durationMs && startIso && (!form.end || !form.end.trim())) {
        const startDate = new Date(startIso);
        if (!Number.isNaN(startDate.getTime())) {
          const suggested = new Date(startDate.getTime() + durationMs);
          endIso = suggested.toISOString();
        }
      }
      return { ...form, start: startIso, end: endIso };
    });
  };

  const handleEndChange = (sessionId: string, value: string) => {
    updateForm(sessionId, (form) => ({ ...form, end: fromInputDateValue(value) }));
  };

  const handleInputChange = (sessionId: string, field: keyof DealSessionForm, value: string) => {
    updateForm(sessionId, (form) => ({ ...form, [field]: value }));
  };

  const handleTrainerChange = (sessionId: string, options: HTMLOptionsCollection) => {
    const selected = Array.from(options)
      .filter((option) => option.selected)
      .map((option) => option.value);
    updateForm(sessionId, (form) => ({ ...form, trainerIds: selected }));
  };

  const handleMobileUnitChange = (sessionId: string, options: HTMLOptionsCollection) => {
    const selected = Array.from(options)
      .filter((option) => option.selected)
      .map((option) => option.value);

    const normalized = selected.includes(NO_MOBILE_UNIT_VALUE) ? [] : selected;
    updateForm(sessionId, (form) => ({ ...form, mobileUnitIds: normalized }));
  };

  const handleStatusChange = (sessionId: string, value: string) => {
    updateForm(sessionId, (form) => ({
      ...form,
      status: (value?.trim().toUpperCase() as DealSessionStatus) ?? 'BORRADOR',
    }));
  };

  const handleClearSession = (sessionId: string) => {
    updateForm(sessionId, (form) => ({
      ...form,
      status: 'BORRADOR',
      start: null,
      end: null,
      sede: '',
      address: '',
      roomId: '',
      trainerIds: [],
      mobileUnitIds: [],
      comment: '',
    }));
    setErrorBySession((current) => ({ ...current, [sessionId]: null }));
    if (successTimeouts.current[sessionId]) {
      clearTimeout(successTimeouts.current[sessionId]!);
      delete successTimeouts.current[sessionId];
    }
    setSuccessMap((current) => {
      const { [sessionId]: _removed, ...rest } = current;
      return rest;
    });
  };

  const buildPayloadFromForm = (form: DealSessionForm, statusOverride?: DealSessionStatus): DealSessionPayload => ({
    status: statusOverride ?? form.status,
    start: form.start,
    end: form.end,
    sede: form.sede,
    address: form.address,
    roomId: form.roomId || null,
    trainerIds: form.trainerIds,
    mobileUnitIds: form.mobileUnitIds,
    comment: form.comment,
  });

  const handleSaveSession = async (sessionId: string) => {
    if (!forms[sessionId]) return;
    const form = forms[sessionId];
    setSavingSessionId(sessionId);
    setErrorBySession((current) => ({ ...current, [sessionId]: null }));

    const effectiveStatus =
      form.status === 'SUSPENDIDO' || form.status === 'CANCELADO'
        ? form.status
        : computeAutomaticStatus(form);

    try {
      const updated = await updateMutation.mutateAsync({
        sessionId,
        payload: buildPayloadFromForm(form, effectiveStatus),
      });
      setForms((current) => ({ ...current, [sessionId]: createFormFromSession(updated, defaults) }));
      markSuccess(sessionId);
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : 'No se pudo guardar la sesión. Inténtalo de nuevo.';
      setErrorBySession((current) => ({ ...current, [sessionId]: message }));
    } finally {
      setSavingSessionId(null);
    }
  };

  const handleDuplicateSession = async (sessionId: string) => {
    if (!normalizedDealId || !forms[sessionId]) return;
    const form = forms[sessionId];
    setDuplicatingSessionId(sessionId);
    setErrorBySession((current) => ({ ...current, [sessionId]: null }));
    try {
      const created = await createMutation.mutateAsync({
        dealId: normalizedDealId,
        payload: buildPayloadFromForm(form),
      });
      setForms((current) => ({
        ...current,
        [created.id]: createFormFromSession(created, defaults),
      }));
      setSessionOrder((current) => [...current, created.id]);
      markSuccess(created.id);
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : 'No se pudo duplicar la sesión. Inténtalo de nuevo.';
      setErrorBySession((current) => ({ ...current, [sessionId]: message }));
    } finally {
      setDuplicatingSessionId(null);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setDeletingSessionId(sessionId);
    setErrorBySession((current) => ({ ...current, [sessionId]: null }));
    try {
      await deleteMutation.mutateAsync(sessionId);
      setForms((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setSessionOrder((current) => current.filter((id) => id !== sessionId));
      setSuccessMap((current) => {
        const { [sessionId]: _removed, ...rest } = current;
        return rest;
      });
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : 'No se pudo eliminar la sesión. Inténtalo de nuevo.';
      setErrorBySession((current) => ({ ...current, [sessionId]: message }));
    } finally {
      setDeletingSessionId(null);
    }
  };

  const isLoadingSessions = sessionsQuery.isLoading || sessionsQuery.isFetching;
  const sessionsErrorMessage = sessionsQuery.error
    ? sessionsQuery.error instanceof Error
      ? sessionsQuery.error.message
      : 'No se pudieron cargar las sesiones.'
    : null;

  const hasSessions = sessionOrder.length > 0;

  return (
    <Modal
      show={show}
      onHide={onClose}
      size="xl"
      backdrop="static"
      centered
      scrollable
    >
      <Modal.Header closeButton>
        <Modal.Title as="div">
          <div className="fw-semibold">Planificación de sesiones</div>
          {dealTitle ? <div className="small text-muted">{dealTitle}</div> : null}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {isLoadingSessions ? (
          <div className="d-flex align-items-center gap-2 text-muted">
            <Spinner size="sm" animation="border" /> Cargando sesiones…
          </div>
        ) : null}

        {sessionsErrorMessage ? (
          <Alert variant="danger" className="mt-3">
            {sessionsErrorMessage}
          </Alert>
        ) : null}

        {!isLoadingSessions && !sessionsErrorMessage && !hasSessions ? (
          <Alert variant="info" className="mt-3">
            No hay sesiones disponibles para este presupuesto.
          </Alert>
        ) : null}

        <div className="d-grid gap-4 mt-3">
          {sessionOrder.map((sessionId, index) => {
            const form = forms[sessionId];
            if (!form) return null;
            const status = form.status ?? 'BORRADOR';
            const background = STATUS_BACKGROUND[status] ?? STATUS_BACKGROUND.BORRADOR;
            const errorMessage = errorBySession[sessionId] ?? null;
            const showSuccess = successMap[sessionId] != null;
            const currentMobileValue =
              form.mobileUnitIds.length > 0 ? form.mobileUnitIds : [NO_MOBILE_UNIT_VALUE];
            const isSaving = savingSessionId === sessionId;
            const isDuplicating = duplicatingSessionId === sessionId;
            const isDeleting = deletingSessionId === sessionId;

            return (
              <div
                key={sessionId}
                className="session-card"
                style={{ backgroundColor: background }}
              >
                <div className="session-card-header">
                  <div>
                    <div className="fw-semibold">Sesión {index + 1}</div>
                    <Badge bg="secondary" className="mt-1">
                      {STATUS_LABELS[status]}
                    </Badge>
                  </div>
                  <div className="session-card-actions">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => handleDuplicateSession(sessionId)}
                      disabled={isDuplicating || !normalizedDealId}
                    >
                      {isDuplicating ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" /> Duplicando…
                        </>
                      ) : (
                        'Duplicar'
                      )}
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => handleClearSession(sessionId)}
                      disabled={isSaving || isDuplicating || isDeleting}
                    >
                      Limpiar
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleDeleteSession(sessionId)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" /> Eliminando…
                        </>
                      ) : (
                        'Eliminar'
                      )}
                    </Button>
                  </div>
                </div>

                <Row className="g-3">
                  <Col md={6} lg={3}>
                    <Form.Label>Inicio</Form.Label>
                    <Form.Control
                      type="datetime-local"
                      value={toInputDateValue(form.start)}
                      onChange={(event) => handleStartChange(sessionId, event.target.value)}
                    />
                  </Col>
                  <Col md={6} lg={3}>
                    <Form.Label>Fin</Form.Label>
                    <Form.Control
                      type="datetime-local"
                      value={toInputDateValue(form.end)}
                      onChange={(event) => handleEndChange(sessionId, event.target.value)}
                    />
                  </Col>
                  <Col md={6} lg={3}>
                    <Form.Label>Sede</Form.Label>
                    <Form.Control
                      value={form.sede}
                      onChange={(event) => handleInputChange(sessionId, 'sede', event.target.value)}
                    />
                  </Col>
                  <Col md={6} lg={3}>
                    <Form.Label>Dirección</Form.Label>
                    <Form.Control
                      value={form.address}
                      onChange={(event) => handleInputChange(sessionId, 'address', event.target.value)}
                    />
                  </Col>
                  <Col md={6} lg={3}>
                    <Form.Label>Sala</Form.Label>
                    <Form.Select
                      value={form.roomId}
                      onChange={(event) => handleInputChange(sessionId, 'roomId', event.target.value)}
                      disabled={roomsQuery.isLoading}
                    >
                      <option value="">Selecciona una sala</option>
                      {rooms.map((room) => (
                        <option key={room.sala_id} value={room.sala_id}>
                          {room.name}
                          {room.sede ? ` — ${room.sede}` : ''}
                        </option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col md={6} lg={3}>
                    <Form.Label>Formador / Bombero</Form.Label>
                    <Form.Select
                      multiple
                      value={form.trainerIds}
                      onChange={(event) => handleTrainerChange(sessionId, event.target.options)}
                      disabled={trainersQuery.isLoading}
                      size={4}
                    >
                      {trainers.map((trainer) => (
                        <option key={trainer.trainer_id} value={trainer.trainer_id}>
                          {formatTrainerName(trainer)}
                        </option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col md={6} lg={3}>
                    <Form.Label>Unidades móviles</Form.Label>
                    <Form.Select
                      multiple
                      value={currentMobileValue}
                      onChange={(event) => handleMobileUnitChange(sessionId, event.target.options)}
                      disabled={mobileUnitsQuery.isLoading}
                      size={4}
                    >
                      <option value={NO_MOBILE_UNIT_VALUE}>Sin unidad móvil</option>
                      {mobileUnits.map((unit) => (
                        <option key={unit.unidad_id} value={unit.unidad_id}>
                          {formatMobileUnit(unit)}
                        </option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col md={6} lg={3}>
                    <Form.Label>Estado</Form.Label>
                    <Form.Select
                      value={status}
                      onChange={(event) => handleStatusChange(sessionId, event.target.value)}
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col xs={12}>
                    <Form.Label>Comentarios</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={form.comment}
                      onChange={(event) => handleInputChange(sessionId, 'comment', event.target.value)}
                    />
                  </Col>
                </Row>

                <div className="session-card-footer">
                  <div>
                    {errorMessage ? (
                      <div className="text-danger small">{errorMessage}</div>
                    ) : null}
                    {showSuccess ? (
                      <div className="text-success small">Sesión guardada correctamente.</div>
                    ) : null}
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => handleSaveSession(sessionId)}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" /> Guardando…
                      </>
                    ) : (
                      'Guardar sesión'
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
