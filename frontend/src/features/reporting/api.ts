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

export type TrainerHoursFilters = {
  startDate?: string;
  endDate?: string;
};

export async function fetchTrainerHours(filters: TrainerHoursFilters = {}): Promise<TrainerHoursResponse> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }

  const query = params.toString();
  const url = query.length ? `/reporting-horas-formadores?${query}` : '/reporting-horas-formadores';
  return getJson<TrainerHoursResponse>(url);
}
