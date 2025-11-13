// backend/functions/variant-trainer-invites.ts
import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError, PrismaClientUnknownRequestError } from '@prisma/client/runtime/library';
import { createHttpHandler, type HttpRequest } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendEmail } from './_shared/mailer';
import { toMadridISOString } from './_shared/timezone';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import { syncUserForTrainer } from './_shared/trainerUsers';

const MADRID_TIMEZONE = 'Europe/Madrid';

const VARIANT_TRAINER_TABLE = 'variant_trainer_links';

const FORMACION_ABIERTA_PIPELINE = 'Formación Abierta';

const ALLOWED_PIPELINE_KEYS = new Set([
  'formacion abierta',
]);

type TrainerInviteStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

type VariantTrainerRecord = {
  trainer_id: string;
  name: string | null;
  apellido: string | null;
  email: string | null;
  activo: boolean | null;
  user_id: string | null;
};

type VariantWithRelations = {
  id: string;
  id_woo: bigint | string | number | null;
  name: string | null;
  sede: string | null;
  date: Date | string | null;
  trainer_id: string | null;
  products: {
    name: string | null;
    code: string | null;
    hora_inicio: Date | string | null;
    hora_fin: Date | string | null;
  } | null;
  trainers: {
    trainer_id: string | null;
    name: string | null;
    apellido: string | null;
    email: string | null;
    activo: boolean | null;
    user_id: string | null;
  } | null;
  variant_invites?: Array<{
    trainer_id: string | null;
    status: TrainerInviteStatus | null;
  }> | null;
};

type VariantInviteRecord = {
  id: string;
  token: string;
  status: TrainerInviteStatus;
  sent_at: Date | string | null;
  created_at: Date | string | null;
  responded_at: Date | string | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_by_name: string | null;
  trainer_email: string | null;
  trainer_id: string;
  variants: VariantWithRelations | null;
  trainers: {
    trainer_id: string | null;
    name: string | null;
    apellido: string | null;
    email: string | null;
    activo: boolean | null;
    user_id: string | null;
  } | null;
};

type NormalizedVariantInfo = {
  id: string;
  woo_id: string | null;
  name: string | null;
  product_name: string | null;
  product_code: string | null;
  site: string | null;
  date: string | null;
  start_at: string | null;
  end_at: string | null;
};

type NormalizedVariantInvite = {
  token: string;
  type: 'variant';
  status: TrainerInviteStatus;
  sent_at: string | null;
  responded_at: string | null;
  created_by: {
    user_id: string | null;
    name: string | null;
    email: string | null;
  };
  trainer: {
    id: string;
    name: string | null;
    last_name: string | null;
    email: string | null;
  };
  variant: NormalizedVariantInfo;
};

type InviteSendResult = {
  trainerId: string;
  email: string;
  name: string;
  token: string;
  status: 'SENT' | 'FAILED';
};

type InviteSkippedTrainer = {
  trainer_id: string;
  name: string | null;
  apellido: string | null;
};

function generateToken(): string {
  return randomBytes(48).toString('base64url');
}

function buildBaseUrl(request: HttpRequest<any>): string {
  const headers = request.headers ?? {};
  const rawProto = headers['x-forwarded-proto'] || headers['x-forwarded-protocol'];
  const protocol = rawProto ? rawProto.split(',')[0]?.trim() || 'https' : 'https';
  const host = headers['host']?.trim();
  if (host) {
    return `${protocol}://${host}`;
  }
  const rawUrl = request.event.rawUrl;
  if (typeof rawUrl === 'string' && rawUrl.trim().length) {
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // ignore
    }
  }
  const fallback = process.env.PUBLIC_APP_BASE_URL;
  return typeof fallback === 'string' ? fallback.trim().replace(/\/$/, '') : '';
}

function buildInvitePath(token: string): string {
  return `/public/formadores/variantes/${encodeURIComponent(token)}`;
}

function escapeHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTrainerName(record: { name: string | null | undefined; apellido: string | null | undefined }): string {
  const parts = [record.name, record.apellido]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  return parts.join(' ') || 'Formador';
}

function normalizeInviteStatus(value: unknown): TrainerInviteStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DECLINED') {
    return normalized as TrainerInviteStatus;
  }
  return null;
}

