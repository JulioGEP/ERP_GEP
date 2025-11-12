import { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { isTrustedClient, logSuspiciousRequest } from './_shared/security';
import { sendEmail } from './_shared/mailer';

function toTrimmed(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

const MADRID_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  dateStyle: 'long',
});

function formatDateForEmail(value: Date | string | null | undefined): string {
  if (!value) return 'Pendiente';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Pendiente';
    return MADRID_DATE_FORMATTER.format(date);
  } catch {
    return 'Pendiente';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type EmailContent = { html: string; text: string };

function buildEmailContent(params: {
  trainerName: string | null;
  intro: string;
  lines: Array<[string, string]>;
  outro?: string;
}): EmailContent {
  const trainerName = toTrimmed(params.trainerName);
  const greeting = trainerName ? `Hola ${trainerName},` : 'Hola,';
  const outro = params.outro ?? 'Por favor, confirma tu disponibilidad respondiendo a este correo.';

  const htmlLines = params.lines
    .map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
    .join('');
  const textLines = params.lines.map(([label, value]) => `${label}: ${value}`);

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;max-width:640px">
      <p>${escapeHtml(greeting)}</p>
      <p>${escapeHtml(params.intro)}</p>
      <ul>${htmlLines}</ul>
      <p>${escapeHtml(outro)}</p>
    </div>
  `.trim();
  const text = [greeting, '', params.intro, '', ...textLines, '', outro].join('\n');

  return { html, text };
}

type PrismaClientOrTx = Prisma.TransactionClient | Prisma.PrismaClient;

async function syncSessionConfirmationRecords(
  prisma: PrismaClientOrTx,
  sessionId: string,
  trainerIds: string[],
): Promise<void> {
  const normalized = Array.from(
    new Set(trainerIds.map((value) => toTrimmed(value)).filter((value): value is string => Boolean(value))),
  );

  if (!normalized.length) {
    await prisma.trainer_confirmation_status.deleteMany({ where: { sesion_id: sessionId } });
    return;
  }

  await prisma.trainer_confirmation_status.deleteMany({
    where: { sesion_id: sessionId, trainer_id: { notIn: normalized } },
  });

  const existing = await prisma.trainer_confirmation_status.findMany({
    where: { sesion_id: sessionId, trainer_id: { in: normalized } },
    select: { trainer_id: true },
  });
  const existingSet = new Set(existing.map((row) => row.trainer_id));

  for (const trainerId of normalized) {
    if (existingSet.has(trainerId)) continue;
    await prisma.trainer_confirmation_status.create({
      data: {
        sesion_id: sessionId,
        trainer_id: trainerId,
      },
    });
  }
}

async function syncVariantConfirmationRecords(
  prisma: PrismaClientOrTx,
  variantId: string,
  trainerIds: string[],
): Promise<void> {
  const normalized = Array.from(
    new Set(trainerIds.map((value) => toTrimmed(value)).filter((value): value is string => Boolean(value))),
  );

  if (!normalized.length) {
    await prisma.trainer_confirmation_status.deleteMany({ where: { variant_id: variantId } });
    return;
  }

  await prisma.trainer_confirmation_status.deleteMany({
    where: { variant_id: variantId, trainer_id: { notIn: normalized } },
  });

  const existing = await prisma.trainer_confirmation_status.findMany({
    where: { variant_id: variantId, trainer_id: { in: normalized } },
    select: { trainer_id: true },
  });
  const existingSet = new Set(existing.map((row) => row.trainer_id));

  for (const trainerId of normalized) {
    if (existingSet.has(trainerId)) continue;
    await prisma.trainer_confirmation_status.create({
      data: {
        variant_id: variantId,
        trainer_id: trainerId,
      },
    });
  }
}

async function fetchVariantTrainerIds(prisma: PrismaClientOrTx, variantId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<{ trainer_id: string }[]>`
      SELECT trainer_id
      FROM variant_trainer_links
      WHERE variant_id = ${variantId}::uuid
      ORDER BY position ASC
    `;
    return rows.map((row) => row.trainer_id).filter((value): value is string => Boolean(toTrimmed(value)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/relation "variant_trainer_links"/i.test(message)) {
      return [];
    }
    throw error;
  }
}

async function computeVariantStudentTotal(prisma: PrismaClientOrTx, variantWooId: string | null): Promise<number> {
  const normalized = toTrimmed(variantWooId);
  if (!normalized) return 0;
  const deals = await prisma.deals.findMany({
    where: { w_id_variation: normalized },
    select: { deal_id: true },
  });
  const dealIds = deals
    .map((deal) => toTrimmed(deal.deal_id))
    .filter((value): value is string => Boolean(value));
  if (!dealIds.length) return 0;
  return prisma.alumnos.count({ where: { deal_id: { in: dealIds } } });
}

async function handleSessionConfirmation(
  prisma: PrismaClientOrTx,
  sessionId: string,
  context: 'company' | 'service',
) {
  const session = await prisma.sesiones.findUnique({
    where: { id: sessionId },
    include: {
      deals: {
        select: {
          title: true,
          training_address: true,
          sede_label: true,
          pipeline_id: true,
          organizations: { select: { name: true } },
        },
      },
      deal_products: { select: { name: true, code: true } },
      sesion_trainers: { select: { trainer_id: true } },
      trainer_confirmations: { select: { trainer_id: true, mail_sent_at: true } },
    },
  });
  if (!session) return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);

  const trainerIds = Array.isArray(session.sesion_trainers)
    ? session.sesion_trainers
        .map((link) => toTrimmed(link.trainer_id))
        .filter((value): value is string => Boolean(value))
    : [];
  if (!trainerIds.length) {
    return errorResponse('VALIDATION_ERROR', 'La sesión no tiene formadores asignados', 400);
  }

  await syncSessionConfirmationRecords(prisma, sessionId, trainerIds);

  const trainers = await prisma.trainers.findMany({
    where: { trainer_id: { in: trainerIds } },
    select: { trainer_id: true, email: true, name: true, apellido: true },
  });
  const trainerMap = new Map(
    trainers.map((trainer) => [trainer.trainer_id, trainer] as const),
  );

  const missingEmails = trainerIds.filter((id) => {
    const trainer = trainerMap.get(id);
    const email = toTrimmed(trainer?.email);
    return !email;
  });
  if (missingEmails.length) {
    return errorResponse(
      'VALIDATION_ERROR',
      `Faltan emails para los formadores: ${missingEmails.join(', ')}`,
      400,
    );
  }

  const organizationName =
    toTrimmed(session.deals?.organizations?.name) ?? toTrimmed(session.deals?.title) ?? '-';
  const productName =
    toTrimmed(session.deal_products?.name) ?? toTrimmed(session.deal_products?.code) ?? '-';
  const formattedDate = formatDateForEmail(session.fecha_inicio_utc);
  const address =
    toTrimmed((session as any).direccion) ?? toTrimmed(session.deals?.training_address) ?? '-';

  const intro =
    context === 'service'
      ? 'Se ha planificado un nuevo servicio pendiente de confirmación.'
      : 'Se ha planificado una nueva sesión de formación pendiente de confirmación.';
  const labelPrefix = context === 'service' ? 'servicio' : 'formación';
  const lines: Array<[string, string]> = [
    ['Organización', organizationName ?? '-'],
    [`Nombre del ${labelPrefix} (Producto)`, productName ?? '-'],
    [`Fecha de inicio del ${labelPrefix}`, formattedDate],
    [`Dirección del ${labelPrefix}`, address ?? '-'],
  ];

  const subject = 'Nueva sesión a espera de confirmación';
  const sentTrainerIds: string[] = [];

  for (const trainerId of trainerIds) {
    const trainer = trainerMap.get(trainerId)!;
    const email = toTrimmed(trainer.email)!;
    const trainerName = [toTrimmed(trainer.name), toTrimmed(trainer.apellido)]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    const content = buildEmailContent({ trainerName, intro, lines });

    try {
      await sendEmail({ to: email, subject, html: content.html, text: content.text });
      sentTrainerIds.push(trainerId);
    } catch (error) {
      if (sentTrainerIds.length) {
        await prisma.trainer_confirmation_status.updateMany({
          where: { sesion_id: sessionId, trainer_id: { in: sentTrainerIds } },
          data: { mail_sent_at: new Date() },
        });
      }
      const message = error instanceof Error ? error.message : 'Error inesperado al enviar el correo';
      return errorResponse('EMAIL_ERROR', message, 502);
    }
  }

  if (sentTrainerIds.length) {
    await prisma.trainer_confirmation_status.updateMany({
      where: { sesion_id: sessionId, trainer_id: { in: sentTrainerIds } },
      data: { mail_sent_at: new Date() },
    });
  }

  const confirmations = await prisma.trainer_confirmation_status.findMany({
    where: { sesion_id: sessionId },
    select: { trainer_id: true, mail_sent_at: true },
  });

  return successResponse({
    trainer_confirmations: confirmations.map((row) => ({
      trainer_id: row.trainer_id,
      mail_sent_at: row.mail_sent_at ? row.mail_sent_at.toISOString() : null,
    })),
  });
}

async function handleVariantConfirmation(prisma: PrismaClientOrTx, variantId: string) {
  const variant = await prisma.variants.findUnique({
    where: { id: variantId },
    include: {
      products: { select: { name: true, code: true } },
      trainer_confirmations: { select: { trainer_id: true, mail_sent_at: true } },
    },
  });
  if (!variant) return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);

  const trainerIdSet = new Set<string>();
  if (variant.trainer_id) {
    const trimmed = toTrimmed(variant.trainer_id);
    if (trimmed) trainerIdSet.add(trimmed);
  }
  const linkedTrainerIds = await fetchVariantTrainerIds(prisma, variantId);
  linkedTrainerIds.forEach((id) => {
    const trimmed = toTrimmed(id);
    if (trimmed) trainerIdSet.add(trimmed);
  });

  const trainerIds = Array.from(trainerIdSet);
  if (!trainerIds.length) {
    return errorResponse('VALIDATION_ERROR', 'La variante no tiene formadores asignados', 400);
  }

  await syncVariantConfirmationRecords(prisma, variantId, trainerIds);

  const trainers = await prisma.trainers.findMany({
    where: { trainer_id: { in: trainerIds } },
    select: { trainer_id: true, email: true, name: true, apellido: true },
  });
  const trainerMap = new Map(
    trainers.map((trainer) => [trainer.trainer_id, trainer] as const),
  );

  const missingEmails = trainerIds.filter((id) => {
    const trainer = trainerMap.get(id);
    const email = toTrimmed(trainer?.email);
    return !email;
  });
  if (missingEmails.length) {
    return errorResponse(
      'VALIDATION_ERROR',
      `Faltan emails para los formadores: ${missingEmails.join(', ')}`,
      400,
    );
  }

  const sede = toTrimmed(variant.sede) ?? '-';
  const productName =
    toTrimmed(variant.products?.name) ?? toTrimmed(variant.products?.code) ?? toTrimmed(variant.name) ?? '-';
  const formattedDate = formatDateForEmail(variant.date);
  const studentTotal = await computeVariantStudentTotal(prisma, variant.id_woo?.toString() ?? null);

  const intro = 'Se ha programado una nueva formación abierta pendiente de confirmación.';
  const lines: Array<[string, string]> = [
    ['Formación abierta en', sede ?? '-'],
    ['Nombre de la formación (Producto)', productName ?? '-'],
    ['Fecha de la formación', formattedDate],
    ['Sumatorio del total de alumnos de los deals asociados', String(studentTotal)],
  ];

  const subject = 'Nueva sesión a espera de confirmación';
  const sentTrainerIds: string[] = [];

  for (const trainerId of trainerIds) {
    const trainer = trainerMap.get(trainerId)!;
    const email = toTrimmed(trainer.email)!;
    const trainerName = [toTrimmed(trainer.name), toTrimmed(trainer.apellido)]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    const content = buildEmailContent({ trainerName, intro, lines });

    try {
      await sendEmail({ to: email, subject, html: content.html, text: content.text });
      sentTrainerIds.push(trainerId);
    } catch (error) {
      if (sentTrainerIds.length) {
        await prisma.trainer_confirmation_status.updateMany({
          where: { variant_id: variantId, trainer_id: { in: sentTrainerIds } },
          data: { mail_sent_at: new Date() },
        });
      }
      const message = error instanceof Error ? error.message : 'Error inesperado al enviar el correo';
      return errorResponse('EMAIL_ERROR', message, 502);
    }
  }

  if (sentTrainerIds.length) {
    await prisma.trainer_confirmation_status.updateMany({
      where: { variant_id: variantId, trainer_id: { in: sentTrainerIds } },
      data: { mail_sent_at: new Date() },
    });
  }

  const confirmations = await prisma.trainer_confirmation_status.findMany({
    where: { variant_id: variantId },
    select: { trainer_id: true, mail_sent_at: true },
  });

  return successResponse({
    trainer_confirmations: confirmations.map((row) => ({
      trainer_id: row.trainer_id,
      mail_sent_at: row.mail_sent_at ? row.mail_sent_at.toISOString() : null,
    })),
  });
}

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();

  const prisma = getPrisma();

  if (!isTrustedClient(event.headers)) {
    await logSuspiciousRequest({
      event,
      headers: event.headers,
      method: event.httpMethod ?? 'UNKNOWN',
      path: String(event.path || ''),
      rawUrl: event.rawUrl ?? null,
      reason: 'missing_or_invalid_client_header',
    });
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse('NOT_IMPLEMENTED', 'Método no soportado', 404);
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    body = {};
  }

  const targetType = toTrimmed(body?.targetType)?.toLowerCase();
  const targetId = toTrimmed(body?.targetId);
  const context = toTrimmed(body?.context)?.toLowerCase();

  if (!targetType || !targetId) {
    return errorResponse('VALIDATION_ERROR', 'Parámetros obligatorios ausentes', 400);
  }

  if (targetType === 'session') {
    if (context !== 'company' && context !== 'service') {
      return errorResponse('VALIDATION_ERROR', 'Contexto inválido para la sesión', 400);
    }
    return handleSessionConfirmation(prisma, targetId, context as 'company' | 'service');
  }

  if (targetType === 'variant') {
    return handleVariantConfirmation(prisma, targetId);
  }

  return errorResponse('VALIDATION_ERROR', 'targetType inválido', 400);
};
