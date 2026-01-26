import type { Handler } from '@netlify/functions';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS } from './_shared/response';
import { buildMadridDateTime } from './_shared/time';
import { ensureMadridTimezone } from './_shared/timezone';

const DEFAULT_CHANNEL_ID = 'C063C7QRHK4';
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_CHANNEL_LIST_URL = 'https://slack.com/api/conversations.list';
const SLACK_CHANNEL_JOIN_URL = 'https://slack.com/api/conversations.join';
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

async function resolveChannelId(token: string): Promise<string> {
  const envChannelId = process.env.SLACK_CHANNEL_ID?.trim();
  if (envChannelId) {
    return envChannelId;
  }

  const channelName = process.env.SLACK_CHANNEL_NAME?.trim();
  if (!channelName) {
    return DEFAULT_CHANNEL_ID;
  }

  let response: Response;
  try {
    response = await fetch(SLACK_CHANNEL_LIST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ exclude_archived: true, limit: 1000, types: 'public_channel,private_channel' }),
    });
  } catch (error) {
    console.error('[slack-daily-availability] Error consultando canales de Slack', {
      error: (error as Error)?.message ?? String(error),
      channelName,
    });
    return DEFAULT_CHANNEL_ID;
  }

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; channels?: { id: string; name: string }[]; error?: string }
    | null;

  const normalized = channelName.replace(/^#/, '').toLowerCase();
  const found = payload?.channels?.find((channel) => channel.name.toLowerCase() === normalized);
  if (response.ok && payload?.ok && found) {
    return found.id;
  }

  console.error('[slack-daily-availability] No se pudo resolver el canal Slack', {
    status: response.status,
    error: payload?.error ?? 'unknown_error',
    channelName,
  });

  return DEFAULT_CHANNEL_ID;
}

async function ensureChannelMembership(token: string, channelId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(SLACK_CHANNEL_JOIN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: channelId }),
    });
  } catch (error) {
    console.error('[slack-daily-availability] Error solicitando unión al canal Slack', {
      error: (error as Error)?.message ?? String(error),
      channelId,
    });
    return;
  }

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (response.ok && payload?.ok) {
    return;
  }

  if (payload?.error && ['already_in_channel', 'method_not_supported_for_channel_type'].includes(payload.error)) {
    return;
  }

  console.error('[slack-daily-availability] No se pudo unir el bot al canal Slack', {
    status: response.status,
    error: payload?.error ?? 'unknown_error',
    channelId,
  });
}

async function postSlackMessage(
  token: string,
  channelId: string,
  text: string,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  let response: Response;
  try {
    response = await fetch(SLACK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        username: SLACK_SENDER_NAME,
      }),
    });
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    console.error('[slack-daily-availability] Error enviando mensaje a Slack', {
      error: message,
      channelId,
    });
    return { ok: false, error: message };
  }

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

  if (!response.ok || !payload?.ok) {
    const error = payload?.error ?? 'unknown_error';
    console.error('[slack-daily-availability] Error enviando mensaje a Slack', {
      status: response.status,
      error,
      channelId,
    });
    return { ok: false, error, status: response.status };
  }

  return { ok: true, status: response.status };
}

type SlackAvailabilityRequest = {
  channelId?: string;
  force?: boolean;
};

function parseSlackAvailabilityRequest(rawBody?: string | null): SlackAvailabilityRequest {
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody) as SlackAvailabilityRequest;
  } catch {
    return {};
  }
}

export const handler: Handler = async (event) => {
  ensureMadridTimezone();
  try {
    const token = process.env.SLACK_TOKEN?.trim();

    if (!token) {
      console.error('[slack-daily-availability] Falta SLACK_TOKEN en el entorno');
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          ok: false,
          error: 'Missing SLACK_TOKEN',
          error_code: 'SLACK_TOKEN_MISSING',
          message: 'Configura SLACK_TOKEN en las variables de entorno de Netlify.',
        }),
      };
    }

    const request = parseSlackAvailabilityRequest(event?.body);
    const force = Boolean(request.force || event?.queryStringParameters?.force === 'true');
    const requestedChannelId =
      request.channelId?.trim() ||
      event?.queryStringParameters?.channelId?.trim() ||
      event?.queryStringParameters?.channel?.trim() ||
      '';

    const nowParts = getMadridParts(new Date());
    if (!force && nowParts.hour !== 7) {
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

    const channelId = requestedChannelId || (await resolveChannelId(token));
    await ensureChannelMembership(token, channelId);
    const slackResult = await postSlackMessage(token, channelId, message);

    if (!slackResult.ok) {
      return {
        statusCode: 502,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          ok: false,
          error: slackResult.error ?? 'Slack error',
          error_code: 'SLACK_POST_FAILED',
          message: 'No se pudo enviar la comunicación a Slack.',
        }),
      };
    }

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: true, notified: true, channelId }),
    };
  } catch (error) {
    console.error('[slack-daily-availability] Error interno en la función', {
      error: (error as Error)?.message ?? String(error),
    });
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error: 'Internal error',
        error_code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error interno al preparar la comunicación de Slack.',
      }),
    };
  }
};
