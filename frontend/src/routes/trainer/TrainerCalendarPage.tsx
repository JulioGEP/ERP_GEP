import type { ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Spinner } from 'react-bootstrap';
import { CalendarView } from '../../features/calendar/CalendarView';
import { fetchTrainerProfile } from '../../api/trainer';
import { TRAINER_PROFILE_QUERY_KEY } from './queryKeys';

type CalendarViewProps = ComponentProps<typeof CalendarView>;

export type TrainerCalendarPageProps = Pick<
  CalendarViewProps,
  'onNotify' | 'onSessionOpen' | 'onDealOpen'
>;

export function TrainerCalendarPage({ onNotify, onSessionOpen, onDealOpen }: TrainerCalendarPageProps) {
  const profileQuery = useQuery({ queryKey: TRAINER_PROFILE_QUERY_KEY, queryFn: fetchTrainerProfile });

  if (profileQuery.isLoading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  if (profileQuery.error) {
    return <Alert variant="danger">No se pudo cargar el perfil del formador.</Alert>;
  }

  const trainerId = profileQuery.data?.trainer_id;
  if (!trainerId) {
    return <Alert variant="warning">No hay un formador asociado a este usuario.</Alert>;
  }

  return (
    <CalendarView
      title="Calendario · Sesiones asignadas"
      mode="sessions"
      trainerId={trainerId}
      showFilters={false}
      onNotify={onNotify}
      onSessionOpen={onSessionOpen}
      onDealOpen={onDealOpen}
    />
  );
}

