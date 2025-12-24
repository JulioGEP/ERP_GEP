// frontend/src/pages/calendario/DisponibilidadPage.tsx
import { useMemo, useState } from "react";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { Alert, Badge, Button, ButtonGroup, Card, Spinner, Stack } from "react-bootstrap";
import { fetchTrainerAvailability, type TrainerAvailabilityResponse } from "../../api/trainer-availability";
import { fetchTrainers } from "../../features/recursos/api";

type TrainerOption = {
  id: string;
  label: string;
};

type MonthDay = {
  iso: string;
  dayNumber: number;
  weekday: number;
};

type MonthCalendar = {
  monthIndex: number;
  label: string;
  leadingEmpty: number;
  days: MonthDay[];
};

type TrainerAvailabilitySnapshot = {
  trainer: TrainerOption;
  unavailable: Set<string>;
  assigned: Set<string>;
  hasData: boolean;
};

const WEEKDAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function buildMonthCalendar(year: number, monthIndex: number): MonthCalendar {
  const monthLabel = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(
    new Date(Date.UTC(year, monthIndex, 1)),
  );
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const leadingEmpty = (firstWeekday + 6) % 7; // Lunes como primer día

  const days: MonthDay[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toIsoDate(year, monthIndex + 1, day);
    const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
    days.push({
      iso,
      dayNumber: day,
      weekday,
    });
  }

  return {
    monthIndex,
    label: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
    leadingEmpty,
    days,
  };
}

function formatTrainerName(name: string, apellido: string | null): string {
  return apellido ? `${name} ${apellido}`.trim() : name;
}

function summarizeAvailability(
  trainers: TrainerOption[],
  queryResults: Array<Pick<UseQueryResult<TrainerAvailabilityResponse>, "data">>,
): TrainerAvailabilitySnapshot[] {
  return trainers.map((trainer, index) => {
    const query = queryResults[index];
    const data = query?.data;
    const unavailable = new Set<string>();
    const assigned = new Set<string>();

    if (data) {
      for (const override of data.overrides) {
        if (override.available) continue;
        unavailable.add(override.date);
      }
      for (const date of data.assignedDates) {
        assigned.add(date);
      }
    }

    return { trainer, unavailable, assigned, hasData: Boolean(data) };
  });
}

