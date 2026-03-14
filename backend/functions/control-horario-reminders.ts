import type { Handler } from '@netlify/functions';

import { sendEmail } from './_shared/mailer';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';

const FIRST_REMINDER_MINUTES = 8.5 * 60;
const SECOND_REMINDER_MINUTES = 12.5 * 60;

function buildReminderEmail(params: { fullName: string; thresholdMinutes: number; checkInUtc: Date }): {
  subject: string;
  html: string;
  text: string;
} {
  const workedHours = (params.thresholdMinutes / 60).toFixed(1).replace('.', ',');
  const checkInTime = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
  }).format(params.checkInUtc);

  const subject = 'Recordatorio de fichaje de salida';
  const text = [
    `Hola ${params.fullName},`,
    '',
    `Has superado las ${workedHours} horas de trabajo desde que iniciaste tu jornada a las ${checkInTime}.`,
    'Parece que todavía no has fichado el fin de jornada.',
    '',
    'Por favor, revisa tu fichaje cuando puedas.',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <p>Hola ${params.fullName},</p>
      <p>
        Has superado las <strong>${workedHours} horas</strong> de trabajo desde que iniciaste tu jornada a las
        <strong>${checkInTime}</strong>.
      </p>
      <p>Parece que todavía no has fichado el fin de jornada.</p>
      <p>Por favor, revisa tu fichaje cuando puedas.</p>
    </div>
  `.trim();

  return { subject, html, text };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  try {
    const prisma = getPrisma();
    const now = new Date();

    const openEntries = await prisma.user_time_logs.findMany({
      where: {
        check_in_utc: { not: null },
        check_out_utc: null,
        OR: [{ reminder_8h30_sent_at: null }, { reminder_12h30_sent_at: null }],
        user: {
          active: true,
        },
      },
      select: {
        id: true,
        check_in_utc: true,
        reminder_8h30_sent_at: true,
        reminder_12h30_sent_at: true,
        user: {
          select: {
            first_name: true,
            last_name: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        check_in_utc: 'asc',
      },
    });

    let firstReminderSent = 0;
    let secondReminderSent = 0;
    let skippedWithoutEmail = 0;
    const errors: string[] = [];

    for (const entry of openEntries) {
      if (!entry.check_in_utc) continue;

      const workedMinutes = (now.getTime() - entry.check_in_utc.getTime()) / (1000 * 60);

      let reminderType: 'FIRST' | 'SECOND' | null = null;
      if (workedMinutes >= SECOND_REMINDER_MINUTES && !entry.reminder_12h30_sent_at) {
        reminderType = 'SECOND';
      } else if (workedMinutes >= FIRST_REMINDER_MINUTES && !entry.reminder_8h30_sent_at) {
        reminderType = 'FIRST';
      }

      if (!reminderType) {
        continue;
      }

      const recipient = String(entry.user.email ?? '').trim();
      if (!recipient) {
        skippedWithoutEmail += 1;
        continue;
      }

      const fullName =
        String(entry.user.name ?? '').trim() ||
        `${String(entry.user.first_name ?? '').trim()} ${String(entry.user.last_name ?? '').trim()}`.trim() ||
        'compañero/a';

      const thresholdMinutes = reminderType === 'SECOND' ? SECOND_REMINDER_MINUTES : FIRST_REMINDER_MINUTES;
      const emailPayload = buildReminderEmail({
        fullName,
        thresholdMinutes,
        checkInUtc: entry.check_in_utc,
      });

      try {
        await sendEmail({
          to: recipient,
          subject: emailPayload.subject,
          html: emailPayload.html,
          text: emailPayload.text,
        });

        const reminderTimestampField =
          reminderType === 'SECOND'
            ? { reminder_12h30_sent_at: now }
            : { reminder_8h30_sent_at: now };

        await prisma.user_time_logs.update({
          where: { id: entry.id },
          data: reminderTimestampField,
        });

        if (reminderType === 'SECOND') {
          secondReminderSent += 1;
        } else {
          firstReminderSent += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        errors.push(`No se pudo enviar el recordatorio para ${recipient}: ${message}`);
      }
    }

    return successResponse({
      message: 'Proceso de recordatorios de fichaje ejecutado.',
      processed: openEntries.length,
      firstReminderSent,
      secondReminderSent,
      skippedWithoutEmail,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return errorResponse('CONTROL_HORARIO_REMINDERS_FAILED', message, 500);
  }
};
