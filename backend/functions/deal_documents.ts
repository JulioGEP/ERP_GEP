// backend/functions/deal_documents.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { getPrisma } from "./_shared/prisma";
import { COMMON_HEADERS, successResponse, errorResponse } from "./_shared/response";

const BUCKET = process.env.S3_BUCKET!;
const REGION = process.env.S3_REGION!;
const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID!;
const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY!;

if (!BUCKET || !REGION || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.warn("[deal_documents] Faltan variables S3: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY");
}

const s3 = new S3Client({
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

// Admite rutas con o sin el prefijo /.backend/functions
// 1) POST   /deal_documents/:dealId/upload-url    -> { uploadUrl, storageKey }
// 2) POST   /deal_documents/:dealId               -> guarda metadatos S3 (source=S3)
// 3) GET    /deal_documents/:dealId               -> lista documentos (PIPEDRIVE + S3)
// 4) GET    /deal_documents/:dealId/:docId/url    -> { url } (firmada si S3, directa si Pipedrive)
// 5) DELETE /deal_documents/:dealId/:docId        -> borra (S3+BD si S3, en PIPEDRIVE solo quita del listado local)

function parsePath(path: string) {
  const p = String(path || "");
  const m = p.match(/\/(?:\.backend\/functions\/)?deal_documents\/([^/]+)(?:\/([^/]+))?(?:\/(upload-url|url))?$/i);
  const dealId = m?.[1] ? decodeURIComponent(m[1]) : null;
  const second = m?.[2] ? decodeURIComponent(m[2]) : null;
  const tail = m?.[3] ? String(m[3]) : null;

  return {
    dealId,
    docId: second && second !== "upload-url" && second !== "url" ? second : second,
    isUploadUrl: tail === "upload-url",
    isGetUrl: tail === "url",
  };
}

export const handler = async (event: any) => {
  try {
    // CORS
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: COMMON_HEADERS, body: "" };
    }

    const method = event.httpMethod;
    const path = event.path || "";
    const { dealId, docId, isUploadUrl, isGetUrl } = parsePath(path);
    if (!dealId) return errorResponse("VALIDATION_ERROR", "deal_id requerido en path", 400);

    const prisma = getPrisma();

    // 1) Presigned URL de subida (PUT a S3)
    if (method === "POST" && isUploadUrl) {
      if (!event.body) return errorResponse("VALIDATION_ERROR", "Body requerido", 400);
      const { fileName, mimeType, fileSize } = JSON.parse(event.body || "{}") as {
        fileName?: string;
        mimeType?: string;
        fileSize?: number;
      };
      if (!fileName || !fileSize) {
        return errorResponse("VALIDATION_ERROR", "fileName y fileSize requeridos", 400);
      }

      const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin";
      const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const storageKey = `deals/${encodeURIComponent(dealId)}/${key}.${ext}`;

      const putCmd = new PutObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
        ContentType: mimeType || "application/octet-stream",
        ContentLength: fileSize,
      });

      const uploadUrl = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 5 });
      return successResponse({ ok: true, uploadUrl, storageKey });
    }

    // 2) Guardar metadatos S3 en deal_documents (source=S3)
    if (method === "POST" && !isUploadUrl) {
      if (!event.body) return errorResponse("VALIDATION_ERROR", "Body requerido", 400);
      const { file_name, storage_key, mime_type, size } = JSON.parse(event.body || "{}") as {
        file_name?: string;
        storage_key?: string;
        mime_type?: string;
        size?: number;
      };
      if (!file_name || !storage_key) {
        return errorResponse("VALIDATION_ERROR", "file_name y storage_key requeridos", 400);
      }

      const id = randomUUID();
      await prisma.deal_documents.create({
        data: {
          id,
          deal_id: String(dealId),
          source: "S3",
          name: file_name,
          mime_type: mime_type ?? null,
          size: typeof size === "number" ? size : null,
          external_id: storage_key, // en S3 usamos la key como external_id
          url: null, // la generamos bajo demanda
        },
      });

      return successResponse({ ok: true, id });
    }

    // 3) Listado unificado (PIPEDRIVE + S3)
    if (method === "GET" && !docId && !isGetUrl) {
      const docs = await prisma.deal_documents.findMany({
        where: { deal_id: String(dealId) },
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          source: true,
          name: true,
          mime_type: true,
          size: true,
          created_at: true,
        },
      });

      return successResponse({ documents: docs });
    }

    // 4) URL de visualización/descarga
    if (method === "GET" && docId && isGetUrl) {
      const doc = await prisma.deal_documents.findUnique({
        where: { id: String(docId) },
        select: { id: true, deal_id: true, source: true, external_id: true, url: true, name: true, mime_type: true },
      });
      if (!doc || doc.deal_id !== String(dealId)) {
        return errorResponse("NOT_FOUND", "Documento no encontrado", 404);
      }

      if (doc.source === "S3") {
        if (!doc.external_id) return errorResponse("VALIDATION_ERROR", "Documento S3 sin external_id", 400);
        const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: String(doc.external_id) });
        const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 5 });
        return successResponse({ ok: true, url, name: doc.name, mime_type: doc.mime_type ?? undefined });
      }

      // PIPEDRIVE: durante el import guardamos una url directa si Pipedrive la expone
      if (doc.source === "PIPEDRIVE") {
        if (doc.url) {
          return successResponse({ ok: true, url: doc.url, name: doc.name, mime_type: doc.mime_type ?? undefined });
        }
        // Si no hay url persistida, de momento devolvemos error controlado (no generamos firmas Pipedrive aquí)
        return errorResponse("NOT_IMPLEMENTED", "Documento de Pipedrive sin url persistida", 501);
      }

      return errorResponse("VALIDATION_ERROR", "Origen de documento desconocido", 400);
    }

    // 5) Borra documento
    if (method === "DELETE" && docId) {
      const doc = await prisma.deal_documents.findUnique({
        where: { id: String(docId) },
        select: { id: true, deal_id: true, source: true, external_id: true },
      });
      if (!doc || doc.deal_id !== String(dealId)) {
        return errorResponse("NOT_FOUND", "Documento no encontrado", 404);
      }

      if (doc.source === "S3" && doc.external_id) {
        // borrar en S3
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: String(doc.external_id) }));
      }
      // Si es PIPEDRIVE, NO borramos en Pipedrive (solo lo quitamos del listado local)
      await prisma.deal_documents.delete({ where: { id: String(docId) } });

      return successResponse({ ok: true });
    }

    return errorResponse("NOT_IMPLEMENTED", "Ruta o método no soportado", 404);
  } catch (e: any) {
    return errorResponse("UNEXPECTED", e?.message || "Unexpected", 500);
  }
};
