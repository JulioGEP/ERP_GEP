// backend/functions/user_documents.ts
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, errorResponse, preflightResponse, successResponse } from './_shared/response';

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

function mapDocument(row: any) {
  const title = row.title ?? row.file_name;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title,
    file_name: row.file_name,
    mime_type: row.mime_type ?? null,
    file_size: row.file_size ?? null,
    created_at: row.created_at ?? null,
    download_url: `/.netlify/functions/user_documents/${encodeURIComponent(String(row.id))}`,
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
      'Content-Disposition': `attachment; filename="${document.file_name}"`,
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

    if (!fileName || !fileDataBase64) {
      return errorResponse('VALIDATION_ERROR', 'fileName y fileData son obligatorios', 400);
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileDataBase64, 'base64');
    } catch {
      return errorResponse('VALIDATION_ERROR', 'fileData inválido', 400);
    }

    const created = await prisma.user_documents.create({
      data: {
        user_id: userId,
        file_name: fileName,
        mime_type: mimeType,
        file_size: buffer.byteLength,
        file_data: buffer,
        created_at: new Date(),
      },
    });

    return successResponse({ document: mapDocument({ ...created, title }) });
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
};
