import { getJson, postJson } from './client';

export type TrainerCalendarStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  totalEvents: number;
};

export async function fetchTrainerCalendarStatus() {
  return getJson<TrainerCalendarStatus>('/trainer-calendar/status');
}

export async function startTrainerCalendarOAuth(returnTo?: string) {
  return postJson<{ url: string }>('/trainer-calendar/oauth/start', {
    returnTo,
  });
}

export async function disconnectTrainerCalendar() {
  return postJson<{ ok: boolean }>('/trainer-calendar/disconnect', {});
}

export async function syncTrainerCalendar() {
  return postJson<{ ok: boolean }>('/trainer-calendar/sync', {});
}
