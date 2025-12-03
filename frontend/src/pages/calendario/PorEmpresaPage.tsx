import type { ComponentProps } from 'react';
import { CalendarView } from '../../features/calendar/CalendarView';

type CalendarViewProps = ComponentProps<typeof CalendarView>;

export type PorEmpresaPageProps = Pick<CalendarViewProps, 'onNotify' | 'onSessionOpen' | 'onVariantOpen'>;

export default function PorEmpresaPage({ onNotify, onSessionOpen, onVariantOpen }: PorEmpresaPageProps) {
  return (
    <CalendarView
      title="Calendario · Por empresa"
      mode="organizations"
      initialView="month"
      onNotify={onNotify}
      onSessionOpen={onSessionOpen}
      onVariantOpen={onVariantOpen}
    />
  );
}
