import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Col,
  Form,
  ListGroup,
  Pagination,
  Row,
  Spinner,
} from 'react-bootstrap';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DealProduct } from '../../../types/deal';
import {
  SessionDTO,
  SessionGroupDTO,
  generateSessionsFromDeal,
  fetchActiveTrainers,
  fetchDealSessions,
  fetchMobileUnitsCatalog,
  fetchRoomsCatalog,
  patchSession,
  createSession,
  deleteSession,
  type TrainerOption,
  type RoomOption,
  type MobileUnitOption,
} from '../api';
import { isApiError } from '../api';

const SESSION_LIMIT = 10;
const MADRID_TIMEZONE = 'Europe/Madrid';

const SESSION_CODE_PREFIXES = ['form-', 'ces-', 'prev-', 'pci-'];

type SessionFormState = {
  id: string;
  nombre_cache: string;
  fecha_inicio_local: string | null;
  fecha_fin_local: string | null;
  sala_id: string | null;
  direccion: string;
  comentarios: string | null;
  trainer_ids: string[];
  unidad_movil_ids: string[];
};

type SaveStatus = {
  saving: boolean;
  error: string | null;
  savedAt?: number;
};

function isApplicableProduct(product: DealProduct): product is DealProduct & { id: string } {
  const code = typeof product?.code === 'string' ? product.code.toLowerCase() : '';
  const id = product?.id;
  return Boolean(id) && SESSION_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

function formatDateForInput(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MADRID_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  if (!values.year || !values.month || !values.day || !values.hour || !values.minute) {
    return null;
  }
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function getTimeZoneOffset(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  const utcTime = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return utcTime - date.getTime();
}

function localInputToUtc(value: string | null): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const baseDate = new Date(Date.UTC(year, monthIndex, day, hour, minute, 0));
  if (!Number.isFinite(baseDate.getTime())) return undefined;
  const offset = getTimeZoneOffset(baseDate, MADRID_TIMEZONE);
  return new Date(baseDate.getTime() - offset).toISOString();
}

function mapSessionToForm(session: SessionDTO): SessionFormState {
  return {
    id: session.id,
    nombre_cache: session.nombre_cache,
    fecha_inicio_local: formatDateForInput(session.fecha_inicio_utc),
    fecha_fin_local: formatDateForInput(session.fecha_fin_utc),
    sala_id: session.sala_id ?? null,
    direccion: session.direccion ?? '',
    comentarios: session.comentarios ?? null,
    trainer_ids: Array.isArray(session.trainer_ids) ? [...session.trainer_ids] : [],
    unidad_movil_ids: Array.isArray(session.unidad_movil_ids) ? [...session.unidad_movil_ids] : [],
  };
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function buildSessionPatchPayload(
  form: SessionFormState,
  saved: SessionFormState | undefined,
): Parameters<typeof patchSession>[1] | null | 'INVALID_DATES' | 'INVALID_START' | 'INVALID_END' {
  if (!saved) {
    return {
      fecha_inicio_utc: localInputToUtc(form.fecha_inicio_local) ?? null,
      fecha_fin_utc: localInputToUtc(form.fecha_fin_local) ?? null,
      sala_id: form.sala_id,
      direccion: form.direccion,
      comentarios: form.comentarios,
      trainer_ids: form.trainer_ids,
      unidad_movil_ids: form.unidad_movil_ids,
    };
  }

  const patch: Parameters<typeof patchSession>[1] = {};
  let hasChanges = false;

  const startIso = localInputToUtc(form.fecha_inicio_local ?? null);
  if (startIso === undefined && form.fecha_inicio_local) return 'INVALID_START';
  const endIso = localInputToUtc(form.fecha_fin_local ?? null);
  if (endIso === undefined && form.fecha_fin_local) return 'INVALID_END';

  if (form.fecha_inicio_local !== saved.fecha_inicio_local) {
    patch.fecha_inicio_utc = startIso ?? null;
    hasChanges = true;
  }

  if (form.fecha_fin_local !== saved.fecha_fin_local) {
    patch.fecha_fin_utc = endIso ?? null;
    hasChanges = true;
  }

  const effectiveStart =
    patch.fecha_inicio_utc !== undefined ? patch.fecha_inicio_utc : localInputToUtc(saved.fecha_inicio_local);
  const effectiveEnd =
    patch.fecha_fin_utc !== undefined ? patch.fecha_fin_utc : localInputToUtc(saved.fecha_fin_local);
  if (effectiveStart && effectiveEnd && new Date(effectiveEnd).getTime() < new Date(effectiveStart).getTime()) {
    return 'INVALID_DATES';
  }

  if (form.sala_id !== saved.sala_id) {
    patch.sala_id = form.sala_id ?? null;
    hasChanges = true;
  }

  if (form.direccion !== saved.direccion) {
    patch.direccion = form.direccion ?? '';
    hasChanges = true;
  }

  if (form.comentarios !== saved.comentarios) {
    patch.comentarios = form.comentarios ?? null;
    hasChanges = true;
  }

  if (!areStringArraysEqual(form.trainer_ids, saved.trainer_ids)) {
    patch.trainer_ids = [...form.trainer_ids];
    hasChanges = true;
  }

  if (!areStringArraysEqual(form.unidad_movil_ids, saved.unidad_movil_ids)) {
    patch.unidad_movil_ids = [...form.unidad_movil_ids];
    hasChanges = true;
  }

  if (!hasChanges) return null;

  return patch;
}

function sortOptionsByName<T extends { name: string }>(options: T[]): T[] {
  return [...options].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

interface SessionsAccordionProps {
  dealId: string;
  dealAddress: string | null;
  products: DealProduct[];
}

export function SessionsAccordion({ dealId, dealAddress, products }: SessionsAccordionProps) {
  const qc = useQueryClient();

  const applicableProducts = useMemo(() =>
    products.filter(isApplicableProduct).map((product) => ({
      id: String(product.id),
      name: product.name ?? null,
      code: product.code ?? null,
      quantity:
        typeof product.quantity === 'number'
          ? product.quantity
          : product.quantity != null
          ? Number(product.quantity)
          : 0,
    })),
  [products]);

  const shouldShow = applicableProducts.length > 0;

  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationDone, setGenerationDone] = useState(false);

  const generateMutation = useMutation({
    mutationFn: (id: string) => generateSessionsFromDeal(id),
    onSuccess: () => {
      setGenerationDone(true);
      setGenerationError(null);
    },
    onError: (error: unknown) => {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudieron generar las sesiones';
      setGenerationError(message);
      setGenerationDone(true);
    },
  });

  useEffect(() => {
    setGenerationError(null);
    setGenerationDone(false);
    if (shouldShow && dealId) {
      generateMutation.mutate(dealId);
    }
  }, [dealId, shouldShow]);

  const [pageByProduct, setPageByProduct] = useState<Record<string, number>>({});

  useEffect(() => {
    setPageByProduct((current) => {
      const next: Record<string, number> = {};
      for (const product of applicableProducts) {
        next[product.id] = current[product.id] ?? 1;
      }
      return next;
    });
  }, [applicableProducts]);

  const trainersQuery = useQuery({
    queryKey: ['trainers', 'active'],
    queryFn: fetchActiveTrainers,
    enabled: shouldShow,
    staleTime: 5 * 60 * 1000,
  });

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'catalog'],
    queryFn: fetchRoomsCatalog,
    enabled: shouldShow,
    staleTime: 5 * 60 * 1000,
  });

  const unitsQuery = useQuery({
    queryKey: ['mobile-units', 'catalog'],
    queryFn: fetchMobileUnitsCatalog,
    enabled: shouldShow,
    staleTime: 5 * 60 * 1000,
  });

  const sessionQueries = useQueries({
    queries: applicableProducts.map((product) => {
      const currentPage = pageByProduct[product.id] ?? 1;
      return {
        queryKey: ['dealSessions', dealId, product.id, currentPage, SESSION_LIMIT],
        queryFn: async () => {
          const groups = await fetchDealSessions(dealId, {
            productId: product.id,
            page: currentPage,
            limit: SESSION_LIMIT,
          });
          return groups[0] ?? null;
        },
        enabled: shouldShow && generationDone,
        staleTime: 0,
        refetchOnWindowFocus: false,
      };
    }),
  });

  const formsRef = useRef<Record<string, SessionFormState>>({});
  const [forms, setForms] = useState<Record<string, SessionFormState>>({});
  const lastSavedRef = useRef<Record<string, SessionFormState>>({});
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sessionProductRef = useRef<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});

  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

  const queriesUpdatedKey = sessionQueries.map((query) => query.dataUpdatedAt).join('|');

  useEffect(() => {
    if (!generationDone) return;
    const nextForms: Record<string, SessionFormState> = {};
    const nextSaved: Record<string, SessionFormState> = {};
    const productMap: Record<string, string> = {};

    sessionQueries.forEach((query, index) => {
      const group = query.data as SessionGroupDTO | null;
      if (!group) return;
      const product = applicableProducts[index];
      const productId = product?.id ?? group.product.id;
      group.sessions.forEach((session) => {
        const form = mapSessionToForm(session);
        nextForms[session.id] = form;
        nextSaved[session.id] = form;
        productMap[session.id] = productId;
      });
    });

    formsRef.current = nextForms;
    lastSavedRef.current = nextSaved;
    sessionProductRef.current = productMap;
    setForms(nextForms);
    setSaveStatus((current) => {
      const next: Record<string, SaveStatus> = {};
      for (const [sessionId, status] of Object.entries(current)) {
        if (nextForms[sessionId]) {
          next[sessionId] = { ...status, error: null };
        }
      }
      return next;
    });

    for (const [sessionId, timer] of Object.entries(saveTimersRef.current)) {
      if (!nextForms[sessionId]) {
        clearTimeout(timer);
        delete saveTimersRef.current[sessionId];
      }
    }
  }, [generationDone, queriesUpdatedKey, applicableProducts]);

  const patchMutation = useMutation({
    mutationFn: ({ sessionId, payload }: { sessionId: string; payload: Parameters<typeof patchSession>[1] }) =>
      patchSession(sessionId, payload),
  });

  const createMutation = useMutation({
    mutationFn: (input: {
      deal_id: string;
      deal_product_id: string;
      direccion?: string | null;
      comentarios?: string | null;
      trainer_ids?: string[];
      unidad_movil_ids?: string[];
      sala_id?: string | null;
    }) =>
      createSession({
        ...input,
        fecha_inicio_utc: null,
        fecha_fin_utc: null,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
  });

  const scheduleSave = (sessionId: string) => {
    if (!formsRef.current[sessionId]) return;
    if (saveTimersRef.current[sessionId]) {
      clearTimeout(saveTimersRef.current[sessionId]);
    }
    saveTimersRef.current[sessionId] = setTimeout(() => {
      runSave(sessionId);
    }, 600);
  };

  const runSave = async (sessionId: string) => {
    const form = formsRef.current[sessionId];
    const saved = lastSavedRef.current[sessionId];
    if (!form) return;

    const patchResult = buildSessionPatchPayload(form, saved);
    if (patchResult === null) return;
    if (patchResult === 'INVALID_START') {
      setSaveStatus((current) => ({
        ...current,
        [sessionId]: { saving: false, error: 'Fecha de inicio inválida' },
      }));
      return;
    }
    if (patchResult === 'INVALID_END') {
      setSaveStatus((current) => ({
        ...current,
        [sessionId]: { saving: false, error: 'Fecha de fin inválida' },
      }));
      return;
    }
    if (patchResult === 'INVALID_DATES') {
      setSaveStatus((current) => ({
        ...current,
        [sessionId]: { saving: false, error: 'Fin no puede ser anterior al inicio' },
      }));
      return;
    }

    const payload = patchResult;

    setSaveStatus((current) => ({
      ...current,
      [sessionId]: { saving: true, error: null },
    }));

    try {
      const updated = await patchMutation.mutateAsync({ sessionId, payload });
      const updatedForm = mapSessionToForm(updated);
      formsRef.current[sessionId] = updatedForm;
      lastSavedRef.current[sessionId] = updatedForm;
      setForms((current) => ({ ...current, [sessionId]: updatedForm }));
      setSaveStatus((current) => ({
        ...current,
        [sessionId]: { saving: false, error: null, savedAt: Date.now() },
      }));
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo guardar la sesión';
      setSaveStatus((current) => ({
        ...current,
        [sessionId]: { saving: false, error: message },
      }));
      // restaura valores previos para evitar inconsistencias
      setForms((current) => ({ ...current, [sessionId]: saved ?? form }));
      formsRef.current[sessionId] = saved ?? form;
    }
  };

  const handleFieldChange = (sessionId: string, updater: (current: SessionFormState) => SessionFormState) => {
    setForms((current) => {
      const existing = current[sessionId];
      if (!existing) return current;
      const next = updater(existing);
      const nextMap = { ...current, [sessionId]: next };
      formsRef.current = nextMap;
      return nextMap;
    });
    setSaveStatus((current) => ({
      ...current,
      [sessionId]: { saving: false, error: null },
    }));
    scheduleSave(sessionId);
  };

  const invalidateProductSessions = async (productId: string) => {
    const currentPage = pageByProduct[productId] ?? 1;
    await qc.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === 'dealSessions' && key[1] === dealId && key[2] === productId;
      },
    });
  };

  const handleDuplicate = async (sessionId: string) => {
    const session = formsRef.current[sessionId];
    const productId = sessionProductRef.current[sessionId];
    if (!session || !productId) return;
    try {
      await createMutation.mutateAsync({
        deal_id: dealId,
        deal_product_id: productId,
        direccion: session.direccion ?? dealAddress ?? '',
        comentarios: session.comentarios ?? null,
        trainer_ids: session.trainer_ids,
        unidad_movil_ids: session.unidad_movil_ids,
        sala_id: session.sala_id,
      });
      await invalidateProductSessions(productId);
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo duplicar la sesión';
      alert(message);
    }
  };

  const handleDelete = async (sessionId: string) => {
    const productId = sessionProductRef.current[sessionId];
    if (!productId) return;
    if (!window.confirm('¿Seguro que quieres eliminar esta sesión?')) return;
    try {
      await deleteMutation.mutateAsync(sessionId);
      await invalidateProductSessions(productId);
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo eliminar la sesión';
      alert(message);
    }
  };

  if (!shouldShow) return null;

  const trainers = trainersQuery.data ? sortOptionsByName(trainersQuery.data) : [];
  const rooms = roomsQuery.data ? sortOptionsByName(roomsQuery.data) : [];
  const units = unitsQuery.data ? sortOptionsByName(unitsQuery.data) : [];

  return (
    <Accordion.Item eventKey="sessions">
      <Accordion.Header>
        <div className="d-flex justify-content-between align-items-center w-100">
          <span className="erp-accordion-title">Sesiones</span>
          <Badge bg="secondary">{applicableProducts.length}</Badge>
        </div>
      </Accordion.Header>
      <Accordion.Body>
        {!generationDone && (
          <div className="d-flex align-items-center gap-2 mb-3">
            <Spinner animation="border" size="sm" /> Generando sesiones…
          </div>
        )}
        {generationError && (
          <Alert variant="danger" className="mb-3">
            {generationError}
          </Alert>
        )}
        {generationDone && !generationError && applicableProducts.length === 0 && (
          <p className="text-muted mb-0">No hay sesiones configurables para este presupuesto.</p>
        )}
        {generationDone && !generationError && applicableProducts.map((product, index) => {
          const query = sessionQueries[index];
          const group = (query?.data as SessionGroupDTO | null) ?? null;
          const sessions = group?.sessions ?? [];
          const pagination = group?.pagination ?? { page: 1, totalPages: 1, total: 0 };
          const currentPage = pageByProduct[product.id] ?? 1;
          const isLoading = query.isLoading || query.isFetching;
          const queryError = query.error;

          return (
            <div key={product.id} className="mb-4">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div>
                  <h5 className="mb-1">{product.name ?? product.code ?? 'Producto'}</h5>
                  <div className="text-muted small">Total sesiones: {pagination.total}</div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => {
                      createMutation
                        .mutateAsync({
                          deal_id: dealId,
                          deal_product_id: product.id,
                          direccion: dealAddress ?? '',
                        })
                        .then(() => invalidateProductSessions(product.id))
                        .catch((error: unknown) => {
                          const message = isApiError(error)
                            ? error.message
                            : error instanceof Error
                            ? error.message
                            : 'No se pudo crear la sesión';
                          alert(message);
                        });
                    }}
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? (
                      <Spinner size="sm" animation="border" />
                    ) : (
                      'Añadir sesión'
                    )}
                  </Button>
                </div>
              </div>
              {isLoading && (
                <div className="d-flex align-items-center gap-2 mb-2">
                  <Spinner animation="border" size="sm" /> Cargando sesiones…
                </div>
              )}
              {queryError && (
                <Alert variant="danger">
                  {queryError instanceof Error ? queryError.message : 'No se pudieron cargar las sesiones'}
                </Alert>
              )}
              {!isLoading && !queryError && !sessions.length && (
                <p className="text-muted">Sin sesiones para este producto.</p>
              )}
              <div className="d-flex flex-column gap-3">
                {sessions.map((session) => {
                  const form = forms[session.id];
                  const status = saveStatus[session.id] ?? { saving: false, error: null };
                  if (!form) return null;
                  return (
                    <SessionEditor
                      key={session.id}
                      form={form}
                      status={status}
                      trainers={trainers}
                      rooms={rooms}
                      units={units}
                      onChange={(updater) => handleFieldChange(session.id, updater)}
                      onDuplicate={() => handleDuplicate(session.id)}
                      onDelete={() => handleDelete(session.id)}
                    />
                  );
                })}
              </div>
              {pagination.totalPages > 1 && (
                <div className="d-flex justify-content-center mt-3">
                  <Pagination size="sm">
                    <Pagination.Prev
                      disabled={currentPage <= 1}
                      onClick={() =>
                        setPageByProduct((current) => ({ ...current, [product.id]: Math.max(1, currentPage - 1) }))
                      }
                    />
                    <Pagination.Item active>{currentPage}</Pagination.Item>
                    <Pagination.Next
                      disabled={currentPage >= pagination.totalPages}
                      onClick={() =>
                        setPageByProduct((current) => ({
                          ...current,
                          [product.id]: Math.min(pagination.totalPages, currentPage + 1),
                        }))
                      }
                    />
                  </Pagination>
                </div>
              )}
            </div>
          );
        })}
      </Accordion.Body>
    </Accordion.Item>
  );
}