function parseTokenActionFromPath(path: string): { token: string; action: 'fetch' | 'respond' } | null {
  const value = String(path || '');
  const respondMatch = value.match(/\/(?:\.netlify\/functions\/)?variant-trainer-invites\/([^/?#]+)\/respond(?:[/?#]|$)/i);
  if (respondMatch) {
    return { token: decodeURIComponent(respondMatch[1]), action: 'respond' };
  }
  const fetchMatch = value.match(/\/(?:\.netlify\/functions\/)?variant-trainer-invites\/([^/?#]+)(?:[/?#]|$)/i);
  if (fetchMatch) {
    return { token: decodeURIComponent(fetchMatch[1]), action: 'fetch' };
  }
  return null;
}

function isBasePath(path: string): boolean {
  const value = String(path || '');
  return /\/(?:\.netlify\/functions\/)?variant-trainer-invites(?:[/?#]|$)/i.test(value) && !/\/variant-trainer-invites\/[^/]+/i.test(value);
}

function formatDate(value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions): string | null {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-ES', { ...options, timeZone: MADRID_TIMEZONE }).format(date);
  } catch {
    return null;
  }
}

function formatScheduleRange(start: string | null, end: string | null) {
  const startDate = formatDate(start, { dateStyle: 'full' });
  const endDate = formatDate(end, { dateStyle: 'full' });
  const startTime = formatDate(start, { timeStyle: 'short' });
  const endTime = formatDate(end, { timeStyle: 'short' });

  if (startDate && startTime && endDate && endTime) {
    if (startDate === endDate) {
      const label = `${escapeHtml(startDate)}, ${escapeHtml(startTime)} – ${escapeHtml(endTime)}`;
      return { html: label, text: `${startDate}, ${startTime} – ${endTime}` };
    }
    const html = `${escapeHtml(startDate)}, ${escapeHtml(startTime)} – ${escapeHtml(endDate)}, ${escapeHtml(endTime)}`;
    return { html, text: `${startDate}, ${startTime} – ${endDate}, ${endTime}` };
  }

  if (startDate && startTime) {
    const html = `${escapeHtml(startDate)}, ${escapeHtml(startTime)}`;
    return { html, text: `${startDate}, ${startTime}` };
  }

  if (startDate) {
    const html = escapeHtml(startDate);
    return { html, text: startDate };
  }

  if (endDate && endTime) {
    const html = `${escapeHtml(endDate)}, ${escapeHtml(endTime)}`;
    return { html, text: `${endDate}, ${endTime}` };
  }

  if (endDate) {
    const html = escapeHtml(endDate);
    return { html, text: endDate };
  }

  return { html: 'Pendiente de programar', text: 'Pendiente de programar' };
}

function parseHourMinute(value: string | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { hour, minute };
}

function computeVariantSchedule(variant: VariantWithRelations): { start_at: string | null; end_at: string | null } {
  const dateValue = variant.date;
  if (!dateValue) {
    return { start_at: null, end_at: null };
  }
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (!Number.isFinite(date.getTime())) {
    return { start_at: null, end_at: null };
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const startTime = parseHourMinute(formatTimeFromDb(variant.products?.hora_inicio ?? null));
  const endTime = parseHourMinute(formatTimeFromDb(variant.products?.hora_fin ?? null));

  const start = startTime
    ? buildMadridDateTime({ year, month, day, hour: startTime.hour, minute: startTime.minute })
    : null;
  const end = endTime
    ? buildMadridDateTime({ year, month, day, hour: endTime.hour, minute: endTime.minute })
    : null;

  return {
    start_at: start ? start.toISOString() : null,
    end_at: end ? end.toISOString() : null,
  };
}

function normalizeVariantInfo(variant: VariantWithRelations | null): NormalizedVariantInfo {
  if (!variant) {
    return {
      id: '',
      woo_id: null,
      name: null,
      product_name: null,
      product_code: null,
      site: null,
      date: null,
      start_at: null,
      end_at: null,
    };
  }

  const schedule = computeVariantSchedule(variant);

  return {
    id: variant.id,
    woo_id:
      variant.id_woo == null
        ? null
        : typeof variant.id_woo === 'string'
          ? variant.id_woo
          : typeof variant.id_woo === 'number'
            ? variant.id_woo.toString()
            : variant.id_woo.toString(),
    name: variant.name ?? null,
    product_name: variant.products?.name ?? null,
    product_code: variant.products?.code ?? null,
    site: variant.sede ?? null,
    date: toMadridISOString(variant.date ?? null),
    start_at: schedule.start_at,
    end_at: schedule.end_at,
  };
}

function normalizeInvite(record: VariantInviteRecord): NormalizedVariantInvite {
  const trainer = record.trainers;
  const variantPayload = normalizeVariantInfo(record.variants);

  return {
    token: record.token,
    type: 'variant',
    status: record.status,
    sent_at: toMadridISOString(record.sent_at ?? record.created_at ?? null),
    responded_at: toMadridISOString(record.responded_at ?? null),
    created_by: {
      user_id: record.created_by_user_id ?? null,
      name: record.created_by_name ?? null,
      email: record.created_by_email ?? null,
    },
    trainer: {
      id: trainer?.trainer_id ?? record.trainer_id,
      name: trainer?.name ?? null,
      last_name: trainer?.apellido ?? null,
      email: trainer?.email ?? record.trainer_email ?? null,
    },
    variant: variantPayload,
  };
}

async function sendVariantInviteEmail(params: {
  email: string;
  trainerName: string;
  variant: NormalizedVariantInfo;
  link: string;
}) {
  const { email, trainerName, variant, link } = params;
  const schedule = formatScheduleRange(variant.start_at, variant.end_at);
  const address = variant.site ? escapeHtml(variant.site) : 'Por confirmar';
  const variantName = variant.name ?? variant.product_name ?? 'Formación';

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <p>Hola ${escapeHtml(trainerName)},</p>
      <p>
        Has sido asignado a la formación <strong>${escapeHtml(variantName)}</strong> de ${escapeHtml(
          FORMACION_ABIERTA_PIPELINE,
        )}.
      </p>
      <ul>
        <li><strong>Fecha y hora:</strong> ${schedule.html}</li>
        <li><strong>Ubicación:</strong> ${address}</li>
      </ul>
      <p>Puedes confirmar o denegar tu asistencia en el siguiente enlace:</p>
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#0b5ed7;color:#fff;text-decoration:none">Gestionar confirmación</a>
      </p>
      <p style="color:#666;font-size:13px">Si el botón no funciona, copia y pega esta URL en tu navegador:</p>
      <p style="word-break:break-all;font-size:13px"><code>${escapeHtml(link)}</code></p>
    </div>
  `.trim();

  const text = `Hola ${trainerName},\nHas sido asignado a la formación ${variantName} de ${FORMACION_ABIERTA_PIPELINE}.\nFecha y hora: ${schedule.text}.\nUbicación: ${variant.site ?? 'Por confirmar'}.\nConfirma o deniega en: ${link}`;

  await sendEmail({
    to: email,
    subject: `Confirmación de formación: ${variantName}`,
    html,
    text,
  });
}

async function sendDeclineNotification(params: {
  recipient: { email: string; name: string | null };
  trainerName: string;
  variant: NormalizedVariantInfo;
}) {
  const { recipient, trainerName, variant } = params;
  const schedule = formatScheduleRange(variant.start_at, variant.end_at);
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <p>Hola ${escapeHtml(recipient.name ?? 'equipo')},</p>
      <p>El formador <strong>${escapeHtml(trainerName)}</strong> ha rechazado la formación <strong>${escapeHtml(
        variant.name ?? variant.product_name ?? 'Formación',
      )}</strong>.</p>
      <ul>
        <li><strong>Fecha y hora:</strong> ${schedule.html}</li>
        <li><strong>Ubicación:</strong> ${escapeHtml(variant.site ?? 'Por confirmar')}</li>
      </ul>
    </div>
  `.trim();

  const text = `Hola ${recipient.name ?? 'equipo'},\n${trainerName} ha rechazado la formación ${
    variant.name ?? variant.product_name ?? 'Formación'
  }.`;

  await sendEmail({
    to: recipient.email,
    subject: `Invitación rechazada: ${variant.name ?? variant.product_name ?? 'Formación'}`,
    html,
    text,
  });
}

function isMissingRelationError(error: unknown, relation: string): boolean {
  if (error instanceof PrismaClientKnownRequestError) {
    if (error.code === 'P2021' || error.code === 'P2022') {
      const message = typeof error.meta?.cause === 'string' ? error.meta.cause : error.message;
      return new RegExp(`(?:relation|table).*${relation}`, 'i').test(message);
    }
  }
  if (error instanceof PrismaClientUnknownRequestError) {
    return new RegExp(`(?:relation|table).*${relation}`, 'i').test(error.message);
  }
  if (error instanceof Error) {
    return new RegExp(`(?:relation|table).*${relation}`, 'i').test(error.message);
  }
  return false;
}

async function fetchVariantTrainerAssignments(
  prisma: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  variantId: string,
) {
  try {
    const rows = await prisma.$queryRaw<Array<{
      trainer_id: string;
      name: string | null;
      apellido: string | null;
      email: string | null;
      activo: boolean | null;
      user_id: string | null;
    }>>`
      SELECT vtl.trainer_id,
             t.name,
             t.apellido,
             t.email,
             t.activo,
             t.user_id
      FROM variant_trainer_links vtl
      LEFT JOIN trainers t ON t.trainer_id = vtl.trainer_id
      WHERE vtl.variant_id = ${variantId}::uuid
      ORDER BY vtl.position ASC
    `;
    return rows;
  } catch (error) {
    if (isMissingRelationError(error, VARIANT_TRAINER_TABLE)) {
      console.warn('[variant-trainer-invites] variant trainer links unavailable', { error });
      return [];
    }
    throw error;
  }
}

async function collectVariantTrainers(
  prisma: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  variant: VariantWithRelations,
): Promise<{ withEmail: VariantTrainerRecord[]; withoutEmail: InviteSkippedTrainer[] }> {
  const map = new Map<string, VariantTrainerRecord>();

  const assignments = await fetchVariantTrainerAssignments(prisma, variant.id);

  if (assignments.length) {
    for (const assignment of assignments) {
      if (!assignment.trainer_id) continue;
      map.set(assignment.trainer_id, {
        trainer_id: assignment.trainer_id,
        name: assignment.name ?? null,
        apellido: assignment.apellido ?? null,
        email: assignment.email ?? null,
        activo: assignment.activo ?? null,
        user_id: assignment.user_id ?? null,
      });
    }

    const relationTrainerId = variant.trainers?.trainer_id ?? null;
    if (relationTrainerId && map.has(relationTrainerId)) {
      const current = map.get(relationTrainerId)!;
      map.set(relationTrainerId, {
        ...current,
        name: variant.trainers?.name ?? current.name ?? null,
        apellido: variant.trainers?.apellido ?? current.apellido ?? null,
        email: variant.trainers?.email ?? current.email ?? null,
        activo: variant.trainers?.activo ?? current.activo ?? null,
        user_id: variant.trainers?.user_id ?? current.user_id ?? null,
      });
    }
  } else {
    if (variant.trainers?.trainer_id) {
      const trainerId = variant.trainers.trainer_id;
      map.set(trainerId, {
        trainer_id: trainerId,
        name: variant.trainers.name ?? null,
        apellido: variant.trainers.apellido ?? null,
        email: variant.trainers.email ?? null,
        activo: variant.trainers.activo ?? null,
        user_id: variant.trainers.user_id ?? null,
      });
    }

    if (variant.trainer_id && !map.has(variant.trainer_id)) {
      const trainerRecord = await prisma.trainers.findUnique({
        where: { trainer_id: variant.trainer_id },
        select: { trainer_id: true, name: true, apellido: true, email: true, activo: true, user_id: true },
      });
      if (trainerRecord) {
        map.set(trainerRecord.trainer_id, {
          trainer_id: trainerRecord.trainer_id,
          name: trainerRecord.name ?? null,
          apellido: trainerRecord.apellido ?? null,
          email: trainerRecord.email ?? null,
          activo: trainerRecord.activo ?? null,
          user_id: trainerRecord.user_id ?? null,
        });
      }
    }
  }

  const withEmail: VariantTrainerRecord[] = [];
  const withoutEmail: InviteSkippedTrainer[] = [];

  for (const record of map.values()) {
    const email = record.email?.trim() ?? '';
    if (email.length) {
      withEmail.push(record);
    } else {
      withoutEmail.push({ trainer_id: record.trainer_id, name: record.name ?? null, apellido: record.apellido ?? null });
    }
  }

  return { withEmail, withoutEmail };
}

function normalizePipeline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function ensurePipelineAllowed(value: string | null): boolean {
  if (!value) return true;
  const normalized = normalizePipeline(value);
  if (!normalized) return true;
  return ALLOWED_PIPELINE_KEYS.has(normalized);
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const { method, path } = request;

  const tokenInfo = parseTokenActionFromPath(path);

  if (tokenInfo) {
    const token = tokenInfo.token;
    if (method === 'GET' && tokenInfo.action === 'fetch') {
      const invite = await prisma.trainer_variant_invites.findUnique({
        where: { token },
        include: {
          variants: {
            select: {
              id: true,
              id_woo: true,
              name: true,
              sede: true,
              date: true,
              trainer_id: true,
              products: { select: { name: true, code: true, hora_inicio: true, hora_fin: true } },
            },
          },
          trainers: { select: { trainer_id: true, name: true, apellido: true, email: true, activo: true, user_id: true } },
        },
      });

      if (!invite) {
        return errorResponse('NOT_FOUND', 'Invitación no encontrada', 404);
      }

      return successResponse({ invite: normalizeInvite(invite as VariantInviteRecord) });
    }

    if (method === 'POST' && tokenInfo.action === 'respond') {
      const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
      const actionRaw = body?.action;
      const action = typeof actionRaw === 'string' ? actionRaw.trim().toLowerCase() : '';
      if (action !== 'confirm' && action !== 'decline') {
        return errorResponse('VALIDATION_ERROR', 'Acción inválida', 400);
      }

      const invite = await prisma.trainer_variant_invites.findUnique({
        where: { token },
        include: {
          variants: {
            select: {
              id: true,
              id_woo: true,
              name: true,
              sede: true,
              date: true,
              trainer_id: true,
              products: { select: { name: true, code: true, hora_inicio: true, hora_fin: true } },
            },
          },
          trainers: { select: { trainer_id: true, name: true, apellido: true, email: true, activo: true, user_id: true } },
        },
      });

      if (!invite) {
        return errorResponse('NOT_FOUND', 'Invitación no encontrada', 404);
      }

      const status: TrainerInviteStatus = action === 'confirm' ? 'CONFIRMED' : 'DECLINED';

      const updated = await prisma.trainer_variant_invites.update({
        where: { id: invite.id },
        data: {
          status,
          responded_at: new Date(),
        },
        include: {
          variants: {
            select: {
              id: true,
              id_woo: true,
              name: true,
              sede: true,
              date: true,
              trainer_id: true,
              products: { select: { name: true, code: true, hora_inicio: true, hora_fin: true } },
            },
          },
          trainers: { select: { trainer_id: true, name: true, apellido: true, email: true, activo: true, user_id: true } },
        },
      });

      if (status === 'CONFIRMED') {
        try {
          await syncUserForTrainer(prisma, {
            trainer_id: invite.trainer_id,
            name: invite.trainers?.name ?? 'Formador',
            apellido: invite.trainers?.apellido ?? null,
            email: invite.trainers?.email ?? invite.trainer_email ?? null,
            activo: Boolean(invite.trainers?.activo ?? true),
            user_id: invite.trainers?.user_id ?? null,
          });
        } catch (error) {
          console.error('[variant-trainer-invites] Failed to sync trainer user on confirm', {
            trainerId: invite.trainer_id,
            error,
          });
        }
      } else if (status === 'DECLINED' && invite.created_by_email) {
        try {
          await sendDeclineNotification({
            recipient: { email: invite.created_by_email, name: invite.created_by_name },
            trainerName: buildTrainerName({ name: invite.trainers?.name ?? null, apellido: invite.trainers?.apellido ?? null }),
            variant: normalizeVariantInfo(invite.variants),
          });
        } catch (error) {
          console.error('[variant-trainer-invites] Failed to send decline notification', {
            inviteId: invite.id,
            error,
          });
        }
      }

      return successResponse({ invite: normalizeInvite(updated as VariantInviteRecord) });
    }
  }

  if (method === 'POST' && isBasePath(path)) {
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
    const variantIdRaw = body.variantId ?? body.variant_id;
    const variantId = typeof variantIdRaw === 'string' ? variantIdRaw.trim() : '';
    if (!variantId) {
      return errorResponse('VALIDATION_ERROR', 'variantId es obligatorio', 400);
    }

    const auth = await requireAuth(request, prisma);
    if ('error' in auth) {
      return auth.error;
    }

    const variant = await prisma.variants.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        id_woo: true,
        name: true,
        sede: true,
        date: true,
        trainer_id: true,
        products: { select: { name: true, code: true, hora_inicio: true, hora_fin: true } },
        trainers: { select: { trainer_id: true, name: true, apellido: true, email: true, activo: true, user_id: true } },
        variant_invites: { select: { trainer_id: true, status: true } },
      },
    });

    if (!variant) {
      return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);
    }

    if (!ensurePipelineAllowed(FORMACION_ABIERTA_PIPELINE)) {
      return errorResponse('INVALID_PIPELINE', 'La variante no pertenece a un pipeline compatible', 400);
    }

    const { withEmail, withoutEmail } = await collectVariantTrainers(prisma, variant);

    if (!withEmail.length) {
      return errorResponse('NO_TRAINERS', 'No hay formadores con email asignados a la variante', 400);
    }

    const existingInviteStatuses = new Map<string, TrainerInviteStatus>();
    for (const invite of variant.variant_invites ?? []) {
      const trainerId = typeof invite?.trainer_id === 'string' ? invite.trainer_id.trim() : '';
      if (!trainerId.length) continue;
      const status = normalizeInviteStatus(invite?.status ?? null);
      if (status) {
        existingInviteStatuses.set(trainerId, status);
      }
    }

    const trainersToInvite = withEmail.filter((trainer) => !existingInviteStatuses.has(trainer.trainer_id));

    const now = new Date();
    const invites = trainersToInvite.length
      ? await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const created: Array<{ token: string; trainer: VariantTrainerRecord }> = [];
          for (const trainer of trainersToInvite) {
            const token = generateToken();
            const existing = await tx.trainer_variant_invites.findFirst({
              where: { variant_id: variant.id, trainer_id: trainer.trainer_id },
            });

            const existingStatus = normalizeInviteStatus(existing?.status ?? null);
            if (existing && existingStatus) {
              continue;
            }

            let inviteToken = token;
            if (existing) {
              const updated = await tx.trainer_variant_invites.update({
                where: { id: existing.id },
                data: {
                  token,
                  status: 'PENDING',
                  sent_at: now,
                  responded_at: null,
                  created_by_user_id: auth.user.id,
                  created_by_email: auth.user.email,
                  created_by_name: `${auth.user.first_name} ${auth.user.last_name}`.trim(),
                  trainer_email: trainer.email,
                },
              });
              inviteToken = updated.token;
            } else {
              const createdInvite = await tx.trainer_variant_invites.create({
                data: {
                  variant_id: variant.id,
                  trainer_id: trainer.trainer_id,
                  token,
                  status: 'PENDING',
                  sent_at: now,
                  created_by_user_id: auth.user.id,
                  created_by_email: auth.user.email,
                  created_by_name: `${auth.user.first_name} ${auth.user.last_name}`.trim(),
                  trainer_email: trainer.email,
                },
              });
              inviteToken = createdInvite.token;
            }
            created.push({ token: inviteToken, trainer });
          }
          return created;
        })
      : [];

    const baseUrl = buildBaseUrl(request);
    const variantPayload = normalizeVariantInfo(variant);
    const results: InviteSendResult[] = [];

    for (const entry of invites) {
      const trainer = entry.trainer;
      const name = buildTrainerName({ name: trainer.name, apellido: trainer.apellido });
      const linkBase = baseUrl ? `${baseUrl}${buildInvitePath(entry.token)}` : buildInvitePath(entry.token);
      try {
        await sendVariantInviteEmail({
          email: trainer.email ?? '',
          trainerName: name,
          variant: variantPayload,
          link: linkBase,
        });
        results.push({ trainerId: trainer.trainer_id, email: trainer.email ?? '', name, token: entry.token, status: 'SENT' });
      } catch (error) {
        console.error('[variant-trainer-invites] Failed to send invite email', {
          variant_id: variant.id,
          trainer_id: trainer.trainer_id,
          error,
        });
        results.push({ trainerId: trainer.trainer_id, email: trainer.email ?? '', name, token: entry.token, status: 'FAILED' });
      }
    }

    return successResponse({
      variant: variantPayload,
      invites: results,
      skippedTrainers: withoutEmail,
    });
  }

  return errorResponse('NOT_FOUND', 'Ruta no encontrada', 404);
});
