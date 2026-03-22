import type { Handler } from '@netlify/functions';

import { getPrisma, withDatabaseFallback } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { getSlackRetryOptions, postSlackMessageWithRetry } from './_shared/slackPost';
import { nowInMadridISO } from './_shared/timezone';
import { isScheduledInvocation, isWithinMadridAutomationWindow } from './_shared/slackSchedule';
import { getSlackChannelId, getSlackToken } from './_shared/slackConfig';

const JOB_NAME = 'daily-trainers-slack';
type SessionSummary = {
  company: string;
  sessionName: string;
  trainers: string[];
};
type SessionRow = {
  id: string | number;
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
type SessionRowsResult = SessionRow[];

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

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const token = getSlackToken();
  if (!token.length) {
    return errorResponse('SLACK_TOKEN_MISSING', 'No existe la variable SLACK_TOKEN en Netlify.', 500);
  }

  try {
    const todayIso = nowInMadridISO();
    const isScheduledEvent = isScheduledInvocation(event);
    const force = String(event.queryStringParameters?.force ?? '').toLowerCase();
    const shouldForceSend = force === '1' || force === 'true';
    const slackRetryOptions = getSlackRetryOptions(event.queryStringParameters);
    const slackChannel = getSlackChannelId();

    console.info(`[${JOB_NAME}] Invocation started.`, {
      method: event.httpMethod,
      path: event.path,
      isScheduledEvent,
      shouldForceSend,
      nowMadrid: todayIso,
      slackChannel,
      ...slackRetryOptions,
    });

    if (!shouldForceSend && isScheduledEvent && !isWithinMadridAutomationWindow(todayIso)) {
      return successResponse({
        message: 'Fuera de la ventana de envío de las 07:00 en Madrid. Se omite.',
        nowMadrid: todayIso,
      });
    }

    const { day, startUtc, endUtc } = buildMadridDayRange(todayIso);

    const sessionRows: SessionRowsResult = await withDatabaseFallback(
      (client) =>
        client.sesiones.findMany({
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
        }),
      { operationName: `${JOB_NAME}:sesiones.findMany` },
    );

    console.info(`[${JOB_NAME}] Session data loaded.`, {
      day,
      count: sessionRows.length,
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

    console.info(`[${JOB_NAME}] Posting message to Slack.`, {
      channel: slackChannel,
      sessionsCount: sessions.length,
      textLength: text.length,
      ...slackRetryOptions,
    });

    const slackPostResult = await postSlackMessageWithRetry(token, text, {
      ...slackRetryOptions,
      channel: slackChannel,
      logger: console,
    });

    console.info(`[${JOB_NAME}] Slack message sent successfully.`, {
      channel: slackChannel,
      date: day,
      ...slackPostResult,
    });

    return successResponse({
      message: 'Mensaje de formadores enviado a Slack correctamente.',
      date: day,
      channel: slackChannel,
      text,
      sessions,
      ...slackPostResult,
    });
  } catch (error) {
    console.error(`[${JOB_NAME}] Handler failed.`, {
      message: error instanceof Error ? error.message : String(error ?? ''),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const errorMessage = error instanceof Error ? error.message : 'Error inesperado al enviar el mensaje a Slack.';
    return errorResponse('SLACK_POST_FAILED', errorMessage, 500);
  }
};
