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
}): Promise<{ message: string }> {
  return postJson<{ message: string }>('/vacation-requests', payload);
}
