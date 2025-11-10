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
import {
  ensureSessionContext,
  resolveSessionNumber,
  toStringOrNull,
} from './_shared/sessions';

const ONE_MEGABYTE = 1024 * 1024;
const MAX_SESSION_DOCUMENT_SIZE_BYTES = 4 * ONE_MEGABYTE;
const MAX_SESSION_DOCUMENT_SIZE_LABEL = '4 MB';

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

function normalizeDriveUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

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

      const context = await ensureSessionContext(prisma, dealId, sessionId);
      if (context.error) return context.error;

      const session = context.session!;
      const sessionDriveUrl = normalizeDriveUrl(session?.drive_url ?? null);

      const files = await prisma.sesion_files.findMany({
        where: { deal_id: dealId, sesion_id: sessionId },
        orderBy: { added_at: 'desc' },
      });

      return successResponse({
        documents: files.map(mapSessionFile),
        drive_url: sessionDriveUrl,
      });
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

      const estimatedTotalSize = filesInput.reduce((sum, item) => {
        const parsed =
          typeof item.fileSize === 'number' ? item.fileSize : Number(item.fileSize);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return sum;
        }
        return sum + parsed;
      }, 0);

      if (estimatedTotalSize > MAX_SESSION_DOCUMENT_SIZE_BYTES) {
        return errorResponse(
          'PAYLOAD_TOO_LARGE',
          `El tamaño total de los archivos supera el límite permitido de ${MAX_SESSION_DOCUMENT_SIZE_LABEL}`,
          413,
        );
      }

      const context = await ensureSessionContext(prisma, dealId, sessionId);
      if (context.error) return context.error;
      const session = context.session!;
      let sessionDriveUrl = normalizeDriveUrl(session.drive_url ?? null);
      const deal = session.deals;
      if (!deal) {
        return errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);
      }

      const sessionNumber = await resolveSessionNumber(prisma, session);
      const sessionName = toStringOrNull(session?.nombre_cache) ?? `Sesión ${sessionNumber}`;

      const now = nowInMadridDate();
      const createdRecords: SessionFileRecord[] = [];
      let processedTotalSize = 0;

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

        processedTotalSize += buffer.length;

        if (buffer.length > MAX_SESSION_DOCUMENT_SIZE_BYTES) {
          return errorResponse(
            'PAYLOAD_TOO_LARGE',
            `El archivo "${fileNameRaw}" supera el tamaño máximo permitido de ${MAX_SESSION_DOCUMENT_SIZE_LABEL}`,
            413,
          );
        }

        if (processedTotalSize > MAX_SESSION_DOCUMENT_SIZE_BYTES) {
          return errorResponse(
            'PAYLOAD_TOO_LARGE',
            `El tamaño total de los archivos supera el límite permitido de ${MAX_SESSION_DOCUMENT_SIZE_LABEL}`,
            413,
          );
        }

        const normalizedFileName = normalizeIncomingFileName(fileNameRaw) || fileNameRaw;
        const extension = extractExtension(normalizedFileName) ?? 'bin';

        let uploadResult;
        try {
          uploadResult = await uploadSessionDocumentToGoogleDrive({
            deal,
            session,
            organizationName:
              deal.organizations?.name ?? (deal as any)?.organizations?.name ?? null,
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

        const folderLink = normalizeDriveUrl(uploadResult.sessionFolderWebViewLink ?? null);
        if (folderLink && folderLink !== sessionDriveUrl) {
          try {
            await prisma.sesiones.update({
              where: { id: sessionId },
              data: { drive_url: folderLink },
            });
            session.drive_url = folderLink;
            sessionDriveUrl = folderLink;
          } catch (err) {
            console.warn(
              '[SessionDocuments] No se pudo actualizar drive_url de la sesión',
              {
                sessionId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }

        const id = randomUUID();
        const created = await prisma.sesion_files.create({
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

      return successResponse({
        documents: createdRecords,
        drive_url: sessionDriveUrl,
      }, 201);
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

      const existing = await prisma.sesion_files.findUnique({ where: { id: docId } });
      if (!existing || existing.deal_id !== dealId || existing.sesion_id !== sessionId) {
        return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      }

      const updated = await prisma.sesion_files.update({
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

      const existing = await prisma.sesion_files.findUnique({ where: { id: docId } });
      if (!existing || existing.deal_id !== dealId || existing.sesion_id !== sessionId) {
        return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      }

      const context = await ensureSessionContext(prisma, dealId, sessionId);
      if (context.error) return context.error;
      const session = context.session!;
      const deal = session.deals;
      if (!deal) {
        return errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);
      }

      const sessionNumber = await resolveSessionNumber(prisma, session);
      const sessionName = toStringOrNull(session?.nombre_cache) ?? `Sesión ${sessionNumber}`;

      const remainingCount = await prisma.sesion_files.count({
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
          organizationName:
            deal.organizations?.name ?? (deal as any)?.organizations?.name ?? null,
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

      await prisma.sesion_files.delete({ where: { id: docId } });

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
