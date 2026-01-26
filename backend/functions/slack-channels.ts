import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { normalizeRoleKey, requireAuth } from './_shared/auth';
import { listSlackChannels, SLACK_AVAILABILITY_USER_EMAIL } from './_shared/slack';

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  const role = normalizeRoleKey(auth.user.role);
  if (role !== 'admin' && role !== 'people') {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

  const slackToken = process.env.SLACK_TOKEN;
  if (!slackToken) {
    return errorResponse('CONFIG_ERROR', 'Slack no está configurado', 500);
  }

  const channels = await listSlackChannels(slackToken, SLACK_AVAILABILITY_USER_EMAIL);

  return successResponse({
    channels: channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      isPrivate: Boolean(channel.is_private),
    })),
  });
});
