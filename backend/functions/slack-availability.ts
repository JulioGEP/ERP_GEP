import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { normalizeRoleKey, requireAuth } from './_shared/auth';
import {
  buildAvailabilityMessage,
  DEFAULT_SLACK_CHANNEL_ID,
  postSlackMessage,
} from './_shared/slack';

type AvailabilityPayload = {
  channelId?: string;
  force?: boolean;
  date?: string;
};

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
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

  const payload = (request.body ?? {}) as AvailabilityPayload;
  const channelId = String(payload.channelId || DEFAULT_SLACK_CHANNEL_ID).trim();
  const force = Boolean(payload.force);

  if (!channelId) {
    return errorResponse('VALIDATION_ERROR', 'channelId es obligatorio', 400);
  }

  const slackToken = process.env.SLACK_TOKEN;
  if (!slackToken) {
    return errorResponse('CONFIG_ERROR', 'Slack no está configurado', 500);
  }

  const referenceDate = payload.date ? new Date(`${payload.date}T00:00:00Z`) : new Date();
  if (Number.isNaN(referenceDate.getTime())) {
    return errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400);
  }

  const availability = await buildAvailabilityMessage(prisma, referenceDate);

  if (!availability.hasEntries && !force) {
    return successResponse({
      sent: false,
      message: 'No hay ausencias ni teletrabajo que reportar.',
      today: availability.todayIso,
      tomorrow: availability.tomorrowIso,
    });
  }

  await postSlackMessage(slackToken, channelId, availability.text);

  return successResponse({
    sent: true,
    message: 'Mensaje enviado correctamente.',
    channelId,
    today: availability.todayIso,
    tomorrow: availability.tomorrowIso,
  });
});
