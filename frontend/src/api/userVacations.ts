// frontend/src/api/userVacations.ts
import { delJson, getJson, patchJson, postJson } from './client';

export type VacationType = 'V' | 'L' | 'A' | 'T' | 'M' | 'H' | 'F' | 'R' | 'P' | 'I' | 'N' | 'C' | 'Y';

export type UserVacationDay = {
  date: string; // ISO YYYY-MM-DD
  type: VacationType;
};

export type UserVacationsResponse = {
  year: number;
  allowance: number;
  anniversaryAllowance: number;
  localHolidayAllowance: number;
  previousYearAllowance: number;
  totalAllowance: number;
  enjoyed: number;
  remaining: number;
  counts: Record<VacationType, number>;
  days: UserVacationDay[];
  updatedDate?: string;
};

export type VacationSummaryUser = {
  userId: string;
  fullName: string;
  role: string;
  active: boolean;
  trainerThirtyThree: boolean;
  allowance: number;
  anniversaryAllowance: number;
  localHolidayAllowance: number;
  previousYearAllowance: number;
  totalAllowance: number;
  enjoyed: number;
  remaining: number;
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

export type VacationJustificationUpload = {
  fileName: string;
  mimeType?: string | null;
  fileSize?: number;
  contentBase64: string;
};

export type VacationRequestPayload = {
  startDate: string;
  endDate: string;
  notes?: string;
  tag?: VacationType | '';
  justification?: VacationJustificationUpload | null;
};

export type VacationRequestItem = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  startDate: string;
  endDate: string;
  tag: VacationType | null;
  notes?: string | null;
  createdAt: string;
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
  anniversaryAllowance: number;
  localHolidayAllowance: number;
  previousYearAllowance: number;
}): Promise<UserVacationsResponse> {
  return patchJson<UserVacationsResponse>('/user-vacations', payload);
}

export async function sendVacationRequest(payload: VacationRequestPayload): Promise<{ message: string }> {
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
  dates: string[];
  type: VacationType;
  userIds: string[];
}): Promise<{
  dates: string[];
  updated: Array<UserVacationsResponse & { userId: string }>;
  ignoredUserIds?: string[];
}> {
  return postJson<{
    dates: string[];
    updated: Array<UserVacationsResponse & { userId: string }>;
    ignoredUserIds?: string[];
  }>('/user-vacations-bulk', payload);
}

export async function fetchVacationRequests(): Promise<VacationRequestItem[]> {
  const response = await getJson<{ requests: VacationRequestItem[] }>('/vacation-requests');
  return response.requests ?? [];
}

export async function deleteVacationRequest(id: string): Promise<{ message: string }> {
  const searchParams = new URLSearchParams({ id });
  return delJson<{ message: string }>(`/vacation-requests?${searchParams.toString()}`);
}

export async function acceptVacationRequest(id: string): Promise<{ message: string; appliedDates: string[] }> {
  return patchJson<{ message: string; appliedDates: string[] }>('/vacation-requests', { id });
}
