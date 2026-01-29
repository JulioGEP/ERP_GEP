import type { Handler } from '@netlify/functions';
import { getPrisma } from './_shared/prisma';
import { requireEnv } from './_shared/env';
import { nowInMadridISO } from './_shared/timezone';

const REMINDER_MESSAGE =
  'Hola, la jornada de 08:00 ya la has sobrepasado, ¿te has olvidado fichar el final de jornada?\n' +
  'Si te has olvidado, puedes hacerlo desde el link "https://erpgep.netlify.app/control_horario"\n' +
  '¡Gracias!';

const REMINDER_MINUTES_THRESHOLD = 8 * 60 + 15;
const REMINDER_MINUTES_WINDOW = 15;

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

function diffMinutes(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

async function lookupSlackUserId(token: string, email: string): Promise<string | null> {
  const url = new URL('https://slack.com/api/users.lookupByEmail');
  url.searchParams.set('email', email);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

  const payload = (await response.json()) as { ok?: boolean; user?: { id?: string }; error?: string };
  if (!response.ok || !payload.ok) {
    if (payload?.error === 'users_not_found') {
      return null;
    }
    const errorMessage = payload?.error ? `Slack API error: ${payload.error}` : 'Slack API error';
    throw new Error(errorMessage);
  }

  return payload.user?.id ?? null;
}

async function postSlackMessage(token: string, channel: string, text: string): Promise<void> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel,
      text,
    }),
  });

  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !payload.ok) {
    const errorMessage = payload?.error ? `Slack API error: ${payload.error}` : 'Slack API error';
    throw new Error(errorMessage);
  }
}

export const handler: Handler = async () => {
  const madridNow = nowInMadridISO();
  const todayUtc = toUtcDateOnly(madridNow);
  const tomorrowUtc = addUtcDays(todayUtc, 1);
  const nowUtc = new Date();

  const prisma = getPrisma();
  const logs = await prisma.user_time_logs.findMany({
    where: {
      log_date: {
        gte: todayUtc,
        lt: tomorrowUtc,
      },
    },
    select: {
      user_id: true,
      check_in_utc: true,
      check_out_utc: true,
      user: {
        select: {
          email: true,
          active: true,
        },
      },
    },
    orderBy: [{ user_id: 'asc' }, { check_in_utc: 'asc' }],
  });

  if (logs.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: 'no_logs', madridNow }),
    };
  }

  const totals = new Map<
    string,
    {
      email: string;
      active: boolean;
      minutes: number;
      hasOpenEntry: boolean;
    }
  >();

  for (const log of logs) {
    if (!log.user?.email) {
      continue;
    }
    const bucket =
      totals.get(log.user_id) ?? {
        email: log.user.email,
        active: log.user.active,
        minutes: 0,
        hasOpenEntry: false,
      };

    const checkIn = log.check_in_utc;
    if (checkIn) {
      const checkOut = log.check_out_utc ?? nowUtc;
      bucket.minutes += diffMinutes(checkIn, checkOut);
    }
    if (!log.check_out_utc && log.check_in_utc) {
      bucket.hasOpenEntry = true;
    }

    totals.set(log.user_id, bucket);
  }

  const slackToken = requireEnv('SLACK_TOKEN');
  const results: Array<{ email: string; status: string }> = [];

  for (const entry of totals.values()) {
    if (!entry.active || !entry.hasOpenEntry) {
      continue;
    }

    if (
      entry.minutes < REMINDER_MINUTES_THRESHOLD ||
      entry.minutes >= REMINDER_MINUTES_THRESHOLD + REMINDER_MINUTES_WINDOW
    ) {
      continue;
    }

    const slackUserId = await lookupSlackUserId(slackToken, entry.email);
    if (!slackUserId) {
      results.push({ email: entry.email, status: 'slack_user_not_found' });
      continue;
    }

    await postSlackMessage(slackToken, slackUserId, REMINDER_MESSAGE);
    results.push({ email: entry.email, status: 'sent' });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      sent: results.filter((result) => result.status === 'sent').length,
      results,
    }),
  };
};
