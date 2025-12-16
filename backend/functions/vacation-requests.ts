// backend/functions/vacation-requests.ts
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { normalizeRoleKey, requireAuth } from './_shared/auth';
import { sendEmail } from './_shared/mailer';
import { formatDateOnly, VACATION_TYPES } from './_shared/vacations';

const RECIPIENT = 'people@gepgroup.es';
const VACATION_TAG_LABELS: Record<'V' | 'L' | 'A' | 'T' | 'M' | 'H' | 'F' | 'R' | 'P' | 'I' | 'N', string> = {
  V: 'Vacaciones',
  L: 'Festivo local',
  A: 'Día aniversario',
  T: 'Teletrabajo',
  M: 'Matrimonio o registro de pareja de hecho',
  H: 'Accidente, enfermedad, hospitalización o intervención de un familiar',
  F: 'Fallecimiento de un familiar',
  R: 'Traslado del domicilio habitual',
  P: 'Exámenes prenatales',
  I: 'Incapacidad temporal',
  N: 'Festivos nacionales',
};

function parseDateOnly(value: unknown): string | null {
  if (!value) return null;
  const input = typeof value === 'string' ? value.trim() : String(value);
  if (!input.length) return null;
  const normalized = input.includes('T') ? input.split('T')[0] : input;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function formatHumanDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
}

export const handler = createHttpHandler<any>(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  if (request.method === 'POST') {
    return handleCreateRequest(request, prisma, auth);
  }

  const role = normalizeRoleKey(auth.user.role);
  if (role !== 'admin' && role !== 'people') {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

  switch (request.method) {
    case 'GET':
      return handleListRequests(prisma);
    case 'DELETE':
      return handleDeleteRequest(request, prisma);
    case 'PATCH':
      return handleAcceptRequest(request, prisma);
    default:
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }
});

async function handleCreateRequest(request: any, prisma: ReturnType<typeof getPrisma>, auth: any) {
  if (!request.body || typeof request.body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
  }

  const startDate = parseDateOnly(request.body.startDate ?? request.body.start_date);
  const endDate = parseDateOnly(request.body.endDate ?? request.body.end_date);
  const notes = typeof request.body.notes === 'string' ? request.body.notes.trim() : '';
  const rawTag = typeof request.body.tag === 'string' ? request.body.tag.trim().toUpperCase() : '';
  const tag = (['V', 'L', 'A', 'T', 'M', 'H', 'F', 'R', 'P', 'I', 'N'] as const).includes(rawTag as any)
    ? (rawTag as keyof typeof VACATION_TAG_LABELS)
    : null;

  if (!startDate || !endDate) {
    return errorResponse('VALIDATION_ERROR', 'Las fechas de inicio y fin son obligatorias', 400);
  }

  if (endDate < startDate) {
    return errorResponse('VALIDATION_ERROR', 'La fecha de fin no puede ser anterior a la de inicio', 400);
  }

  const cc = auth.user.email ? auth.user.email : undefined;

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <h2>Petición de vacaciones</h2>
      <p><strong>Usuario:</strong> ${auth.user.first_name} ${auth.user.last_name ?? ''} (${auth.user.email})</p>
      <p><strong>Fechas solicitadas:</strong> ${formatHumanDate(startDate)} → ${formatHumanDate(endDate)}</p>
      ${tag ? `<p><strong>Tipo:</strong> ${VACATION_TAG_LABELS[tag]}</p>` : ''}
      ${notes ? `<p><strong>Notas:</strong> ${notes}</p>` : ''}
      <p style="margin-top:16px;color:#555">Enviado automáticamente desde ERP.</p>
    </div>
  `;

  await prisma.vacation_requests.create({
    data: {
      user_id: auth.user.id,
      start_date: new Date(`${startDate}T00:00:00Z`),
      end_date: new Date(`${endDate}T00:00:00Z`),
      tag,
      notes: notes || null,
    },
  });

  await sendEmail({
    to: RECIPIENT,
    cc,
    subject: 'Petición de vacaciones',
    html,
    text: `Petición de vacaciones\nUsuario: ${auth.user.first_name} ${auth.user.last_name ?? ''} (${auth.user.email})\nFechas: ${startDate} -> ${endDate}${
      tag ? `\nTipo: ${VACATION_TAG_LABELS[tag]}` : ''
    }${notes ? `\nNotas: ${notes}` : ''}`,
  });

  return successResponse({ message: 'Petición enviada correctamente' });
}

async function handleListRequests(prisma: ReturnType<typeof getPrisma>) {
  const requests = await prisma.vacation_requests.findMany({
    orderBy: { created_at: 'desc' },
    include: { user: { select: { id: true, first_name: true, last_name: true, email: true } } },
  });

  const formattedRequests = requests.map((request) => ({
    id: request.id,
    userId: request.user_id,
    userName: `${request.user.first_name} ${request.user.last_name ?? ''}`.trim(),
    userEmail: request.user.email,
    startDate: formatDateOnly(request.start_date),
    endDate: formatDateOnly(request.end_date),
    tag: request.tag,
    notes: request.notes,
    createdAt: request.created_at.toISOString(),
  }));

  return successResponse({ requests: formattedRequests });
}

async function handleDeleteRequest(request: any, prisma: ReturnType<typeof getPrisma>) {
  const id = String(request.query.id || '').trim();
  if (!id) {
    return errorResponse('VALIDATION_ERROR', 'id es obligatorio', 400);
  }

  const existing = await prisma.vacation_requests.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse('NOT_FOUND', 'Petición no encontrada', 404);
  }

  await prisma.vacation_requests.delete({ where: { id } });
  return successResponse({ message: 'Petición eliminada' });
}

async function handleAcceptRequest(request: any, prisma: ReturnType<typeof getPrisma>) {
  if (!request.body || typeof request.body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
  }

  const id = String(request.body.id || '').trim();
  if (!id) {
    return errorResponse('VALIDATION_ERROR', 'id es obligatorio', 400);
  }

  const existing = await prisma.vacation_requests.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse('NOT_FOUND', 'Petición no encontrada', 404);
  }

  const start = new Date(existing.start_date);
  const end = new Date(existing.end_date);
  const effectiveType = existing.tag && VACATION_TYPES.has(existing.tag) ? existing.tag : 'V';

  if (end < start) {
    return errorResponse('VALIDATION_ERROR', 'La solicitud tiene un rango de fechas inválido', 400);
  }

  const appliedDates: string[] = [];
  const operations = [] as ReturnType<typeof prisma.user_vacation_days.upsert>[];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateOnly = new Date(cursor);
    appliedDates.push(formatDateOnly(dateOnly));
    operations.push(
      prisma.user_vacation_days.upsert({
        where: { user_id_date: { user_id: existing.user_id, date: dateOnly } },
        update: { type: effectiveType },
        create: { user_id: existing.user_id, date: dateOnly, type: effectiveType },
      }),
    );
  }

  await prisma.$transaction([...operations, prisma.vacation_requests.delete({ where: { id } })]);

  return successResponse({ message: 'Petición aceptada y aplicada al calendario', appliedDates });
}
