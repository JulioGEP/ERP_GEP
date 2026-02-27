import type { Handler } from '@netlify/functions';

import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO } from './_shared/timezone';

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_CHANNEL_ID = 'C063C7QRHK4';
const TELEWORK_TYPE = 'T';
const NETLIFY_SCHEDULE_HEADER = 'x-netlify-event';
const MADRID_SEND_HOUR = '07';
const MADRID_SEND_START_MINUTE = 0;
const MADRID_SEND_END_MINUTE = 20;

type DailyGroup = {
  off: string[];
  telework: string[];
};

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function getWeekdayNameEs(dateOnly: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    timeZone: 'Europe/Madrid',
  }).format(new Date(`${dateOnly}T12:00:00Z`));
}

function toTitleCase(text: string): string {
  if (!text.length) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatNames(names: string[]): string {
  return names.length ? names.join(' / ') : 'Nadie';
}

function isScheduledInvocation(event: Parameters<Handler>[0]): boolean {
  const scheduleHeader = event.headers?.[NETLIFY_SCHEDULE_HEADER] ?? event.headers?.[NETLIFY_SCHEDULE_HEADER.toUpperCase()];
  return String(scheduleHeader ?? '').toLowerCase() === 'schedule';
}

function isWithinMadridSendWindow(isoDateTime: string, startMinute: number, endMinute: number): boolean {
  const timePart = isoDateTime.split('T')[1] ?? '';
  const [hour = '', minute = ''] = timePart.split(':');
  const minuteNumber = Number.parseInt(minute, 10);
  return (
    hour === MADRID_SEND_HOUR &&
    Number.isInteger(minuteNumber) &&
    minuteNumber >= startMinute &&
    minuteNumber <= endMinute
  );
}

function normalizePersonName(entry: { first_name: string; last_name: string; name: string | null }): string {
  const nameField = String(entry.name ?? '').trim();
  if (nameField.length) return nameField;

  const firstName = String(entry.first_name ?? '').trim();
  const lastName = String(entry.last_name ?? '').trim();
  return `${firstName} ${lastName}`.trim() || 'Sin nombre';
}

function buildSlackMessage(today: string, tomorrow: string, grouped: Record<string, DailyGroup>): string {
  const todayName = toTitleCase(getWeekdayNameEs(today));
  const tomorrowName = toTitleCase(getWeekdayNameEs(tomorrow));
  const todayGroup = grouped[today] ?? { off: [], telework: [] };
  const tomorrowGroup = grouped[tomorrow] ?? { off: [], telework: [] };

  return [
    `${todayName}:`,
    `Hoy ${todayName} no estarán disponibles por días libres: ${formatNames(todayGroup.off)}.`,
    `Además hoy teletrabaja: ${formatNames(todayGroup.telework)}.`,
    `Mañana ${tomorrowName} no estarán disponibles por días libres: ${formatNames(tomorrowGroup.off)}.`,
    `Además mañana teletrabajarán: ${formatNames(tomorrowGroup.telework)}.`,
    'Tu chat bot preferido :)',
  ].join('\n');
}

async function postSlackMessage(token: string, text: string): Promise<void> {
  const response = await fetch(SLACK_API_URL, {
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

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

  if (!response.ok || !payload?.ok) {
    const details = payload?.error ? ` (${payload.error})` : '';
    throw new Error(`Slack API chat.postMessage falló${details}`);
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const token = String(process.env.SLACK_TOKEN ?? '').trim();
  if (!token.length) {
    return errorResponse('SLACK_TOKEN_MISSING', 'No existe la variable SLACK_TOKEN en Netlify.', 500);
  }

  try {
    const prisma = getPrisma();
    const nowMadrid = nowInMadridISO();
    if (isScheduledInvocation(event) && !isWithinMadridSendWindow(nowMadrid, MADRID_SEND_START_MINUTE, MADRID_SEND_END_MINUTE)) {
      return successResponse({
        message: 'Invocación programada fuera del horario de envío. Se omite.',
        nowMadrid,
      });
    }

    const today = nowMadrid.slice(0, 10);
    const tomorrow = addDaysToDateOnly(today, 1);
    const targetDates = [today, tomorrow];

    const vacationDays = await prisma.user_vacation_days.findMany({
      where: {
        date: {
          in: targetDates.map((date) => new Date(`${date}T00:00:00Z`)),
        },
        user: {
          active: true,
        },
      },
      select: {
        type: true,
        date: true,
        user: {
          select: {
            first_name: true,
            last_name: true,
            name: true,
          },
        },
      },
      orderBy: [
        { date: 'asc' },
        { user: { first_name: 'asc' } },
        { user: { last_name: 'asc' } },
      ],
    });

    const grouped: Record<string, DailyGroup> = {
      [today]: { off: [], telework: [] },
      [tomorrow]: { off: [], telework: [] },
    };

    for (const entry of vacationDays) {
      const dateKey = entry.date.toISOString().slice(0, 10);
      const bucket = grouped[dateKey];
      if (!bucket) continue;

      const personName = normalizePersonName(entry.user);
      if (entry.type === TELEWORK_TYPE) {
        if (!bucket.telework.includes(personName)) {
          bucket.telework.push(personName);
        }
      } else if (!bucket.off.includes(personName)) {
        bucket.off.push(personName);
      }
    }

    grouped[today].off.sort((a, b) => a.localeCompare(b, 'es'));
    grouped[today].telework.sort((a, b) => a.localeCompare(b, 'es'));
    grouped[tomorrow].off.sort((a, b) => a.localeCompare(b, 'es'));
    grouped[tomorrow].telework.sort((a, b) => a.localeCompare(b, 'es'));

    const text = buildSlackMessage(today, tomorrow, grouped);
    await postSlackMessage(token, text);

    return successResponse({
      message: 'Mensaje enviado a Slack correctamente.',
      date: today,
      nextDate: tomorrow,
      channel: SLACK_CHANNEL_ID,
      text,
      availability: grouped,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error inesperado al enviar el mensaje a Slack.';
    return errorResponse('SLACK_POST_FAILED', errorMessage, 500);
  }
};
