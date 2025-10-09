import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Col,
  Form,
  OverlayTrigger,
  Row,
  Spinner,
  Tooltip,
} from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchDealSessions,
  fetchMobileUnitsAvailability,
  fetchRoomsAvailability,
  fetchTrainersAvailability,
  isApiError,
  normalizeConflictSummaries,
  updateDealSession,
} from './api';
import type { DealSession, DealSessionUpdatePayload } from '../../types/deal';
import type { Room } from '../../types/room';
import type { Trainer } from '../../types/trainer';
import type { MobileUnit } from '../../types/mobile-unit';
import type { ResourceConflictDetail, ResourceConflictSummary } from '../../types/resource-conflict';

type SessionPlannerProps = {
  dealId: string;
  dealTitle?: string | null;
};

type SessionFormState = {
  inicio: string;
  fin: string;
  sala_id: string | null;
  formadores: string[];
  unidades_moviles: string[];
};

type SessionErrorState = {
  message: string;
  conflicts: ResourceConflictSummary[];
};

const dateTimeFormatter = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function toIsoFromLocal(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const orderedA = [...a].sort();
  const orderedB = [...b].sort();
  for (let i = 0; i < orderedA.length; i += 1) {
    if (orderedA[i] !== orderedB[i]) return false;
  }
  return true;
}

function formatConflictRange(conflict: ResourceConflictDetail): string | null {
  const start = conflict.inicio ? new Date(conflict.inicio) : null;
  const end = conflict.fin ? new Date(conflict.fin) : null;
  if (start && !Number.isNaN(start.getTime()) && end && !Number.isNaN(end.getTime())) {
    return `${dateTimeFormatter.format(start)} – ${dateTimeFormatter.format(end)}`;
  }
  if (start && !Number.isNaN(start.getTime())) {
    return dateTimeFormatter.format(start);
  }
  if (end && !Number.isNaN(end.getTime())) {
    return dateTimeFormatter.format(end);
  }
  return null;
}

function getResourceTypeLabel(type: ResourceConflictSummary['resource_type']): string {
  if (type === 'sala') return 'Sala';
  if (type === 'formador') return 'Formador';
  return 'Unidad móvil';
}

type SessionRowProps = {
  session: DealSession;
  index: number;
  formState: SessionFormState | null;
  onChange: (sessionId: string, updater: (state: SessionFormState) => SessionFormState) => void;
  onSave: (sessionId: string) => void;
  error?: SessionErrorState;
  isSaving: boolean;
};

