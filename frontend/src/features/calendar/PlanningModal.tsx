import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarSession } from './api';
import { fetchCalendarSessions } from './api';
import { fetchTrainers } from '../recursos/api';
import { fetchSessionAvailability, patchSession } from '../presupuestos/api/sessions.api';

const HOURS_OK_MAX = 140;
const HOURS_WARNING_MAX = 159;

const monthLabelFormatter = new Intl.DateTimeFormat('es-ES', {
  month: 'long',
  year: 'numeric',
});

const hoursFormatter = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type PlanningModalProps = {
  session: CalendarSession | null;
  show: boolean;
  onClose: () => void;
  onNotify?: (toast: ToastParams) => void;
};

type TrainerSummary = {
  trainerId: string;
  name: string;
  totalDays: number;
  weekdayDays: number;
  weekendDays: number;
  totalHours: number;
};

function formatTrainerName(input: { name?: string | null; apellido?: string | null; secondary?: string | null }) {
  const name = input.name?.trim() ?? '';
  const secondary = input.apellido?.trim() ?? input.secondary?.trim() ?? '';
  return [name, secondary].filter((value) => value.length).join(' ').trim();
}

function buildMonthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function getEffectiveEnd(start: Date, end: Date) {
  if (end.getTime() <= start.getTime()) {
    return new Date(start.getTime());
  }
  return new Date(end.getTime() - 1);
}

