// backend/functions/session_documents.ts
import { randomUUID } from 'crypto';
import { validate as isUUID } from 'uuid';
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import {
  COMMON_HEADERS,
  errorResponse,
  preflightResponse,
  successResponse,
} from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';
import {
  uploadSessionDocumentToGoogleDrive,
  deleteSessionDocumentFromGoogleDrive,
} from './_shared/googleDrive';

type ParsedPath = {
  docId: string | null;
};

type UploadedFileInput = {
  fileName?: unknown;
  mimeType?: unknown;
  fileSize?: unknown;
  contentBase64?: unknown;
};

type SessionFileRecord = {
  id: string;
  deal_id: string;
  sesion_id: string;
  file_type: string | null;
  compartir_formador: boolean;
  added_at: string | null;
  updated_at: string | null;
  drive_file_name: string | null;
  drive_web_view_link: string | null;
};

function parsePath(path: string): ParsedPath {
  const normalized = String(path || '');
  const trimmed = normalized.replace(/^\/?\.netlify\/functions\//, '/');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments[0] !== 'session_documents') {
    return { docId: null };
  }
  const docId = segments[1] ? decodeURIComponent(segments[1]) : null;
  return { docId };
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
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

function extractExtension(name: string): string | null {
  if (!name.includes('.')) return null;
  const parts = name.split('.');
  const ext = parts.pop();
  if (!ext) return null;
  const normalized = ext.trim().toLowerCase();
  return normalized.length ? normalized.slice(0, 10) : null;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized.length) return fallback;
    if (['1', 'true', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function toBufferFromBase64(contentBase64: string): Buffer {
  return Buffer.from(String(contentBase64), 'base64');
}

function mapSessionFile(row: any): SessionFileRecord {
  return {
    id: toStringOrNull(row?.id) ?? '',
    deal_id: toStringOrNull(row?.deal_id) ?? '',
    sesion_id: toStringOrNull(row?.sesion_id) ?? '',
    file_type: toStringOrNull(row?.file_type),
    compartir_formador: Boolean(row?.compartir_formador),
    added_at: row?.added_at ? toMadridISOString(row.added_at) : null,
    updated_at: row?.updated_at ? toMadridISOString(row.updated_at) : null,
    drive_file_name: toStringOrNull(row?.drive_file_name),
    drive_web_view_link: toStringOrNull(row?.drive_web_view_link),
  };
}

function extractPersistedSessionNumber(session: any): string | null {
  const candidates: unknown[] = [
    session?.numero,
    session?.numero_cache,
    session?.numero_sesion,
    session?.session_number,
    session?.orden,
    session?.order,
    session?.position,
  ];

  for (const candidate of candidates) {
    const value = toStringOrNull(candidate);
    if (value) return value;
  }

  const metadata = session?.metadata;
  if (metadata && typeof metadata === 'object') {
    const metaCandidate =
      toStringOrNull((metadata as any)?.numero) ||
      toStringOrNull((metadata as any)?.session_number);
    if (metaCandidate) return metaCandidate;
  }

  return null;
}

function toTimestamp(value: unknown): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function compareSessionsForOrder(
  a: { id: string; fecha_inicio_utc: Date | null; created_at: Date | null },
  b: { id: string; fecha_inicio_utc: Date | null; created_at: Date | null },
): number {
  const startA = toTimestamp(a.fecha_inicio_utc);
  const startB = toTimestamp(b.fecha_inicio_utc);
  if (startA !== null && startB !== null && startA !== startB) {
    return startA - startB;
  }
  if (startA === null && startB !== null) return 1;
  if (startA !== null && startB === null) return -1;
  const createdA = toTimestamp(a.created_at) ?? 0;
  const createdB = toTimestamp(b.created_at) ?? 0;
  if (createdA !== createdB) return createdA - createdB;
  return a.id.localeCompare(b.id);
}

async function resolveSessionNumber(
  prisma: PrismaClient,
  session: any,
): Promise<string> {
  const persisted = extractPersistedSessionNumber(session);
  if (persisted) return persisted;

  const siblings = await prisma.sessions.findMany({
    where: { deal_id: session.deal_id },
    select: { id: true, fecha_inicio_utc: true, created_at: true },
  });

  if (!siblings.length) {
    return '1';
  }

  const sorted = siblings.slice().sort(compareSessionsForOrder);
  const index = sorted.findIndex((row) => row.id === session.id);
  return String(index >= 0 ? index + 1 : sorted.length + 1);
}

async function ensureSessionContext(
  prisma: PrismaClient,
  dealId: string,
  sessionId: string,
) {
  const session = await prisma.sessions.findUnique({
    where: { id: sessionId },
    include: {
      deal: {
        include: { organization: { select: { name: true } } },
      },
    },
  });

  if (!session) {
    return { error: errorResponse('NOT_FOUND', 'Sesión no encontrada', 404) };
  }

  if (session.deal_id !== dealId) {
    return {
      error: errorResponse(
        'VALIDATION_ERROR',
        'La sesión no pertenece al presupuesto indicado',
        400,
      ),
    };
  }

  if (!session.deal) {
    const deal = await prisma.deals.findUnique({
      where: { deal_id: dealId },
      include: { organization: { select: { name: true } } },
    });
    if (!deal) {
      return { error: errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404) };
    }
    return { session: { ...session, deal } };
  }

  return { session };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const method = event.httpMethod;
    const prisma = getPrisma();
    const { docId } = parsePath(event.path || '');

    if (method === 'GET') {
      const params = event.queryStringParameters || {};
      const dealId = toStringOrNull(params.dealId ?? params.deal_id);
      const sessionId = toStringOrNull(params.sessionId ?? params.sesion_id);

      if (!dealId || !sessionId) {
        return errorResponse('VALIDATION_ERROR', 'dealId y sessionId son requeridos', 400);
      }
      if (!isUUID(sessionId)) {
        return errorResponse('VALIDATION_ERROR', 'sessionId inválido (UUID)', 400);
      }

      const { error } = await ensureSessionContext(prisma, dealId, sessionId);
      if (error) return error;

      const files = await prisma.session_files.findMany({
        where: { deal_id: dealId, sesion_id: sessionId },
        orderBy: { added_at: 'desc' },
      });

      return successResponse({ documents: files.map(mapSessionFile) });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      let payload: any = null;
      try {
        payload = JSON.parse(event.body);
      } catch {
        return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
      }

      const dealId = toStringOrNull(payload?.deal_id ?? payload?.dealId);
      const sessionId = toStringOrNull(payload?.sesion_id ?? payload?.sessionId);
      if (!dealId || !sessionId) {
        return errorResponse('VALIDATION_ERROR', 'deal_id y sesion_id son requeridos', 400);
      }
      if (!isUUID(sessionId)) {
        return errorResponse('VALIDATION_ERROR', 'sesion_id inválido (UUID)', 400);
      }

      const shareWithTrainer = parseBoolean(
        payload?.compartir_formador ?? payload?.shareWithTrainer,
        false,
      );

      const filesInput: UploadedFileInput[] = Array.isArray(payload?.files)
        ? payload.files
        : [];
      if (!filesInput.length) {
        return errorResponse('VALIDATION_ERROR', 'Se requiere al menos un archivo', 400);
      }

      const context = await ensureSessionContext(prisma, dealId, sessionId);
      if (context.error) return context.error;
      const session = context.session!;
      const deal = session.deal;
      if (!deal) {
        return errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);
      }

      const sessionNumber = await resolveSessionNumber(prisma, session);
      const sessionName = toStringOrNull(session?.nombre_cache) ?? `Sesión ${sessionNumber}`;

      const now = nowInMadridDate();
      const createdRecords: SessionFileRecord[] = [];

      for (const item of filesInput) {
        const fileNameRaw = toStringOrNull(item.fileName);
        const contentBase64 = toStringOrNull(item.contentBase64);
        const fileSize = typeof item.fileSize === 'number' ? item.fileSize : Number(item.fileSize);
        const mimeType = toStringOrNull(item.mimeType) ?? 'application/octet-stream';

        if (!fileNameRaw || !contentBase64) {
          return errorResponse(
            'VALIDATION_ERROR',
            'Cada archivo requiere fileName y contentBase64',
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
          return errorResponse('VALIDATION_ERROR', 'Archivo vacío o no válido', 400);
        }

        if (Number.isFinite(fileSize) && typeof fileSize === 'number' && fileSize > 0) {
          const delta = Math.abs(buffer.length - fileSize);
          if (delta > Math.max(512, fileSize * 0.01)) {
            return errorResponse(
              'VALIDATION_ERROR',
              `El tamaño del archivo "${fileNameRaw}" no coincide con el contenido recibido`,
              400,
            );
          }
        }

        const normalizedFileName = normalizeIncomingFileName(fileNameRaw) || fileNameRaw;
        const extension = extractExtension(normalizedFileName) ?? 'bin';

        let uploadResult;
        try {
          uploadResult = await uploadSessionDocumentToGoogleDrive({
            deal,
            session,
            organizationName: deal.organization?.name ?? null,
            sessionNumber,
            sessionName,
            fileName: normalizedFileName,
            mimeType,
            data: buffer,
          });
        } catch (err: any) {
          const message = err?.message || 'No se pudo subir el archivo a Drive';
          return errorResponse('UPLOAD_ERROR', message, 502);
        }

        const id = randomUUID();
        const created = await prisma.session_files.create({
          data: {
            id,
            deal_id: dealId,
            sesion_id: sessionId,
            file_type: extension,
            compartir_formador: shareWithTrainer,
            added_at: now,
            drive_file_name: uploadResult.driveFileName,
            drive_web_view_link: uploadResult.driveWebViewLink,
          },
        });

        createdRecords.push(mapSessionFile(created));
      }

      return successResponse({ documents: createdRecords }, 201);
    }

    if (method === 'PATCH' && docId) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      let payload: any = null;
      try {
        payload = JSON.parse(event.body);
      } catch {
        return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
      }

      const params = event.queryStringParameters || {};
      const dealId = toStringOrNull(payload?.deal_id ?? payload?.dealId ?? params.dealId ?? params.deal_id);
      const sessionId = toStringOrNull(
        payload?.sesion_id ?? payload?.sessionId ?? params.sessionId ?? params.sesion_id,
      );
      if (!dealId || !sessionId) {
        return errorResponse('VALIDATION_ERROR', 'dealId y sessionId son requeridos', 400);
      }
      if (!isUUID(sessionId)) {
        return errorResponse('VALIDATION_ERROR', 'sessionId inválido (UUID)', 400);
      }

      const compartirFormador = parseBoolean(
        payload?.compartir_formador ?? payload?.shareWithTrainer ?? payload?.share,
        false,
      );

      const existing = await prisma.session_files.findUnique({ where: { id: docId } });
      if (!existing || existing.deal_id !== dealId || existing.sesion_id !== sessionId) {
        return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      }

      const updated = await prisma.session_files.update({
        where: { id: docId },
        data: {
          compartir_formador: compartirFormador,
          updated_at: nowInMadridDate(),
        },
      });

      return successResponse({ document: mapSessionFile(updated) });
    }

    if (method === 'DELETE' && docId) {
      let payload: any = null;
      if (event.body) {
        try {
          payload = JSON.parse(event.body);
        } catch {
          return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
        }
      }

      const params = event.queryStringParameters || {};
      const dealId = toStringOrNull(
        payload?.deal_id ?? payload?.dealId ?? params.dealId ?? params.deal_id,
      );
      const sessionId = toStringOrNull(
        payload?.sesion_id ??
          payload?.sessionId ??
          params.sessionId ??
          params.sesion_id,
      );

      if (!dealId || !sessionId) {
        return errorResponse('VALIDATION_ERROR', 'dealId y sessionId son requeridos', 400);
      }
      if (!isUUID(sessionId)) {
        return errorResponse('VALIDATION_ERROR', 'sessionId inválido (UUID)', 400);
      }

      const existing = await prisma.session_files.findUnique({ where: { id: docId } });
      if (!existing || existing.deal_id !== dealId || existing.sesion_id !== sessionId) {
        return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      }

      const context = await ensureSessionContext(prisma, dealId, sessionId);
      if (context.error) return context.error;
      const session = context.session!;
      const deal = session.deal;
      if (!deal) {
        return errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);
      }

      const sessionNumber = await resolveSessionNumber(prisma, session);
      const sessionName = toStringOrNull(session?.nombre_cache) ?? `Sesión ${sessionNumber}`;

      const remainingCount = await prisma.session_files.count({
        where: {
          deal_id: dealId,
          sesion_id: sessionId,
          NOT: { id: docId },
        },
      });

      try {
        await deleteSessionDocumentFromGoogleDrive({
          deal,
          session,
          organizationName: deal.organization?.name ?? null,
          sessionNumber,
          sessionName,
          driveFileName: existing.drive_file_name,
          driveWebViewLink: existing.drive_web_view_link,
          removeSessionFolder: remainingCount === 0,
        });
      } catch (err: any) {
        const message = err?.message || 'No se pudo eliminar el archivo de Drive';
        return errorResponse('UPLOAD_ERROR', message, 502);
      }

      await prisma.session_files.delete({ where: { id: docId } });

      return successResponse({ ok: true });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (err: any) {
    console.error('[session_documents] Error inesperado', err);
    const message = err?.message || 'Error inesperado';
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: false, error_code: 'UNEXPECTED', message }),
    };
  }
};
