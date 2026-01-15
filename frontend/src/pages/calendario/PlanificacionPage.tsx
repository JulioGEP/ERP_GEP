import type { ComponentProps } from 'react';
import { useState } from 'react';
import { CalendarView } from '../../features/calendar/CalendarView';
import type { CalendarSession } from '../../features/calendar/api';
import { PlanningModal } from '../../features/calendar/PlanningModal';

type CalendarViewProps = ComponentProps<typeof CalendarView>;

export type PlanificacionPageProps = Pick<CalendarViewProps, 'onNotify' | 'onVariantOpen'>;

export default function PlanificacionPage({ onNotify, onVariantOpen }: PlanificacionPageProps) {
  const [activeSession, setActiveSession] = useState<CalendarSession | null>(null);

  return (
    <>
      <CalendarView
        title="Calendario · Planificación"
        mode="trainers"
        initialView="month"
        onNotify={onNotify}
        onSessionOpen={(session) => setActiveSession(session)}
        onVariantOpen={onVariantOpen}
      />
      <PlanningModal
        session={activeSession}
        show={Boolean(activeSession)}
        onClose={() => setActiveSession(null)}
        onNotify={onNotify}
      />
    </>
  );
}
