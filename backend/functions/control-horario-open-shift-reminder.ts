import type { Handler } from '@netlify/functions';

import { sendEmail } from './_shared/mailer';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO } from './_shared/timezone';

const NETLIFY_SCHEDULE_HEADER = 'x-netlify-event';
const REMINDER_START_HOUR = 8;
const REMINDER_START_MINUTE = 15;
const REMINDER_END_HOUR = 12;
const REMINDER_END_MINUTE = 15;

function isScheduledInvocation(event: Parameters<Handler>[0]): boolean {
  const scheduleHeader = event.headers?.[NETLIFY_SCHEDULE_HEADER] ?? event.headers?.[NETLIFY_SCHEDULE_HEADER.toUpperCase()];
  return String(scheduleHeader ?? '').toLowerCase() === 'schedule';
}

function resolveUserName(user: { first_name: string; last_name: string; email: string }): string {
  const parts = [user.first_name, user.last_name].map((value) => String(value ?? '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return user.email;
}

function getMadridTimeParts(nowMadridIso: string): { hour: number; minute: number } {
  const timePart = nowMadridIso.slice(11, 16);
  const [hourRaw, minuteRaw] = timePart.split(':');
  return {
    hour: Number.parseInt(hourRaw ?? '0', 10),
    minute: Number.parseInt(minuteRaw ?? '0', 10),
  };
}

async function sendClockInReminderEmail(params: { userEmail: string; userName: string }): Promise<void> {
  const subject = 'Recordatorio control horario: ficha tu entrada';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <p>Hola ${params.userName},</p>
      <p>Son más de las 08:15 y no hemos detectado tu fichaje de entrada de hoy.</p>
      <p>Por favor, registra tu entrada en el control horario.</p>
      <p style="margin-top: 16px;">Gracias.</p>
    </div>
  `.trim();

  await sendEmail({
    to: params.userEmail,
    subject,
    html,
    text: `Hola ${params.userName},\n\nSon más de las 08:15 y no hemos detectado tu fichaje de entrada de hoy.\nPor favor, registra tu entrada en el control horario.\n\nGracias.`,
  });
}

async function sendClockOutReminderEmail(params: { userEmail: string; userName: string }): Promise<void> {
  const subject = 'Recordatorio control horario: ficha tu salida';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <p>Hola ${params.userName},</p>
      <p>Son las 12:15 o más tarde y tienes la jornada abierta sin fichar la salida.</p>
      <p>Por favor, revisa tu fichaje y marca la salida cuando corresponda.</p>
      <p style="margin-top: 16px;">Gracias.</p>
    </div>
  `.trim();

  await sendEmail({
    to: params.userEmail,
    subject,
    html,
    text: `Hola ${params.userName},\n\nSon las 12:15 o más tarde y tienes la jornada abierta sin fichar la salida.\nPor favor, revisa tu fichaje y marca la salida cuando corresponda.\n\nGracias.`,
  });
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  if (!isScheduledInvocation(event)) {
    return errorResponse('FORBIDDEN', 'Esta función solo admite invocaciones programadas.', 403);
  }

  const now = new Date();
  const nowMadridIso = nowInMadridISO();
  const madridDate = nowMadridIso.slice(0, 10);
  const madridTime = getMadridTimeParts(nowMadridIso);

  const shouldSendClockInReminder =
    madridTime.hour > REMINDER_START_HOUR ||
    (madridTime.hour === REMINDER_START_HOUR && madridTime.minute >= REMINDER_START_MINUTE);
  const shouldSendClockOutReminder =
    madridTime.hour > REMINDER_END_HOUR ||
    (madridTime.hour === REMINDER_END_HOUR && madridTime.minute >= REMINDER_END_MINUTE);

  try {
    const prisma = getPrisma();

    let clockInRemindersSent = 0;
    let clockOutRemindersSent = 0;

    if (shouldSendClockInReminder) {
      const usersWithoutClockIn = await prisma.users.findMany({
        where: {
          active: true,
          email: {
            contains: '@',
          },
          OR: [
            {
              role: {
                notIn: ['formador', 'Formador'],
              },
            },
            {
              role: {
                in: ['formador', 'Formador'],
              },
              trainer: {
                is: {
                  contrato_fijo: true,
                },
              },
            },
          ],
          time_logs: {
            none: {
              log_date: new Date(`${madridDate}T00:00:00Z`),
              check_in_utc: {
                not: null,
              },
            },
          },
        },
        select: {
          email: true,
          first_name: true,
          last_name: true,
        },
      });

      for (const user of usersWithoutClockIn) {
        await sendClockInReminderEmail({
          userEmail: user.email,
          userName: resolveUserName(user),
        });
        clockInRemindersSent += 1;
      }
    }

    if (shouldSendClockOutReminder) {
      const openEntries = await prisma.user_time_logs.findMany({
        where: {
          log_date: new Date(`${madridDate}T00:00:00Z`),
          check_in_utc: {
            not: null,
          },
          check_out_utc: null,
          reminder_12h_sent_at: null,
          user: {
            active: true,
            OR: [
              {
                role: {
                  notIn: ['formador', 'Formador'],
                },
              },
              {
                role: {
                  in: ['formador', 'Formador'],
                },
                trainer: {
                  is: {
                    contrato_fijo: true,
                  },
                },
              },
            ],
          },
        },
        include: {
          user: {
            select: {
              email: true,
              first_name: true,
              last_name: true,
            },
          },
        },
      });

      for (const entry of openEntries) {
        await sendClockOutReminderEmail({
          userEmail: entry.user.email,
          userName: resolveUserName(entry.user),
        });

        await prisma.user_time_logs.update({
          where: { id: entry.id },
          data: {
            reminder_12h_sent_at: now,
          },
        });

        clockOutRemindersSent += 1;
      }
    }

    return successResponse({
      date: madridDate,
      madridTime,
      clockInRemindersSent,
      clockOutRemindersSent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado enviando recordatorios de control horario.';
    return errorResponse('REMINDER_SEND_FAILED', message, 500);
  }
};
