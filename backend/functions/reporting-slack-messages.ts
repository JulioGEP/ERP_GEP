import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

const SLACK_API_BASE_URL = 'https://slack.com/api';
const CHANNELS_PAGE_LIMIT = 200;

type SlackChannel = {
  id?: string;
  name?: string;
  is_private?: boolean;
  is_archived?: boolean;
};

type SlackConversationsListResponse = {
  ok?: boolean;
  error?: string;
  needed?: string;
  provided?: string;
  channels?: SlackChannel[];
  response_metadata?: {
    next_cursor?: string;
  };
};

type SlackPostMessageResponse = {
  ok?: boolean;
  error?: string;
  ts?: string;
  channel?: string;
};

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function fetchSlackChannelsByTypes(token: string, types: string): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor = '';

  do {
    const params = new URLSearchParams({
      types,
      exclude_archived: 'true',
      limit: String(CHANNELS_PAGE_LIMIT),
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    const response = await fetch(`${SLACK_API_BASE_URL}/conversations.list?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as SlackConversationsListResponse;
    if (!payload.ok) {
      const code = payload.error ?? 'SLACK_LIST_CHANNELS_FAILED';
      const needed = sanitizeText(payload.needed);
      const provided = sanitizeText(payload.provided);
      const details = [needed ? `needed=${needed}` : null, provided ? `provided=${provided}` : null]
        .filter((part): part is string => Boolean(part))
        .join(', ');
      throw new Error(details ? `${code} (${details})` : code);
    }

    if (Array.isArray(payload.channels)) {
      channels.push(...payload.channels);
    }

    cursor = sanitizeText(payload.response_metadata?.next_cursor) ?? '';
  } while (cursor.length > 0);

  return channels;
}

async function listSlackChannels(token: string): Promise<SlackChannel[]> {
  try {
    return await fetchSlackChannelsByTypes(token, 'public_channel,private_channel');
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('missing_scope')) {
      throw error;
    }

    // Fallback: algunos tokens solo tienen alcance para canales públicos.
    return fetchSlackChannelsByTypes(token, 'public_channel');
  }
}

async function sendSlackMessage(token: string, channel: string, message: string) {
  const response = await fetch(`${SLACK_API_BASE_URL}/chat.postMessage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel,
      text: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const payload = (await response.json()) as SlackPostMessageResponse;
  if (!payload.ok) {
    throw new Error(payload.error ?? 'SLACK_POST_MESSAGE_FAILED');
  }

  return payload;
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });

  if ('error' in auth) {
    return auth.error;
  }

  const slackToken = sanitizeText(process.env.SLACK_TOKEN);
  if (!slackToken) {
    return errorResponse('CONFIG_ERROR', 'La variable SLACK_TOKEN no está configurada.', 500);
  }

  if (request.method === 'GET') {
    try {
      const channels = await listSlackChannels(slackToken);
      const normalizedChannels = channels
        .map((channel) => ({
          id: sanitizeText(channel.id),
          name: sanitizeText(channel.name),
          isPrivate: Boolean(channel.is_private),
          isArchived: Boolean(channel.is_archived),
        }))
        .filter(
          (channel): channel is { id: string; name: string; isPrivate: boolean; isArchived: boolean } =>
            Boolean(channel.id) && Boolean(channel.name) && !channel.isArchived,
        )
        .sort((left, right) => left.name.localeCompare(right.name, 'es'));

      return successResponse({ channels: normalizedChannels });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SLACK_LIST_CHANNELS_FAILED';
      console.error('[reporting-slack-messages] No se pudieron cargar los canales', error);
      return errorResponse('SLACK_CHANNELS_ERROR', `No se pudieron cargar los canales de Slack: ${message}`, 502);
    }
  }

  if (request.method === 'POST') {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const channelId = sanitizeText((body as Record<string, unknown>).channelId);
    const message = sanitizeText((body as Record<string, unknown>).message);

    if (!channelId) {
      return errorResponse('VALIDATION_ERROR', 'Debes seleccionar un canal de Slack.', 400);
    }

    if (!message) {
      return errorResponse('VALIDATION_ERROR', 'Debes escribir un mensaje.', 400);
    }

    try {
      const result = await sendSlackMessage(slackToken, channelId, message);
      return successResponse({
        messageTs: sanitizeText(result.ts),
        channelId: sanitizeText(result.channel) ?? channelId,
      });
    } catch (error) {
      const slackError = error instanceof Error ? error.message : 'SLACK_POST_MESSAGE_FAILED';
      console.error('[reporting-slack-messages] No se pudo enviar el mensaje', error);
      return errorResponse('SLACK_SEND_ERROR', `No se pudo enviar el mensaje a Slack: ${slackError}`, 502);
    }
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
});
