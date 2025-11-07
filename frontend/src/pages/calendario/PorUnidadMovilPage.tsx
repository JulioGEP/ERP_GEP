import type { ComponentProps } from 'react';
import { CalendarView } from '../../features/calendar/CalendarView';

type CalendarViewProps = ComponentProps<typeof CalendarView>;

export type PorUnidadMovilPageProps = Pick<CalendarViewProps, 'onNotify' | 'onSessionOpen' | 'onVariantOpen'>;

export default function PorUnidadMovilPage({ onNotify, onSessionOpen, onVariantOpen }: PorUnidadMovilPageProps) {
  return (
    <CalendarView
      title="Calendario · Por unidad móvil"
      mode="units"
      initialView="month"
      onNotify={onNotify}
      onSessionOpen={onSessionOpen}
      onVariantOpen={onVariantOpen}
    />
  );
}
