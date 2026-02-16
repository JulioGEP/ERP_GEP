// backend/functions/session-trainer-invites.ts
import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { createHttpHandler, type HttpRequest } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendEmail } from './_shared/mailer';
import { toMadridISOString } from './_shared/timezone';
import { syncUserForTrainer } from './_shared/trainerUsers';

type SessionTrainerLinkRecord = {
  trainer_id: string;
  trainers: {
    trainer_id: string;
    name: string | null;
    apellido: string | null;
    email: string | null;
    activo: boolean | null;
    user_id: string | null;
  } | null;
};

type SessionWithRelations = {
  id: string;
  nombre_cache: string | null;
  fecha_inicio_utc: Date | string | null;
  fecha_fin_utc: Date | string | null;
  direccion: string | null;
  estado: string;
  deal_id: string;
  deals: {
    title: string | null;
    pipeline_id: string | null;
    pipeline_label: string | null;
    training_address: string | null;
  } | null;
  deal_products: {
    name: string | null;
    code: string | null;
  } | null;
  sesion_trainers: SessionTrainerLinkRecord[] | null;
  trainer_session_invites?:
    | Array<{
        trainer_id: string | null;
        status: TrainerInviteStatus | null;
      }>
    | null;
};

type TrainerInviteStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

type TrainerInviteRecord = {
  id: string;
  session_id: string;
  trainer_id: string;
  token: string;
  status: TrainerInviteStatus;
  sent_at: Date | string | null;
  responded_at: Date | string | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_by_name: string | null;
  trainer_email: string | null;
  created_at: Date | string | null;
  sesiones: SessionWithRelations | null;
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
  status: 'PENDING' | 'CONFIRMED' | 'DECLINED';
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
  session: {
    id: string;
    name: string | null;
    product_name: string | null;
    product_code: string | null;
    deal_id: string | null;
    deal_title: string | null;
    pipeline_id: string | null;
    pipeline_label: string | null;
    address: string | null;
    start_at: string | null;
    end_at: string | null;
  };
};

const MADRID_TIMEZONE = 'Europe/Madrid';

const PIPELINE_KEYS_ALLOWED = new Set([
  'gep services',
  'preventivos',
  'pci',
  'formacion empresa',
  'formacion empresas',
]);

function normalizeInviteStatus(value: unknown): TrainerInviteStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DECLINED') {
    return normalized as TrainerInviteStatus;
  }
  return null;
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

function isAllowedPipeline(value: unknown): boolean {
  const normalized = normalizePipeline(value);
  if (!normalized) return false;
  return PIPELINE_KEYS_ALLOWED.has(normalized);
}

