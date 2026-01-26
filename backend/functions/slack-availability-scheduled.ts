import type { Handler } from '@netlify/functions';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS } from './_shared/response';
import {
  buildAvailabilityMessage,
  DEFAULT_SLACK_CHANNEL_ID,
  postSlackMessage,
} from './_shared/slack';

function getMadridHour(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false })
    .formatToParts(date)
    .find((part) => part.type === 'hour');
  return parts ? Number(parts.value) : date.getUTCHours();
}

export const handler: Handler = async () => {
  const slackToken = process.env.SLACK_TOKEN;
  if (!slackToken) {
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: false, message: 'Slack no está configurado' }),
    };
  }

  const now = new Date();
  const madridHour = getMadridHour(now);
  if (madridHour !== 7) {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: true, skipped: true, reason: 'Fuera del horario de envío.' }),
    };
  }

  const prisma = getPrisma();
  const availability = await buildAvailabilityMessage(prisma, now);

  if (!availability.hasEntries) {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: true, skipped: true, reason: 'Sin ausencias.' }),
    };
  }

  await postSlackMessage(slackToken, DEFAULT_SLACK_CHANNEL_ID, availability.text);

  return {
    statusCode: 200,
    headers: COMMON_HEADERS,
    body: JSON.stringify({ ok: true, sent: true, channelId: DEFAULT_SLACK_CHANNEL_ID }),
  };
};
