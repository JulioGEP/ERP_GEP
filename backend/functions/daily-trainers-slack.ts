import type { Handler } from '@netlify/functions';

import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO } from './_shared/timezone';

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_CHANNEL_ID = 'C063C7QRHK4';

type SessionSummary = {
  company: string;
  sessionName: string;
  trainers: string[];
};

function getMadridOffsetFromIso(isoValue: string): string {
  const match = isoValue.match(/([+-]\d{2}:\d{2})$/);
  return match?.[1] ?? '+00:00';
}

function buildMadridDayRange(todayIso: string): { day: string; startUtc: Date; endUtc: Date } {
  const day = todayIso.slice(0, 10);
  const offset = getMadridOffsetFromIso(todayIso);
  const startUtc = new Date(`${day}T00:00:00${offset}`);
  const endUtc = new Date(`${day}T23:59:59.999${offset}`);
  return { day, startUtc, endUtc };
}

function normalizeText(value: string | null | undefined, fallback: string): string {
  const text = String(value ?? '').trim();
  return text.length ? text : fallback;
}

function formatTrainerList(names: string[]): string {
  if (names.length === 0) return 'Sin formador asignado';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function buildSlackMessage(sessions: SessionSummary[]): string {
  if (!sessions.length) {
    return ['Hoy no hay sesiones con formadores asignados.', 'De tu querido Bot', '¡Gracias!'].join('\n');
  }

  const lines = sessions.map(
    (session) =>
      `- ${formatTrainerList(session.trainers)} en ${session.company} haciendo ${session.sessionName}`,
  );

  return ['Hoy tenemos a', ...lines, 'De tu querido Bot', '¡Gracias!'].join('\n');
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

  const rawBody = await response.text();
  let payload: { ok?: boolean; error?: string } | null = null;

  try {
    payload = rawBody ? (JSON.parse(rawBody) as { ok?: boolean; error?: string }) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const slackError = payload?.error ? ` (${payload.error})` : '';
    const rawDetails = rawBody ? ` | body=${rawBody}` : '';
    throw new Error(`Slack API chat.postMessage falló${slackError}${rawDetails}`);
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
    const todayIso = nowInMadridISO();
    const { day, startUtc, endUtc } = buildMadridDayRange(todayIso);

    const sessionRows = await prisma.sesiones.findMany({
      where: {
        fecha_inicio_utc: {
          gte: startUtc,
          lte: endUtc,
        },
      },
      select: {
        id: true,
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
      orderBy: [{ fecha_inicio_utc: 'asc' }, { created_at: 'asc' }],
    });

    const sessions: SessionSummary[] = sessionRows.map((row) => {
      const trainerNames = Array.from(
        new Set<string>(
          (row.sesion_trainers ?? [])
            .map((entry) => normalizeText(entry.trainers?.name, ''))
            .filter((name) => name.length),
        ),
      ).sort((a, b) => a.localeCompare(b, 'es'));

      return {
        company: normalizeText(row.deals?.organizations?.name, normalizeText(row.deals?.title, 'Empresa sin nombre')),
        sessionName: normalizeText(row.nombre_cache, 'Sesión sin nombre'),
        trainers: trainerNames,
      };
    });

    const text = buildSlackMessage(sessions);
    await postSlackMessage(token, text);

    return successResponse({
      message: 'Mensaje de formadores enviado a Slack correctamente.',
      date: day,
      channel: SLACK_CHANNEL_ID,
      text,
      sessions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error inesperado al enviar el mensaje a Slack.';
    return errorResponse('SLACK_POST_FAILED', errorMessage, 500);
  }
};

