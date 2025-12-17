// backend/functions/session-trainer-cancellations.ts
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendEmail } from './_shared/mailer';
import { toMadridISOString } from './_shared/timezone';

const MADRID_TIMEZONE = 'Europe/Madrid';

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function formatDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: MADRID_TIMEZONE,
    }).format(date);
  } catch {
    return null;
  }
}

function buildEmailContent({
  sessionName,
  productName,
  statusLabel,
  address,
  start,
  end,
}: {
  sessionName: string;
  productName: string | null;
  statusLabel: string;
  address: string | null;
  start: string | null;
  end: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Sesión ${statusLabel}: ${sessionName}`;
  const parts: string[] = [];
  const htmlParts: string[] = [];

  htmlParts.push(`<p>La sesión <strong>${sessionName}</strong> ha sido ${statusLabel.toLowerCase()}.</p>`);
  parts.push(`La sesión ${sessionName} ha sido ${statusLabel.toLowerCase()}.`);

  if (productName) {
    htmlParts.push(`<p><strong>Formación:</strong> ${productName}</p>`);
    parts.push(`Formación: ${productName}`);
  }
  if (start) {
    htmlParts.push(`<p><strong>Inicio:</strong> ${start}</p>`);
    parts.push(`Inicio: ${start}`);
  }
  if (end) {
    htmlParts.push(`<p><strong>Fin:</strong> ${end}</p>`);
    parts.push(`Fin: ${end}`);
  }
  if (address) {
    htmlParts.push(`<p><strong>Dirección:</strong> ${address}</p>`);
    parts.push(`Dirección: ${address}`);
  }

  htmlParts.push('<p>Este correo es informativo. No responda a este mensaje.</p>');
  parts.push('Este correo es informativo. No responda a este mensaje.');

  return {
    subject,
    html: htmlParts.join('\n'),
    text: parts.join('\n'),
  };
}

export const handler = createHttpHandler(async (request) => {
  await requireAuth(request);

  if (request.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  let body: any = {};
  try {
    body = request.body ? JSON.parse(request.body) : {};
  } catch {
    body = {};
  }

  const sessionId = toStringOrNull(body?.sessionId);
  const estado = toStringOrNull(body?.estado);

  if (!sessionId) {
    return errorResponse('VALIDATION_ERROR', 'sessionId es obligatorio', 400);
  }

  if (estado !== 'SUSPENDIDA' && estado !== 'CANCELADA') {
    return errorResponse('VALIDATION_ERROR', 'estado debe ser SUSPENDIDA o CANCELADA', 400);
  }

  const prisma = getPrisma();

  const session = await prisma.sesiones.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      nombre_cache: true,
      fecha_inicio_utc: true,
      fecha_fin_utc: true,
      direccion: true,
      deal_products: { select: { name: true } },
      trainer_session_invites: {
        where: { status: 'CONFIRMED' },
        select: {
          trainer_id: true,
          trainers: { select: { name: true, apellido: true, email: true } },
        },
      },
    },
  });

  if (!session) {
    return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
  }

  const sessionName = session.nombre_cache?.trim() || 'Sesión';
  const productName = session.deal_products?.name?.trim() || null;
  const address = session.direccion?.trim() || null;
  const start = formatDateTime(session.fecha_inicio_utc);
  const end = formatDateTime(session.fecha_fin_utc);
  const statusLabel = estado === 'CANCELADA' ? 'Cancelada' : 'Suspendida';

  const { subject, html, text } = buildEmailContent({
    sessionName,
    productName,
    statusLabel,
    address,
    start,
    end,
  });

  const recipients = (session.trainer_session_invites ?? [])
    .map((invite) => invite.trainers?.email?.trim())
    .filter((email): email is string => Boolean(email && email.length));

  if (recipients.length === 0) {
    return successResponse({ sent: 0, skipped: 0 });
  }

  let sent = 0;
  let skipped = 0;

  for (const email of recipients) {
    try {
      await sendEmail({
        to: email,
        subject,
        html,
        text,
      });
      sent += 1;
    } catch (error) {
      console.error('[session-trainer-cancellations] No se pudo enviar email', {
        sessionId,
        email,
        error,
      });
      skipped += 1;
    }
  }

  return successResponse({
    sent,
    skipped,
    sessionId,
    estado,
    start: session.fecha_inicio_utc ? toMadridISOString(session.fecha_inicio_utc) : null,
    end: session.fecha_fin_utc ? toMadridISOString(session.fecha_fin_utc) : null,
  });
});
