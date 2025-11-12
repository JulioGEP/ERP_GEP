import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { sendEmail } from './_shared/mailer';
import { serializeTrainerConfirmation } from './_shared/trainer-confirmations';

const MADRID_TIMEZONE = 'Europe/Madrid';
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  timeZone: MADRID_TIMEZONE,
  dateStyle: 'full',
  timeStyle: 'short',
});

const DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  timeZone: MADRID_TIMEZONE,
  dateStyle: 'full',
});

const TRAINER_CONFIRMATION_STATE_VALUES = ['PENDING', 'MAIL_SENT', 'CONFIRMED', 'DECLINED'] as const;

type TrainerConfirmationState = typeof TRAINER_CONFIRMATION_STATE_VALUES[number];

type ConfirmationTarget = {
  trainerId: string;
  email: string;
  displayName: string;
};

type SessionEmailPayload = {
  type: 'session';
  sessionName: string;
  productName: string | null;
  start: string | null;
  end: string | null;
  address: string | null;
  sede: string | null;
};

type VariantEmailPayload = {
  type: 'variant';
  variantName: string | null;
  productName: string | null;
  date: string | null;
  sede: string | null;
  wooId: string | null;
};

type EmailPayload = SessionEmailPayload | VariantEmailPayload;

function toTrimmed(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function sanitizeTrainerIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    const trimmed = toTrimmed(entry);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function formatDateTime(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return DATE_TIME_FORMATTER.format(date);
}

function formatDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return DATE_FORMATTER.format(date);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toTrainerConfirmationState(value: unknown): TrainerConfirmationState {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if ((TRAINER_CONFIRMATION_STATE_VALUES as readonly string[]).includes(normalized)) {
      return normalized as TrainerConfirmationState;
    }
  }
  return 'PENDING';
}

