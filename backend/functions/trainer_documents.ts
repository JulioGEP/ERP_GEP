// backend/functions/trainer_documents.ts
import { randomUUID } from 'crypto';
import { getPrisma } from './_shared/prisma';
import {
  COMMON_HEADERS,
  errorResponse,
  preflightResponse,
  successResponse,
} from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';
import {
  uploadTrainerDocumentToGoogleDrive,
  deleteTrainerDocumentFromGoogleDrive,
} from './_shared/googleDrive';

const TEN_MEGABYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_SIZE_BYTES = TEN_MEGABYTES;
const MAX_DOCUMENT_SIZE_LABEL = '10 MB';

const TRAINER_DOCUMENT_TYPES = {
  curriculum_vitae: 'Curriculum Vitae',
  personales: 'Personales',
  certificados: 'Certificados',
  otros: 'Otros',
} as const;

type TrainerDocumentType = keyof typeof TRAINER_DOCUMENT_TYPES;

type ParsedPath = {
  documentId: string | null;
};

type UploadedFileInput = {
  fileName?: unknown;
  mimeType?: unknown;
  fileSize?: unknown;
  contentBase64?: unknown;
};

type TrainerDocumentRecord = {
  id: string;
  trainer_id: string;
  document_type: string;
  file_name: string;
  original_file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  drive_file_id: string | null;
  drive_file_name: string;
  drive_web_view_link: string | null;
  uploaded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function parsePath(path: string | null | undefined): ParsedPath {
  const normalized = String(path || '');
  const trimmed = normalized.replace(/^\/?\.netlify\/functions\//, '/');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments[0] !== 'trainer_documents') {
    return { documentId: null };
  }
  return { documentId: segments[1] ? decodeURIComponent(segments[1]) : null };
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  const trimmed = text.trim();
  return trimmed.length ? trimmed : null;
}

function parseDocumentType(value: unknown): TrainerDocumentType | null {
  const normalized = toStringOrNull(value);
  if (!normalized) return null;
  const key = normalized
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z_]/gi, '')
    .toLowerCase();

  if (key in TRAINER_DOCUMENT_TYPES) {
    return key as TrainerDocumentType;
  }

  switch (normalized.toLowerCase()) {
    case 'cv':
    case 'curriculum':
    case 'curriculum vitae':
      return 'curriculum_vitae';
    case 'personal':
    case 'personales':
      return 'personales';
    case 'certificado':
    case 'certificados':
      return 'certificados';
    case 'otro':
    case 'otros':
      return 'otros';
    default:
      return null;
  }
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

function ensureTypePrefix(name: string, type: TrainerDocumentType): string {
  const label = TRAINER_DOCUMENT_TYPES[type];
  const normalized = name.trim();
  const prefix = `${label} - `;
  if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
    return normalized;
  }
  return `${prefix}${normalized}`;
}

function toBufferFromBase64(contentBase64: string): Buffer {
  return Buffer.from(String(contentBase64), 'base64');
}

