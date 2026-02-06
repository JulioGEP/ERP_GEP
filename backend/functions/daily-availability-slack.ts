// backend/functions/daily-availability-slack.ts
import type { Handler } from '@netlify/functions';

import { getPrisma } from './_shared/prisma';
import { formatDateOnly, parseDateOnly } from './_shared/vacations';
import { nowInMadridDate } from './_shared/timezone';

const SLACK_CHANNEL = 'equipo-gep-group';

const VACATION_TYPE_LABELS: Record<string, string> = {
  V: 'Vacaciones',
  L: 'Festivo local',
  A: 'Día aniversario',
  T: 'Teletrabajo',
  M: 'Matrimonio',
  H: 'Accidente',
  F: 'Fallecimiento',
  R: 'Traslado',
  P: 'Visita médica o exámenes',
  I: 'Incapacidad',
  N: 'Festivo nacional',
  C: 'Fiesta autonómica',
  Y: 'Vacaciones año anterior',
};

type VacationEntry = {
  date: Date;
  type: string;
  user: {
    name: string | null;
    first_name: string;
    last_name: string;
  };
};

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function buildUserLabel(entry: VacationEntry): string {
  const rawName = entry.user.name?.trim();
  const name =
    rawName && rawName.length > 0
      ? rawName
      : `${entry.user.first_name ?? ''} ${entry.user.last_name ?? ''}`.trim();
  const label = VACATION_TYPE_LABELS[entry.type] ?? 'ausencia';

  if (entry.type === 'T') {
    return `${name} teletrabaja`;
  }

  return `${name} tiene ${label.toLocaleLowerCase('es-ES')}`;
}

function joinWithConjunction(items: string[]): string {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

async function sendSlackMessage(token: string, text: string) {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: SLACK_CHANNEL,
      text,
    }),
  });

  const payload = (await response.json()) as { ok?: boolean; error?: string };
  return { responseOk: response.ok, payload };
}

export const handler: Handler = async () => {
  console.info('daily-availability-slack: inicio ejecución');
  const slackToken = process.env.SLACK_TOKEN?.trim();
  if (!slackToken) {
    console.error('daily-availability-slack: falta SLACK_TOKEN');
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'SLACK_TOKEN no configurado.' }),
    };
  }

  const prisma = getPrisma();
  const todayIso = formatDateOnly(nowInMadridDate());
  const todayDate = parseDateOnly(todayIso);

  if (!todayDate) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'No se pudo calcular la fecha de hoy.' }),
    };
  }

  const tomorrowDate = addUtcDays(todayDate, 1);

  try {
    const entries = (await prisma.user_vacation_days.findMany({
      where: {
        date: { in: [todayDate, tomorrowDate] },
        user: { active: true },
      },
      include: {
        user: {
          select: {
            name: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    })) as VacationEntry[];

    const todayEntries = entries.filter((entry) => entry.date.getTime() === todayDate.getTime());
    const tomorrowEntries = entries.filter((entry) => entry.date.getTime() === tomorrowDate.getTime());

    const todayText = todayEntries.length
      ? `Hoy ${joinWithConjunction(todayEntries.map(buildUserLabel))}.`
      : 'Hoy estamos todos.';
    const tomorrowText = tomorrowEntries.length
      ? `Mañana ${joinWithConjunction(tomorrowEntries.map(buildUserLabel))}.`
      : 'Mañana estamos todos.';

    const message = `${todayText} ${tomorrowText}`.trim();

    const { responseOk, payload } = await sendSlackMessage(slackToken, message);

    if (!responseOk || !payload.ok) {
      console.error('Error enviando Slack', payload);
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: payload.error ?? 'Error enviando el mensaje a Slack.',
          slack: payload,
        }),
      };
    }

    console.info('daily-availability-slack: mensaje enviado');
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message, slack: payload }),
    };
  } catch (error) {
    console.error('Fallo en daily-availability-slack', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Error desconocido.',
      }),
    };
  }
};