interface SessionEditorProps {
  form: SessionFormState;
  status: SaveStatus;
  trainers: TrainerOption[];
  rooms: RoomOption[];
  units: MobileUnitOption[];
  onChange: (updater: (current: SessionFormState) => SessionFormState) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function SessionEditor({
  form,
  status,
  trainers,
  rooms,
  units,
  onChange,
  onDuplicate,
  onDelete,
}: SessionEditorProps) {
  const [trainerFilter, setTrainerFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');

  const filteredTrainers = useMemo(() => {
    const search = trainerFilter.trim().toLowerCase();
    if (!search) return trainers;
    return trainers.filter((trainer) => {
      const label = `${trainer.name} ${trainer.apellido ?? ''}`.toLowerCase();
      return label.includes(search);
    });
  }, [trainerFilter, trainers]);

  const filteredUnits = useMemo(() => {
    const search = unitFilter.trim().toLowerCase();
    if (!search) return units;
    return units.filter((unit) => {
      const label = `${unit.name} ${unit.matricula ?? ''}`.toLowerCase();
      return label.includes(search);
    });
  }, [unitFilter, units]);

  return (
    <div className="border rounded p-3">
      <Row className="g-3">
        <Col md={6} lg={4}>
          <Form.Group controlId={`session-${form.id}-nombre`}>
            <Form.Label>Nombre</Form.Label>
            <Form.Control value={form.nombre_cache} readOnly />
          </Form.Group>
        </Col>
        <Col md={6} lg={4}>
          <Form.Group controlId={`session-${form.id}-inicio`}>
            <Form.Label>Fecha inicio</Form.Label>
            <Form.Control
              type="datetime-local"
              value={form.fecha_inicio_local ?? ''}
              onChange={(event) =>
                onChange((current) => ({ ...current, fecha_inicio_local: event.target.value || null }))
              }
            />
          </Form.Group>
        </Col>
        <Col md={6} lg={4}>
          <Form.Group controlId={`session-${form.id}-fin`}>
            <Form.Label>Fecha fin</Form.Label>
            <Form.Control
              type="datetime-local"
              value={form.fecha_fin_local ?? ''}
              onChange={(event) =>
                onChange((current) => ({ ...current, fecha_fin_local: event.target.value || null }))
              }
            />
          </Form.Group>
        </Col>
        <Col md={6} lg={4}>
          <Form.Group controlId={`session-${form.id}-sala`}>
            <Form.Label>Sala</Form.Label>
            <Form.Select
              value={form.sala_id ?? ''}
              onChange={(event) =>
                onChange((current) => ({ ...current, sala_id: event.target.value || null }))
              }
            >
              <option value="">Sin sala asignada</option>
              {rooms.map((room) => (
                <option key={room.sala_id} value={room.sala_id}>
                  {room.name} {room.sede ? `(${room.sede})` : ''}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={12} lg={8}>
          <Form.Group controlId={`session-${form.id}-direccion`}>
            <Form.Label>Dirección</Form.Label>
            <div className="d-flex gap-2">
              <Form.Control
                value={form.direccion}
                onChange={(event) =>
                  onChange((current) => ({ ...current, direccion: event.target.value ?? '' }))
                }
              />
              <Button
                variant="outline-primary"
                onClick={() => {
                  if (form.direccion.trim()) {
                    window.open(
                      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.direccion)}`,
                      '_blank',
                      'noopener,noreferrer',
                    );
                  }
                }}
                disabled={!form.direccion.trim()}
              >
                Ver
              </Button>
            </div>
          </Form.Group>
        </Col>
        <Col md={12}>
          <Form.Group controlId={`session-${form.id}-comentarios`}>
            <Form.Label>Comentarios</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={form.comentarios ?? ''}
              onChange={(event) =>
                onChange((current) => ({ ...current, comentarios: event.target.value || null }))
              }
            />
          </Form.Group>
        </Col>
      </Row>

      <Row className="g-3 mt-1">
        <Col md={6}>
          <Form.Group controlId={`session-${form.id}-trainers`}>
            <Form.Label>Formadores / Bomberos</Form.Label>
            <Form.Control
              type="search"
              placeholder="Buscar"
              value={trainerFilter}
              onChange={(event) => setTrainerFilter(event.target.value)}
              className="mb-2"
            />
            <div className="border rounded overflow-auto" style={{ maxHeight: 160 }}>
              <ListGroup variant="flush">
                {filteredTrainers.map((trainer) => {
                  const label = `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`;
                  const checked = form.trainer_ids.includes(trainer.trainer_id);
                  return (
                    <ListGroup.Item key={trainer.trainer_id} className="py-1">
                      <Form.Check
                        type="checkbox"
                        label={label}
                        checked={checked}
                        onChange={(event) =>
                          onChange((current) => {
                            const set = new Set(current.trainer_ids);
                            if (event.target.checked) {
                              set.add(trainer.trainer_id);
                            } else {
                              set.delete(trainer.trainer_id);
                            }
                            return { ...current, trainer_ids: Array.from(set) };
                          })
                        }
                      />
                    </ListGroup.Item>
                  );
                })}
                {!filteredTrainers.length && (
                  <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                )}
              </ListGroup>
            </div>
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group controlId={`session-${form.id}-units`}>
            <Form.Label>Unidades móviles</Form.Label>
            <Form.Control
              type="search"
              placeholder="Buscar"
              value={unitFilter}
              onChange={(event) => setUnitFilter(event.target.value)}
              className="mb-2"
            />
            <div className="border rounded overflow-auto" style={{ maxHeight: 160 }}>
              <ListGroup variant="flush">
                {filteredUnits.map((unit) => {
                  const label = unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name;
                  const checked = form.unidad_movil_ids.includes(unit.unidad_id);
                  return (
                    <ListGroup.Item key={unit.unidad_id} className="py-1">
                      <Form.Check
                        type="checkbox"
                        label={label}
                        checked={checked}
                        onChange={(event) =>
                          onChange((current) => {
                            const set = new Set(current.unidad_movil_ids);
                            if (event.target.checked) {
                              set.add(unit.unidad_id);
                            } else {
                              set.delete(unit.unidad_id);
                            }
                            return { ...current, unidad_movil_ids: Array.from(set) };
                          })
                        }
                      />
                    </ListGroup.Item>
                  );
                })}
                {!filteredUnits.length && (
                  <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                )}
              </ListGroup>
            </div>
          </Form.Group>
        </Col>
      </Row>

      <div className="d-flex justify-content-between align-items-center mt-3">
        <div className="d-flex align-items-center gap-2">
          <Button variant="outline-primary" size="sm" onClick={onDuplicate}>
            Duplicar sesión
          </Button>
          <Button variant="outline-danger" size="sm" onClick={onDelete}>
            Eliminar
          </Button>
        </div>
        <div className="text-end">
          {status.saving ? (
            <span className="text-primary d-flex align-items-center gap-2">
              <Spinner size="sm" animation="border" /> Guardando…
            </span>
          ) : status.error ? (
            <span className="text-danger">{status.error}</span>
          ) : status.savedAt ? (
            <span className="text-success">Guardado ✓</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
