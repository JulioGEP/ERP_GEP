// frontend/src/pages/usuarios/trainer/TrainerAvailabilityPage.tsx
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, ButtonGroup, Card, Spinner, Stack } from 'react-bootstrap';
import {
  fetchTrainerAvailability,
  updateTrainerAvailability,
  type TrainerAvailabilityOverride,
  type TrainerAvailabilityResponse,
} from '../../../api/trainer-availability';

const BASE_QUERY_KEY = ['trainer', 'availability'] as const;
const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function buildIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function isDefaultAvailable(_dateIso: string): boolean {
  return true;
}

function useCalendar(year: number, data: TrainerAvailabilityResponse | undefined) {
  const overrideMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const entry of data?.overrides ?? []) {
      map.set(entry.date, entry.available);
    }
    return map;
  }, [data?.overrides]);

  const assignmentSet = useMemo(() => {
    return new Set(data?.assignedDates ?? []);
  }, [data?.assignedDates]);

  return useMemo(() => {
    const months = [] as Array<{
      monthIndex: number;
      label: string;
      leadingEmpty: number;
      days: Array<{
        iso: string;
        dayNumber: number;
        weekday: number;
        available: boolean;
        defaultAvailable: boolean;
        isOverride: boolean;
        hasAssignment: boolean;
      }>;
    }>;

    for (let month = 0; month < 12; month += 1) {
      const monthLabel = new Intl.DateTimeFormat('es-ES', {
        month: 'long',
      }).format(new Date(Date.UTC(year, month, 1)));

      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
      const leadingEmpty = (firstWeekday + 6) % 7; // Lunes como primer día

      const days: Array<{
        iso: string;
        dayNumber: number;
        weekday: number;
        available: boolean;
        defaultAvailable: boolean;
        isOverride: boolean;
        hasAssignment: boolean;
      }> = [];

      for (let day = 1; day <= daysInMonth; day += 1) {
        const iso = buildIsoDate(year, month + 1, day);
        const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
        const defaultAvailable = true;
        const override = overrideMap.get(iso);
        const available = override !== undefined ? override : defaultAvailable;
        const hasAssignment = assignmentSet.has(iso);
        days.push({
          iso,
          dayNumber: day,
          weekday,
          available,
          defaultAvailable,
          isOverride: override !== undefined,
          hasAssignment,
        });
      }

      months.push({
        monthIndex: month,
        label: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
        leadingEmpty,
        days,
      });
    }

    return months;
  }, [assignmentSet, overrideMap, year]);
}

