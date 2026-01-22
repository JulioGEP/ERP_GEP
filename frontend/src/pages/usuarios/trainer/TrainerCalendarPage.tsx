import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CalendarView } from '../../../features/calendar/CalendarView';
import type { CalendarSession, CalendarVariantEvent } from '../../../features/calendar/api';
import { useAuth } from '../../../context/AuthContext';
import { fetchTrainers } from '../../../features/recursos/api';

const MADRID_TIMEZONE = 'Europe/Madrid';
const SHARED_CALENDAR_ROOM = 'GEP Arganda';
const SHARED_CALENDAR_SEDE = 'Madrid';
const LAURA_EMAIL = 'laura@gepgroup.es';
const RAMON_EMAIL = 'ramon@gepgroup.es';

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
  const { user } = useAuth();
  const trainerId = user?.trainerId ?? null;
  const normalizedEmail = useMemo(() => user?.email?.trim().toLowerCase() ?? '', [user?.email]);
  const sharedTrainerEmail = useMemo(() => {
    if (normalizedEmail === LAURA_EMAIL) {
      return RAMON_EMAIL;
    }
    if (normalizedEmail === RAMON_EMAIL) {
      return LAURA_EMAIL;
    }
    return null;
  }, [normalizedEmail]);

  const trainersQuery = useQuery({
    queryKey: ['trainers', 'calendar-shared'],
    queryFn: fetchTrainers,
    enabled: Boolean(sharedTrainerEmail),
  });

  const sharedTrainerId = useMemo(() => {
    if (!sharedTrainerEmail) {
      return null;
    }
    return (
      trainersQuery.data?.find(
        (trainer) => trainer.email?.trim().toLowerCase() === sharedTrainerEmail,
      )?.trainer_id ?? null
    );
  }, [sharedTrainerEmail, trainersQuery.data]);

  const sharedTrainerIds = useMemo(() => {
    const ids = new Set<string>();
    if (trainerId) {
      ids.add(trainerId);
    }
    if (sharedTrainerId) {
      ids.add(sharedTrainerId);
    }
    return ids;
  }, [trainerId, sharedTrainerId]);

  const shouldApplySharedCalendar = Boolean(sharedTrainerEmail);

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

  const sessionFilter = useCallback(
    (session: CalendarSession) => {
      const matchesTrainer = session.trainers.some((trainer) => sharedTrainerIds.has(trainer.id));
      const roomName = session.room?.name?.trim().toLowerCase() ?? '';
      const matchesRoom = roomName === SHARED_CALENDAR_ROOM.toLowerCase();
      return matchesTrainer || matchesRoom;
    },
    [sharedTrainerIds],
  );

  const variantFilter = useCallback(
    (variant: CalendarVariantEvent) => {
      const trainers = variant.variant.trainers?.length
        ? variant.variant.trainers
        : variant.variant.trainer
        ? [variant.variant.trainer]
        : [];
      const matchesTrainer = trainers.some((trainer) => sharedTrainerIds.has(trainer.trainer_id));
      const sede = variant.variant.sede?.trim().toLowerCase() ?? '';
      const matchesSede = sede === SHARED_CALENDAR_SEDE.toLowerCase();
      return matchesTrainer || matchesSede;
    },
    [sharedTrainerIds],
  );

  return (
    <CalendarView
      title="Calendario · Por empresa"
      mode="organizations"
      initialView="month"
      trainerId={trainerId}
      fetchAllSessions={shouldApplySharedCalendar}
      sessionFilter={shouldApplySharedCalendar ? sessionFilter : undefined}
      variantFilter={shouldApplySharedCalendar ? variantFilter : undefined}
      onSessionOpen={handleSessionOpen}
      onVariantOpen={handleVariantOpen}
    />
  );
}
