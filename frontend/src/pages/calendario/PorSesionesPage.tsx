import type { ComponentProps } from 'react';
import { CalendarView } from '../../features/calendar/CalendarView';

type CalendarViewProps = ComponentProps<typeof CalendarView>;

export type PorSesionesPageProps = Pick<CalendarViewProps, 'onNotify' | 'onSessionOpen'>;

export default function PorSesionesPage({ onNotify, onSessionOpen }: PorSesionesPageProps) {
  return (
    <CalendarView
      title="Calendario · Por sesiones"
      mode="sessions"
      onNotify={onNotify}
      onSessionOpen={onSessionOpen}
    />
  );
}
