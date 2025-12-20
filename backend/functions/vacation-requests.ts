// backend/functions/vacation-requests.ts
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { normalizeRoleKey, requireAuth } from './_shared/auth';
import { sendEmail } from './_shared/mailer';
import { formatDateOnly, VACATION_TYPES } from './_shared/vacations';
import { uploadTrainerDocumentToGoogleDrive, uploadUserDocumentToGoogleDrive } from './_shared/googleDrive';

const RECIPIENT = 'people@gepgroup.es';
const VACATION_TAG_LABELS: Record<'V' | 'L' | 'A' | 'T' | 'M' | 'H' | 'F' | 'R' | 'P' | 'I' | 'N' | 'C', string> = {
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
  C: 'Fiesta autonómica',
};

const JUSTIFICATION_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const JUSTIFICATION_FOLDER_NAME = 'Justificantes';

type ParsedJustification = {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
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

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
}

function normalizeIncomingFileName(name: unknown): string {
  const raw = typeof name === 'string' ? name : String(name || '');
  if (!raw.includes('%')) return raw.trim();
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function buildDisplayName(user: any, trainer?: any): string {
  const pieces: string[] = [];
  if (trainer?.name) pieces.push(String(trainer.name));
  if (trainer?.apellido) pieces.push(String(trainer.apellido));

  if (!pieces.length) {
    if (user?.first_name) pieces.push(String(user.first_name));
    if (user?.last_name) pieces.push(String(user.last_name));
  }

  if (!pieces.length && user?.email) {
    pieces.push(String(user.email));
  }

  return pieces.join(' ').trim() || 'Usuario';
}

function parseJustification(payload: any): { error?: ReturnType<typeof errorResponse>; data?: ParsedJustification } {
  if (!payload) return {};

  const rawFileName =
    toStringOrNull(payload.fileName ?? payload.file_name ?? payload.name) ?? 'Justificante';
  const originalFileName = sanitizeFileName(normalizeIncomingFileName(rawFileName) || 'Justificante');
  const mimeType = toStringOrNull(payload.mimeType ?? payload.mime_type ?? payload.type) ?? 'application/octet-stream';
  const contentBase64 =
    toStringOrNull(payload.contentBase64 ?? payload.base64 ?? payload.data ?? payload.fileData ?? payload.file_data) ??
    null;
  const declaredSize =
    typeof payload.fileSize === 'number'
      ? payload.fileSize
      : Number(payload.fileSize ?? payload.size ?? payload.file_size);

  if (!contentBase64) {
    return { error: errorResponse('VALIDATION_ERROR', 'El justificante adjunto no es válido', 400) };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(contentBase64, 'base64');
  } catch {
    return { error: errorResponse('VALIDATION_ERROR', 'El justificante adjunto no es válido', 400) };
  }

  if (!buffer.length) {
    return { error: errorResponse('VALIDATION_ERROR', 'El justificante recibido está vacío', 400) };
  }

  if (buffer.length > JUSTIFICATION_MAX_BYTES) {
    return {
      error: errorResponse(
        'PAYLOAD_TOO_LARGE',
        'El justificante supera el tamaño máximo permitido (10 MB)',
        413,
      ),
    };
  }

  if (Number.isFinite(declaredSize) && declaredSize > 0) {
    const delta = Math.abs(buffer.length - Number(declaredSize));
    if (delta > Math.max(512, Number(declaredSize) * 0.05)) {
      return {
        error: errorResponse('VALIDATION_ERROR', 'El tamaño del justificante no coincide con el contenido recibido', 400),
      };
    }
  }

  return {
    data: {
      buffer,
      originalFileName,
      mimeType,
    },
  };
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
  const tag = (['V', 'L', 'A', 'T', 'M', 'H', 'F', 'R', 'P', 'I', 'N', 'C'] as const).includes(rawTag as any)
    ? (rawTag as keyof typeof VACATION_TAG_LABELS)
    : null;

  if (!startDate || !endDate) {
    return errorResponse('VALIDATION_ERROR', 'Las fechas de inicio y fin son obligatorias', 400);
  }

  if (endDate < startDate) {
    return errorResponse('VALIDATION_ERROR', 'La fecha de fin no puede ser anterior a la de inicio', 400);
  }

  const cc = auth.user.email ? auth.user.email : undefined;
  const role = normalizeRoleKey(auth.user.role);
  const justificationInput = request.body.justification ?? null;
  let justificationLink: string | null = null;
  let justificationFileName: string | null = null;

  if (justificationInput) {
    const parsed = parseJustification(justificationInput);
    if (parsed.error) {
      return parsed.error;
    }
    if (parsed.data) {
      const displayName = buildDisplayName(auth.user, auth.user.trainer);
      const justificationDate = startDate;
      const finalFileName = sanitizeFileName(`Justificante - ${justificationDate} - ${displayName}`) || 'Justificante';

      if (role === 'formador') {
        const trainer =
          auth.user.trainer ??
          (await prisma.trainers.findFirst({
            where: { user_id: auth.user.id },
          }));
        if (!trainer) {
          return errorResponse('NOT_FOUND', 'No se encontró tu ficha de formador para guardar el justificante', 404);
        }

        const uploadResult = await uploadTrainerDocumentToGoogleDrive({
          trainer,
          documentTypeLabel: 'Justificante',
          fileName: finalFileName,
          mimeType: parsed.data.mimeType,
          data: parsed.data.buffer,
          subfolderName: JUSTIFICATION_FOLDER_NAME,
        });

        await prisma.trainer_documents.create({
          data: {
            trainer_id: trainer.trainer_id,
            document_type: 'justificante',
            file_name: finalFileName,
            original_file_name: parsed.data.originalFileName,
            mime_type: parsed.data.mimeType,
            file_size: parsed.data.buffer.length,
            drive_file_id: uploadResult.driveFileId,
            drive_file_name: uploadResult.driveFileName,
            drive_web_view_link: uploadResult.driveWebViewLink,
            uploaded_at: new Date(),
          },
        });

        justificationLink = uploadResult.driveWebViewLink ?? null;
        justificationFileName = finalFileName;
      } else {
        const uploadResult = await uploadUserDocumentToGoogleDrive({
          user: auth.user,
          title: finalFileName,
          fileName: finalFileName,
          mimeType: parsed.data.mimeType,
          data: parsed.data.buffer,
          subfolderName: JUSTIFICATION_FOLDER_NAME,
          baseFolderName: 'Equipo GEP Group',
        });

        await prisma.user_documents.create({
          data: {
            user_id: auth.user.id,
            title: finalFileName,
            file_name: finalFileName,
            mime_type: parsed.data.mimeType,
            file_size: parsed.data.buffer.length,
            drive_folder_id: uploadResult.destinationFolderId ?? uploadResult.driveFolderId,
            drive_web_view_link: uploadResult.driveWebViewLink,
            drive_web_content_link: uploadResult.driveFolderContentLink,
            file_data: parsed.data.buffer,
            created_at: new Date(),
          },
        });

        justificationLink = uploadResult.driveWebViewLink ?? uploadResult.driveFolderContentLink ?? null;
        justificationFileName = finalFileName;
      }
    }
  }

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <h2>Petición de vacaciones y justificación de ausencias y Teletrabajo</h2>
      <p><strong>Usuario:</strong> ${auth.user.first_name} ${auth.user.last_name ?? ''} (${auth.user.email})</p>
      <p><strong>Fechas solicitadas:</strong> ${formatHumanDate(startDate)} → ${formatHumanDate(endDate)}</p>
      ${tag ? `<p><strong>Tipo:</strong> ${VACATION_TAG_LABELS[tag]}</p>` : ''}
      ${notes ? `<p><strong>Notas:</strong> ${notes}</p>` : ''}
      ${
        justificationLink
          ? `<p><strong>Justificante:</strong> <a href="${justificationLink}" target="_blank" rel="noreferrer">${justificationFileName ?? 'Ver documento'}</a></p>`
          : ''
      }
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
    subject: 'Petición de vacaciones y justificación de ausencias y Teletrabajo',
    html,
    text: `Petición de vacaciones y justificación de ausencias y Teletrabajo\nUsuario: ${auth.user.first_name} ${auth.user.last_name ?? ''} (${auth.user.email})\nFechas: ${startDate} -> ${endDate}${
      tag ? `\nTipo: ${VACATION_TAG_LABELS[tag]}` : ''
    }${notes ? `\nNotas: ${notes}` : ''}${justificationLink ? `\nJustificante: ${justificationLink}` : ''}`,
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
