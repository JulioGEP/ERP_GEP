import type { Handler } from '@netlify/functions';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS } from './_shared/response';
import { buildMadridDateTime } from './_shared/time';
import { ensureMadridTimezone } from './_shared/timezone';

const CHANNEL_ID = 'C063C7QRHK4';
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_SENDER_NAME = 'ERP GEP Group';

const VACATION_REASON_BY_TYPE: Record<string, string> = {
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

const MADRID_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const MADRID_DATE_TIME_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

type MadridParts = { year: number; month: number; day: number; hour: number; minute: number };

function getMadridParts(date: Date): MadridParts {
  const parts = MADRID_DATE_TIME_PARTS.formatToParts(date);
  const value = (type: string) => Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function addMadridDays(base: MadridParts, days: number): MadridParts {
  const baseUtc = new Date(Date.UTC(base.year, base.month - 1, base.day + days, 12, 0, 0));
  return getMadridParts(baseUtc);
}

function formatMadridDate(date: Date): string {
  return MADRID_DATE_FORMATTER.format(date);
}

function buildMadridStart(parts: MadridParts): Date {
  return buildMadridDateTime({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0 });
}

type DayEntry = { name: string; reason: string };

function buildDaySection(label: string, entries: DayEntry[]): string {
  if (!entries.length) {
    return `${label} -\nEstamos todos disponibles`;
  }

  const lines = entries.map((entry) => `- ${entry.name} por ${entry.reason}`);
  return `${label} -\n${lines.join('\n')}`;
}

async function postSlackMessage(token: string, text: string): Promise<void> {
  const response = await fetch(SLACK_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: CHANNEL_ID,
      text,
      username: SLACK_SENDER_NAME,
    }),
  });

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

  if (!response.ok || !payload?.ok) {
    console.error('[slack-daily-availability] Error enviando mensaje a Slack', {
      status: response.status,
      error: payload?.error ?? 'unknown_error',
    });
  }
}

export const handler: Handler = async () => {
  ensureMadridTimezone();
  const token = process.env.SLACK_TOKEN?.trim();

  if (!token) {
    console.error('[slack-daily-availability] Falta SLACK_TOKEN en el entorno');
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Missing SLACK_TOKEN' }),
    };
  }

  const nowParts = getMadridParts(new Date());
  if (nowParts.hour !== 7) {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: true, skipped: true, reason: 'outside_schedule' }),
    };
  }

  const tomorrowParts = addMadridDays(nowParts, 1);
  const dayAfterParts = addMadridDays(nowParts, 2);

  const todayStart = buildMadridStart(nowParts);
  const tomorrowStart = buildMadridStart(tomorrowParts);
  const dayAfterStart = buildMadridStart(dayAfterParts);

  const todayKey = formatMadridDate(todayStart);
  const tomorrowKey = formatMadridDate(tomorrowStart);

  const prisma = getPrisma();
  const users = await prisma.users.findMany({
    where: {
      active: true,
      OR: [
        { role: { not: 'Formador' } },
        { role: 'Formador', trainer: { is: { contrato_fijo: true } } },
      ],
    },
    select: { id: true, first_name: true, last_name: true },
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
  });

  if (!users.length) {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: true, skipped: true, reason: 'no_users' }),
    };
  }

  const userNameById = new Map<string, string>(
    users.map((user) => [user.id, `${user.first_name} ${user.last_name}`.trim()]),
  );

  const userIds = users.map((user) => user.id);
  const days = await prisma.user_vacation_days.findMany({
    where: {
      user_id: { in: userIds },
      date: { gte: todayStart, lt: dayAfterStart },
    },
    select: { user_id: true, date: true, type: true },
  });

  const entriesByDate = new Map<string, DayEntry[]>();
  const seenByDate = new Map<string, Set<string>>();

  for (const day of days) {
    const reason = VACATION_REASON_BY_TYPE[day.type];
    if (!reason) continue;

    const dateKey = formatMadridDate(day.date);
    if (dateKey !== todayKey && dateKey !== tomorrowKey) continue;

    const name = userNameById.get(day.user_id) ?? 'Usuario desconocido';
    const uniqueKey = `${day.user_id}:${reason}`;
    const seen = seenByDate.get(dateKey) ?? new Set<string>();
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    seenByDate.set(dateKey, seen);

    const bucket = entriesByDate.get(dateKey) ?? [];
    bucket.push({ name, reason });
    entriesByDate.set(dateKey, bucket);
  }

  const todayEntries = entriesByDate.get(todayKey) ?? [];
  const tomorrowEntries = entriesByDate.get(tomorrowKey) ?? [];

  if (!todayEntries.length && !tomorrowEntries.length) {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: true, skipped: true, reason: 'no_absences' }),
    };
  }

  const message = [
    '-Información de la disponibilidad del personal-',
    buildDaySection('Hoy', todayEntries),
    buildDaySection('Mañana', tomorrowEntries),
  ].join('\n');

  await postSlackMessage(token, message);

  return {
    statusCode: 200,
    headers: COMMON_HEADERS,
    body: JSON.stringify({ ok: true, notified: true }),
  };
};
