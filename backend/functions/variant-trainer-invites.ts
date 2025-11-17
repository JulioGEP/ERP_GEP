// backend/functions/variant-trainer-invites.ts
import { randomBytes } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { sqltag as sql, raw, PrismaClientKnownRequestError, PrismaClientUnknownRequestError } from '@prisma/client/runtime/library';

import { createHttpHandler, type HttpRequest } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendEmail } from './_shared/mailer';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import { toMadridISOString } from './_shared/timezone';
import { syncUserForTrainer } from './_shared/trainerUsers';

const MADRID_TIMEZONE = 'Europe/Madrid';

const VARIANT_TRAINER_LINKS_TABLE = 'variant_trainer_links';

type TrainerInviteStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

function normalizeInviteStatus(value: unknown): TrainerInviteStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DECLINED') {
    return normalized as TrainerInviteStatus;
  }
  return null;
}

function generateToken(): string {
  return randomBytes(48).toString('base64url');
}

function buildInvitePath(token: string): string {
  return `/public/formadores/variantes/${encodeURIComponent(token)}`;
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

function buildBaseUrl(request: HttpRequest<any>): string {
  const headers = request.headers;
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
  return /\/(?:\.netlify\/functions\/)?variant-trainer-invites(?:[/?#]|$)/i.test(value) &&
    !/\/variant-trainer-invites\/[^/]+/i.test(value);
}

type VariantTrainerRow = {
  trainer_id: string;
  name: string | null;
  apellido: string | null;
  email: string | null;
  activo: boolean | null;
  user_id: string | null;
};

async function fetchVariantTrainers(prisma: Prisma.TransactionClient | PrismaClient, variantId: string) {
  try {
    const rows = await prisma.$queryRaw(
      sql`
        SELECT vtl.trainer_id,
               t.name,
               t.apellido,
               t.email,
               t.activo,
               t.user_id
        FROM ${raw(VARIANT_TRAINER_LINKS_TABLE)} vtl
        LEFT JOIN trainers t ON t.trainer_id = vtl.trainer_id
        WHERE vtl.variant_id = ${variantId}::uuid
        ORDER BY vtl.position ASC
      `,
    ) as VariantTrainerRow[];
    return rows;
  } catch (error) {
    if (isMissingRelationError(error, VARIANT_TRAINER_LINKS_TABLE)) {
      return [];
    }
    throw error;
  }
}

function buildTrainerName(record: { name: string | null | undefined; apellido: string | null | undefined }): string {
  const parts = [record.name, record.apellido]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  return parts.join(' ') || 'Formador';
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

type TimeParts = { hour: number; minute: number };

function extractTimeParts(value: Date | string | null | undefined): TimeParts | null {
  const formatted = formatTimeFromDb(value);
  if (!formatted) return null;
  const match = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildDateTime(date: Date, time: TimeParts | null, fallback: TimeParts): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}

function computeVariantRange(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): { start: Date; end: Date } | null {
  if (!variantDate) return null;
  const parsedDate = new Date(variantDate as any);
  if (!Number.isFinite(parsedDate.getTime())) return null;
  const startTime = extractTimeParts(productTimes.hora_inicio);
  const endTime = extractTimeParts(productTimes.hora_fin);
  const fallbackStart: TimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: TimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });
  const start = buildDateTime(parsedDate, startTime, fallbackStart);
  let end = buildDateTime(parsedDate, endTime, fallbackEnd);
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  return { start, end };
}

type VariantRecord = {
  id: string;
  name: string | null;
  status: string | null;
  date: Date | string | null;
  sede: string | null;
  products: {
    name: string | null;
    code: string | null;
    hora_inicio: Date | string | null;
    hora_fin: Date | string | null;
  } | null;
};

type VariantInviteRecord = {
  trainer_id: string | null;
  status: string | null;
  sent_at: Date | string | null;
  responded_at: Date | string | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_by_name: string | null;
  trainer_email: string | null;
  variant: VariantRecord | null;
  trainers: {
    trainer_id: string | null;
    name: string | null;
    apellido: string | null;
    email: string | null;
    activo: boolean | null;
    user_id: string | null;
  } | null;
};

type NormalizedInvite = {
  token: string;
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
  variant: {
    id: string;
    name: string | null;
    status: string | null;
    product_name: string | null;
    product_code: string | null;
    sede: string | null;
    start_at: string | null;
    end_at: string | null;
  };
};

function buildVariantPayload(variant: VariantRecord | null): NormalizedInvite['variant'] {
  if (!variant) {
    return {
      id: '',
      name: null,
      status: null,
      product_name: null,
      product_code: null,
      sede: null,
      start_at: null,
      end_at: null,
    };
  }
  const range = computeVariantRange(variant.date, {
    hora_inicio: variant.products?.hora_inicio ?? null,
    hora_fin: variant.products?.hora_fin ?? null,
  });
  return {
    id: variant.id,
    name: variant.name ?? null,
    status: variant.status ?? null,
    product_name: variant.products?.name ?? null,
    product_code: variant.products?.code ?? null,
    sede: variant.sede ?? null,
    start_at: range ? toMadridISOString(range.start) : null,
    end_at: range ? toMadridISOString(range.end) : null,
  };
}

function normalizeInvite(record: VariantInviteRecord & { token: string }): NormalizedInvite {
  const trainer = record.trainers;
  const status = normalizeInviteStatus(record.status) ?? 'PENDING';
  return {
    token: record.token,
    status,
    sent_at: toMadridISOString(record.sent_at ?? null),
    responded_at: toMadridISOString(record.responded_at ?? null),
    created_by: {
      user_id: record.created_by_user_id ?? null,
      name: record.created_by_name ?? null,
      email: record.created_by_email ?? null,
    },
    trainer: {
      id: trainer?.trainer_id ?? record.trainer_id ?? '',
      name: trainer?.name ?? null,
      last_name: trainer?.apellido ?? null,
      email: trainer?.email ?? record.trainer_email ?? null,
    },
    variant: buildVariantPayload(record.variant ?? null),
  };
}

async function sendVariantInviteEmail(params: {
  email: string;
  trainerName: string;
  variant: NormalizedInvite['variant'];
  link: string;
}) {
  const { email, trainerName, variant, link } = params;
  const start = variant.start_at ? new Date(variant.start_at) : null;
  const end = variant.end_at ? new Date(variant.end_at) : null;
  const dateFormatter = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeZone: MADRID_TIMEZONE });
  const timeFormatter = new Intl.DateTimeFormat('es-ES', { timeStyle: 'short', timeZone: MADRID_TIMEZONE });
  let rangeHtml = 'Pendiente de programar';
  let rangeText = 'Pendiente de programar';
  if (start && end) {
    const sameDay = dateFormatter.format(start) === dateFormatter.format(end);
    const startDate = dateFormatter.format(start);
    const startTime = timeFormatter.format(start);
    const endDate = dateFormatter.format(end);
    const endTime = timeFormatter.format(end);
    if (sameDay) {
      rangeHtml = `${escapeHtml(startDate)}, ${escapeHtml(startTime)} – ${escapeHtml(endTime)}`;
      rangeText = `${startDate}, ${startTime} – ${endTime}`;
    } else {
      rangeHtml = `${escapeHtml(startDate)}, ${escapeHtml(startTime)} – ${escapeHtml(endDate)}, ${escapeHtml(endTime)}`;
      rangeText = `${startDate}, ${startTime} – ${endDate}, ${endTime}`;
    }
  } else if (start) {
    const startDate = dateFormatter.format(start);
    const startTime = timeFormatter.format(start);
    rangeHtml = `${escapeHtml(startDate)}, ${escapeHtml(startTime)}`;
    rangeText = `${startDate}, ${startTime}`;
  }
  const productInfo = variant.product_name ? ` del curso <strong>${escapeHtml(variant.product_name)}</strong>` : '';
  const sedeInfo = variant.sede ? escapeHtml(variant.sede) : 'Por confirmar';
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <p>Hola ${escapeHtml(trainerName)},</p>
      <p>
        Has sido asignado a la formación abierta <strong>${escapeHtml(variant.name ?? 'Formación')}</strong>${productInfo}.
      </p>
      <ul>
        <li><strong>Fecha y hora:</strong> ${rangeHtml}</li>
        <li><strong>Ubicación:</strong> ${sedeInfo}</li>
      </ul>
      <p>Puedes confirmar o rechazar tu asistencia en el siguiente enlace:</p>
      <p>
        <a href="${link}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#0b5ed7;color:#fff;text-decoration:none">Gestionar confirmación</a>
      </p>
      <p style="color:#666;font-size:13px">Si el botón no funciona, copia y pega esta URL en tu navegador:</p>
      <p style="word-break:break-all;font-size:13px"><code>${escapeHtml(link)}</code></p>
    </div>
  `.trim();
  const text = `Hola ${trainerName},\nHas sido asignado a la formación abierta ${variant.name ?? 'Formación'}${
    variant.product_name ? ` del curso ${variant.product_name}` : ''
  }.\nFecha y hora: ${rangeText}.\nUbicación: ${variant.sede ?? 'Por confirmar'}.\nConfirma o rechaza en: ${link}`;
  await sendEmail({
    to: email,
    subject: `Confirmación de formación abierta: ${variant.name ?? 'Formación'}`,
    html,
    text,
  });
}

async function sendDeclineNotification(params: {
  recipient: { email: string; name: string | null };
  trainerName: string;
  variant: NormalizedInvite['variant'];
}) {
  const { recipient, trainerName, variant } = params;
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <p>Hola ${escapeHtml(recipient.name ?? 'equipo')},</p>
      <p>El formador <strong>${escapeHtml(trainerName)}</strong> ha rechazado la formación abierta <strong>${escapeHtml(
        variant.name ?? 'Formación',
      )}</strong>.</p>
      <ul>
        <li><strong>Ubicación:</strong> ${escapeHtml(variant.sede ?? 'Por confirmar')}</li>
      </ul>
    </div>
  `.trim();
  const text = `Hola ${recipient.name ?? 'equipo'},\n${trainerName} ha rechazado la formación abierta ${variant.name ?? 'Formación'}.`;
  await sendEmail({
    to: recipient.email,
    subject: `Invitación rechazada: ${variant.name ?? 'Formación'}`,
    html,
    text,
  });
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const { method, path } = request;

  const tokenInfo = parseTokenActionFromPath(path);
  if (tokenInfo) {
    const token = tokenInfo.token;
    if (method === 'GET' && tokenInfo.action === 'fetch') {
      const invite = await prisma.variant_trainer_invites.findUnique({
        where: { token },
        include: {
          variant: {
            select: {
              id: true,
              name: true,
              status: true,
              date: true,
              sede: true,
              products: {
                select: {
                  name: true,
                  code: true,
                  hora_inicio: true,
                  hora_fin: true,
                },
              },
            },
          },
          trainers: {
            select: {
              trainer_id: true,
              name: true,
              apellido: true,
              email: true,
              activo: true,
              user_id: true,
            },
          },
        },
      });
      if (!invite) {
        return errorResponse('NOT_FOUND', 'Invitación no encontrada', 404);
      }
      return successResponse({ invite: normalizeInvite({ ...invite, variant: invite.variant }) });
    }

    if (method === 'POST' && tokenInfo.action === 'respond') {
      const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
      const actionRaw = body?.action;
      const action = typeof actionRaw === 'string' ? actionRaw.trim().toLowerCase() : '';
      if (action !== 'confirm' && action !== 'decline') {
        return errorResponse('VALIDATION_ERROR', 'Acción inválida', 400);
      }
      const invite = await prisma.variant_trainer_invites.findUnique({
        where: { token },
        include: {
          variant: {
            select: {
              id: true,
              name: true,
              status: true,
              date: true,
              sede: true,
              products: {
                select: {
                  name: true,
                  code: true,
                  hora_inicio: true,
                  hora_fin: true,
                },
              },
            },
          },
          trainers: {
            select: {
              trainer_id: true,
              name: true,
              apellido: true,
              email: true,
              activo: true,
              user_id: true,
            },
          },
        },
      });
      if (!invite) {
        return errorResponse('NOT_FOUND', 'Invitación no encontrada', 404);
      }
      if (invite.status !== 'PENDING') {
        return successResponse({ invite: normalizeInvite({ ...invite, variant: invite.variant }) });
      }
      const now = new Date();
      let updated = invite;
      if (action === 'confirm') {
        updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          if (invite.variant_id) {
            await tx.variants.update({
              where: { id: invite.variant_id },
              data: { status: 'publish' },
            });
          }

          return tx.variant_trainer_invites.update({
            where: { token },
            data: {
              status: 'CONFIRMED',
              responded_at: now,
            },
            include: {
              variant: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  date: true,
                  sede: true,
                  products: {
                    select: {
                      name: true,
                      code: true,
                      hora_inicio: true,
                      hora_fin: true,
                    },
                  },
                },
              },
              trainers: {
                select: {
                  trainer_id: true,
                  name: true,
                  apellido: true,
                  email: true,
                  activo: true,
                  user_id: true,
                },
              },
            },
          });
        });
        const trainer = updated.trainers;
        if (trainer) {
          try {
            await syncUserForTrainer(prisma, {
              trainer_id: trainer.trainer_id ?? '',
              name: trainer.name ?? 'Formador',
              apellido: trainer.apellido ?? null,
              email: trainer.email ?? null,
              activo: Boolean(trainer.activo),
              user_id: trainer.user_id ?? null,
            });
          } catch (error) {
            console.error('[variant-trainer-invites] Failed to sync trainer user on confirm', {
              trainer_id: trainer.trainer_id,
              error,
            });
          }
        }
      } else {
        updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          if (invite.variant_id) {
            await tx.variants.update({
              where: { id: invite.variant_id },
              data: { status: 'private' },
            });
          }

          return tx.variant_trainer_invites.update({
            where: { token },
            data: {
              status: 'DECLINED',
              responded_at: now,
            },
            include: {
              variant: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  date: true,
                  sede: true,
                  products: {
                    select: {
                      name: true,
                      code: true,
                      hora_inicio: true,
                      hora_fin: true,
                    },
                  },
                },
              },
              trainers: {
                select: {
                  trainer_id: true,
                  name: true,
                  apellido: true,
                  email: true,
                  activo: true,
                  user_id: true,
                },
              },
            },
          });
        });
        if (updated.created_by_email) {
          try {
            await sendDeclineNotification({
              recipient: { email: updated.created_by_email, name: updated.created_by_name },
              trainerName: buildTrainerName({
                name: updated.trainers?.name ?? null,
                apellido: updated.trainers?.apellido ?? null,
              }),
              variant: buildVariantPayload(updated.variant ?? null),
            });
          } catch (error) {
            console.error('[variant-trainer-invites] Failed to send decline notification', {
              invite_id: updated.id,
              error,
            });
          }
        }
      }
      return successResponse({ invite: normalizeInvite({ ...updated, variant: updated.variant }) });
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
        name: true,
        date: true,
        sede: true,
        status: true,
        products: {
          select: {
            name: true,
            code: true,
            hora_inicio: true,
            hora_fin: true,
          },
        },
        trainer_invites: {
          select: {
            trainer_id: true,
            status: true,
          },
        },
      },
    });
    if (!variant) {
      return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);
    }

    const assigned = await fetchVariantTrainers(prisma, variant.id);
    if (!assigned.length) {
      return errorResponse('NO_TRAINERS', 'No hay formadores asignados a la variante', 400);
    }

    const withEmail = assigned.filter((row: VariantTrainerRow) => typeof row.email === 'string' && row.email.trim().length);
    const withoutEmail = assigned.filter((row: VariantTrainerRow) => !row.email || !row.email.trim().length);
    if (!withEmail.length) {
      return errorResponse('NO_EMAIL', 'No hay formadores con email registrado', 400);
    }

    const existingInviteStatuses = new Map<string, TrainerInviteStatus>();
    for (const invite of variant.trainer_invites ?? []) {
      const trainerId = typeof invite.trainer_id === 'string' ? invite.trainer_id.trim() : '';
      if (!trainerId.length) continue;
      const status = normalizeInviteStatus(invite.status);
      if (status) existingInviteStatuses.set(trainerId, status);
    }

    const trainersToInvite = withEmail.filter((row: VariantTrainerRow) => !existingInviteStatuses.has(row.trainer_id));
    if (!trainersToInvite.length) {
      return errorResponse('ALREADY_SENT', 'No hay invitaciones pendientes de enviar', 400);
    }

    const now = new Date();
    const invites = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created: Array<{ token: string; trainer: VariantTrainerRow }> = [];
      for (const trainer of trainersToInvite) {
        const token = generateToken();
        const existing = await tx.variant_trainer_invites.findFirst({
          where: { variant_id: variant.id, trainer_id: trainer.trainer_id },
        });
        if (existing) {
          await tx.variant_trainer_invites.update({
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
          created.push({ token, trainer });
        } else {
          const createdInvite = await tx.variant_trainer_invites.create({
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
          created.push({ token: createdInvite.token, trainer });
        }
      }
      return created;
    });

    const baseUrl = buildBaseUrl(request);
    const variantPayload = buildVariantPayload({
      id: variant.id,
      name: variant.name,
      date: variant.date,
      sede: variant.sede,
      products: variant.products,
    });

    const results: Array<{ trainerId: string; email: string; name: string; token: string; status: 'SENT' | 'FAILED' }> = [];
    for (const entry of invites) {
      const trainer = entry.trainer;
      const name = buildTrainerName({ name: trainer.name, apellido: trainer.apellido });
      const link = baseUrl ? `${baseUrl}${buildInvitePath(entry.token)}` : buildInvitePath(entry.token);
      try {
        await sendVariantInviteEmail({
          email: trainer.email ?? '',
          trainerName: name,
          variant: variantPayload,
          link,
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

    const skippedTrainers = withoutEmail.map((row: VariantTrainerRow) => ({
      trainer_id: row.trainer_id,
      name: row.name ?? null,
      apellido: row.apellido ?? null,
    }));

    return successResponse({
      variant: variantPayload,
      invites: results,
      skippedTrainers,
    });
  }

  return errorResponse('NOT_FOUND', 'Ruta no encontrada', 404);
});
