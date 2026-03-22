import type { Handler } from '@netlify/functions';

import { withDatabaseFallback } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO } from './_shared/timezone';
import { getSlackChannelId, getSlackToken } from './_shared/slackConfig';

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const JOB_NAME = 'daily-trainers-slack';

type SessionSummary = {
  company: string;
  sessionName: string;
  trainers: string[];
};

type SessionRow = {
  nombre_cache: string | null;
  deals: {
    title: string | null;
    organizations: {
      name: string | null;
    } | null;
  } | null;
  sesion_trainers: Array<{
    trainers: {
      name: string | null;
    } | null;
  }>;
};

function buildMadridDayRange(todayIso: string): { day: string; startUtc: Date; endUtc: Date } {
  const day = todayIso.slice(0, 10);
  const offset = todayIso.match(/([+-]\d{2}:\d{2})$/)?.[1] ?? '+00:00';
  const startUtc = new Date(`${day}T00:00:00${offset}`);
  const endUtc = new Date(`${day}T23:59:59.999${offset}`);

  return { day, startUtc, endUtc };
}

function cleanText(value: string | null | undefined, fallback: string): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatTrainerList(trainers: string[]): string {
  if (trainers.length === 0) return 'Sin formador asignado';
  return trainers.join(', ');
}

function buildSlackMessage(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return 'Hoy no hay sesiones con formadores asignados.';
  }

  return [
    'Formadores de hoy:',
    ...sessions.map(
      (session) =>
        `- ${formatTrainerList(session.trainers)} | ${session.company} | ${session.sessionName}`,
    ),
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
    const todayIso = nowInMadridISO();
    const { day, startUtc, endUtc } = buildMadridDayRange(todayIso);

    const sessionRows = await withDatabaseFallback<SessionRow[]>(
      (client) =>
        client.sesiones.findMany({
          where: {
            fecha_inicio_utc: {
              gte: startUtc,
              lte: endUtc,
            },
          },
          select: {
            nombre_cache: true,
            deals: {
              select: {
                title: true,
                organizations: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            sesion_trainers: {
              select: {
                trainers: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: {
            fecha_inicio_utc: 'asc',
          },
        }),
      { operationName: `${JOB_NAME}:sesiones.findMany` },
    );

    const sessions: SessionSummary[] = sessionRows.map((row) => ({
      company: cleanText(row.deals?.organizations?.name, cleanText(row.deals?.title, 'Empresa sin nombre')),
      sessionName: cleanText(row.nombre_cache, 'Sesión sin nombre'),
      trainers: Array.from(
        new Set(
          (row.sesion_trainers ?? [])
            .map((entry) => cleanText(entry.trainers?.name, ''))
            .filter(Boolean),
        ),
      ),
    }));

    const text = buildSlackMessage(sessions);
    await postSlackMessage(token, text);

    return successResponse({
      message: 'Mensaje de formadores enviado a Slack correctamente.',
      date: day,
      channel: getSlackChannelId(),
      text,
      sessions,
    });
  } catch (error) {
    console.error(`[${JOB_NAME}] Error`, error);
    const message = error instanceof Error ? error.message : 'Error inesperado al enviar el mensaje a Slack.';
    return errorResponse('SLACK_POST_FAILED', message, 500);
  }
};