function buildEmailContent(payload: EmailPayload, intro: string, displayName: string) {
  const lines: string[] = [];
  if (payload.type === 'session') {
    const session = payload;
    lines.push(`Sesión: ${session.sessionName}`);
    if (session.productName) lines.push(`Producto: ${session.productName}`);
    if (session.start) lines.push(`Inicio: ${session.start}`);
    if (session.end) lines.push(`Fin: ${session.end}`);
    if (session.address) lines.push(`Dirección: ${session.address}`);
    if (session.sede) lines.push(`Sede: ${session.sede}`);
  } else {
    const variant = payload;
    if (variant.variantName) lines.push(`Variante: ${variant.variantName}`);
    if (variant.productName) lines.push(`Producto: ${variant.productName}`);
    if (variant.date) lines.push(`Fecha: ${variant.date}`);
    if (variant.sede) lines.push(`Sede: ${variant.sede}`);
    if (variant.wooId) lines.push(`ID WooCommerce: ${variant.wooId}`);
  }

  const htmlList = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height:1.6; max-width:640px">
      <p>Hola ${escapeHtml(displayName)},</p>
      <p>${escapeHtml(intro)}</p>
      ${lines.length ? `<ul style="padding-left:18px;">${htmlList}</ul>` : ''}
      <p>Por favor, responde a este correo confirmando tu disponibilidad.</p>
      <p>Gracias,<br/>Equipo GEP</p>
    </div>
  `.trim();

  const textLines = [
    `Hola ${displayName},`,
    '',
    intro,
    '',
    ...lines,
    '',
    'Por favor, responde a este correo confirmando tu disponibilidad.',
    '',
    'Gracias,',
    'Equipo GEP',
  ];

  return { html, text: textLines.join('\n') };
}

function mapStatuses(rows: Array<{ trainer_id: string; status: unknown; mail_sent_at: Date | string | null; updated_at: Date | string | null }>) {
  return rows
    .filter((row) => typeof row.trainer_id === 'string' && row.trainer_id.trim().length)
    .map((row) =>
      serializeTrainerConfirmation({
        trainer_id: row.trainer_id,
        status: toTrainerConfirmationState(row.status),
        mail_sent_at: row.mail_sent_at ?? null,
        updated_at: row.updated_at ?? null,
      }),
    );
}

export const handler = createHttpHandler(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }

  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  const prisma = getPrisma();
  const body = (request.body ?? {}) as Record<string, unknown>;

  const kindRaw = toTrimmed(body.kind);
  const entityId = toTrimmed(body.id);
  if (!kindRaw || !entityId) {
    return errorResponse('VALIDATION_ERROR', 'Parámetros kind e id son obligatorios', 400);
  }

  const kind = kindRaw === 'session' || kindRaw === 'variant' ? kindRaw : null;
  if (!kind) {
    return errorResponse('VALIDATION_ERROR', 'Tipo de entidad no soportado', 400);
  }

  const trainerIdsInput = sanitizeTrainerIds(body.trainers);

  if (kind === 'session') {
    const session = await prisma.sesiones.findUnique({
      where: { id: entityId },
      include: {
        deal_products: { select: { name: true, code: true } },
        deals: { select: { sede_label: true, training_address: true } },
        sesion_trainers: { select: { trainer_id: true } },
        trainer_confirmations: {
          select: { trainer_id: true, status: true, mail_sent_at: true, updated_at: true },
        },
      },
    });

    if (!session) {
      return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
    }

    const assignedIds = Array.from(
      new Set(
        (session.sesion_trainers ?? [])
          .map((entry) => toTrimmed(entry.trainer_id))
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (!assignedIds.length) {
      return errorResponse('NO_TRAINERS', 'La sesión no tiene formadores asignados', 409);
    }

    const statusMap = new Map<string, TrainerConfirmationState>();
    for (const entry of session.trainer_confirmations ?? []) {
      const trainerId = toTrimmed(entry.trainer_id);
      if (!trainerId) continue;
      statusMap.set(trainerId, toTrainerConfirmationState(entry.status));
    }

    const baseTargets = trainerIdsInput.length ? trainerIdsInput : assignedIds;
    const eligibleTargets = baseTargets.filter((id) => assignedIds.includes(id));
    const pendingTargets = eligibleTargets.filter((id) => {
      const state = statusMap.get(id);
      return !state || state === 'PENDING';
    });

    if (!pendingTargets.length) {
      const statuses = mapStatuses(session.trainer_confirmations ?? []);
      return successResponse({ ok: true, sent: 0, statuses });
    }

    const trainers = await prisma.trainers.findMany({
      where: { trainer_id: { in: pendingTargets } },
      select: { trainer_id: true, email: true, name: true, apellido: true },
    });

    const trainerMap = new Map<string, { email: string | null; name: string | null; apellido: string | null }>();
    trainers.forEach((trainer) => trainerMap.set(trainer.trainer_id, trainer));

    const targets: ConfirmationTarget[] = [];
    for (const trainerId of pendingTargets) {
      const trainer = trainerMap.get(trainerId);
      const email = toTrimmed(trainer?.email);
      if (!email) {
        return errorResponse('MISSING_EMAIL', `El formador ${trainerId} no tiene email registrado`, 409);
      }
      const displayName = [toTrimmed(trainer?.name), toTrimmed(trainer?.apellido)]
        .filter(Boolean)
        .join(' ');
      targets.push({ trainerId, email, displayName: displayName || trainerId });
    }

    const payload: SessionEmailPayload = {
      type: 'session',
      sessionName: session.nombre_cache ?? 'Sesión',
      productName: session.deal_products?.name ?? session.deal_products?.code ?? null,
      start: formatDateTime(session.fecha_inicio_utc ?? null),
      end: formatDateTime(session.fecha_fin_utc ?? null),
      address: session.direccion ?? session.deals?.training_address ?? null,
      sede: session.deals?.sede_label ?? null,
    };

    for (const target of targets) {
      const intro = 'Se ha asignado una sesión para tu confirmación:';
      const { html, text } = buildEmailContent(payload, intro, target.displayName);
      await sendEmail({ to: target.email, subject: 'Nueva sesión a espera de confirmación', html, text });
      await prisma.trainer_confirmation_status.upsert({
        where: { sesion_id_trainer_id: { sesion_id: entityId, trainer_id: target.trainerId } },
        update: { status: 'MAIL_SENT', mail_sent_at: new Date(), updated_at: new Date() },
        create: {
          sesion_id: entityId,
          variant_id: null,
          trainer_id: target.trainerId,
          status: 'MAIL_SENT',
          mail_sent_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    const updatedStatuses = await prisma.trainer_confirmation_status.findMany({
      where: { sesion_id: entityId },
      select: { trainer_id: true, status: true, mail_sent_at: true, updated_at: true },
    });

    return successResponse({ ok: true, sent: targets.length, statuses: mapStatuses(updatedStatuses) });
  }

  // kind === 'variant'
  const variant = await prisma.variants.findUnique({
    where: { id: entityId },
    include: {
      products: { select: { name: true } },
      trainer_links: { select: { trainer_id: true, name: true, apellido: true } },
      trainer_confirmations: {
        select: { trainer_id: true, status: true, mail_sent_at: true, updated_at: true },
      },
    },
  });

  if (!variant) {
    return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);
  }

  const assignedIds = Array.from(
    new Set(
      (variant.trainer_links ?? [])
        .map((entry) => toTrimmed(entry.trainer_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (!assignedIds.length) {
    return errorResponse('NO_TRAINERS', 'La variante no tiene formadores asignados', 409);
  }

  const statusMap = new Map<string, TrainerConfirmationState>();
  for (const entry of variant.trainer_confirmations ?? []) {
    const trainerId = toTrimmed(entry.trainer_id);
    if (!trainerId) continue;
    statusMap.set(trainerId, toTrainerConfirmationState(entry.status));
  }

  const baseTargets = trainerIdsInput.length ? trainerIdsInput : assignedIds;
  const eligibleTargets = baseTargets.filter((id) => assignedIds.includes(id));
  const pendingTargets = eligibleTargets.filter((id) => {
    const state = statusMap.get(id);
    return !state || state === 'PENDING';
  });

  if (!pendingTargets.length) {
    const statuses = mapStatuses(variant.trainer_confirmations ?? []);
    return successResponse({ ok: true, sent: 0, statuses });
  }

  const trainers = await prisma.trainers.findMany({
    where: { trainer_id: { in: pendingTargets } },
    select: { trainer_id: true, email: true, name: true, apellido: true },
  });

  const trainerMap = new Map<string, { email: string | null; name: string | null; apellido: string | null }>();
  trainers.forEach((trainer) => trainerMap.set(trainer.trainer_id, trainer));

  const targets: ConfirmationTarget[] = [];
  for (const trainerId of pendingTargets) {
    const trainer = trainerMap.get(trainerId);
    const email = toTrimmed(trainer?.email);
    if (!email) {
      return errorResponse('MISSING_EMAIL', `El formador ${trainerId} no tiene email registrado`, 409);
    }
    const displayName = [toTrimmed(trainer?.name), toTrimmed(trainer?.apellido)]
      .filter(Boolean)
      .join(' ');
    targets.push({ trainerId, email, displayName: displayName || trainerId });
  }

  const payload: VariantEmailPayload = {
    type: 'variant',
    variantName: variant.name ?? null,
    productName: variant.products?.name ?? null,
    date: formatDate(variant.date ?? null),
    sede: variant.sede ?? null,
    wooId: variant.id_woo ? String(variant.id_woo) : null,
  };

  for (const target of targets) {
    const intro = 'Se ha asignado una formación en abierto para tu confirmación:';
    const { html, text } = buildEmailContent(payload, intro, target.displayName);
    await sendEmail({ to: target.email, subject: 'Nueva sesión a espera de confirmación', html, text });
    await prisma.trainer_confirmation_status.upsert({
      where: { variant_id_trainer_id: { variant_id: entityId, trainer_id: target.trainerId } },
      update: { status: 'MAIL_SENT', mail_sent_at: new Date(), updated_at: new Date() },
      create: {
        sesion_id: null,
        variant_id: entityId,
        trainer_id: target.trainerId,
        status: 'MAIL_SENT',
        mail_sent_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  const updatedStatuses = await prisma.trainer_confirmation_status.findMany({
    where: { variant_id: entityId },
    select: { trainer_id: true, status: true, mail_sent_at: true, updated_at: true },
  });

  return successResponse({ ok: true, sent: targets.length, statuses: mapStatuses(updatedStatuses) });
});
