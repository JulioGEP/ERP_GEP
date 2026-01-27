import type { Handler } from '@netlify/functions';
import { getPrisma } from './_shared/prisma';
import { requireEnv } from './_shared/env';
import { formatDateOnly } from './_shared/vacations';
import { nowInMadridISO } from './_shared/timezone';

const SLACK_CHANNEL_ID = 'C063C7QRHK4';

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

function toUtcDateOnly(isoDate: string): Date {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function resolveReason(type: string): string | null {
  return VACATION_REASON_LABELS[type] ?? null;
}

async function postSlackMessage(token: string, text: string): Promise<void> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: SLACK_CHANNEL_ID,
      text,
    }),
  });

  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !payload.ok) {
    const errorMessage = payload?.error ? `Slack API error: ${payload.error}` : 'Slack API error';
    throw new Error(errorMessage);
  }
}

function buildBlock(label: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [`${label} - Estamos todos disponibles`];
  }
  return [`${label} -`, ...lines];
}

export const handler: Handler = async () => {
  const madridNow = nowInMadridISO();
  const madridHour = Number(madridNow.slice(11, 13));

  if (madridHour !== 7) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: 'outside_schedule', madridNow }),
    };
  }

  const todayUtc = toUtcDateOnly(madridNow);
  const tomorrowUtc = addUtcDays(todayUtc, 1);
  const dayAfterTomorrowUtc = addUtcDays(todayUtc, 2);

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

  if (users.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: 'no_users' }),
    };
  }

  const userIds = users.map((user) => user.id);

  const days = await prisma.user_vacation_days.findMany({
    where: {
      user_id: { in: userIds },
      date: { gte: todayUtc, lt: dayAfterTomorrowUtc },
    },
    select: { user_id: true, date: true, type: true },
    orderBy: [{ date: 'asc' }, { user_id: 'asc' }],
  });

  const entriesByDate = new Map<string, Map<string, string>>();

  for (const day of days) {
    const reason = resolveReason(day.type);
    if (!reason) continue;
    const dateKey = formatDateOnly(day.date);
    const bucket = entriesByDate.get(dateKey) ?? new Map<string, string>();
    bucket.set(day.user_id, reason);
    entriesByDate.set(dateKey, bucket);
  }

  const todayKey = formatDateOnly(todayUtc);
  const tomorrowKey = formatDateOnly(tomorrowUtc);

  const todayLines: string[] = [];
  const tomorrowLines: string[] = [];

  for (const user of users) {
    const fullName = buildFullName(user.first_name, user.last_name);
    const todayReason = entriesByDate.get(todayKey)?.get(user.id);
    if (todayReason) {
      todayLines.push(`${fullName} por ${todayReason}`);
    }

    const tomorrowReason = entriesByDate.get(tomorrowKey)?.get(user.id);
    if (tomorrowReason) {
      tomorrowLines.push(`${fullName} por ${tomorrowReason}`);
    }
  }

  if (todayLines.length === 0 && tomorrowLines.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: 'no_incidents' }),
    };
  }

  const messageLines = [
    '*Información de la disponibilidad del personal*',
    ...buildBlock('Hoy', todayLines),
    ...buildBlock('Mañana', tomorrowLines),
  ];

  const message = messageLines.join('\n');

  const slackToken = requireEnv('SLACK_TOKEN');
  await postSlackMessage(slackToken, message);

  return {
    statusCode: 200,
    body: JSON.stringify({
      sent: true,
      todayCount: todayLines.length,
      tomorrowCount: tomorrowLines.length,
    }),
  };
};
