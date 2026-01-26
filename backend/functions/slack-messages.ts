import type { Handler } from '@netlify/functions';
import { COMMON_HEADERS, preflightResponse } from './_shared/response';

const SLACK_API_BASE = 'https://slack.com/api';
const SLACK_USER_EMAIL = 'erp@gepgroup.es';

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

type SlackChannel = {
  id: string;
  name: string;
  is_private?: boolean;
  name_normalized?: string;
};

type SlackMessageResponse = {
  message?: {
    text?: string;
    ts?: string;
  };
};

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: JSON.stringify(body),
  };
}

async function slackRequest(
  token: string,
  endpoint: string,
  options?: { method?: string; body?: Record<string, unknown> },
) {
  const response = await fetch(`${SLACK_API_BASE}/${endpoint}`, {
    method: options?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const data = (await response.json().catch(() => ({}))) as SlackApiResponse;
  console.log('Slack API response:', endpoint, data);
  return { response, data };
}

async function fetchSlackUserId(token: string): Promise<string> {
  const { response, data } = await slackRequest(
    token,
    `users.lookupByEmail?email=${encodeURIComponent(SLACK_USER_EMAIL)}`,
  );

  if (!response.ok || !data.ok) {
    const message = data.error ? `Slack error: ${data.error}` : 'No se pudo resolver el usuario de Slack.';
    throw new Error(message);
  }

  const userId = (data.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error('No se encontró el usuario de Slack.');
  }

  return userId;
}

async function fetchSlackChannels(token: string, userId: string) {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      user: userId,
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    });
    if (cursor) params.set('cursor', cursor);

    const { response, data } = await slackRequest(token, `users.conversations?${params.toString()}`);

    if (!response.ok || !data.ok) {
      const message = data.error ? `Slack error: ${data.error}` : 'No se pudieron listar los canales de Slack.';
      throw new Error(message);
    }

    const pageChannels = (data.channels as SlackChannel[] | undefined) ?? [];
    channels.push(...pageChannels);
    cursor = (data.response_metadata as { next_cursor?: string } | undefined)?.next_cursor;
    if (cursor && !cursor.trim().length) cursor = undefined;
  } while (cursor);

  return channels;
}

async function sendSlackMessage(
  token: string,
  channelId: string,
  text: string,
): Promise<SlackMessageResponse & SlackApiResponse> {
  const { response, data } = await slackRequest(token, 'chat.postMessage', {
    method: 'POST',
    body: {
      channel: channelId,
      text,
    },
  });

  if (!response.ok || !data.ok) {
    const message = data.error ? `Slack error: ${data.error}` : 'No se pudo enviar el mensaje a Slack.';
    throw new Error(message);
  }

  return data as SlackMessageResponse & SlackApiResponse;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return preflightResponse();
  }

  const token = process.env.SLACK_TOKEN;
  if (!token) {
    return jsonResponse(500, {
      ok: false,
      error_code: 'SLACK_TOKEN_MISSING',
      message: 'Falta configurar SLACK_TOKEN en Netlify.',
    });
  }

  try {
    if (event.httpMethod === 'GET') {
      const userId = await fetchSlackUserId(token);
      const channels = await fetchSlackChannels(token, userId);
      return jsonResponse(200, {
        ok: true,
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name_normalized ?? channel.name,
          isPrivate: Boolean(channel.is_private),
        })),
      });
    }

    if (event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
      const text = typeof body.text === 'string' ? body.text.trim() : '';

      if (!channelId || !text) {
        return jsonResponse(400, {
          ok: false,
          error_code: 'INVALID_PAYLOAD',
          message: 'Debes indicar el canal y el texto del mensaje.',
        });
      }

      const slackResponse = await sendSlackMessage(token, channelId, text);
      return jsonResponse(200, {
        ok: true,
        message: slackResponse.message ?? null,
        slack: slackResponse,
      });
    }

    return jsonResponse(405, {
      ok: false,
      error_code: 'METHOD_NOT_ALLOWED',
      message: 'Método no permitido.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado al conectar con Slack.';
    return jsonResponse(502, {
      ok: false,
      error_code: 'SLACK_API_ERROR',
      message,
    });
  }
};
