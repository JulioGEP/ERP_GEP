import type { Handler } from '@netlify/functions';

import {
  CONTROL_HORARIO_ALERT_THRESHOLDS,
  EMAIL_ENTITY_TYPE,
  formatWorkedDuration,
  getControlHorarioUserName,
  minutesWorked,
  sendControlHorarioAlertEmail
} from './_shared/controlHorarioEmailAlerts';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';

const NETLIFY_SCHEDULE_HEADER = 'x-netlify-event';

function isScheduledInvocation(event: Parameters<Handler>[0]): boolean {
  const scheduleHeader = event.headers?.[NETLIFY_SCHEDULE_HEADER] ?? event.headers?.[NETLIFY_SCHEDULE_HEADER.toUpperCase()];
  return String(scheduleHeader ?? '').toLowerCase() === 'schedule';
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();

  try {
    const now = new Date();
    const openEntries = await prisma.user_time_logs.findMany({
      where: {
        check_in_utc: { not: null },
        check_out_utc: null,
        user: {
          active: true,
        },
      },
      select: {
        id: true,
        check_in_utc: true,
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
    });

    let sentCount = 0;
    const skipped: Array<{ entryId: string; reason: string }> = [];

    for (const entry of openEntries) {
      if (!entry.check_in_utc || !entry.user?.email?.trim()) {
        skipped.push({ entryId: entry.id, reason: 'Entrada sin check-in o usuario sin email' });
        continue;
      }

      const workedMinutes = minutesWorked(entry.check_in_utc, now);
      const workedDuration = formatWorkedDuration(workedMinutes);

      for (const threshold of CONTROL_HORARIO_ALERT_THRESHOLDS) {
        if (workedMinutes < threshold.minutes) {
          continue;
        }

        const entityId = `${entry.id}:${threshold.key}`;
        const alreadySent = await prisma.audit_logs.findFirst({
          where: {
            entity_type: EMAIL_ENTITY_TYPE,
            entity_id: entityId,
            action: 'SENT',
          },
          select: { id: true },
        });

        if (alreadySent) {
          continue;
        }

        const userName = getControlHorarioUserName(entry.user);

        await sendControlHorarioAlertEmail({
          to: entry.user.email,
          userName,
          workedDuration,
          thresholdKey: threshold.key,
        });

        await prisma.audit_logs.create({
          data: {
            user_id: entry.user.id,
            action: 'SENT',
            entity_type: EMAIL_ENTITY_TYPE,
            entity_id: entityId,
            after: {
              threshold: threshold.key,
              workedMinutes,
              workedDuration,
              sentAt: now.toISOString(),
              mode: isScheduledInvocation(event) ? 'scheduled' : 'manual',
            },
          },
        });

        sentCount += 1;
      }
    }

    return successResponse({
      message: 'Proceso de avisos de control horario completado.',
      processedEntries: openEntries.length,
      sentCount,
      skipped,
      scheduled: isScheduledInvocation(event),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado al enviar avisos de fichaje';
    return errorResponse('CONTROL_HORARIO_ALERTS_FAILED', message, 500);
  }
};
