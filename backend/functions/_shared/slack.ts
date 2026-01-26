import type { PrismaClient } from '@prisma/client';

const SLACK_API_BASE = 'https://slack.com/api';

export const DEFAULT_SLACK_CHANNEL_ID = 'C063C7QRHK4';
export const SLACK_AVAILABILITY_USER_EMAIL = 'erp@geproup.es';

const VACATION_REASON_LABELS: Record<string, string> = {
  V: 'Vacaciones',
  L: 'Festivo Local',
  A: 'Día de Aniversario',
  T: 'Teletrabajo',
  M: 'Matrimonio',
  H: 'Motivo personal',
  F: 'Motivo personal',
  R: 'Motivo personal',
  P: 'Motivo personal',
  I: 'Motivo personal',
  N: 'Festivo Nacional',
  C: 'Festivo Autonómico',
  Y: 'No está disponible',
};

type SlackChannel = {
  id: string;
  name: string;
  is_private?: boolean;
};

type SlackApiResponse<T> = T & { ok: boolean; error?: string };

function formatSlackError(data: SlackApiResponse<any>, status: number): string {
  if (data?.error) return data.error;
  return `Slack API error (${status})`;
}

async function slackApiGet<T>(token: string, endpoint: string, params?: Record<string, string>) {
  const url = new URL(`${SLACK_API_BASE}/${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await response.json()) as SlackApiResponse<T>;

  if (!response.ok || !data.ok) {
    throw new Error(formatSlackError(data, response.status));
  }

  return data;
}

async function slackApiPost<T>(token: string, endpoint: string, body: Record<string, unknown>) {
  const response = await fetch(`${SLACK_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as SlackApiResponse<T>;

  if (!response.ok || !data.ok) {
    throw new Error(formatSlackError(data, response.status));
  }

  return data;
}

async function fetchSlackChannels(
  token: string,
  endpoint: 'users.conversations' | 'conversations.list',
  params: Record<string, string>,
) {
  let cursor: string | undefined;
  const channels: SlackChannel[] = [];

  do {
    const data = await slackApiGet<{ channels: SlackChannel[]; response_metadata?: { next_cursor?: string } }>(
      token,
      endpoint,
      { ...params, cursor: cursor ?? '' },
    );
    channels.push(...(data.channels ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return channels;
}

export async function listSlackChannels(token: string, email: string) {
  try {
    const userInfo = await slackApiGet<{ user: { id: string } }>(token, 'users.lookupByEmail', { email });
    const channels = await fetchSlackChannels(token, 'users.conversations', {
      user: userInfo.user.id,
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    });

    return channels;
  } catch (error) {
    console.warn('[slack] users.conversations fallback:', error);
  }

  return fetchSlackChannels(token, 'conversations.list', {
    types: 'public_channel,private_channel',
    exclude_archived: 'true',
    limit: '200',
  });
}

export async function postSlackMessage(token: string, channel: string, text: string) {
  await slackApiPost(token, 'chat.postMessage', { channel, text });
}

export type AvailabilityEntry = {
  fullName: string;
  type: string;
};

function formatMadridDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatFullName(firstName: string, lastName: string | null) {
  return `${firstName} ${lastName ?? ''}`.trim();
}

async function fetchAvailabilityEntries(prisma: PrismaClient, dateIso: string): Promise<AvailabilityEntry[]> {
  const date = new Date(`${dateIso}T00:00:00Z`);
  const records = await prisma.user_vacation_days.findMany({
    where: {
      date,
      user: {
        active: true,
        OR: [
          { role: { not: 'Formador' } },
          { role: 'Formador', trainer: { is: { contrato_fijo: true } } },
        ],
      },
    },
    include: {
      user: {
        select: { first_name: true, last_name: true },
      },
    },
    orderBy: [{ user: { first_name: 'asc' } }, { user: { last_name: 'asc' } }],
  });

  return records.map((record) => ({
    fullName: formatFullName(record.user.first_name, record.user.last_name),
    type: record.type,
  }));
}

function formatDaySection(label: string, entries: AvailabilityEntry[]) {
  if (!entries.length) {
    return `${label} - Estamos todos disponibles`;
  }

  const lines = entries.map((entry) => {
    const reason = VACATION_REASON_LABELS[entry.type] ?? 'No disponible';
    return `${entry.fullName} por ${reason}`;
  });

  return `${label} -\n${lines.join('\n')}`;
}

export async function buildAvailabilityMessage(prisma: PrismaClient, referenceDate: Date = new Date()) {
  const todayIso = formatMadridDate(referenceDate);
  const tomorrowIso = addDays(todayIso, 1);

  const [todayEntries, tomorrowEntries] = await Promise.all([
    fetchAvailabilityEntries(prisma, todayIso),
    fetchAvailabilityEntries(prisma, tomorrowIso),
  ]);

  const text = [
    '-Información de la disponibilidad del personal-',
    formatDaySection('Hoy', todayEntries),
    formatDaySection('Mañana', tomorrowEntries),
  ].join('\n');

  return {
    text,
    todayIso,
    tomorrowIso,
    todayEntries,
    tomorrowEntries,
    hasEntries: todayEntries.length > 0 || tomorrowEntries.length > 0,
  };
}
