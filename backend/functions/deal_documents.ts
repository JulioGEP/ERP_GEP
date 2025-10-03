import type { Handler } from '@netlify/functions';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from './_lib/db';
import { ok, err, getUser } from './_lib/http';
import { randomUUID } from 'node:crypto';

const bucket = process.env.S3_BUCKET!;
const region = process.env.S3_REGION!;
const accessKeyId = process.env.S3_ACCESS_KEY_ID!;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY!;

if (!bucket || !region || !accessKeyId || !secretAccessKey) {
  // Evita errores difíciles de depurar si falta alguna env var
  console.warn('[deal_documents] Faltan variables S3: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
}

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

/**
 * ENDPOINTS
 * 1) POST   /.backend/functions/deal_documents/:dealId/upload-url
 * 2) POST   /.backend/functions/deal_documents/:dealId
 * 3) GET    /.backend/functions/deal_documents/:dealId/:docId/url
 * 4) DELETE /.backend/functions/deal_documents/:dealId/:docId
 */
export const handler: Handler = async (event) => {
  try {
    const path = event.path || '';
    const method = event.httpMethod;

    // /deal_documents/:dealId(/:docId)?(/upload-url)?
    const m = path.match(/\/\.backend\/functions\/deal_documents\/([^/]+)(?:\/([^/]+))?(?:\/(upload-url))?$/);
    const dealId = m?.[1] ? String(m[1]) : null;
    const second = m?.[2] ? String(m[2]) : null;
    const isUploadUrl = m?.[3] === 'upload-url';
    const docId = second && second !== 'upload-url' ? second : null;

    if (!dealId) return err('VALIDATION_ERROR', 'deal_id requerido en path', 400);

    // 1) URL firmada para SUBIDA
    if (method === 'POST' && isUploadUrl) {
      if (!event.body) return err('VALIDATION_ERROR', 'Body requerido', 400);
      const { fileName, mimeType, fileSize } = JSON.parse(event.body || '{}') as {
        fileName?: string; mimeType?: string; fileSize?: number;
      };
      if (!fileName || !fileSize) return err('VALIDATION_ERROR', 'fileName y fileSize requeridos', 400);

      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const storageKey = `deals/${dealId}/${key}.${ext}`;

      const putCmd = new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        ContentType: mimeType || 'application/octet-stream',
        ContentLength: fileSize,
      });

      const uploadUrl = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 5 });
      return ok({ ok: true, uploadUrl, storageKey });
    }

    // 2) Guardar METADATOS en deal_files
    if (method === 'POST' && !isUploadUrl) {
      if (!event.body) return err('VALIDATION_ERROR', 'Body requerido', 400);
      const { userId } = getUser(event);
      const { file_name, mime_type, file_size, storage_key } = JSON.parse(event.body || '{}') as {
        file_name?: string; mime_type?: string | null; file_size?: number | string; storage_key?: string;
      };
      if (!file_name || !storage_key) return err('VALIDATION_ERROR', 'file_name y storage_key requeridos', 400);

      const id = randomUUID();

      await prisma.deal_files.create({
        data: {
          id,
          deal_id: String(dealId),
          file_name,
          file_url: storage_key,
          // Descomenta estas si existen en tu esquema:
          // mime_type: mime_type ?? null,
          // file_size: file_size != null ? Number(file_size) : null,
          // uploaded_by: userId || null,
        },
      });

      return ok({ ok: true, id });
    }

    // 3) URL firmada para DESCARGA
    if (method === 'GET' && docId && path.endsWith('/url')) {
      const doc = await prisma.deal_files.findFirst({
        where: { id: String(docId), deal_id: String(dealId) },
      });
      if (!doc) return err('NOT_FOUND', 'Documento no encontrado', 404);
      if (!doc.file_url) return err('VALIDATION_ERROR', 'Documento sin file_url', 400);

      const getCmd = new GetObjectCommand({ Bucket: bucket, Key: String(doc.file_url) });
      const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 5 });
      return ok({ ok: true, url });
    }

    // 4) BORRADO (S3 + BD)
    if (method === 'DELETE' && docId) {
      const doc = await prisma.deal_files.findFirst({
        where: { id: String(docId), deal_id: String(dealId) },
      });
      if (!doc) return err('NOT_FOUND', 'Documento no encontrado', 404);
      if (!doc.file_url) return err('VALIDATION_ERROR', 'Documento sin file_url', 400);

      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: String(doc.file_url) }));
      await prisma.deal_files.delete({ where: { id: String(docId) } });

      return ok({ ok: true });
    }

    return err('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (e: any) {
    return err('UNEXPECTED', e?.message || 'Unexpected', 500);
  }
};
