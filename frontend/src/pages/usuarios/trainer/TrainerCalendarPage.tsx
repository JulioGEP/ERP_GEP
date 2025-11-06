import type { ComponentProps } from 'react';
import { TrainerCalendarPage as TrainerCalendarPageView } from '../../../routes/trainer/TrainerCalendarPage';

export type TrainerCalendarPageProps = ComponentProps<typeof TrainerCalendarPageView>;

export default function TrainerCalendarPage(props: TrainerCalendarPageProps) {
  return <TrainerCalendarPageView {...props} />;
}

