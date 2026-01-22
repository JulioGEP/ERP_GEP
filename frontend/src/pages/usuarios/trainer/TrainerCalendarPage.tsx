import type { ComponentProps } from 'react';
import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarView } from '../../../features/calendar/CalendarView';
import type { CalendarSession, CalendarVariantEvent } from '../../../features/calendar/api';
import { useAuth } from '../../../context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { fetchTrainers } from '../../../features/recursos/api';

const MADRID_TIMEZONE = 'Europe/Madrid';
const SPECIAL_TRAINER_EMAILS = new Set(['laura@gepgroup.es', 'ramon@gepgroup.es']);
const SPECIAL_ROOM_NAME = 'gep arganda';
const SPECIAL_VARIANT_SEDE = 'madrid';

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

type CalendarViewProps = ComponentProps<typeof CalendarView>;

export type TrainerCalendarPageProps = Pick<
  CalendarViewProps,
  'onNotify' | 'onSessionOpen' | 'onVariantOpen'
>;

export default function TrainerCalendarPage({
  onNotify,
  onSessionOpen,
  onVariantOpen,
}: TrainerCalendarPageProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const trainerId = user?.trainerId ?? null;
  const normalizedEmail = user?.email?.trim().toLowerCase() ?? '';
  const isSpecialTrainer = SPECIAL_TRAINER_EMAILS.has(normalizedEmail);

  const trainersQuery = useQuery({
    queryKey: ['trainers', 'calendar-visibility'],
    queryFn: fetchTrainers,
    enabled: isSpecialTrainer,
    staleTime: 5 * 60 * 1000,
  });

  const allowedTrainerIds = useMemo(() => {
    const ids = new Set<string>();
    if (trainerId) {
      ids.add(trainerId);
    }
    if (!isSpecialTrainer) {
      return Array.from(ids);
    }
    const trainers = trainersQuery.data ?? [];
    trainers.forEach((trainer) => {
      const email = trainer.email?.trim().toLowerCase();
      if (email && SPECIAL_TRAINER_EMAILS.has(email)) {
        ids.add(trainer.trainer_id);
      }
    });
    return Array.from(ids);
  }, [trainerId, trainersQuery.data, isSpecialTrainer]);

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
      if (isSpecialTrainer && onSessionOpen) {
        onSessionOpen(session);
        return;
      }
      handleCalendarNavigate(getMadridDateKey(session.start));
    },
    [handleCalendarNavigate, isSpecialTrainer, onSessionOpen],
  );

  const handleVariantOpen = useCallback(
    (variant: CalendarVariantEvent) => {
      if (isSpecialTrainer && onVariantOpen) {
        onVariantOpen(variant);
        return;
      }
      handleCalendarNavigate(getMadridDateKey(variant.start));
    },
    [handleCalendarNavigate, isSpecialTrainer, onVariantOpen],
  );

  const sessionFilter = useCallback(
    (session: CalendarSession) => {
      if (!isSpecialTrainer) return true;
      const normalizedRoom = session.room?.name?.trim().toLowerCase() ?? '';
      const matchesRoom = normalizedRoom === SPECIAL_ROOM_NAME;
      const matchesTrainer =
        allowedTrainerIds.length > 0 &&
        session.trainers.some((trainer) => allowedTrainerIds.includes(trainer.id));
      return matchesRoom || matchesTrainer;
    },
    [allowedTrainerIds, isSpecialTrainer],
  );

  const variantFilter = useCallback(
    (variant: CalendarVariantEvent) => {
      if (!isSpecialTrainer) return true;
      const normalizedSede = variant.variant.sede?.trim().toLowerCase() ?? '';
      const matchesSede = normalizedSede === SPECIAL_VARIANT_SEDE;
      const trainerIds = new Set<string>();
      if (variant.variant.trainer_id) trainerIds.add(variant.variant.trainer_id);
      variant.variant.trainer_ids?.forEach((id) => trainerIds.add(id));
      variant.variant.trainers?.forEach((trainer) => {
        if (trainer.trainer_id) trainerIds.add(trainer.trainer_id);
      });
      const matchesTrainer =
        allowedTrainerIds.length > 0 && Array.from(trainerIds).some((id) => allowedTrainerIds.includes(id));
      return matchesSede || matchesTrainer;
    },
    [allowedTrainerIds, isSpecialTrainer],
  );

  return (
    <CalendarView
      title="Calendario · Por empresa"
      mode="organizations"
      initialView="month"
      trainerId={isSpecialTrainer ? null : trainerId}
      onSessionOpen={handleSessionOpen}
      onVariantOpen={handleVariantOpen}
      onNotify={onNotify}
      sessionFilter={isSpecialTrainer ? sessionFilter : undefined}
      variantFilter={isSpecialTrainer ? variantFilter : undefined}
    />
  );
}
