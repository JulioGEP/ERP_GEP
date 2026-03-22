import type { Handler } from '@netlify/functions';

import { withDatabaseFallback } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO } from './_shared/timezone';
import { getSlackChannelId, getSlackToken } from './_shared/slackConfig';

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const TELEWORK_TYPE = 'T';
const JOB_NAME = 'daily-availability-slack';

type DailyGroup = {
  off: string[];
  telework: string[];
};

type VacationDayRow = {
  type: string | null;
  date: Date;
  user: {
    first_name: string;
    last_name: string;
    name: string | null;
  };
};

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cleanName(value: { first_name: string; last_name: string; name: string | null }): string {
  return String(value.name ?? '').trim() || `${value.first_name ?? ''} ${value.last_name ?? ''}`.trim() || 'Sin nombre';
}

function listNames(names: string[]): string {
  return names.length ? names.join(', ') : 'Nadie';
}

function buildMessage(today: string, tomorrow: string, grouped: Record<string, DailyGroup>): string {
  return [
    `Disponibilidad ${today}:`,
    `- No disponibles: ${listNames(grouped[today]?.off ?? [])}`,
    `- Teletrabajo: ${listNames(grouped[today]?.telework ?? [])}`,
    `Disponibilidad ${tomorrow}:`,
    `- No disponibles: ${listNames(grouped[tomorrow]?.off ?? [])}`,
    `- Teletrabajo: ${listNames(grouped[tomorrow]?.telework ?? [])}`,
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
      channel: getSlackChannelId(),
      text,
    }),
  });

  const payload = (await response.json()) as { ok?: boolean; error?: string };

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'No se pudo enviar el mensaje a Slack.');
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const token = getSlackToken();
  if (!token) {
    return errorResponse('SLACK_TOKEN_MISSING', 'No existe la variable SLACK_TOKEN en Netlify.', 500);
  }

  try {
    const today = nowInMadridISO().slice(0, 10);
    const tomorrow = addDays(today, 1);
    const targetDates = [today, tomorrow];

    const vacationDays = await withDatabaseFallback<VacationDayRow[]>(
      (client) =>
        client.user_vacation_days.findMany({
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
          orderBy: {
            date: 'asc',
          },
        }),
      { operationName: `${JOB_NAME}:user_vacation_days.findMany` },
    );

    const grouped: Record<string, DailyGroup> = {
      [today]: { off: [], telework: [] },
      [tomorrow]: { off: [], telework: [] },
    };

    for (const entry of vacationDays) {
      const date = entry.date.toISOString().slice(0, 10);
      const bucket = grouped[date];
      if (!bucket) continue;

      const name = cleanName(entry.user);
      if (entry.type === TELEWORK_TYPE) {
        if (!bucket.telework.includes(name)) bucket.telework.push(name);
      } else {
        if (!bucket.off.includes(name)) bucket.off.push(name);
      }
    }

    const text = buildMessage(today, tomorrow, grouped);
    await postSlackMessage(token, text);

    return successResponse({
      message: 'Mensaje enviado a Slack correctamente.',
      date: today,
      nextDate: tomorrow,
      channel: getSlackChannelId(),
      text,
      availability: grouped,
    });
  } catch (error) {
    console.error(`[${JOB_NAME}] Error`, error);
    const message = error instanceof Error ? error.message : 'Error inesperado al enviar el mensaje a Slack.';
    return errorResponse('SLACK_POST_FAILED', message, 500);
  }
};
