import type { ComponentProps } from 'react';
import { CalendarView } from '../../features/calendar/CalendarView';

type CalendarViewProps = ComponentProps<typeof CalendarView>;

export type PorFormadorPageProps = Pick<CalendarViewProps, 'onNotify' | 'onSessionOpen'>;

export default function PorFormadorPage({ onNotify, onSessionOpen }: PorFormadorPageProps) {
  return (
    <CalendarView
      title="Calendario · Por formador"
      mode="trainers"
      initialView="month"
      onNotify={onNotify}
      onSessionOpen={onSessionOpen}
    />
  );
}
