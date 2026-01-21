import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarView } from '../../../features/calendar/CalendarView';
import type { CalendarSession, CalendarVariantEvent } from '../../../features/calendar/api';

const MADRID_TIMEZONE = 'Europe/Madrid';

const madridDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MADRID_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getMadridDateKey(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return madridDateFormatter.format(parsed);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.split('T')[0] ?? null;
}

export default function TrainerCalendarPage() {
  const navigate = useNavigate();

  const handleCalendarNavigate = useCallback(
    (date: string | null) => {
      navigate('/usuarios/trainer/sesiones', {
        state: {
          trainerSessionDate: date,
        },
      });
    },
    [navigate],
  );

  const handleSessionOpen = useCallback(
    (session: CalendarSession) => {
      handleCalendarNavigate(getMadridDateKey(session.start));
    },
    [handleCalendarNavigate],
  );

  const handleVariantOpen = useCallback(
    (variant: CalendarVariantEvent) => {
      handleCalendarNavigate(getMadridDateKey(variant.start));
    },
    [handleCalendarNavigate],
  );

  return (
    <CalendarView
      title="Calendario · Por empresa"
      mode="organizations"
      initialView="month"
      onSessionOpen={handleSessionOpen}
      onVariantOpen={handleVariantOpen}
    />
  );
}
