// frontend/src/api/userVacations.ts
import { getJson, patchJson, postJson } from './client';

export type VacationType = 'A' | 'F' | 'L' | 'C' | 'T';

export type UserVacationDay = {
  date: string; // ISO YYYY-MM-DD
  type: VacationType;
};

export type UserVacationsResponse = {
  year: number;
  allowance: number | null;
  enjoyed: number;
  remaining: number | null;
  counts: Record<VacationType, number>;
  days: UserVacationDay[];
  updatedDate?: string;
};

export type VacationSummaryUser = {
  userId: string;
  fullName: string;
  role: string;
  active: boolean;
  allowance: number | null;
  enjoyed: number;
  remaining: number | null;
  counts: Record<VacationType, number>;
  upcomingDates: string[];
  days: UserVacationDay[];
  lastUpdated: string | null;
};

export type VacationSummaryResponse = {
  year: number;
  generatedAt: string;
  users: VacationSummaryUser[];
};

export async function fetchUserVacations(userId: string, year?: number): Promise<UserVacationsResponse> {
  const searchParams = new URLSearchParams({ userId });
  if (year) searchParams.set('year', String(year));
  return getJson<UserVacationsResponse>(`/user-vacations?${searchParams.toString()}`);
}

export async function saveUserVacationDay(payload: {
  userId: string;
  date: string;
  type: VacationType | '';
}): Promise<UserVacationsResponse> {
  return postJson<UserVacationsResponse>('/user-vacations', payload);
}

export async function updateVacationAllowance(payload: {
  userId: string;
  year: number;
  allowance: number;
}): Promise<UserVacationsResponse> {
  return patchJson<UserVacationsResponse>('/user-vacations', payload);
}

export async function sendVacationRequest(payload: {
  startDate: string;
  endDate: string;
  notes?: string;
  tag?: VacationType | '';
}): Promise<{ message: string }> {
  return postJson<{ message: string }>('/vacation-requests', payload);
}

export async function fetchVacationsSummary(year?: number): Promise<VacationSummaryResponse> {
  const searchParams = new URLSearchParams();
  if (year) searchParams.set('year', String(year));
  const query = searchParams.toString();
  const url = query.length ? `/user-vacations-summary?${query}` : '/user-vacations-summary';
  return getJson<VacationSummaryResponse>(url);
}

export async function applyBulkVacationDay(payload: {
  date: string;
  type: VacationType;
  userIds: string[];
}): Promise<{ date: string; updated: Array<UserVacationsResponse & { userId: string }> }> {
  return postJson<{ date: string; updated: Array<UserVacationsResponse & { userId: string }> }>(
    '/user-vacations-bulk',
    payload,
  );
}
