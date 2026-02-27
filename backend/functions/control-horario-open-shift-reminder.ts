import type { Handler } from '@netlify/functions';

import { sendEmail } from './_shared/mailer';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO } from './_shared/timezone';

const NETLIFY_SCHEDULE_HEADER = 'x-netlify-event';
const HOURS_8_MS = 8 * 60 * 60 * 1000;
const HOURS_12_MS = 12 * 60 * 60 * 1000;

function isScheduledInvocation(event: Parameters<Handler>[0]): boolean {
  const scheduleHeader = event.headers?.[NETLIFY_SCHEDULE_HEADER] ?? event.headers?.[NETLIFY_SCHEDULE_HEADER.toUpperCase()];
  return String(scheduleHeader ?? '').toLowerCase() === 'schedule';
}

function resolveUserName(user: { first_name: string; last_name: string; email: string }): string {
  const parts = [user.first_name, user.last_name].map((value) => String(value ?? '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return user.email;
}

async function sendOpenShiftReminderEmail(params: {
  userEmail: string;
  userName: string;
  thresholdHours: 8 | 12;
  workedHours: number;
}): Promise<void> {
  const workedHoursRounded = params.workedHours.toFixed(2);
  const subject = `Aviso control horario: llevas más de ${params.thresholdHours}:00h sin fichar cierre`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <p>Hola ${params.userName},</p>
      <p>
        Hemos detectado que hoy llevas <strong>${workedHoursRounded} horas</strong> trabajadas en el control horario
        y todavía no has registrado el cierre de la jornada.
      </p>
      <p>Por favor, revisa tu fichaje y marca la salida cuando corresponda.</p>
      <p style="margin-top: 16px;">Gracias.</p>
    </div>
  `.trim();
  const text = [
    `Hola ${params.userName},`,
    ``,
    `Hemos detectado que hoy llevas ${workedHoursRounded} horas trabajadas en el control horario y todavía no has registrado el cierre de la jornada.`,
    `Por favor, revisa tu fichaje y marca la salida cuando corresponda.`,
    ``,
    `Gracias.`,
  ].join('\n');

  await sendEmail({
    to: params.userEmail,
    subject,
    html,
    text,
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
  const madridDate = nowInMadridISO().slice(0, 10);

  try {
    const prisma = getPrisma();

    const openEntries = await prisma.user_time_logs.findMany({
      where: {
        log_date: new Date(`${madridDate}T00:00:00Z`),
        check_in_utc: {
          not: null,
        },
        check_out_utc: null,
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
      orderBy: {
        check_in_utc: 'asc',
      },
    });

    let reminders8hSent = 0;
    let reminders12hSent = 0;

    for (const entry of openEntries) {
      if (!entry.check_in_utc) continue;

      const elapsedMs = now.getTime() - entry.check_in_utc.getTime();
      const workedHours = elapsedMs / (60 * 60 * 1000);
      const userName = resolveUserName(entry.user);

      if (elapsedMs >= HOURS_12_MS && !entry.reminder_12h_sent_at) {
        await sendOpenShiftReminderEmail({
          userEmail: entry.user.email,
          userName,
          thresholdHours: 12,
          workedHours,
        });

        await prisma.user_time_logs.update({
          where: { id: entry.id },
          data: {
            reminder_12h_sent_at: now,
            reminder_8h_sent_at: entry.reminder_8h_sent_at ?? now,
          },
        });

        reminders12hSent += 1;
        continue;
      }

      if (elapsedMs >= HOURS_8_MS && !entry.reminder_8h_sent_at) {
        await sendOpenShiftReminderEmail({
          userEmail: entry.user.email,
          userName,
          thresholdHours: 8,
          workedHours,
        });

        await prisma.user_time_logs.update({
          where: { id: entry.id },
          data: {
            reminder_8h_sent_at: now,
          },
        });

        reminders8hSent += 1;
      }
    }

    return successResponse({
      date: madridDate,
      scannedOpenEntries: openEntries.length,
      reminders8hSent,
      reminders12hSent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado enviando recordatorios de control horario.';
    return errorResponse('REMINDER_SEND_FAILED', message, 500);
  }
};