export default function TrainerAvailabilityPage() {
  const queryClient = useQueryClient();
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const queryKey = useMemo(() => [...BASE_QUERY_KEY, selectedYear] as const, [selectedYear]);

  const availabilityQuery = useQuery({
    queryKey,
    queryFn: () => fetchTrainerAvailability({ year: selectedYear }),
    staleTime: 5 * 60 * 1000,
  });

  const calendarMonths = useCalendar(selectedYear, availabilityQuery.data);

  const mutation = useMutation({
    mutationFn: (update: TrainerAvailabilityOverride) =>
      updateTrainerAvailability([{ date: update.date, available: update.available }]),
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TrainerAvailabilityResponse>(queryKey);
      if (!previous) {
        return { previous: null };
      }

      const map = new Map(previous.overrides.map((entry) => [entry.date, entry.available] as const));
      const defaultAvailable = isDefaultAvailable(update.date);
      if (update.available === defaultAvailable) {
        map.delete(update.date);
      } else {
        map.set(update.date, update.available);
      }

      const next: TrainerAvailabilityResponse = {
        year: previous.year,
        overrides: Array.from(map.entries())
          .map(([date, available]) => ({ date, available }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        assignedDates: previous.assignedDates,
      };

      queryClient.setQueryData(queryKey, next);

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData([...BASE_QUERY_KEY, data.year], data);
    },
  });

  const handleToggleDay = useCallback(
    (date: string, available: boolean) => {
      mutation.mutate({ date, available: !available });
    },
    [mutation],
  );

  const handlePrevYear = useCallback(() => {
    setSelectedYear((year) => Math.max(1970, year - 1));
  }, []);

  const handleNextYear = useCallback(() => {
    setSelectedYear((year) => Math.min(2100, year + 1));
  }, []);

  return (
    <Stack gap={4} className="trainer-availability-page">
      <Stack gap={1}>
        <span className="text-uppercase text-muted small fw-semibold">Disponibilidad</span>
        <h1 className="h3 text-uppercase mb-0">Mi disponibilidad</h1>
        <span className="text-muted small">
          Selecciona los días en los que estarás disponible para impartir formaciones.
        </span>
      </Stack>

      <Card className="shadow-sm border-0">
        <Card.Body className="d-flex flex-column flex-lg-row gap-3 align-items-lg-center justify-content-lg-between">
          <div>
            <span className="text-uppercase text-muted small fw-semibold">Año</span>
            <div className="display-6 fw-bold text-primary">{selectedYear}</div>
          </div>
          <ButtonGroup aria-label="Cambiar año">
            <Button variant="outline-secondary" onClick={handlePrevYear} disabled={availabilityQuery.isLoading}>
              Año anterior
            </Button>
            <Button variant="outline-secondary" onClick={handleNextYear} disabled={availabilityQuery.isLoading}>
              Siguiente año
            </Button>
          </ButtonGroup>
          <div className="ms-lg-auto">
            <Button
              variant="outline-primary"
              onClick={() => availabilityQuery.refetch()}
              disabled={availabilityQuery.isFetching}
            >
              Actualizar datos
            </Button>
          </div>
        </Card.Body>
      </Card>

      {availabilityQuery.isLoading ? (
        <div className="d-flex justify-content-center py-5" aria-live="polite">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Cargando…</span>
          </Spinner>
        </div>
      ) : availabilityQuery.isError ? (
        <Alert variant="danger" className="d-flex flex-column flex-md-row align-items-md-center gap-3">
          <div>
            <div className="fw-semibold">No se pudo cargar tu disponibilidad.</div>
            <div className="small text-muted">Inténtalo de nuevo más tarde.</div>
          </div>
          <div className="ms-md-auto">
            <Button
              variant="outline-danger"
              onClick={() => availabilityQuery.refetch()}
              disabled={availabilityQuery.isFetching}
            >
              Reintentar
            </Button>
          </div>
        </Alert>
      ) : (
        <Stack gap={3}>
          <div className="d-flex flex-wrap align-items-center gap-3 text-muted small">
            <div className="d-flex align-items-center gap-2">
              <span className="trainer-availability-legend trainer-availability-legend--available" /> Disponible
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className="trainer-availability-legend trainer-availability-legend--unavailable" /> Sin disponibilidad
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className="trainer-availability-legend trainer-availability-legend--assigned" /> Sesión o variante asignada
            </div>
          </div>

          <div className="trainer-availability-calendar">
            {calendarMonths.map((month) => (
              <Card key={month.monthIndex} className="trainer-availability-month shadow-sm border-0">
                <Card.Header className="trainer-availability-month-header text-uppercase small fw-semibold">
                  {month.label}
                </Card.Header>
                <Card.Body>
                  <div className="trainer-availability-weekdays">
                    {WEEKDAY_LABELS.map((label) => (
                      <span key={label} className="trainer-availability-weekday">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="trainer-availability-grid">
                    {Array.from({ length: month.leadingEmpty }).map((_, index) => (
                      <div key={`empty-${index}`} aria-hidden="true" />
                    ))}
                    {month.days.map((day) => {
                      const classes = ['trainer-availability-day'];
                      if (day.hasAssignment) {
                        classes.push('trainer-availability-day--assigned');
                      } else if (day.available) {
                        classes.push('trainer-availability-day--available');
                      } else {
                        classes.push('trainer-availability-day--unavailable');
                      }

                      const title = day.hasAssignment
                        ? 'Sesión o variante asignada'
                        : day.available
                          ? 'Disponible todo el día'
                          : 'Sin disponibilidad';

                      return (
                        <button
                          key={day.iso}
                          type="button"
                          className={classes.join(' ')}
                          onClick={() => handleToggleDay(day.iso, day.available)}
                          aria-pressed={day.available}
                          title={title}
                        >
                          <span>{day.dayNumber}</span>
                        </button>
                      );
                    })}
                  </div>
                </Card.Body>
              </Card>
            ))}
          </div>
        </Stack>
      )}
    </Stack>
  );
}