function SessionRow({ session, index, formState, onChange, onSave, error, isSaving }: SessionRowProps) {
  const startIso = toIsoFromLocal(formState?.inicio ?? null);
  const endIso = toIsoFromLocal(formState?.fin ?? null);

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'availability', session.session_id, startIso ?? 'none', endIso ?? 'none'],
    queryFn: () =>
      fetchRoomsAvailability({
        start: startIso ?? undefined,
        end: endIso ?? undefined,
        excludeSessionId: session.session_id,
      }),
    enabled: Boolean(formState),
    staleTime: 60_000,
  });

  const trainersQuery = useQuery({
    queryKey: [
      'trainers',
      'availability',
      session.session_id,
      startIso ?? 'none',
      endIso ?? 'none',
    ],
    queryFn: () =>
      fetchTrainersAvailability({
        start: startIso ?? undefined,
        end: endIso ?? undefined,
        excludeSessionId: session.session_id,
      }),
    enabled: Boolean(formState),
    staleTime: 60_000,
  });

  const unitsQuery = useQuery({
    queryKey: [
      'mobile-units',
      'availability',
      session.session_id,
      startIso ?? 'none',
      endIso ?? 'none',
    ],
    queryFn: () =>
      fetchMobileUnitsAvailability({
        start: startIso ?? undefined,
        end: endIso ?? undefined,
        excludeSessionId: session.session_id,
      }),
    enabled: Boolean(formState),
    staleTime: 60_000,
  });

  const handleFieldChange = (field: keyof SessionFormState, value: string | null) => {
    if (!formState) return;
    onChange(session.session_id, (current) => ({ ...current, [field]: value }));
  };

  const handleTrainerToggle = (trainerId: string) => {
    if (!formState) return;
    onChange(session.session_id, (current) => {
      const exists = current.formadores.includes(trainerId);
      return {
        ...current,
        formadores: exists
          ? current.formadores.filter((id) => id !== trainerId)
          : [...current.formadores, trainerId],
      };
    });
  };

  const handleMobileUnitToggle = (unidadId: string) => {
    if (!formState) return;
    onChange(session.session_id, (current) => {
      const exists = current.unidades_moviles.includes(unidadId);
      return {
        ...current,
        unidades_moviles: exists
          ? current.unidades_moviles.filter((id) => id !== unidadId)
          : [...current.unidades_moviles, unidadId],
      };
    });
  };

  const clearMobileUnits = () => {
    if (!formState) return;
    onChange(session.session_id, (current) => ({ ...current, unidades_moviles: [] }));
  };

  const formValues = formState ?? {
    inicio: '',
    fin: '',
    sala_id: null,
    formadores: [],
    unidades_moviles: [],
  };

  const baseForm: SessionFormState = {
    inicio: toLocalInputValue(session.inicio),
    fin: toLocalInputValue(session.fin),
    sala_id: session.sala_id ?? null,
    formadores: session.formadores.map((f) => f.trainer_id),
    unidades_moviles: session.unidades_moviles.map((u) => u.unidad_id),
  };

  const isDirty = useMemo(() => {
    if (!formState) return false;
    const sameInicio = baseForm.inicio === formState.inicio;
    const sameFin = baseForm.fin === formState.fin;
    const sameSala = baseForm.sala_id === formState.sala_id;
    const sameTrainers = arraysEqual(baseForm.formadores, formState.formadores);
    const sameUnits = arraysEqual(baseForm.unidades_moviles, formState.unidades_moviles);
    return !(sameInicio && sameFin && sameSala && sameTrainers && sameUnits);
  }, [formState, session.session_id, session.inicio, session.fin, session.sala_id, session.formadores, session.unidades_moviles]);

  const rooms = roomsQuery.data ?? [];
  const trainers = trainersQuery.data ?? [];
  const units = unitsQuery.data ?? [];

  const productLabel = useMemo(() => {
    return (
      session.deal_product?.code ??
      session.deal_product?.name ??
      session.origen?.code ??
      null
    );
  }, [session.deal_product, session.origen]);

  const statusLabel = session.estado ? session.estado : null;

  const saveDisabled = !isDirty || isSaving;

  const renderResourceTooltip = (conflicts: ResourceConflictDetail[], id: string) => (
    <Tooltip id={`conflict-${session.session_id}-${id}`} className="resource-conflict-tooltip">
      <div className="text-start">
        {conflicts.map((conflict) => {
          const rangeLabel = formatConflictRange(conflict);
          return (
            <div key={conflict.session_id} className="mb-2">
              <div className="fw-semibold">
                {conflict.deal_title ?? conflict.organization_name ?? conflict.deal_id}
              </div>
              {conflict.product_name || conflict.product_code ? (
                <div className="small">
                  {conflict.product_name ?? conflict.product_code}
                </div>
              ) : null}
              {rangeLabel ? (
                <div className="text-muted small">{rangeLabel}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Tooltip>
  );

  const renderRoomOption = (room: Room) => {
    const conflicts = room.availability?.conflicts ?? [];
    const isBusy = room.availability?.isBusy ?? false;
    const isSelected = formValues.sala_id === room.sala_id;
    const disabled = isBusy && !isSelected;

    const label = (
      <div className="d-flex align-items-center gap-2">
        <span className={isBusy ? 'text-danger fw-semibold' : 'fw-semibold'}>{room.name}</span>
        {room.sede ? <span className="text-muted small">{room.sede}</span> : null}
        {isBusy ? <Badge bg="danger">Ocupado</Badge> : null}
      </div>
    );

    const control = (
      <Form.Check
        type="radio"
        id={`session-${session.session_id}-room-${room.sala_id}`}
        name={`session-${session.session_id}-room`}
        value={room.sala_id}
        className="mb-2"
        checked={isSelected}
        disabled={disabled}
        onChange={() => handleFieldChange('sala_id', room.sala_id)}
        label={label}
      />
    );

    if (!conflicts.length) {
      return (
        <div key={room.sala_id} className="d-block">
          {control}
        </div>
      );
    }

    return (
      <OverlayTrigger
        key={room.sala_id}
        overlay={renderResourceTooltip(conflicts, `room-${room.sala_id}`)}
        placement="top"
      >
        <div className="d-block" tabIndex={0}>
          {control}
        </div>
      </OverlayTrigger>
    );
  };

  const renderTrainerOption = (trainer: Trainer) => {
    const conflicts = trainer.availability?.conflicts ?? [];
    const isBusy = trainer.availability?.isBusy ?? false;
    const isSelected = formValues.formadores.includes(trainer.trainer_id);
    const disabled = isBusy && !isSelected;

    const label = (
      <div className="d-flex align-items-center gap-2">
        <span className={isBusy ? 'text-danger fw-semibold' : 'fw-semibold'}>
          {trainer.name}
        </span>
        {trainer.apellido ? <span className="text-muted small">{trainer.apellido}</span> : null}
        {isBusy ? <Badge bg="danger">Ocupado</Badge> : null}
      </div>
    );

    const control = (
      <Form.Check
        type="checkbox"
        id={`session-${session.session_id}-trainer-${trainer.trainer_id}`}
        className="mb-2"
        checked={isSelected}
        disabled={disabled}
        onChange={() => handleTrainerToggle(trainer.trainer_id)}
        label={label}
      />
    );

    if (!conflicts.length) {
      return (
        <div key={trainer.trainer_id} className="d-block">
          {control}
        </div>
      );
    }

    return (
      <OverlayTrigger
        key={trainer.trainer_id}
        overlay={renderResourceTooltip(conflicts, `trainer-${trainer.trainer_id}`)}
        placement="top"
      >
        <div className="d-block" tabIndex={0}>
          {control}
        </div>
      </OverlayTrigger>
    );
  };

  const renderMobileUnitOption = (unit: MobileUnit) => {
    const conflicts = unit.availability?.conflicts ?? [];
    const isBusy = unit.availability?.isBusy ?? false;
    const isSelected = formValues.unidades_moviles.includes(unit.unidad_id);
    const disabled = isBusy && !isSelected;

    const label = (
      <div className="d-flex align-items-center gap-2">
        <span className={isBusy ? 'text-danger fw-semibold' : 'fw-semibold'}>{unit.name}</span>
        {unit.matricula ? <span className="text-muted small">{unit.matricula}</span> : null}
        {isBusy ? <Badge bg="danger">Ocupado</Badge> : null}
      </div>
    );

    const control = (
      <Form.Check
        type="checkbox"
        id={`session-${session.session_id}-unit-${unit.unidad_id}`}
        className="mb-2"
        checked={isSelected}
        disabled={disabled}
        onChange={() => handleMobileUnitToggle(unit.unidad_id)}
        label={label}
      />
    );

    if (!conflicts.length) {
      return (
        <div key={unit.unidad_id} className="d-block">
          {control}
        </div>
      );
    }

    return (
      <OverlayTrigger
        key={unit.unidad_id}
        overlay={renderResourceTooltip(conflicts, `unit-${unit.unidad_id}`)}
        placement="top"
      >
        <div className="d-block" tabIndex={0}>
          {control}
        </div>
      </OverlayTrigger>
    );
  };

  const renderList = <T,>(items: T[], renderItem: (item: T) => JSX.Element, loading: boolean, error: unknown, emptyMessage: string) => {
    if (loading) {
      return (
        <div className="d-flex align-items-center gap-2">
          <Spinner animation="border" size="sm" role="status" />
          <span>Cargando…</span>
        </div>
      );
    }

    if (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar la información';
      return <Alert variant="danger" className="mb-0">{message}</Alert>;
    }

    if (!items.length) {
      return <p className="text-muted mb-0">{emptyMessage}</p>;
    }

    return <div className="d-flex flex-column">{items.map(renderItem)}</div>;
  };

  return (
    <div className="border rounded p-3">
      <div className="d-flex justify-content-between align-items-start gap-2 mb-3 flex-wrap">
        <div>
          <div className="fw-semibold">Sesión {index + 1}</div>
          {productLabel ? <div className="text-muted small">{productLabel}</div> : null}
        </div>
        <div className="d-flex align-items-center gap-2">
          {statusLabel ? <Badge bg="secondary">{statusLabel}</Badge> : null}
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSave(session.session_id)}
            disabled={saveDisabled}
          >
            {isSaving ? (
              <>
                <Spinner animation="border" size="sm" role="status" className="me-2" />
                Guardando…
              </>
            ) : (
              'Guardar'
            )}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="danger">
          <p className="mb-2">{error.message}</p>
          {error.conflicts.length ? (
            <ul className="mb-0 ps-3">
              {error.conflicts.map((conflict) => (
                <li key={`${conflict.resource_type}-${conflict.resource_id}`}>
                  <div className="fw-semibold">
                    {getResourceTypeLabel(conflict.resource_type)}{' '}
                    {conflict.resource_label ?? conflict.resource_id}
                  </div>
                  {conflict.conflicts.map((detail) => {
                    const range = formatConflictRange(detail);
                    return (
                      <div key={detail.session_id} className="text-muted small">
                        {detail.deal_title ?? detail.deal_id}
                        {detail.product_name || detail.product_code ? (
                          <> · {detail.product_name ?? detail.product_code}</>
                        ) : null}
                        {range ? <> · {range}</> : null}
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <Row className="g-3 mb-3">
        <Col md={6}>
          <Form.Group controlId={`session-${session.session_id}-inicio`}>
            <Form.Label>Inicio</Form.Label>
            <Form.Control
              type="datetime-local"
              value={formValues.inicio}
              onChange={(event) => handleFieldChange('inicio', event.target.value)}
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group controlId={`session-${session.session_id}-fin`}>
            <Form.Label>Fin</Form.Label>
            <Form.Control
              type="datetime-local"
              value={formValues.fin}
              onChange={(event) => handleFieldChange('fin', event.target.value)}
            />
          </Form.Group>
        </Col>
      </Row>

      <div className="mb-3">
        <Form.Label>Sala</Form.Label>
        {renderList(rooms, renderRoomOption, roomsQuery.isLoading || roomsQuery.isFetching, roomsQuery.error, 'No hay salas registradas.')}
      </div>

      <div className="mb-3">
        <Form.Label>Formadores</Form.Label>
        {renderList(trainers, renderTrainerOption, trainersQuery.isLoading || trainersQuery.isFetching, trainersQuery.error, 'No hay formadores registrados.')}
      </div>

      <div>
        <Form.Label>Unidades móviles</Form.Label>
        <div className="mb-2">
          <Form.Check
            type="switch"
            id={`session-${session.session_id}-no-mobile`}
            label="Sin unidad móvil"
            checked={formValues.unidades_moviles.length === 0}
            onChange={(event) => {
              if (event.target.checked) {
                clearMobileUnits();
              }
            }}
          />
        </div>
        {renderList(
          units,
          renderMobileUnitOption,
          unitsQuery.isLoading || unitsQuery.isFetching,
          unitsQuery.error,
          'No hay unidades móviles registradas.',
        )}
      </div>
    </div>
  );
}

export function SessionPlanner({ dealId, dealTitle }: SessionPlannerProps) {
  const queryClient = useQueryClient();
  const [forms, setForms] = useState<Record<string, SessionFormState>>({});
  const [errors, setErrors] = useState<Record<string, SessionErrorState>>({});

  const sessionsQuery = useQuery({
    queryKey: ['deal', dealId, 'sessions'],
    queryFn: () => fetchDealSessions(dealId),
    enabled: dealId.trim().length > 0,
  });

  const sessions = sessionsQuery.data ?? [];

  useEffect(() => {
    if (!sessions.length) {
      setForms({});
      return;
    }
    setForms(() => {
      const next: Record<string, SessionFormState> = {};
      for (const session of sessions) {
        next[session.session_id] = {
          inicio: toLocalInputValue(session.inicio),
          fin: toLocalInputValue(session.fin),
          sala_id: session.sala_id ?? null,
          formadores: session.formadores.map((f) => f.trainer_id),
          unidades_moviles: session.unidades_moviles.map((u) => u.unidad_id),
        };
      }
      return next;
    });
  }, [sessions]);

  const updateSessionMutation = useMutation<
    DealSession,
    unknown,
    { sessionId: string; payload: DealSessionUpdatePayload }
  >({
    mutationFn: ({ sessionId, payload }) => updateDealSession(sessionId, payload),
    onSuccess: (updatedSession, variables) => {
      queryClient.setQueryData<DealSession[]>(
        ['deal', dealId, 'sessions'],
        (current) =>
          (current ?? []).map((session) =>
            session.session_id === updatedSession.session_id ? updatedSession : session,
          ),
      );
      setErrors((prev) => {
        if (!prev[variables.sessionId]) return prev;
        const next = { ...prev };
        delete next[variables.sessionId];
        return next;
      });
      setForms((prev) => ({
        ...prev,
        [updatedSession.session_id]: {
          inicio: toLocalInputValue(updatedSession.inicio),
          fin: toLocalInputValue(updatedSession.fin),
          sala_id: updatedSession.sala_id ?? null,
          formadores: updatedSession.formadores.map((f) => f.trainer_id),
          unidades_moviles: updatedSession.unidades_moviles.map((u) => u.unidad_id),
        },
      }));
    },
    onError: (error, variables) => {
      if (isApiError(error)) {
        const summaries = normalizeConflictSummaries(error.details ?? null);
        setErrors((prev) => ({
          ...prev,
          [variables.sessionId]: {
            message: error.message,
            conflicts: summaries,
          },
        }));
      } else {
        const message = error instanceof Error ? error.message : 'No se pudo guardar la sesión';
        setErrors((prev) => ({
          ...prev,
          [variables.sessionId]: {
            message,
            conflicts: [],
          },
        }));
      }
    },
  });

  const handleFormChange = (
    sessionId: string,
    updater: (state: SessionFormState) => SessionFormState,
  ) => {
    setForms((current) => {
      const existing = current[sessionId];
      if (!existing) return current;
      return { ...current, [sessionId]: updater(existing) };
    });
    setErrors((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  };

  const handleSave = (sessionId: string) => {
    const formState = forms[sessionId];
    if (!formState) return;

    const payload: DealSessionUpdatePayload = {
      inicio: formState.inicio ? toIsoFromLocal(formState.inicio) : null,
      fin: formState.fin ? toIsoFromLocal(formState.fin) : null,
      sala_id: formState.sala_id,
      formadores: formState.formadores,
      unidades_moviles: formState.unidades_moviles,
    };

    updateSessionMutation.mutate({ sessionId, payload });
  };

  if (sessionsQuery.isLoading) {
    return (
      <div className="d-flex align-items-center gap-2">
        <Spinner animation="border" size="sm" role="status" />
        <span>Cargando sesiones…</span>
      </div>
    );
  }

  if (sessionsQuery.isError) {
    const message =
      sessionsQuery.error instanceof Error
        ? sessionsQuery.error.message
        : 'No se pudieron cargar las sesiones.';
    return <Alert variant="danger" className="mb-0">{message}</Alert>;
  }

  if (!sessions.length) {
    return <p className="text-muted mb-0">{dealTitle ? `No hay sesiones planificadas para ${dealTitle}.` : 'No hay sesiones planificadas.'}</p>;
  }

  return (
    <div className="d-flex flex-column gap-3">
      {sessions.map((session, index) => (
        <SessionRow
          key={session.session_id}
          session={session}
          index={index}
          formState={forms[session.session_id] ?? null}
          onChange={handleFormChange}
          onSave={handleSave}
          error={errors[session.session_id]}
          isSaving={
            updateSessionMutation.isPending &&
            updateSessionMutation.variables?.sessionId === session.session_id
          }
        />
      ))}
    </div>
  );
}
