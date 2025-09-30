const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { getPrisma } = require('./_shared/prisma');

const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION;

function parsePath(path) {
  // /deal_documents/:dealId or /deal_documents/:dealId/:docId
  const m = path.match(/\/\.netlify\/functions\/deal_documents\/([^\/]+)(?:\/([^\/]+))?/);
  return { dealId: m?.[1] || null, docId: m?.[2] || null };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
    }

    const prisma = getPrisma();
    const { dealId, docId } = parsePath(event.path || '');
    const method = event.httpMethod;

    if (!dealId) return errorResponse('VALIDATION_ERROR', 'dealId requerido', 400);
    if (!bucket || !region) return errorResponse('ENV_MISSING', 'S3_BUCKET y S3_REGION requeridos', 500);

    const s3 = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
      }
    });

    // 1) Obtener URL de subida firmada
    if (method === 'POST' && (event.path || '').endsWith('/upload-url')) {
      const { fileName, mimeType, fileSize } = JSON.parse(event.body || '{}');
      if (!fileName || !fileSize) return errorResponse('VALIDATION_ERROR', 'fileName y fileSize requeridos', 400);
      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const key = `deals/${dealId}/${(globalThis.crypto?.randomUUID?.() || Date.now())}.${ext}`;
      const put = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType || 'application/octet-stream', ContentLength: fileSize });
      const uploadUrl = await getSignedUrl(s3, put, { expiresIn: 300 });
      return successResponse({ uploadUrl, storageKey: key });
    }

    // 2) Registrar metadato tras subir
    if (method === 'POST' && !(event.path || '').endsWith('/upload-url')) {
      const { file_name, mime_type, file_size, storage_key } = JSON.parse(event.body || '{}');
      if (!file_name || !file_size || !storage_key) return errorResponse('VALIDATION_ERROR', 'Campos documento requeridos', 400);
      const userId = event.headers['x-user-id'] || event.headers['X-User-Id'] || null;
      await prisma.document.create({
        data: {
          dealId: Number(dealId),
          fileName: file_name,
          fileSize: Number(file_size),
          mimeType: mime_type || null,
          storageKey: storage_key,
          origin: 'user_upload',
          uploadedBy: userId
        }
      });
      return successResponse();
    }

    // 3) URL firmada para ver/descargar
    if (method === 'GET' && docId && (event.path || '').endsWith('/url')) {
      const doc = await prisma.document.findFirst({ where: { id: docId, dealId: Number(dealId) } });
      if (!doc) return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      const getCmd = new GetObjectCommand({ Bucket: bucket, Key: doc.storageKey });
      const url = await getSignedUrl(s3, getCmd, { expiresIn: 300 });
      return successResponse({ url });
    }

    // 4) Eliminar (solo user_upload)
    if (method === 'DELETE' && docId) {
      const doc = await prisma.document.findFirst({ where: { id: docId, dealId: Number(dealId) } });
      if (!doc) return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      if (doc.origin !== 'user_upload') return errorResponse('FORBIDDEN', 'Solo se pueden borrar documentos subidos por usuario', 403);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: doc.storageKey }));
      await prisma.document.delete({ where: { id: docId } });
      return successResponse();
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (e) {
    return errorResponse('UNEXPECTED', e?.message || 'Unexpected', 500);
  }
};