function enumerateDays(start: Date, end: Date) {
  const days: Date[] = [];
  const cursor = new Date(start.getTime());
  cursor.setHours(0, 0, 0, 0);
  const endCursor = new Date(end.getTime());
  endCursor.setHours(0, 0, 0, 0);
  while (cursor <= endCursor) {
    days.push(new Date(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function getHoursClass(hours: number) {
  if (hours <= HOURS_OK_MAX) return 'erp-planning-hours--ok';
  if (hours <= HOURS_WARNING_MAX) return 'erp-planning-hours--warn';
  return 'erp-planning-hours--alert';
}

export function PlanningModal({ session, show, onClose, onNotify }: PlanningModalProps) {
  const queryClient = useQueryClient();
  const [searchValue, setSearchValue] = useState('');
  const [selectedTrainerIds, setSelectedTrainerIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<keyof TrainerSummary>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (!session) return;
    setSelectedTrainerIds(session.trainers.map((trainer) => trainer.id));
  }, [session]);

  const trainersQuery = useQuery({
    queryKey: ['trainers'],
    queryFn: fetchTrainers,
    staleTime: 5 * 60 * 1000,
  });

  const availabilityQuery = useQuery({
    queryKey: session
      ? ['session-availability', session.id, session.start, session.end]
      : ['session-availability', 'no-session'],
    queryFn: () =>
      fetchSessionAvailability({
        start: session!.start,
        end: session!.end,
        excludeSessionId: session!.id,
      }),
    enabled: Boolean(session),
    staleTime: 60_000,
  });

  const monthRange = useMemo(() => {
    if (!session) return null;
    return buildMonthRange(new Date(session.start));
  }, [session]);

  const monthSessionsQuery = useQuery({
    queryKey: monthRange
      ? ['calendarSessions', 'planning', monthRange.start.toISOString(), monthRange.end.toISOString()]
      : ['calendarSessions', 'planning', 'no-range'],
    queryFn: () =>
      fetchCalendarSessions({
        start: monthRange!.start.toISOString(),
        end: monthRange!.end.toISOString(),
      }),
    enabled: Boolean(monthRange),
    staleTime: 2 * 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: async (nextIds: string[]) => {
      if (!session) throw new Error('Sesión no disponible');
      return patchSession(session.id, { trainer_ids: nextIds });
    },
    onMutate: async (nextIds) => {
      const previous = selectedTrainerIds;
      setSelectedTrainerIds(nextIds);
      return { previous };
    },
    onError: (error, _nextIds, context) => {
      if (context?.previous) {
        setSelectedTrainerIds(context.previous);
      }
      const message = error instanceof Error ? error.message : 'No se pudo actualizar la sesión.';
      onNotify?.({ variant: 'danger', message });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarSessions'] });
      onNotify?.({ variant: 'success', message: 'Formadores actualizados en la sesión.' });
    },
  });

  const activeTrainers = useMemo(() => {
    const trainers = trainersQuery.data ?? [];
    return trainers.filter((trainer) => trainer.activo);
  }, [trainersQuery.data]);

  const availableTrainerSet = useMemo(() => {
    if (!availabilityQuery.isSuccess) return null;
    const available = availabilityQuery.data?.availableTrainers ?? [];
    return new Set(available);
  }, [availabilityQuery.data?.availableTrainers, availabilityQuery.isSuccess]);

  const trainerNameById = useMemo(() => {
    const map = new Map<string, string>();
    activeTrainers.forEach((trainer) => {
      map.set(trainer.trainer_id, formatTrainerName(trainer));
    });
    session?.trainers.forEach((trainer) => {
      if (!map.has(trainer.id)) {
        map.set(trainer.id, formatTrainerName({ name: trainer.name, secondary: trainer.secondary }));
      }
    });
    return map;
  }, [activeTrainers, session?.trainers]);

  const displayedTrainers = useMemo(() => activeTrainers, [activeTrainers]);

  const filteredTrainers = useMemo(() => {
    const search = searchValue.trim().toLowerCase();
    if (!search) return displayedTrainers;
    return displayedTrainers.filter((trainer) => {
      const label = `${trainer.name} ${trainer.apellido ?? ''}`.toLowerCase();
      return label.includes(search);
    });
  }, [searchValue, displayedTrainers]);

  const trainerSummaries = useMemo<TrainerSummary[]>(() => {
    if (!monthRange) return [];
    const monthSessions = monthSessionsQuery.data?.sessions ?? [];
    const summaries = new Map<string, TrainerSummary>();

    const getSummary = (trainerId: string) => {
      const existing = summaries.get(trainerId);
      if (existing) return existing;
      const name = trainerNameById.get(trainerId) ?? 'Sin nombre';
      const summary = {
        trainerId,
        name,
        totalDays: 0,
        weekdayDays: 0,
        weekendDays: 0,
        totalHours: 0,
      } satisfies TrainerSummary;
      summaries.set(trainerId, summary);
      return summary;
    };

    monthSessions.forEach((sessionItem) => {
      if (!sessionItem.trainers.length) return;
      const sessionStart = new Date(sessionItem.start);
      const sessionEnd = new Date(sessionItem.end);
      const clampedStart = new Date(Math.max(sessionStart.getTime(), monthRange.start.getTime()));
      const clampedEnd = new Date(Math.min(sessionEnd.getTime(), monthRange.end.getTime()));
      if (clampedEnd.getTime() <= clampedStart.getTime()) return;

      const hours = (clampedEnd.getTime() - clampedStart.getTime()) / 36e5;
      const endForDays = getEffectiveEnd(clampedStart, clampedEnd);
      const days = enumerateDays(clampedStart, endForDays);

      sessionItem.trainers.forEach((trainer) => {
        const summary = getSummary(trainer.id);
        summary.totalHours += hours;
        days.forEach((day) => {
          const dayOfWeek = day.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          summary.totalDays += 1;
          if (isWeekend) {
            summary.weekendDays += 1;
          } else {
            summary.weekdayDays += 1;
          }
        });
      });
    });

    const availableIds = new Set(displayedTrainers.map((trainer) => trainer.trainer_id));
    displayedTrainers.forEach((trainer) => {
      if (!summaries.has(trainer.trainer_id)) {
        summaries.set(trainer.trainer_id, {
          trainerId: trainer.trainer_id,
          name: formatTrainerName(trainer),
          totalDays: 0,
          weekdayDays: 0,
          weekendDays: 0,
          totalHours: 0,
        });
      }
    });

    return Array.from(summaries.values())
      .filter((summary) => availableIds.has(summary.trainerId))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }, [monthRange, monthSessionsQuery.data?.sessions, trainerNameById, displayedTrainers]);

  const sortedTrainerSummaries = useMemo(() => {
    const sorted = [...trainerSummaries];
    const direction = sortDirection === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * direction;
      }
      return String(aValue).localeCompare(String(bValue), 'es', { sensitivity: 'base' }) * direction;
    });
    return sorted;
  }, [trainerSummaries, sortDirection, sortKey]);

  const handleToggleTrainer = useCallback(
    (trainerId: string, checked: boolean) => {
      if (!session || updateMutation.isPending) return;
      const set = new Set(selectedTrainerIds);
      if (checked) {
        set.add(trainerId);
      } else {
        set.delete(trainerId);
      }
      updateMutation.mutate(Array.from(set));
    },
    [selectedTrainerIds, session, updateMutation],
  );

  const handleSort = useCallback((key: keyof TrainerSummary) => {
    setSortKey((currentKey) => {
      if (currentKey !== key) {
        setSortDirection('asc');
        return key;
      }
      setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
      return currentKey;
    });
  }, []);

  const renderSortIndicator = (key: keyof TrainerSummary) => {
    if (sortKey !== key) return <span className="erp-planning-sort-indicator">↕</span>;
    return (
      <span className="erp-planning-sort-indicator">
        {sortDirection === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  if (!session) {
    return null;
  }

  const modalTitle = `Planificación · ${session.title}`;
  const monthLabel = monthRange
    ? monthLabelFormatter.format(monthRange.start)
    : 'Mes actual';

  const availabilityError =
    availabilityQuery.error instanceof Error ? availabilityQuery.error.message : null;

  return (
    <Modal show={show} onHide={updateMutation.isPending ? undefined : onClose} size="xl" centered backdrop="static">
      <Modal.Header closeButton={!updateMutation.isPending}>
        <Modal.Title>{modalTitle}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-grid gap-4">
        <section className="d-grid gap-3">
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-2">
            <div>
              <h5 className="mb-1">Formadores y bomberos disponibles</h5>
              <p className="text-muted mb-0">
                Selecciona uno o varios recursos para añadirlos automáticamente a la sesión.
              </p>
            </div>
            {availabilityQuery.isFetching || updateMutation.isPending ? (
              <div className="d-flex align-items-center gap-2 text-muted">
                <Spinner animation="border" size="sm" />
                <span className="small">Actualizando disponibilidad...</span>
              </div>
            ) : null}
          </div>
          {availabilityError ? (
            <Alert variant="warning" className="mb-0">
              {availabilityError}
            </Alert>
          ) : null}
          <Form.Control
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Buscar formador o bombero"
          />
          <div className="erp-planning-resource-list">
            {trainersQuery.isLoading ? (
              <div className="d-flex align-items-center gap-2 text-muted">
                <Spinner animation="border" size="sm" />
                <span>Cargando recursos...</span>
              </div>
            ) : filteredTrainers.length ? (
              filteredTrainers.map((trainer) => {
                const label = formatTrainerName(trainer);
                const isBombero = Boolean(trainer.certificado_bombero_caducidad);
                const isSelected = selectedTrainerIds.includes(trainer.trainer_id);
                const isUnavailable = availableTrainerSet
                  ? !availableTrainerSet.has(trainer.trainer_id)
                  : false;
                return (
                  <Form.Check
                    key={trainer.trainer_id}
                    type="checkbox"
                    id={`planning-trainer-${trainer.trainer_id}`}
                    className="erp-planning-resource-item"
                    label={
                      <span className="d-flex align-items-center gap-2">
                        <span className={isUnavailable ? 'erp-planning-resource-name--unavailable' : undefined}>
                          {label || 'Sin nombre'}
                        </span>
                        {isBombero ? <Badge bg="dark">Bombero</Badge> : null}
                        {isUnavailable ? (
                          <span className="erp-planning-resource-unavailable">No - Disponible</span>
                        ) : null}
                      </span>
                    }
                    checked={isSelected}
                    disabled={updateMutation.isPending || (isUnavailable && !isSelected)}
                    onChange={(event) =>
                      handleToggleTrainer(trainer.trainer_id, event.target.checked)
                    }
                  />
                );
              })
            ) : (
              <span className="text-muted">No hay formadores disponibles con ese filtro.</span>
            )}
          </div>
        </section>

        <section className="d-grid gap-2">
          <div>
            <h5 className="mb-1">Resumen mensual</h5>
            <p className="text-muted mb-0">{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</p>
          </div>
          <div className="table-responsive">
            <Table bordered hover size="sm" className="mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th
                    className="erp-planning-sortable-header"
                    onClick={() => handleSort('name')}
                  >
                    <span className="erp-planning-sort-label">
                      Formador {renderSortIndicator('name')}
                    </span>
                  </th>
                  <th
                    className="text-center erp-planning-sortable-header"
                    onClick={() => handleSort('totalDays')}
                  >
                    <span className="erp-planning-sort-label">
                      Días totales {renderSortIndicator('totalDays')}
                    </span>
                  </th>
                  <th
                    className="text-center erp-planning-sortable-header"
                    onClick={() => handleSort('weekdayDays')}
                  >
                    <span className="erp-planning-sort-label">
                      Días L-V {renderSortIndicator('weekdayDays')}
                    </span>
                  </th>
                  <th
                    className="text-center erp-planning-sortable-header"
                    onClick={() => handleSort('weekendDays')}
                  >
                    <span className="erp-planning-sort-label">
                      Días S-D {renderSortIndicator('weekendDays')}
                    </span>
                  </th>
                  <th
                    className="text-center erp-planning-sortable-header"
                    onClick={() => handleSort('totalHours')}
                  >
                    <span className="erp-planning-sort-label">
                      Horas totales {renderSortIndicator('totalHours')}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthSessionsQuery.isLoading ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted">
                      <Spinner animation="border" size="sm" className="me-2" />
                      Cargando resumen...
                    </td>
                  </tr>
                ) : sortedTrainerSummaries.length ? (
                  sortedTrainerSummaries.map((summary) => (
                    <tr key={summary.trainerId}>
                      <td>{summary.name}</td>
                      <td className="text-center">{summary.totalDays}</td>
                      <td className="text-center">{summary.weekdayDays}</td>
                      <td className="text-center">{summary.weekendDays}</td>
                      <td className="text-center">
                        <span className={getHoursClass(summary.totalHours)}>
                          {hoursFormatter.format(summary.totalHours)}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="text-center text-muted">
                      No hay datos de sesiones para este mes.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        </section>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={updateMutation.isPending}>
          Cerrar
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
