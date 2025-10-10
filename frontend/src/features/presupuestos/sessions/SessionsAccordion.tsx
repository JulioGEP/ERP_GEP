import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Accordion,
  Alert,
  Button,
  Collapse,
  Col,
  Form,
  ListGroup,
  Modal,
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
  fetchSessionAvailability,
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

const ALWAYS_AVAILABLE_UNIT_IDS = new Set(['52377f13-05dd-4830-88aa-0f5c78bee750']);

function DuplicateIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <rect x={7} y={7} width={11} height={11} rx={2.2} ry={2.2} />
      <path d="M5.5 15.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.6" />
    </svg>
  );
}

function DeleteIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M5 7h14" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M9.5 11.5v5" />
      <path d="M14.5 11.5v5" />
      <path d="M7.5 7l.7 11a2 2 0 0 0 2 1.9h3.6a2 2 0 0 0 2-1.9l.7-11" />
    </svg>
  );
}

type SessionActionIconProps = {
  label: string;
  onActivate: () => void;
  children: ReactNode;
  variant?: 'default' | 'danger';
};

function SessionActionIcon({ label, onActivate, children, variant = 'default' }: SessionActionIconProps) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    }
  };

  return (
    <span
      role="button"
      aria-label={label}
      title={label}
      tabIndex={0}
      className={`session-action-icon${variant === 'danger' ? ' danger' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </span>
  );
}

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

type IsoRange = {
  startIso: string;
  endIso?: string;
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

function buildIsoRangeFromInputs(
  startInput: string | null,
  endInput: string | null,
): IsoRange | null {
  const startIso = localInputToUtc(startInput ?? null);
  if (typeof startIso !== 'string') {
    return null;
  }

  const endIso = localInputToUtc(endInput ?? null);
  if (endIso === undefined) {
    return null;
  }

  if (typeof endIso === 'string') {
    const startTime = new Date(startIso).getTime();
    const endTime = new Date(endIso).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
      return null;
    }
    return { startIso, endIso };
  }

  return { startIso };
}

function addHoursToLocalDateTime(value: string, hours: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!Number.isFinite(hours)) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const baseDate = new Date(year, monthIndex, day, hour, minute, 0, 0);
  if (!Number.isFinite(baseDate.getTime())) return null;
  const minutesToAdd = Math.round(hours * 60);
  if (!Number.isFinite(minutesToAdd)) return null;
  baseDate.setMinutes(baseDate.getMinutes() + minutesToAdd);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${baseDate.getFullYear()}-${pad(baseDate.getMonth() + 1)}-${pad(baseDate.getDate())}T${pad(
    baseDate.getHours(),
  )}:${pad(baseDate.getMinutes())}`;
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
      nombre_cache: form.nombre_cache,
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

  if (form.nombre_cache !== saved.nombre_cache) {
    patch.nombre_cache = form.nombre_cache;
    hasChanges = true;
  }

  if (!hasChanges) return null;

  return patch;
}

function sortOptionsByName<T extends { name: string }>(options: T[]): T[] {
  return [...options].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

type SessionTimeRange = {
  startMs: number;
  endMs: number;
};

function getSessionRangeFromForm(form: SessionFormState): SessionTimeRange | null {
  const range = buildIsoRangeFromInputs(form.fecha_inicio_local, form.fecha_fin_local);
  if (!range || !range.endIso) {
    return null;
  }

  const startMs = new Date(range.startIso).getTime();
  const endMs = new Date(range.endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }

  return { startMs, endMs };
}

function rangesOverlap(a: SessionTimeRange, b: SessionTimeRange): boolean {
  return a.startMs <= b.endMs && b.startMs <= a.endMs;
}

interface SessionsAccordionProps {
  dealId: string;
  dealAddress: string | null;
  products: DealProduct[];
}

export function SessionsAccordion({ dealId, dealAddress, products }: SessionsAccordionProps) {
  const qc = useQueryClient();

  const applicableProducts = useMemo(
    () =>
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
        hours:
          typeof product.hours === 'number'
            ? product.hours
            : product.hours != null
            ? Number(product.hours)
            : null,
      })),
    [products],
  );

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
  const [activeSession, setActiveSession] = useState<
    | {
        sessionId: string;
        productId: string;
        productName: string;
        displayIndex: number;
      }
    | null
  >(null);

  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

  const queriesUpdatedKey = sessionQueries.map((query) => query.dataUpdatedAt).join('|');

  const totalSessionsCount = generationDone
    ? sessionQueries.reduce((total, query) => {
        const group = (query.data as SessionGroupDTO | null) ?? null;
        const pagination = group?.pagination;
        return total + (pagination?.total ?? 0);
      }, 0)
    : 0;

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
      setActiveSession((current) => (current?.sessionId === sessionId ? null : current));
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
        ? error.message
        : 'No se pudo eliminar la sesión';
      alert(message);
    }
  };

  const activeForm = activeSession ? forms[activeSession.sessionId] ?? null : null;
  const activeProductHours = activeSession
    ? (() => {
        const directProduct = applicableProducts.find((product) => product.id === activeSession.productId);
        if (directProduct && typeof directProduct.hours === 'number' && Number.isFinite(directProduct.hours)) {
          return directProduct.hours;
        }
        const fallbackProductId = sessionProductRef.current[activeSession.sessionId];
        if (!fallbackProductId) return null;
        const fallbackProduct = applicableProducts.find((product) => product.id === fallbackProductId);
        if (fallbackProduct && typeof fallbackProduct.hours === 'number' && Number.isFinite(fallbackProduct.hours)) {
          return fallbackProduct.hours;
        }
        return null;
      })()
    : null;

  useEffect(() => {
    if (activeSession && !forms[activeSession.sessionId]) {
      setActiveSession(null);
    }
  }, [activeSession, forms]);

  if (!shouldShow) return null;

  const trainers = trainersQuery.data ? sortOptionsByName(trainersQuery.data) : [];
  const rooms = roomsQuery.data ? sortOptionsByName(roomsQuery.data) : [];
  const units = unitsQuery.data ? sortOptionsByName(unitsQuery.data) : [];
  const activeStatus = activeSession
    ? saveStatus[activeSession.sessionId] ?? { saving: false, error: null }
    : { saving: false, error: null };

  return (
    <Accordion.Item eventKey="sessions">
      <Accordion.Header>
        <div className="d-flex justify-content-between align-items-center w-100">
          <span className="erp-accordion-title">
            Sesiones
            {totalSessionsCount > 0 ? (
              <span className="erp-accordion-count">{totalSessionsCount}</span>
            ) : null}
          </span>
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
              {!!sessions.length && (
                <ListGroup as="ol" numbered className="mb-0">
                  {sessions.map((session, sessionIndex) => {
                    const form = forms[session.id];
                    const status = saveStatus[session.id] ?? { saving: false, error: null };
                    if (!form) return null;
                    const displayIndex = ((pagination.page ?? currentPage) - 1) * SESSION_LIMIT + sessionIndex + 1;
                    const productName = product.name ?? product.code ?? 'Producto';
                    return (
                      <ListGroup.Item
                        key={session.id}
                        as="li"
                        action
                        value={displayIndex}
                        className="session-list-item d-flex justify-content-between align-items-center gap-3"
                        onClick={() =>
                          setActiveSession({
                            sessionId: session.id,
                            productId: product.id,
                            productName,
                            displayIndex,
                          })
                        }
                      >
                        <div
                          className="flex-grow-1 me-3"
                          title={form.nombre_cache?.trim() || `Sesión ${displayIndex}`}
                        >
                          <div className="fw-semibold text-truncate">
                            {form.nombre_cache?.trim() || `Sesión ${displayIndex}`}
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-3">
                          <div className="session-item-actions d-inline-flex align-items-center gap-2">
                            <SessionActionIcon
                              label="Duplicar sesión"
                              onActivate={() => handleDuplicate(session.id)}
                            >
                              <DuplicateIcon aria-hidden="true" />
                            </SessionActionIcon>
                            <SessionActionIcon
                              label="Eliminar sesión"
                              variant="danger"
                              onActivate={() => handleDelete(session.id)}
                            >
                              <DeleteIcon aria-hidden="true" />
                            </SessionActionIcon>
                          </div>
                          <div className="text-end small text-nowrap">
                            {status.saving ? (
                              <span className="text-primary d-inline-flex align-items-center gap-1">
                                <Spinner animation="border" size="sm" /> Guardando…
                              </span>
                            ) : status.error ? (
                              <span className="text-danger">Error al guardar</span>
                            ) : status.savedAt ? (
                              <span className="text-success">Actualizado</span>
                            ) : (
                              <span className="text-muted">Sin cambios</span>
                            )}
                          </div>
                        </div>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}
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
        {activeSession && (
          <Modal
            show={Boolean(activeForm)}
            onHide={() => setActiveSession(null)}
            size="lg"
            centered
            scrollable
            contentClassName="session-modal"
          >
            <Modal.Header closeButton closeVariant="white" className="border-0">
              <Modal.Title className="session-modal-title">
                {activeForm?.nombre_cache?.trim() || `Sesión ${activeSession.displayIndex}`}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {activeForm ? (
                <SessionEditor
                  form={activeForm}
                  status={activeStatus}
                  trainers={trainers}
                  rooms={rooms}
                  units={units}
                  defaultDurationHours={activeProductHours}
                  allForms={forms}
                  onChange={(updater) => handleFieldChange(activeSession.sessionId, updater)}
                />
              ) : (
                <p className="text-muted mb-0">No se pudo cargar la sesión seleccionada.</p>
              )}
            </Modal.Body>
          </Modal>
        )}
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
  defaultDurationHours: number | null;
  allForms: Record<string, SessionFormState>;
  onChange: (updater: (current: SessionFormState) => SessionFormState) => void;
}

function SessionEditor({
  form,
  status,
  trainers,
  rooms,
  units,
  defaultDurationHours,
  allForms,
  onChange,
}: SessionEditorProps) {
  const [trainerFilter, setTrainerFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [trainerListOpen, setTrainerListOpen] = useState(false);
  const [unitListOpen, setUnitListOpen] = useState(false);
  const trainerFieldRef = useRef<HTMLDivElement | null>(null);
  const unitFieldRef = useRef<HTMLDivElement | null>(null);

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

  const selectedTrainers = useMemo(() => {
    const selected = new Set(form.trainer_ids);
    return trainers.filter((trainer) => selected.has(trainer.trainer_id));
  }, [form.trainer_ids, trainers]);

  const selectedUnits = useMemo(() => {
    const selected = new Set(form.unidad_movil_ids);
    return units.filter((unit) => selected.has(unit.unidad_id));
  }, [form.unidad_movil_ids, units]);

  const trainerSummary = selectedTrainers
    .map((trainer) => `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`)
    .join(', ');
  const unitSummary = selectedUnits
    .map((unit) => (unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name))
    .join(', ');

  const availabilityRange = useMemo(
    () => buildIsoRangeFromInputs(form.fecha_inicio_local, form.fecha_fin_local),
    [form.fecha_inicio_local, form.fecha_fin_local],
  );

  const availabilityQuery = useQuery({
    queryKey: availabilityRange
      ? ['session-availability', form.id, availabilityRange.startIso, availabilityRange.endIso]
      : ['session-availability', form.id, 'no-range'],
    queryFn: () =>
      fetchSessionAvailability({
        start: availabilityRange!.startIso,
        end: availabilityRange!.endIso,
        excludeSessionId: form.id,
      }),
    enabled: Boolean(availabilityRange),
    staleTime: 60_000,
  });

  const availabilityError =
    availabilityQuery.error instanceof Error ? availabilityQuery.error : null;
  const availabilityFetching = availabilityQuery.isFetching;

  const localLocks = useMemo(() => {
    const currentRange = getSessionRangeFromForm(form);
    if (!currentRange) {
      return {
        trainers: new Set<string>(),
        rooms: new Set<string>(),
        units: new Set<string>(),
      };
    }

    const trainerSet = new Set<string>();
    const roomSet = new Set<string>();
    const unitSet = new Set<string>();

    for (const [sessionId, otherForm] of Object.entries(allForms)) {
      if (sessionId === form.id) continue;
      const otherRange = getSessionRangeFromForm(otherForm);
      if (!otherRange) continue;
      if (!rangesOverlap(currentRange, otherRange)) continue;
      otherForm.trainer_ids.forEach((trainerId) => trainerSet.add(trainerId));
      if (otherForm.sala_id) roomSet.add(otherForm.sala_id);
      otherForm.unidad_movil_ids.forEach((unidadId) => unitSet.add(unidadId));
    }

    return { trainers: trainerSet, rooms: roomSet, units: unitSet };
  }, [allForms, form.id, form.fecha_fin_local, form.fecha_inicio_local]);

  const availability = availabilityQuery.data;

  const blockedTrainers = useMemo(() => {
    const set = new Set<string>();
    localLocks.trainers.forEach((id) => set.add(id));
    availability?.trainers?.forEach((id) => set.add(id));
    return set;
  }, [availability, localLocks]);

  const blockedRooms = useMemo(() => {
    const set = new Set<string>();
    localLocks.rooms.forEach((id) => set.add(id));
    availability?.rooms?.forEach((id) => set.add(id));
    return set;
  }, [availability, localLocks]);

  const blockedUnits = useMemo(() => {
    const set = new Set<string>();
    localLocks.units.forEach((id) => {
      if (!ALWAYS_AVAILABLE_UNIT_IDS.has(id)) {
        set.add(id);
      }
    });
    availability?.units?.forEach((id) => {
      if (!ALWAYS_AVAILABLE_UNIT_IDS.has(id)) {
        set.add(id);
      }
    });
    return set;
  }, [availability, localLocks]);

  const hasDateRange = Boolean(availabilityRange);
  const roomWarningVisible = hasDateRange && blockedRooms.size > 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trainerFieldRef.current && !trainerFieldRef.current.contains(target)) {
        setTrainerListOpen(false);
      }
      if (unitFieldRef.current && !unitFieldRef.current.contains(target)) {
        setUnitListOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setTrainerListOpen(false);
    setUnitListOpen(false);
  }, [form.id]);

  return (
    <div className="session-editor bg-white rounded-3 p-3">
      <Row className="g-3">
        <Col md={6} lg={4}>
          <Form.Group controlId={`session-${form.id}-nombre`}>
            <Form.Label>Nombre</Form.Label>
            <Form.Control
              value={form.nombre_cache}
              placeholder="Introduce el nombre de la sesión"
              onChange={(event) =>
                onChange((current) => ({ ...current, nombre_cache: event.target.value }))
              }
            />
          </Form.Group>
        </Col>
        <Col md={6} lg={4}>
          <Form.Group controlId={`session-${form.id}-inicio`}>
            <Form.Label>Fecha inicio</Form.Label>
            <Form.Control
              type="datetime-local"
              value={form.fecha_inicio_local ?? ''}
              onChange={(event) => {
                const rawValue = event.target.value ?? '';
                const normalizedValue = rawValue.trim() ? rawValue : null;
                const durationHours =
                  typeof defaultDurationHours === 'number' &&
                  Number.isFinite(defaultDurationHours) &&
                  defaultDurationHours > 0
                    ? defaultDurationHours
                    : null;
                onChange((current) => {
                  const next: SessionFormState = { ...current, fecha_inicio_local: normalizedValue };
                  if (normalizedValue && durationHours !== null) {
                    const computedEnd = addHoursToLocalDateTime(normalizedValue, durationHours);
                    if (computedEnd) {
                      next.fecha_fin_local = computedEnd;
                    }
                  } else if (!normalizedValue) {
                    const previousStart = current.fecha_inicio_local;
                    const previousEnd = current.fecha_fin_local;
                    if (
                      durationHours !== null &&
                      previousStart &&
                      previousEnd &&
                      addHoursToLocalDateTime(previousStart, durationHours) === previousEnd
                    ) {
                      next.fecha_fin_local = null;
                    }
                  }
                  return next;
                });
              }}
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
      </Row>

      <Row className="g-3 mt-1">
        <Col md={6}>
          <Form.Group controlId={`session-${form.id}-trainers`}>
            <Form.Label>Formadores / Bomberos</Form.Label>
            <div ref={trainerFieldRef} className="session-multiselect">
              <Form.Control
                type="text"
                readOnly
                placeholder="Selecciona formadores"
                value={trainerSummary}
                aria-expanded={trainerListOpen}
                aria-controls={`session-${form.id}-trainers-options`}
                className="session-multiselect-summary"
                onClick={() => setTrainerListOpen((open) => !open)}
                onFocus={() => setTrainerListOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setTrainerListOpen((open) => !open);
                  }
                }}
              />
              <Collapse in={trainerListOpen}>
                <div
                  id={`session-${form.id}-trainers-options`}
                  className="session-multiselect-panel mt-2"
                >
                  <Form.Control
                    type="search"
                    placeholder="Buscar"
                    value={trainerFilter}
                    onChange={(event) => setTrainerFilter(event.target.value)}
                    className="mb-2"
                  />
                  <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                    <ListGroup variant="flush">
                      {filteredTrainers.map((trainer) => {
                        const label = `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`;
                        const checked = form.trainer_ids.includes(trainer.trainer_id);
                        const blocked = blockedTrainers.has(trainer.trainer_id);
                        const displayLabel = blocked ? `${label} · No disponible` : label;
                        return (
                          <ListGroup.Item
                            key={trainer.trainer_id}
                            className={`py-1${blocked ? ' session-option-unavailable' : ''}`}
                          >
                            <Form.Check
                              type="checkbox"
                              id={`session-${form.id}-trainer-${trainer.trainer_id}`}
                              className={blocked ? 'session-option-unavailable' : undefined}
                              label={displayLabel}
                              checked={checked}
                              disabled={blocked && !checked}
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
                </div>
              </Collapse>
            </div>
            {availabilityError && (
              <div className="text-danger small mt-1">No se pudo comprobar la disponibilidad.</div>
            )}
            {hasDateRange && availabilityFetching && !availabilityError && (
              <div className="text-muted small mt-1">Comprobando disponibilidad…</div>
            )}
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group controlId={`session-${form.id}-units`}>
            <Form.Label>Unidades móviles</Form.Label>
            <div ref={unitFieldRef} className="session-multiselect">
              <Form.Control
                type="text"
                readOnly
                placeholder="Selecciona unidades móviles"
                value={unitSummary}
                aria-expanded={unitListOpen}
                aria-controls={`session-${form.id}-units-options`}
                className="session-multiselect-summary"
                onClick={() => setUnitListOpen((open) => !open)}
                onFocus={() => setUnitListOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setUnitListOpen((open) => !open);
                  }
                }}
              />
              <Collapse in={unitListOpen}>
                <div id={`session-${form.id}-units-options`} className="session-multiselect-panel mt-2">
                  <Form.Control
                    type="search"
                    placeholder="Buscar"
                    value={unitFilter}
                    onChange={(event) => setUnitFilter(event.target.value)}
                    className="mb-2"
                  />
                  <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                    <ListGroup variant="flush">
                      {filteredUnits.map((unit) => {
                        const label = unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name;
                        const checked = form.unidad_movil_ids.includes(unit.unidad_id);
                        const blocked = blockedUnits.has(unit.unidad_id);
                        const displayLabel = blocked ? `${label} · No disponible` : label;
                        return (
                          <ListGroup.Item
                            key={unit.unidad_id}
                            className={`py-1${blocked ? ' session-option-unavailable' : ''}`}
                          >
                            <Form.Check
                              type="checkbox"
                              id={`session-${form.id}-unit-${unit.unidad_id}`}
                              className={blocked ? 'session-option-unavailable' : undefined}
                              label={displayLabel}
                              checked={checked}
                              disabled={blocked && !checked}
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
                </div>
              </Collapse>
            </div>
            {availabilityError && (
              <div className="text-danger small mt-1">No se pudo comprobar la disponibilidad.</div>
            )}
            {hasDateRange && availabilityFetching && !availabilityError && (
              <div className="text-muted small mt-1">Comprobando disponibilidad…</div>
            )}
          </Form.Group>
        </Col>
      </Row>

      <Row className="g-3 mt-1">
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
              {rooms.map((room) => {
                const label = room.sede ? `${room.name} (${room.sede})` : room.name;
                const blocked = blockedRooms.has(room.sala_id);
                const displayLabel = blocked ? `${label} · No disponible` : label;
                return (
                  <option
                    key={room.sala_id}
                    value={room.sala_id}
                    disabled={blocked && form.sala_id !== room.sala_id}
                    className={blocked ? 'session-option-unavailable' : undefined}
                    style={blocked ? { color: '#dc3545', fontWeight: 600 } : undefined}
                  >
                    {displayLabel}
                  </option>
                );
              })}
            </Form.Select>
            {availabilityError && (
              <div className="text-danger small mt-1">No se pudo comprobar la disponibilidad.</div>
            )}
            {!availabilityError && roomWarningVisible && !form.sala_id && (
              <div className="text-danger small mt-1">
                Los recursos en rojo están reservados para estas fechas.
              </div>
            )}
            {hasDateRange && availabilityFetching && !availabilityError && (
              <div className="text-muted small mt-1">Comprobando disponibilidad…</div>
            )}
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

      <div className="d-flex justify-content-end align-items-center mt-3">
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
