import type { ComponentProps } from 'react';
import { CalendarView } from '../../features/calendar/CalendarView';

type CalendarViewProps = ComponentProps<typeof CalendarView>;

export type PorFormadorPageProps = Pick<CalendarViewProps, 'onNotify' | 'onSessionOpen' | 'onVariantOpen'>;

export default function PorFormadorPage({ onNotify, onSessionOpen, onVariantOpen }: PorFormadorPageProps) {
  return (
    <CalendarView
      title="Calendario · Por formador"
      mode="trainers"
      initialView="month"
      onNotify={onNotify}
      onSessionOpen={onSessionOpen}
      onVariantOpen={onVariantOpen}
    />
  );
}
