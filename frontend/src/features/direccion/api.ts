import { getJson } from '../../api/client';

export type TrainerHoursItem = {
  trainerId: string;
  name: string | null;
  lastName: string | null;
  sessionCount: number;
  totalHours: number;
};

export type TrainerHoursResponse = {
  items: TrainerHoursItem[];
  summary: {
    totalSessions: number;
    totalHours: number;
  };
};

export async function fetchTrainerHours(): Promise<TrainerHoursResponse> {
  return getJson<TrainerHoursResponse>('/direccion-horas-formadores');
}
