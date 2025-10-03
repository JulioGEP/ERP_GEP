// backend/functions/deal_documents.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { getPrisma } from './_shared/prisma';
import { COMMON_HEADERS, successResponse, errorResponse } from './_shared/response';

// ---------- ENV ----------
const bucket = process.env.S3_BUCKET!;
const region = process.env.S3_REGION!;
const accessKeyId = process.env.S3_ACCESS_KEY_ID!;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY!;

if (!bucket || !region || !accessKeyId || !secretAccessKey) {
  console.warn(
    '[deal_documents] Faltan variables S3: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY'
  );
}

const s3 = new S3Client({
  region,
  credentials: { accessKeyId, secretAccessKey },
});

// /deal_documents/:dealId(/:docId)?(/upload-url)?
function parsePath(path: string) {
  const m = String(path || '').match(
    /\/\.backend\/functions\/deal_documents\/([^/]+)(?:\/([^/]+))?(?:\/(upload-url|url))?$/
  );
  const dealId = m?.[1] ? decodeURIComponent(m[1]) : null;
  const second = m?.[2] ? decodeURIComponent(m[2]) : null;
  const tail = m?.[3] ? String(m[3]) : null;
  const isUploadUrl = tail === 'upload-url';
  const isGetUrl = tail === 'url';
  const docId = second && second !== 'upload-url' && second !== 'url' ? second : second && isGetUrl ? second : second;
  return { dealId, docId, isUploadUrl, isGetUrl };
}

/**
 * ENDPOINTS
 * 1) POST   /.backend/functions/deal_documents/:dealId/upload-url   -> {uploadUrl, storageKey}
 * 2) POST   /.backend/functions/deal_documents/:dealId              -> guarda metadatos en deal_files
 * 3) GET    /.backend/functions/deal_documents/:dealId/:docId/url   -> {url} descarga firmada
 * 4) DELETE /.backend/functions/deal_documents/:dealId/:docId       -> borra S3 + BD
 */
export const handler = async (event: any) => {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
    }

    const method = event.httpMethod;
    const path = event.path || '';
    const { dealId, docId, isUploadUrl, isGetUrl } = parsePath(path);

    if (!dealId) return errorResponse('VALIDATION_ERROR', 'deal_id requerido en path', 400);

    const prisma = getPrisma();

    // 1) URL firmada de SUBIDA (PUT directo a S3)
    if (method === 'POST' && isUploadUrl) {
      if (!event.body) return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      const { fileName, mimeType, fileSize } = JSON.parse(event.body || '{}') as {
        fileName?: string;
        mimeType?: string;
        fileSize?: number;
      };
      if (!fileName || !fileSize) {
        return errorResponse('VALIDATION_ERROR', 'fileName y fileSize requeridos', 400);
      }

      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const storageKey = `deals/${encodeURIComponent(dealId)}/${key}.${ext}`;

      const putCmd = new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        ContentType: mimeType || 'application/octet-stream',
        ContentLength: fileSize,
      });

      const uploadUrl = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 5 });
      return successResponse({ ok: true, uploadUrl, storageKey });
    }

    // 2) Guardar METADATOS en deal_files
    if (method === 'POST' && !isUploadUrl) {
      if (!event.body) return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      const { file_name, storage_key } = JSON.parse(event.body || '{}') as {
        file_name?: string;
        storage_key?: string;
      };
      if (!file_name || !storage_key) {
        return errorResponse('VALIDATION_ERROR', 'file_name y storage_key requeridos', 400);
      }

      const id = randomUUID();
      await prisma.deal_files.create({
        data: {
          id,
          deal_id: String(dealId),
          file_name,
          file_url: storage_key,
          // file_type/added_at se gestionan por DB si los usáramos; ahora no son necesarios
        },
      });

      return successResponse({ ok: true, id });
    }

    // 3) URL firmada para DESCARGA
    if (method === 'GET' && docId && isGetUrl) {
      const doc = await prisma.deal_files.findFirst({
        where: { id: String(docId), deal_id: String(dealId) },
      });
      if (!doc) return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      if (!doc.file_url) return errorResponse('VALIDATION_ERROR', 'Documento sin file_url', 400);

      const getCmd = new GetObjectCommand({ Bucket: bucket, Key: String(doc.file_url) });
      const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 5 });
      return successResponse({ ok: true, url });
    }

    // 4) BORRADO (S3 + BD)
    if (method === 'DELETE' && docId) {
      const doc = await prisma.deal_files.findFirst({
        where: { id: String(docId), deal_id: String(dealId) },
      });
      if (!doc) return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      if (!doc.file_url) return errorResponse('VALIDATION_ERROR', 'Documento sin file_url', 400);

      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: String(doc.file_url) }));
      await prisma.deal_files.delete({ where: { id: String(docId) } });

      return successResponse({ ok: true });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (e: any) {
    return errorResponse('UNEXPECTED', e?.message || 'Unexpected', 500);
  }
};
