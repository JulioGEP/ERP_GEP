// backend/functions/documents.ts
import { validate as isUUID } from 'uuid';
import { getPrisma } from './_shared/prisma';
import {
  COMMON_HEADERS,
  errorResponse,
  preflightResponse,
  successResponse,
} from './_shared/response';
import {
  ensureSessionContext,
  resolveSessionNumber,
  toStringOrNull,
} from './_shared/sessions';
import { normalizeDriveUrl } from './_shared/drive';
import { uploadSessionCertificateToGoogleDrive } from './_shared/googleDrive';
import { nowInMadridDate } from './_shared/timezone';

const MAX_CERTIFICATE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function parsePath(path: string | undefined | null): { isUpload: boolean } {
  const normalized = String(path || '');
  const trimmed = normalized.replace(/^\/?\.netlify\/functions\//, '/');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments[0] !== 'documents') {
    return { isUpload: false };
  }
  const action = segments[1] ? decodeURIComponent(segments[1]) : null;
  return { isUpload: action === 'upload' };
}

function normalizeIncomingFileName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return '';
  if (!trimmed.includes('%')) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function toBufferFromBase64(contentBase64: string): Buffer {
  return Buffer.from(String(contentBase64), 'base64');
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const method = event.httpMethod;
    const { isUpload } = parsePath(event.path);

    if (method !== 'POST' || !isUpload) {
      return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
    }

    if (!event.body) {
      return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
    }

    let payload: any;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
    }

    const dealId = toStringOrNull(payload?.dealId ?? payload?.deal_id);
    const sessionId = toStringOrNull(payload?.sessionId ?? payload?.sesion_id);
    const studentId = toStringOrNull(payload?.studentId ?? payload?.alumno_id);
    const type = toStringOrNull(payload?.type ?? payload?.documentType);

    if (!dealId || !sessionId || !studentId) {
      return errorResponse(
        'VALIDATION_ERROR',
        'dealId, sessionId y studentId son requeridos',
        400,
      );
    }

    if (!isUUID(sessionId) || !isUUID(studentId)) {
      return errorResponse('VALIDATION_ERROR', 'sessionId o studentId inválidos (UUID)', 400);
    }

    if ((type ?? '').toLowerCase() !== 'certificate') {
      return errorResponse('VALIDATION_ERROR', 'type debe ser "certificate"', 400);
    }

    const fileInput = typeof payload?.file === 'object' && payload.file
      ? payload.file
      : payload;

    const fileNameRaw =
      toStringOrNull(fileInput?.fileName ?? fileInput?.name ?? payload?.fileName ?? payload?.name) ??
      null;
    const mimeType =
      toStringOrNull(fileInput?.mimeType ?? payload?.mimeType ?? payload?.contentType) ??
      'application/pdf';
    const contentBase64 =
      toStringOrNull(
        fileInput?.contentBase64 ??
          fileInput?.base64 ??
          fileInput?.data ??
          payload?.contentBase64 ??
          payload?.fileContentBase64 ??
          payload?.fileBase64,
      ) ?? null;

    const fileSize =
      typeof fileInput?.fileSize === 'number'
        ? fileInput.fileSize
        : Number(fileInput?.fileSize ?? payload?.fileSize);

    if (!contentBase64) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Se requiere el contenido del archivo en base64 (contentBase64)',
        400,
      );
    }

    let buffer: Buffer;
    try {
      buffer = toBufferFromBase64(contentBase64);
    } catch {
      return errorResponse('VALIDATION_ERROR', 'contentBase64 no es válido', 400);
    }

    if (!buffer.length) {
      return errorResponse('VALIDATION_ERROR', 'El archivo recibido está vacío', 400);
    }

    if (buffer.length > MAX_CERTIFICATE_SIZE_BYTES) {
      return errorResponse(
        'PAYLOAD_TOO_LARGE',
        'El archivo supera el tamaño máximo permitido de 10 MB',
        413,
      );
    }

    if (Number.isFinite(fileSize) && fileSize > 0) {
      const delta = Math.abs(buffer.length - fileSize);
      if (delta > Math.max(512, fileSize * 0.01)) {
        return errorResponse(
          'VALIDATION_ERROR',
          'El tamaño del archivo no coincide con el contenido recibido',
          400,
        );
      }
    }

    const prisma = getPrisma();

    const student = await prisma.alumnos.findUnique({ where: { id: studentId } });
    if (!student || student.deal_id !== dealId || student.sesion_id !== sessionId) {
      return errorResponse('NOT_FOUND', 'Alumno no encontrado para la sesión indicada', 404);
    }

    const { error, session } = await ensureSessionContext(prisma, dealId, sessionId);
    if (error) return error;
    const resolvedSession = session!;
    const deal = resolvedSession.deal;
    if (!deal) {
      return errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);
    }

    const sessionNumber = await resolveSessionNumber(prisma, resolvedSession);
    const sessionName =
      toStringOrNull(resolvedSession?.nombre_cache) ?? `Sesión ${sessionNumber}`;

    let normalizedFileName = fileNameRaw
      ? normalizeIncomingFileName(fileNameRaw)
      : '';
    if (!normalizedFileName) {
      const studentName = `${student.nombre} ${student.apellido}`.trim();
      normalizedFileName = `Certificado - ${studentName || student.dni || student.id}`;
    }
    if (!normalizedFileName.toLowerCase().endsWith('.pdf')) {
      normalizedFileName = `${normalizedFileName}.pdf`;
    }

    if (!mimeType.toLowerCase().includes('pdf')) {
      return errorResponse('VALIDATION_ERROR', 'Solo se permiten certificados en PDF', 400);
    }

    let uploadResult;
    try {
      uploadResult = await uploadSessionCertificateToGoogleDrive({
        deal,
        session: resolvedSession,
        organizationName: deal.organization?.name ?? null,
        sessionNumber,
        sessionName,
        fileName: normalizedFileName,
        mimeType,
        data: buffer,
      });
    } catch (err: any) {
      const message = err?.message || 'No se pudo subir el certificado a Drive';
      return errorResponse('UPLOAD_ERROR', message, 502);
    }

    if (!uploadResult.driveWebViewLink) {
      return errorResponse(
        'UPLOAD_ERROR',
        'No se pudo obtener un enlace público del certificado',
        502,
      );
    }

    const sessionFolderLink = normalizeDriveUrl(uploadResult.sessionFolderWebViewLink ?? null);
    const currentSessionDriveUrl = normalizeDriveUrl(resolvedSession.drive_url ?? null);
    if (sessionFolderLink && sessionFolderLink !== currentSessionDriveUrl) {
      try {
        await prisma.sessions.update({
          where: { id: resolvedSession.id },
          data: { drive_url: sessionFolderLink },
        });
        resolvedSession.drive_url = sessionFolderLink;
      } catch (err) {
        console.warn('[documents] No se pudo actualizar drive_url de la sesión', {
          sessionId: resolvedSession.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const updatedStudent = await prisma.alumnos.update({
      where: { id: student.id },
      data: {
        drive_url: uploadResult.driveWebViewLink,
        certificado: true,
        updated_at: nowInMadridDate(),
      },
    });

    return successResponse(
      {
        doc_id: uploadResult.driveFileId,
        file_name: uploadResult.driveFileName,
        public_url: uploadResult.driveWebViewLink,
        student: {
          id: updatedStudent.id,
          drive_url: updatedStudent.drive_url,
          certificado: Boolean(updatedStudent.certificado),
        },
      },
      201,
    );
  } catch (err: any) {
    console.error('[documents] Error inesperado', err);
    const message = err?.message || 'Error inesperado';
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: false, error_code: 'UNEXPECTED', message }),
    };
  }
};
