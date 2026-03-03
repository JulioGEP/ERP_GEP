import { sendEmail } from './mailer';

export const EMAIL_ENTITY_TYPE = 'control_horario_email_alert';

const FIRST_THRESHOLD_MINUTES = 8 * 60 + 15;
const SECOND_THRESHOLD_MINUTES = 12 * 60 + 15;

export type ControlHorarioThresholdKey = '08h15' | '12h15';

export type ControlHorarioThreshold = {
  minutes: number;
  key: ControlHorarioThresholdKey;
};

export const CONTROL_HORARIO_ALERT_THRESHOLDS: ControlHorarioThreshold[] = [
  { minutes: FIRST_THRESHOLD_MINUTES, key: '08h15' },
  { minutes: SECOND_THRESHOLD_MINUTES, key: '12h15' },
];

export function minutesWorked(checkInUtc: Date, now: Date): number {
  const diffMs = now.getTime() - checkInUtc.getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

export function formatWorkedDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function getControlHorarioUserName(user: { first_name: string; last_name: string; email: string }): string {
  const fullName = `${user.first_name} ${user.last_name}`.trim();
  return fullName || user.email;
}

function buildControlHorarioAlertEmailPayload(
  userName: string,
  workedDuration: string,
  thresholdKey: ControlHorarioThresholdKey,
) {
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

export async function sendControlHorarioAlertEmail(input: {
  to: string;
  userName: string;
  workedDuration: string;
  thresholdKey: ControlHorarioThresholdKey;
}) {
  const payload = buildControlHorarioAlertEmailPayload(input.userName, input.workedDuration, input.thresholdKey);

  await sendEmail({
    to: input.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });
}