function mapDocument(row: TrainerDocumentRecord) {
  return {
    id: row.id,
    trainer_id: row.trainer_id,
    document_type: row.document_type,
    document_type_label: TRAINER_DOCUMENT_TYPES[row.document_type as TrainerDocumentType] ?? row.document_type,
    file_name: row.file_name,
    original_file_name: row.original_file_name,
    mime_type: row.mime_type,
    file_size: row.file_size,
    drive_file_id: row.drive_file_id,
    drive_file_name: row.drive_file_name,
    drive_web_view_link: row.drive_web_view_link,
    uploaded_at: row.uploaded_at ? toMadridISOString(row.uploaded_at) : null,
    created_at: row.created_at ? toMadridISOString(row.created_at) : null,
    updated_at: row.updated_at ? toMadridISOString(row.updated_at) : null,
  };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const { documentId } = parsePath(event.path);

    if (method === 'GET') {
      const params = event.queryStringParameters || {};
      const trainerId = toStringOrNull(params.trainerId ?? params.trainer_id);
      if (!trainerId) {
        return errorResponse('VALIDATION_ERROR', 'trainerId es requerido', 400);
      }

      const trainer = await prisma.trainers.findUnique({ where: { trainer_id: trainerId } });
      if (!trainer) {
        return errorResponse('NOT_FOUND', 'Formador/Bombero no encontrado', 404);
      }

      const documents = await prisma.trainer_documents.findMany({
        where: { trainer_id: trainerId },
        orderBy: { uploaded_at: 'desc' },
      });

      return successResponse({
        documents: documents.map((doc: TrainerDocumentRecord) => mapDocument(doc)),
      });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      let payload: any;
      try {
        payload = JSON.parse(event.body);
      } catch {
        return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
      }

      const trainerId = toStringOrNull(payload?.trainer_id ?? payload?.trainerId);
      if (!trainerId) {
        return errorResponse('VALIDATION_ERROR', 'trainer_id es requerido', 400);
      }

      const trainer = await prisma.trainers.findUnique({ where: { trainer_id: trainerId } });
      if (!trainer) {
        return errorResponse('NOT_FOUND', 'Formador/Bombero no encontrado', 404);
      }

      const documentType = parseDocumentType(payload?.document_type ?? payload?.documentType);
      if (!documentType) {
        return errorResponse('VALIDATION_ERROR', 'document_type no es válido', 400);
      }

      const fileInput: UploadedFileInput | null = payload?.file && typeof payload.file === 'object'
        ? payload.file
        : null;

      if (!fileInput) {
        return errorResponse('VALIDATION_ERROR', 'Se requiere un archivo para subir', 400);
      }

      const fileNameRaw = toStringOrNull(fileInput.fileName ?? payload?.fileName ?? payload?.name);
      const contentBase64 = toStringOrNull(fileInput.contentBase64 ?? payload?.contentBase64 ?? payload?.fileContentBase64);
      const mimeType = toStringOrNull(fileInput.mimeType ?? payload?.mimeType) ?? 'application/octet-stream';
      const fileSizeRaw = typeof fileInput.fileSize === 'number' ? fileInput.fileSize : Number(fileInput.fileSize);

      if (!fileNameRaw) {
        return errorResponse('VALIDATION_ERROR', 'fileName es requerido', 400);
      }

      if (!contentBase64) {
        return errorResponse('VALIDATION_ERROR', 'contentBase64 es requerido', 400);
      }

      let buffer: Buffer;
      try {
        buffer = toBufferFromBase64(contentBase64);
      } catch {
        return errorResponse('VALIDATION_ERROR', 'contentBase64 no es válido', 400);
      }

      if (!buffer.length) {
        return errorResponse('VALIDATION_ERROR', 'El archivo está vacío', 400);
      }

      if (buffer.length > MAX_DOCUMENT_SIZE_BYTES) {
        return errorResponse(
          'PAYLOAD_TOO_LARGE',
          `El archivo supera el tamaño máximo permitido de ${MAX_DOCUMENT_SIZE_LABEL}`,
          413,
        );
      }

      if (Number.isFinite(fileSizeRaw) && typeof fileSizeRaw === 'number' && fileSizeRaw > 0) {
        const delta = Math.abs(buffer.length - fileSizeRaw);
        if (delta > Math.max(512, fileSizeRaw * 0.01)) {
          return errorResponse(
            'VALIDATION_ERROR',
            'El tamaño del archivo no coincide con el contenido recibido',
            400,
          );
        }
      }

      const originalName = normalizeIncomingFileName(fileNameRaw) || fileNameRaw;
      const finalFileName = ensureTypePrefix(originalName, documentType);

      let uploadResult;
      try {
        uploadResult = await uploadTrainerDocumentToGoogleDrive({
          trainer,
          fileName: finalFileName,
          mimeType,
          data: buffer,
        });
      } catch (error: any) {
        const message = error?.message || 'No se pudo subir el archivo a Drive';
        return errorResponse('UPLOAD_ERROR', message, 502);
      }

      const now = nowInMadridDate();
      const created = await prisma.trainer_documents.create({
        data: {
          id: randomUUID(),
          trainer_id: trainerId,
          document_type: documentType,
          file_name: finalFileName,
          original_file_name: originalName,
          mime_type: mimeType,
          file_size: buffer.length,
          drive_file_id: uploadResult.driveFileId,
          drive_file_name: uploadResult.driveFileName,
          drive_web_view_link: uploadResult.driveWebViewLink,
          uploaded_at: now,
          created_at: now,
          updated_at: now,
        },
      });

      return successResponse(
        {
          document: mapDocument(created as TrainerDocumentRecord),
          trainer_folder_url: uploadResult.trainerFolderWebViewLink ?? null,
        },
        201,
      );
    }

    if (method === 'DELETE' && documentId) {
      let payload: any = null;
      if (event.body) {
        try {
          payload = JSON.parse(event.body);
        } catch {
          return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
        }
      }

      const params = event.queryStringParameters || {};
      const trainerId = toStringOrNull(
        payload?.trainer_id ?? payload?.trainerId ?? params.trainerId ?? params.trainer_id,
      );
      if (!trainerId) {
        return errorResponse('VALIDATION_ERROR', 'trainerId es requerido', 400);
      }

      const document = await prisma.trainer_documents.findUnique({ where: { id: documentId } });
      if (!document || document.trainer_id !== trainerId) {
        return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      }

      const trainer = await prisma.trainers.findUnique({ where: { trainer_id: trainerId } });
      if (!trainer) {
        return errorResponse('NOT_FOUND', 'Formador/Bombero no encontrado', 404);
      }

      try {
        await deleteTrainerDocumentFromGoogleDrive({
          trainer,
          driveFileId: document.drive_file_id,
          driveFileName: document.drive_file_name,
        });
      } catch (error: any) {
        const message = error?.message || 'No se pudo eliminar el archivo de Drive';
        return errorResponse('UPLOAD_ERROR', message, 502);
      }

      await prisma.trainer_documents.delete({ where: { id: documentId } });

      return successResponse({ ok: true });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (err: any) {
    console.error('[trainer_documents] Error inesperado', err);
    const message = err?.message || 'Error inesperado';
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: false, error_code: 'UNEXPECTED_ERROR', message }),
    };
  }
};
