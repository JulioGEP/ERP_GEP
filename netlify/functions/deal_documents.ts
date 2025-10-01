import type { Handler } from '@netlify/functions';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from './_lib/db';
import { ok, err, getUser } from './_lib/http';
import { randomUUID } from 'node:crypto';

const bucket = process.env.S3_BUCKET!;
const region = process.env.S3_REGION!;

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

export const handler: Handler = async (event) => {
  try {
    const path = event.path || '';
    const method = event.httpMethod;
    const m = path.match(/\/\.netlify\/functions\/deal_documents\/([^/]+)(?:\/([^/]+))?/);
    const dealId = m?.[1];
    const docId = m?.[2];

    if (!dealId) return err('VALIDATION_ERROR', 'deal_id requerido en path', 400);

    // POST /upload-url  → URL firmada para subir a S3
    if (method === 'POST' && path.endsWith('/upload-url')) {
      if (!event.body) return err('VALIDATION_ERROR', 'Body requerido', 400);

      const { fileName, mimeType, fileSize } = JSON.parse(event.body) as {
        fileName?: string;
        mimeType?: string;
        fileSize?: number;
      };

      if (!fileName || !fileSize) {
        return err('VALIDATION_ERROR', 'fileName y fileSize requeridos', 400);
      }

      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const key = (globalThis as any)?.crypto?.randomUUID?.() ?? String(Date.now());
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

    // POST /:dealId  → guardar metadatos del documento subido
    if (method === 'POST' && !path.endsWith('/upload-url')) {
      if (!event.body) return err('VALIDATION_ERROR', 'Body requerido', 400);

      const { userId } = getUser(event);
      const { file_name, mime_type, file_size, storage_key } = JSON.parse(event.body) as {
        file_name?: string;
        mime_type?: string | null;
        file_size?: number | string;
        storage_key?: string;
      };

      if (!file_name || !storage_key || !file_size) {
        return err('VALIDATION_ERROR', 'Campos documento requeridos', 400);
      }

      // 👇 Requisito de tu modelo: documents.doc_id es obligatorio
      const generatedDocId = typeof randomUUID === 'function' ? randomUUID() : String(Date.now());

      await prisma.documents.create({
        data: {
          doc_id: generatedDocId,
          deal_id: dealId,
          file_name,
          mime_type: mime_type || null,
          file_size: Number(file_size),
          storage_key,
          origin: 'user_upload',
          uploaded_by: userId || null,
        },
      });

      return ok();
    }

    // GET /:dealId/:docId/url  → URL firmada para ver/descargar
    if (method === 'GET' && docId && path.endsWith('/url')) {
      const doc = await prisma.documents.findFirst({
        where: { deal_id: dealId, doc_id: docId },
      });
      if (!doc) return err('NOT_FOUND', 'Documento no encontrado', 404);

      const getCmd = new GetObjectCommand({ Bucket: bucket, Key: doc.storage_key });
      const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 5 });
      return ok({ ok: true, url });
    }

    // DELETE /:dealId/:docId  → borrar (solo user_upload)
    if (method === 'DELETE' && docId) {
      const doc = await prisma.documents.findFirst({
        where: { deal_id: dealId, doc_id: docId },
      });
      if (!doc) return err('NOT_FOUND', 'Documento no encontrado', 404);
      if (doc.origin !== 'user_upload') {
        return err('FORBIDDEN', 'Solo se pueden borrar documentos subidos por usuario', 403);
      }

      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: doc.storage_key }));
      await prisma.documents.delete({ where: { doc_id: docId } });

      return ok();
    }

    return err('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (e: any) {
    return err('UNEXPECTED', e?.message || 'Unexpected', 500);
  }
};