export default function DisponibilidadPage() {
  const now = useMemo(() => new Date(), []);
  const initialYear = now.getFullYear();
  const initialMonth = now.getMonth();
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  const trainersQuery = useQuery({
    queryKey: ["trainers", "calendar", "fixed-contract"],
    queryFn: fetchTrainers,
    staleTime: 5 * 60 * 1000,
  });

  const trainerOptions = useMemo((): TrainerOption[] => {
    return (trainersQuery.data ?? [])
      .filter((trainer) => trainer.contrato_fijo && trainer.activo)
      .map((trainer) => ({
        id: trainer.trainer_id,
        label: formatTrainerName(trainer.name, trainer.apellido),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [trainersQuery.data]);

  const availabilityQueries = useQueries({
    queries: trainerOptions.map((trainer) => ({
      queryKey: ["trainer", "availability", trainer.id, selectedYear],
      queryFn: () => fetchTrainerAvailability({ year: selectedYear, trainerId: trainer.id }),
      enabled: Boolean(trainerOptions.length),
      staleTime: 5 * 60 * 1000,
    })) satisfies UseQueryOptions<TrainerAvailabilityResponse>[],
  });

  const availabilitySnapshots = useMemo(
    () => summarizeAvailability(trainerOptions, availabilityQueries),
    [availabilityQueries, trainerOptions],
  );

  const monthCalendar = useMemo(
    () => buildMonthCalendar(selectedYear, selectedMonth),
    [selectedMonth, selectedYear],
  );

  const dayAvailability = useMemo(() => {
    return monthCalendar.days.map((day) => {
      const available = availabilitySnapshots
        .filter((snapshot) => snapshot.hasData)
        .filter((snapshot) => !snapshot.unavailable.has(day.iso) && !snapshot.assigned.has(day.iso))
        .map((snapshot) => snapshot.trainer);

      return { ...day, available };
    });
  }, [availabilitySnapshots, monthCalendar.days]);

  const handlePrevMonth = () => {
    setSelectedMonth((month) => {
      if (month === 0) {
        setSelectedYear((year) => Math.max(1970, year - 1));
        return 11;
      }
      return month - 1;
    });
  };

  const handleNextMonth = () => {
    setSelectedMonth((month) => {
      if (month === 11) {
        setSelectedYear((year) => Math.min(2100, year + 1));
        return 0;
      }
      return month + 1;
    });
  };

  const handleRefresh = () => {
    availabilityQueries.forEach((query) => query?.refetch?.());
  };

  const anyLoading = trainersQuery.isLoading || availabilityQueries.some((query) => query.isLoading);
  const anyError = trainersQuery.isError || availabilityQueries.some((query) => query.isError);
  const failedTrainers = availabilityQueries.filter((query) => query.isError).length;

  return (
    <Stack gap={4}>
      <div className="d-flex flex-column gap-1">
        <span className="text-uppercase text-muted small fw-semibold">Calendario</span>
        <h1 className="h3 fw-bold mb-0">Disponibilidad por día</h1>
        <p className="text-muted mb-0">Consulta qué formadores con contrato fijo están libres cada día.</p>
      </div>

      <Card className="shadow-sm border-0">
        <Card.Body className="d-flex flex-column flex-lg-row gap-3 align-items-lg-center justify-content-lg-between">
          <div>
            <span className="text-uppercase text-muted small fw-semibold">Mes</span>
            <div className="display-6 fw-bold text-primary">
              {monthCalendar.label} {selectedYear}
            </div>
          </div>
          <ButtonGroup aria-label="Cambiar mes">
            <Button variant="outline-secondary" onClick={handlePrevMonth} disabled={anyLoading}>
              Mes anterior
            </Button>
            <Button variant="outline-secondary" onClick={handleNextMonth} disabled={anyLoading}>
              Siguiente mes
            </Button>
          </ButtonGroup>
          <div className="ms-lg-auto">
            <Button variant="outline-primary" onClick={handleRefresh} disabled={anyLoading}>
              Actualizar datos
            </Button>
          </div>
        </Card.Body>
      </Card>

      {anyLoading ? (
        <div className="d-flex justify-content-center py-5" aria-live="polite">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Cargando…</span>
          </Spinner>
        </div>
      ) : trainersQuery.isError ? (
        <Alert variant="danger" className="mb-0">
          No se pudo cargar la lista de formadores.
        </Alert>
      ) : !trainerOptions.length ? (
        <Alert variant="info" className="mb-0">
          No hay formadores con contrato fijo activos para mostrar en el calendario.
        </Alert>
      ) : (
        <Stack gap={3}>
          {anyError ? (
            <Alert variant="warning" className="mb-0">
              No se pudo cargar la disponibilidad de {failedTrainers} formador(es). Intenta actualizar los datos.
            </Alert>
          ) : null}

          <div className="availability-calendar-wrapper">
            <div className="availability-calendar">
              <div className="availability-weekdays">
                {WEEKDAY_LABELS.map((label) => (
                  <span key={label} className="availability-weekday">
                    {label}
                  </span>
                ))}
              </div>

              {monthCalendar.leadingEmpty > 0 ? (
                <div className="availability-empty" style={{ gridColumn: `span ${monthCalendar.leadingEmpty}` }} aria-hidden />
              ) : null}

              {dayAvailability.map((day) => (
                <Card key={day.iso} className="availability-day shadow-sm border-0">
                  <Card.Body className="d-flex flex-column gap-2">
                    <div className="d-flex align-items-center justify-content-between gap-2">
                      <div className="d-flex align-items-baseline gap-2">
                        <span className="availability-day-number">{day.dayNumber}</span>
                        <span className="text-muted small text-uppercase fw-semibold">
                          {WEEKDAY_LABELS[(day.weekday + 6) % 7]}
                        </span>
                      </div>
                      <Badge bg="success" pill>
                        {day.available.length} disponibles
                      </Badge>
                    </div>
                    {day.available.length ? (
                      <div className="d-flex flex-wrap gap-1">
                        {day.available.map((trainer) => (
                          <Badge key={trainer.id} bg="light" text="dark" className="availability-trainer-chip">
                            {trainer.label}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted small">Sin formadores libres.</span>
                    )}
                  </Card.Body>
                </Card>
              ))}
            </div>
          </div>
        </Stack>
      )}
    </Stack>
  );
}
