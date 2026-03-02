import type { Handler } from '@netlify/functions';

import { sendEmail } from './_shared/mailer';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';

const NETLIFY_SCHEDULE_HEADER = 'x-netlify-event';
const EMAIL_ENTITY_TYPE = 'control_horario_email_alert';
const FIRST_THRESHOLD_MINUTES = 8 * 60 + 15;
const SECOND_THRESHOLD_MINUTES = 12 * 60 + 15;

type ThresholdConfig = {
  minutes: number;
  key: '08h15' | '12h15';
};

const THRESHOLDS: ThresholdConfig[] = [
  { minutes: FIRST_THRESHOLD_MINUTES, key: '08h15' },
  { minutes: SECOND_THRESHOLD_MINUTES, key: '12h15' },
];

function isScheduledInvocation(event: Parameters<Handler>[0]): boolean {
  const scheduleHeader = event.headers?.[NETLIFY_SCHEDULE_HEADER] ?? event.headers?.[NETLIFY_SCHEDULE_HEADER.toUpperCase()];
  return String(scheduleHeader ?? '').toLowerCase() === 'schedule';
}

function minutesWorked(checkInUtc: Date, now: Date): number {
  const diffMs = now.getTime() - checkInUtc.getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

function formatWorkedDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getUserName(user: { first_name: string; last_name: string; email: string }): string {
  const fullName = `${user.first_name} ${user.last_name}`.trim();
  return fullName || user.email;
}

function buildEmailPayload(userName: string, workedDuration: string, thresholdKey: ThresholdConfig['key']) {
  const isSecondReminder = thresholdKey === '12h15';
  const subject = isSecondReminder
    ? 'Segundo aviso: recuerda fichar tu salida'
    : 'Aviso: revisa tu fichaje de salida';

  const intro = isSecondReminder
    ? 'Seguimos detectando una sesión de control horario abierta.'
    : 'Hemos detectado que tu sesión de control horario sigue abierta.';

  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.5; color:#1f2937; max-width:640px;">
      <p>Hola ${userName},</p>
      <p>${intro}</p>
      <p>
        El contador ha alcanzado <strong>${workedDuration} horas</strong> de trabajo sin fichaje de salida.
      </p>
      <p>
        Por favor, confirma si se trata de <strong>horas extras</strong> o si has olvidado <strong>fichar la salida</strong>.
      </p>
      <p>Gracias.</p>
    </div>
  `.trim();

  const text = [
    `Hola ${userName},`,
    intro,
    `El contador ha alcanzado ${workedDuration} horas de trabajo sin fichaje de salida.`,
    'Por favor, confirma si se trata de horas extras o si has olvidado fichar la salida.',
    'Gracias.',
  ].join('\n');

  return { subject, html, text };
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

      for (const threshold of THRESHOLDS) {
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

        const userName = getUserName(entry.user);
        const mailPayload = buildEmailPayload(userName, workedDuration, threshold.key);

        await sendEmail({
          to: entry.user.email,
          subject: mailPayload.subject,
          html: mailPayload.html,
          text: mailPayload.text,
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