function parseTokenActionFromPath(path: string): { token: string; action: 'fetch' | 'respond' } | null {
  const value = String(path || '');
  const respondMatch = value.match(/\/(?:\.netlify\/functions\/)?session-trainer-invites\/([^/?#]+)\/respond(?:[/?#]|$)/i);
  if (respondMatch) {
    return { token: decodeURIComponent(respondMatch[1]), action: 'respond' };
  }
  const fetchMatch = value.match(/\/(?:\.netlify\/functions\/)?session-trainer-invites\/([^/?#]+)(?:[/?#]|$)/i);
  if (fetchMatch) {
    return { token: decodeURIComponent(fetchMatch[1]), action: 'fetch' };
  }
  return null;
}

function isBasePath(path: string): boolean {
  const value = String(path || '');
  return /\/(?:\.netlify\/functions\/)?session-trainer-invites(?:[/?#]|$)/i.test(value) && !/\/session-trainer-invites\/[^/]+/i.test(value);
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

function buildInvitePath(token: string): string {
  return `/public/formadores/sesiones/${encodeURIComponent(token)}`;
}

function generateToken(): string {
  return randomBytes(48).toString('base64url');
}

function buildTrainerName(record: { name: string | null | undefined; apellido: string | null | undefined }): string {
  const parts = [record.name, record.apellido].map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean);
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

function formatSessionRange(start: string | Date | null | undefined, end: string | Date | null | undefined) {
  const startDate = formatDate(start, { dateStyle: 'full' });
  const endDate = formatDate(end, { dateStyle: 'full' });
  const startTime = formatDate(start, { timeStyle: 'short' });
  const endTime = formatDate(end, { timeStyle: 'short' });

  if (startDate && startTime && endDate && endTime) {
    if (startDate === endDate) {
      return {
        html: `${escapeHtml(startDate)}, ${escapeHtml(startTime)} – ${escapeHtml(endTime)}`,
        text: `${startDate}, ${startTime} – ${endTime}`,
      };
    }
    return {
      html: `${escapeHtml(startDate)}, ${escapeHtml(startTime)} – ${escapeHtml(endDate)}, ${escapeHtml(endTime)}`,
      text: `${startDate}, ${startTime} – ${endDate}, ${endTime}`,
    };
  }

  if (startDate && startTime) {
    return {
      html: `${escapeHtml(startDate)}, ${escapeHtml(startTime)}`,
      text: `${startDate}, ${startTime}`,
    };
  }

  if (startDate) {
    return { html: escapeHtml(startDate), text: startDate };
  }

  if (endDate && endTime) {
    return {
      html: `${escapeHtml(endDate)}, ${escapeHtml(endTime)}`,
      text: `${endDate}, ${endTime}`,
    };
  }

  if (endDate) {
    return { html: escapeHtml(endDate), text: endDate };
  }

  return {
    html: 'Pendiente de programar',
    text: 'Pendiente de programar',
  };
}

function buildSessionPayload(
  session:
    | SessionWithRelations
    | (TrainerInviteRecord['sesiones'] & {
        deals?: SessionWithRelations['deals'];
        deal_products?: SessionWithRelations['deal_products'];
      })
    | null
    | undefined,
): NormalizedInvite['session'] {
  if (!session) {
    return {
      id: '',
      name: null,
      product_name: null,
      product_code: null,
      deal_id: null,
      deal_title: null,
      pipeline_id: null,
      pipeline_label: null,
      address: null,
      start_at: null,
      end_at: null,
    };
  }

  const addressSource =
    typeof session.direccion === 'string' && session.direccion.trim().length
      ? session.direccion.trim()
      : session.deals?.training_address?.trim() ?? null;

  return {
    id: session.id ?? '',
    name: session.nombre_cache ?? null,
    product_name: session.deal_products?.name ?? null,
    product_code: session.deal_products?.code ?? null,
    deal_id: session.deal_id ?? null,
    deal_title: session.deals?.title ?? null,
    pipeline_id: session.deals?.pipeline_id ?? null,
    pipeline_label: session.deals?.pipeline_label ?? null,
    address: addressSource,
    start_at: toMadridISOString(session.fecha_inicio_utc ?? null),
    end_at: toMadridISOString(session.fecha_fin_utc ?? null),
  };
}

function normalizeInvite(record: TrainerInviteRecord): NormalizedInvite {
  const trainer = record.trainers;
  const sessionPayload = buildSessionPayload(record.sesiones);

  return {
    token: record.token,
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
    session: sessionPayload,
  };
}

async function sendTrainerInviteEmail(params: {
  email: string;
  trainerName: string;
  session: NormalizedInvite['session'];
  link: string;
}) {
  const { email, trainerName, session, link } = params;
  const range = formatSessionRange(session.start_at, session.end_at);
  const dealInfo = session.deal_title ? ` del presupuesto <strong>${escapeHtml(session.deal_title)}</strong>` : '';
  const address = session.address ? escapeHtml(session.address) : 'Por confirmar';

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <p>Hola ${escapeHtml(trainerName)},</p>
      <p>
        Has sido asignado a la sesión <strong>${escapeHtml(session.name ?? 'Sesión')}</strong>${dealInfo}.
      </p>
      <ul>
        <li><strong>Fecha y hora:</strong> ${range.html}</li>
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

  const text = `Hola ${trainerName},\nHas sido asignado a la sesión ${session.name ?? 'Sesión'}${
    session.deal_title ? ` del presupuesto ${session.deal_title}` : ''
  }.\nFecha y hora: ${range.text}.\nUbicación: ${session.address ?? 'Por confirmar'}.\nConfirma o deniega en: ${link}`;

  await sendEmail({
    to: email,
    subject: `Confirmación de sesión: ${session.name ?? 'Sesión'}`,
    html,
    text,
  });
}

async function sendDeclineNotification(params: {
  recipient: { email: string; name: string | null };
  trainerName: string;
  session: NormalizedInvite['session'];
}) {
  const { recipient, trainerName, session } = params;
  const range = formatSessionRange(session.start_at, session.end_at);
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <p>Hola ${escapeHtml(recipient.name ?? 'equipo')},</p>
      <p>El formador <strong>${escapeHtml(trainerName)}</strong> ha rechazado la sesión <strong>${escapeHtml(
        session.name ?? 'Sesión',
      )}</strong>.</p>
      <ul>
        <li><strong>Fecha y hora:</strong> ${range.html}</li>
        <li><strong>Ubicación:</strong> ${escapeHtml(session.address ?? 'Por confirmar')}</li>
      </ul>
    </div>
  `.trim();

  const text = `Hola ${recipient.name ?? 'equipo'},\n${trainerName} ha rechazado la sesión ${session.name ?? 'Sesión'}.`;

  await sendEmail({
    to: recipient.email,
    subject: `Invitación rechazada: ${session.name ?? 'Sesión'}`,
    html,
    text,
  });
}

function filterTrainersWithEmail(session: SessionWithRelations) {
  const withEmail: Array<{
    trainer_id: string;
    name: string | null;
    apellido: string | null;
    email: string;
    activo: boolean;
    user_id: string | null;
  }> = [];
  const withoutEmail: Array<{ trainer_id: string; name: string | null; apellido: string | null }> = [];

  (session.sesion_trainers ?? []).forEach((link) => {
    const trainer = link.trainers;
    if (!trainer) return;
    const email = typeof trainer.email === 'string' ? trainer.email.trim() : '';
    if (email.length) {
      withEmail.push({
        trainer_id: trainer.trainer_id,
        name: trainer.name ?? null,
        apellido: trainer.apellido ?? null,
        email,
        activo: Boolean(trainer.activo),
        user_id: trainer.user_id ?? null,
      });
    } else {
      withoutEmail.push({
        trainer_id: trainer.trainer_id,
        name: trainer.name ?? null,
        apellido: trainer.apellido ?? null,
      });
    }
  });

  return { withEmail, withoutEmail };
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const { method, path } = request;

  const tokenInfo = parseTokenActionFromPath(path);

  if (tokenInfo) {
    const token = tokenInfo.token;
    if (method === 'GET' && tokenInfo.action === 'fetch') {
      const invite = await prisma.trainer_session_invites.findUnique({
        where: { token },
        include: {
          sesiones: {
            select: {
              id: true,
              nombre_cache: true,
              fecha_inicio_utc: true,
              fecha_fin_utc: true,
              direccion: true,
              estado: true,
              deal_id: true,
              deals: {
                select: {
                  title: true,
                  pipeline_id: true,
                  pipeline_label: true,
                  training_address: true,
                },
              },
              deal_products: {
                select: {
                  name: true,
                  code: true,
                },
              },
              sesion_trainers: {
                select: {
                  trainer_id: true,
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

      return successResponse({ invite: normalizeInvite(invite) });
    }

    if (method === 'POST' && tokenInfo.action === 'respond') {
      const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
      const actionRaw = body?.action;
      const action = typeof actionRaw === 'string' ? actionRaw.trim().toLowerCase() : '';
      if (action !== 'confirm' && action !== 'decline') {
        return errorResponse('VALIDATION_ERROR', 'Acción inválida', 400);
      }

      const invite = await prisma.trainer_session_invites.findUnique({
        where: { token },
        include: {
          sesiones: {
            select: {
              id: true,
              nombre_cache: true,
              fecha_inicio_utc: true,
              fecha_fin_utc: true,
              direccion: true,
              estado: true,
              deal_id: true,
              deals: {
                select: {
                  title: true,
                  pipeline_id: true,
                  pipeline_label: true,
                  training_address: true,
                },
              },
              deal_products: {
                select: {
                  name: true,
                  code: true,
                },
              },
              sesion_trainers: {
                select: {
                  trainer_id: true,
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
        return successResponse({ invite: normalizeInvite(invite) }, 200);
      }

      const now = new Date();
      let updated = invite;

      if (action === 'confirm') {
        updated = await prisma.trainer_session_invites.update({
          where: { token },
          data: {
            status: 'CONFIRMED',
            responded_at: now,
          },
          include: {
            sesiones: {
              select: {
                id: true,
                nombre_cache: true,
                fecha_inicio_utc: true,
                fecha_fin_utc: true,
                direccion: true,
                estado: true,
                deal_id: true,
                deals: {
                  select: {
                    title: true,
                    pipeline_id: true,
                    pipeline_label: true,
                    training_address: true,
                  },
                },
                deal_products: {
                  select: {
                    name: true,
                    code: true,
                  },
                },
                sesion_trainers: {
                  select: {
                    trainer_id: true,
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

        const trainer = updated.trainers;
        if (trainer) {
          try {
            await syncUserForTrainer(prisma, {
              trainer_id: trainer.trainer_id,
              name: trainer.name ?? 'Formador',
              apellido: trainer.apellido ?? null,
              email: trainer.email ?? null,
              activo: Boolean(trainer.activo),
              user_id: trainer.user_id ?? null,
            });
          } catch (error) {
            console.error('[session-trainer-invites] Failed to sync trainer user on confirm', {
              trainer_id: trainer.trainer_id,
              error,
            });
          }
        }
      } else {
        updated = await prisma.trainer_session_invites.update({
          where: { token },
          data: {
            status: 'DECLINED',
            responded_at: now,
          },
          include: {
            sesiones: {
              select: {
                id: true,
                nombre_cache: true,
                fecha_inicio_utc: true,
                fecha_fin_utc: true,
                direccion: true,
                estado: true,
                deal_id: true,
                deals: {
                  select: {
                    title: true,
                    pipeline_id: true,
                    pipeline_label: true,
                    training_address: true,
                  },
                },
                deal_products: {
                  select: {
                    name: true,
                    code: true,
                  },
                },
                sesion_trainers: {
                  select: {
                    trainer_id: true,
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

        if (updated.created_by_email) {
          try {
            await sendDeclineNotification({
              recipient: { email: updated.created_by_email, name: updated.created_by_name },
              trainerName: buildTrainerName({
                name: updated.trainers?.name ?? null,
                apellido: updated.trainers?.apellido ?? null,
              }),
              session: buildSessionPayload(updated.sesiones),
            });
          } catch (error) {
            console.error('[session-trainer-invites] Failed to send decline notification', {
              invite_id: updated.id,
              error,
            });
          }
        }
      }

      return successResponse({ invite: normalizeInvite(updated) });
    }
  }

  if (method === 'POST' && isBasePath(path)) {
    const prismaTx = prisma;
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
    const sessionIdRaw = body.sessionId ?? body.session_id ?? body.sesion_id;
    const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw.trim() : '';
    if (!sessionId) {
      return errorResponse('VALIDATION_ERROR', 'sessionId es obligatorio', 400);
    }

    const auth = await requireAuth(request, prismaTx);
    if ('error' in auth) {
      return auth.error;
    }

    const session = await prismaTx.sesiones.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        nombre_cache: true,
        fecha_inicio_utc: true,
        fecha_fin_utc: true,
        direccion: true,
        estado: true,
        deal_id: true,
        deals: {
          select: {
            title: true,
            pipeline_id: true,
            pipeline_label: true,
            training_address: true,
          },
        },
        deal_products: {
          select: {
            name: true,
            code: true,
          },
        },
        sesion_trainers: {
          select: {
            trainer_id: true,
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
        },
        trainer_session_invites: {
          select: {
            trainer_id: true,
            status: true,
          },
        },
      },
    });

    if (!session) {
      return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
    }

    if (session.estado !== 'PLANIFICADA') {
      return errorResponse('INVALID_STATE', 'La sesión debe estar en estado planificada', 400);
    }

    const pipelineSource = session.deals?.pipeline_id ?? session.deals?.pipeline_label ?? null;
    if (!isAllowedPipeline(pipelineSource)) {
      return errorResponse('INVALID_PIPELINE', 'La sesión no pertenece a un pipeline compatible', 400);
    }

    const { withEmail, withoutEmail } = filterTrainersWithEmail(session);

    const existingInviteStatuses = new Map<string, TrainerInviteStatus>();
    for (const invite of session.trainer_session_invites ?? []) {
      const trainerId = typeof invite?.trainer_id === 'string' ? invite.trainer_id.trim() : '';
      if (!trainerId.length) continue;
      const status = normalizeInviteStatus(invite?.status ?? null);
      if (status) {
        existingInviteStatuses.set(trainerId, status);
      }
    }

    const trainersToInvite = withEmail.filter((trainer) => !existingInviteStatuses.has(trainer.trainer_id));

    if (!withEmail.length) {
      return errorResponse('NO_TRAINERS', 'No hay formadores con email asignados a la sesión', 400);
    }

    const now = new Date();
    const invites = trainersToInvite.length
      ? await prismaTx.$transaction(async (tx: Prisma.TransactionClient) => {
          const created: Array<{ token: string; trainer: typeof withEmail[number] }> = [];
          for (const trainer of trainersToInvite) {
            const token = generateToken();
            const existing = await tx.trainer_session_invites.findFirst({
              where: { session_id: session.id, trainer_id: trainer.trainer_id },
            });

            const existingStatus = normalizeInviteStatus(existing?.status ?? null);

            if (existing && existingStatus) {
              continue;
            }

            let inviteToken = token;
            if (existing) {
              const updated = await tx.trainer_session_invites.update({
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
              const createdInvite = await tx.trainer_session_invites.create({
                data: {
                  session_id: session.id,
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
    const sessionPayload = buildSessionPayload(session);

    const results: Array<{ trainerId: string; email: string; name: string; token: string; status: 'SENT' | 'FAILED' }> = [];

    for (const entry of invites) {
      const trainer = entry.trainer;
      const name = buildTrainerName({ name: trainer.name, apellido: trainer.apellido });
      const linkBase: string = baseUrl
        ? `${baseUrl}${buildInvitePath(entry.token)}`
        : buildInvitePath(entry.token);
      try {
        await sendTrainerInviteEmail({
          email: trainer.email,
          trainerName: name,
          session: sessionPayload,
          link: linkBase,
        });
        results.push({ trainerId: trainer.trainer_id, email: trainer.email, name, token: entry.token, status: 'SENT' });
      } catch (error) {
        console.error('[session-trainer-invites] Failed to send invite email', {
          session_id: session.id,
          trainer_id: trainer.trainer_id,
          error,
        });
        results.push({ trainerId: trainer.trainer_id, email: trainer.email, name, token: entry.token, status: 'FAILED' });
      }
    }

    return successResponse({
      session: sessionPayload,
      invites: results,
      skippedTrainers: withoutEmail,
    });
  }

  return errorResponse('NOT_FOUND', 'Ruta no encontrada', 404);
});
