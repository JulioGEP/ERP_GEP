// backend/functions/user_documents.ts
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, preflightResponse, successResponse } from './_shared/response';
import {
  deleteUserDocumentFromGoogleDrive,
  uploadUserDocumentToGoogleDrive,
} from './_shared/googleDrive';

const ALLOWED_DOCUMENT_TYPES = new Map([
  ['curriculum_vitae', 'Curriculum Vitae'],
  ['personales', 'Personales'],
  ['certificados', 'Certificados'],
  ['gasto', 'Gasto'],
  ['otros', 'Otros'],
]);

function parsePath(path: string | undefined | null) {
  const normalized = String(path || '');
  const trimmed = normalized.replace(/^\/?\.netlify\/functions\//, '/');
  const segments = trimmed.split('/').filter(Boolean);
  const documentId = segments[1] && segments[0] === 'user_documents' ? segments[1] : null;
  return { documentId };
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function resolveDocumentType(value: unknown) {
  const defaultLabel = ALLOWED_DOCUMENT_TYPES.get('otros') ?? 'Otros';
  const key = toStringOrNull(value)?.toLowerCase();
  if (!key) {
    return { key: 'otros', label: defaultLabel };
  }
  const label = ALLOWED_DOCUMENT_TYPES.get(key);
  if (!label) {
    return { key: 'otros', label: defaultLabel };
  }
  return { key, label };
}

function buildStoredFileName(typeLabel: string, baseName: string): string {
  const safeLabel = typeLabel.trim() || 'Documento';
  const name = baseName.trim();
  const prefixedLabel = safeLabel.toLowerCase() === 'gasto' ? `<${safeLabel}>` : safeLabel;

  if (!name) {
    return prefixedLabel;
  }

  const prefixesToKeep = [
    `${prefixedLabel} - `,
    `${safeLabel} - `,
  ];

  if (prefixesToKeep.some((prefix) => name.toLowerCase().startsWith(prefix.toLowerCase()))) {
    return name;
  }

  return `${prefixedLabel} - ${name}`;
}

function mapDocument(row: any) {
  const { key: documentType, label: documentTypeLabel } = resolveDocumentType(row.document_type);
  const title = row.title ?? row.file_name;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: title ?? null,
    file_name: row.file_name,
    mime_type: row.mime_type ?? null,
    file_size: row.file_size ?? null,
    drive_folder_id: row.drive_folder_id ?? null,
    drive_web_view_link: row.drive_web_view_link ?? null,
    drive_web_content_link: row.drive_web_content_link ?? null,
    created_at: row.created_at ?? null,
    download_url: `/.netlify/functions/user_documents/${encodeURIComponent(String(row.id))}`,
    document_type: documentType,
    document_type_label: documentTypeLabel,
  };
}

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return preflightResponse();
  }

  const prisma = getPrisma();
  const method = event.httpMethod;
  const { documentId } = parsePath(event.path);

  if (method === 'GET' && documentId) {
    const document = await prisma.user_documents.findUnique({ where: { id: documentId } });
    if (!document) {
      return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
    }

    const headers: Record<string, string> = {
      ...COMMON_HEADERS,
      'Content-Type': document.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${document.file_name}"`,
    };
    if (typeof document.file_size === 'number') {
      headers['Content-Length'] = String(document.file_size);
    }

    return {
      statusCode: 200,
      headers,
      isBase64Encoded: true,
      body: document.file_data ? Buffer.from(document.file_data).toString('base64') : '',
    };
  }

  if (method === 'GET') {
    const params = event.queryStringParameters || {};
    const userId = toStringOrNull(params.userId ?? params.user_id);
    if (!userId) {
      return errorResponse('VALIDATION_ERROR', 'userId es obligatorio', 400);
    }

    const documents = await prisma.user_documents.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    return successResponse({ documents: documents.map(mapDocument) });
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

    const userId = toStringOrNull(payload.userId ?? payload.user_id);
    if (!userId) {
      return errorResponse('VALIDATION_ERROR', 'userId es obligatorio', 400);
    }

    const title =
      toStringOrNull(payload.title) || toStringOrNull(payload.fileName ?? payload.file_name);
    const fileName = toStringOrNull(payload.fileName ?? payload.file_name);
    const mimeType = toStringOrNull(payload.mimeType ?? payload.mime_type);
    const fileDataBase64 = toStringOrNull(payload.fileData ?? payload.file_data);
    const documentType = resolveDocumentType(payload.documentType ?? payload.document_type);

    if (!fileName || !fileDataBase64) {
      return errorResponse('VALIDATION_ERROR', 'fileName y fileData son obligatorios', 400);
    }

    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) {
      return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
    }

    const resolvedTitle = title || fileName.replace(/\.[^.]+$/, '') || fileName;
    const finalTitle = buildStoredFileName(documentType.label, resolvedTitle);
    const finalFileName = buildStoredFileName(documentType.label, fileName);

    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileDataBase64, 'base64');
    } catch {
      return errorResponse('VALIDATION_ERROR', 'fileData inválido', 400);
    }

    const driveUpload = await uploadUserDocumentToGoogleDrive({
      user,
      title: finalTitle,
      fileName: finalFileName,
      mimeType,
      data: buffer,
    });

    const created = await prisma.user_documents.create({
      data: {
        user_id: userId,
        title: finalTitle,
        file_name: finalFileName,
        mime_type: mimeType,
        file_size: buffer.byteLength,
        drive_folder_id: driveUpload.destinationFolderId ?? driveUpload.driveFolderId,
        drive_web_view_link: driveUpload.driveWebViewLink,
        drive_web_content_link: driveUpload.driveFolderContentLink,
        file_data: buffer,
        created_at: new Date(),
      },
    });

    return successResponse({
      document: mapDocument({ ...created, title: finalTitle, document_type: documentType.key }),
    });
  }

  if (method === 'DELETE' && documentId) {
    const existing = await prisma.user_documents.findUnique({ where: { id: documentId } });
    if (!existing) {
      return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
    }

    const user = await prisma.users.findUnique({ where: { id: existing.user_id } });

    let driveDeleted = false;
    try {
      const driveResult = await deleteUserDocumentFromGoogleDrive({
        user,
        driveFileName: existing.file_name,
        driveWebViewLink: existing.drive_web_view_link,
        driveWebContentLink: existing.drive_web_content_link,
        driveFolderId: existing.drive_folder_id,
      });
      driveDeleted = driveResult.fileDeleted;
    } catch (err) {
      console.warn('[user-documents] No se pudo eliminar documento en Drive', {
        documentId,
        userId: existing.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await prisma.user_documents.delete({ where: { id: documentId } });

    return successResponse({ deleted: true, documentId, drive_deleted: driveDeleted });
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
};
