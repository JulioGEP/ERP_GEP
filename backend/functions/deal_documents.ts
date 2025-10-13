// backend/functions/deal_documents.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { getPrisma } from "./_shared/prisma";
import { nowInMadridISO, toMadridISOString } from "./_shared/timezone";
import { COMMON_HEADERS, successResponse, errorResponse } from "./_shared/response";
import { downloadFile as downloadPipedriveFile } from "./_shared/pipedrive";

const BUCKET = process.env.S3_BUCKET!;
const REGION = process.env.S3_REGION!;
const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID!;
const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY!;

if (!BUCKET || !REGION || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.warn(
    "[deal_documents] Faltan variables S3: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY"
  );
}

const s3 = new S3Client({
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

// Admite rutas con o sin el prefijo /.netlify/functions
// 1) POST   /deal_documents/:dealId/upload-url    -> { uploadUrl, storageKey }
// 2) POST   /deal_documents/:dealId               -> guarda metadatos en deal_files (source implícito)
// 3) GET    /deal_documents/:dealId               -> lista documentos (mapeo a {name,mime_type,...})
// 4) GET    /deal_documents/:dealId/:docId/url    -> { url } (presign si S3, directa si http(s))
// 5) GET    /deal_documents/:dealId/:docId/download -> binario (Pipedrive proxy o S3 directo)
// 6) DELETE /deal_documents/:dealId/:docId        -> borra (S3+BD si S3; si http(s) solo BD)

type ParsedPath = {
  dealId: string | null;
  docId: string | null;
  isUploadUrl: boolean;
  isGetUrl: boolean;
  isDownload: boolean;
};

function parsePath(rawPath: string): ParsedPath {
  const path = String(rawPath || "");
  const withoutPrefix = path.replace(/^\/?\.netlify\/functions\//i, "/");
  const segments = withoutPrefix.split("/").filter(Boolean);

  if (segments[0] !== "deal_documents") {
    return { dealId: null, docId: null, isUploadUrl: false, isGetUrl: false, isDownload: false };
  }

  const dealId = segments[1] ? decodeURIComponent(segments[1]) : null;
  let docId: string | null = null;
  let action: string | null = null;

  if (segments.length >= 3) {
    const maybeDocOrAction = decodeURIComponent(segments[2]);
    if (["upload-url", "url", "download"].includes(maybeDocOrAction)) {
      action = maybeDocOrAction;
    } else {
      docId = maybeDocOrAction;
      if (segments.length >= 4) {
        const maybeAction = decodeURIComponent(segments[3]);
        if (["upload-url", "url", "download"].includes(maybeAction)) {
          action = maybeAction;
        }
      }
    }
  }

  return {
    dealId,
    docId,
    isUploadUrl: action === "upload-url",
    isGetUrl: action === "url",
    isDownload: action === "download",
  };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\r\n\t]+/g, " ").replace(/[\\/:*?"<>|]+/g, "_");
}

function buildContentDisposition(filename: string): string {
  const safe = sanitizeFileName(filename.trim() || "documento");
  const quoted = safe.replace(/"/g, "'");
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${quoted}"; filename*=UTF-8''${encoded}`;
}

async function streamToBuffer(body: any): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer);

  if (typeof (body as any)[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<any>) {
      if (chunk === undefined || chunk === null) continue;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  return Buffer.alloc(0);
}

function isHttpUrl(u?: string | null): boolean {
  if (!u) return false;
  return /^https?:\/\//i.test(u);
}

export const handler = async (event: any) => {
  try {
    // CORS
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: COMMON_HEADERS, body: "" };
    }

    const method = event.httpMethod;
    const path = event.path || "";
    const { dealId, docId, isUploadUrl, isGetUrl, isDownload } = parsePath(path);
    if (!dealId) return errorResponse("VALIDATION_ERROR", "deal_id requerido en path", 400);

    const prisma = getPrisma();
    const dealIdStr = String(dealId).trim();
    if (!dealIdStr) return errorResponse("VALIDATION_ERROR", "deal_id inválido", 400);

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
      const storageKey = `deals/${encodeURIComponent(dealIdStr)}/${key}.${ext}`;

      const putCmd = new PutObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
        ContentType: mimeType || "application/octet-stream",
        ContentLength: fileSize,
      });

      const uploadUrl = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 5 });
      return successResponse({ ok: true, uploadUrl, storageKey });
    }

    // 2) Guardar metadatos en deal_files (mapeando a columnas reales)
    //    Para S3: guardamos file_url = storage_key (clave interna S3), file_type = mime_type
    //    Para Pipedrive (si algún día llega): file_url deberá ser http(s)
    if (method === "POST" && !isUploadUrl) {
      if (!event.body) return errorResponse("VALIDATION_ERROR", "Body requerido", 400);
      const { file_name, storage_key, mime_type } = JSON.parse(event.body || "{}") as {
        file_name?: string;
        storage_key?: string; // en S3 usamos esta key como file_url interno
        mime_type?: string;
      };
      if (!file_name || !storage_key) {
        return errorResponse("VALIDATION_ERROR", "file_name y storage_key requeridos", 400);
      }

      const id = randomUUID();
      await prisma.deal_files.create({
        data: {
          id,
          deal_id: dealIdStr,
          file_name: file_name,
          file_type: mime_type ?? null,
          file_url: storage_key, // guardamos la clave S3 (no es URL pública)
          added_at: nowInMadridISO(), // opcional: marca de alta en hora local de Madrid
        },
      });

      return successResponse({ ok: true, id });
    }

    // 3) Listado (mapeamos a la forma esperada por el front)
    if (method === "GET" && !docId && !isGetUrl) {
      const docsRaw = await prisma.deal_files.findMany({
        where: { deal_id: dealIdStr },
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          file_name: true,
          file_type: true,
          file_url: true,
          created_at: true,
        },
      });

      const documents = docsRaw.map((d: any) => {
        const isHttp = isHttpUrl(d.file_url);
        return {
          id: d.id,
          source: isHttp ? "PIPEDRIVE" : "S3",
          name: d.file_name ?? null,
          mime_type: d.file_type ?? null,
          url: isHttp ? d.file_url ?? null : null,
          // no tenemos `size` en el esquema → lo omitimos
          created_at: toMadridISOString(d.created_at),
        };
      });

      return successResponse({ documents });
    }

    // 4) URL de visualización/descarga
    if (method === "GET" && docId && isGetUrl) {
      const doc = await prisma.deal_files.findUnique({
        where: { id: String(docId) },
        select: { id: true, deal_id: true, file_url: true, file_type: true, file_name: true },
      });
      if (!doc || doc.deal_id !== dealIdStr) {
        return errorResponse("NOT_FOUND", "Documento no encontrado", 404);
      }

      // Si es http(s), devolvemos directamente (documento tipo Pipedrive u origen externo)
      if (isHttpUrl(doc.file_url)) {
        return successResponse({
          ok: true,
          url: String(doc.file_url),
          name: doc.file_name ?? undefined,
          mime_type: doc.file_type ?? undefined,
        });
      }

      // Si no es http(s), lo tratamos como S3 Key
      if (!doc.file_url) {
        return errorResponse("VALIDATION_ERROR", "Documento sin referencia de ubicación", 400);
      }
      const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: String(doc.file_url) });
      const url = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 5 });
      return successResponse({ ok: true, url, name: doc.file_name ?? undefined, mime_type: doc.file_type ?? undefined });
    }

    // 5) Descarga directa (Pipedrive proxy o S3 binario)
    if (method === "GET" && docId && isDownload) {
      const doc = await prisma.deal_files.findUnique({
        where: { id: String(docId) },
        select: {
          id: true,
          deal_id: true,
          file_url: true,
          file_type: true,
          file_name: true,
        },
      });

      if (!doc || doc.deal_id !== dealIdStr) {
        return errorResponse("NOT_FOUND", "Documento no encontrado", 404);
      }

      const baseHeaders = { ...COMMON_HEADERS } as Record<string, string>;
      delete baseHeaders["Content-Type"];

      // Documentos de Pipedrive → descargamos con el token del backend
      if (isHttpUrl(doc.file_url)) {
        const pipedriveId = Number(doc.id);
        if (!Number.isFinite(pipedriveId)) {
          return errorResponse("VALIDATION_ERROR", "Documento Pipedrive con identificador inválido", 400);
        }

        const download = await downloadPipedriveFile(pipedriveId);
        const buffer = download.data;
        const fileName = doc.file_name ?? download.fileName ?? `pipedrive_file_${doc.id}`;
        const mimeType = doc.file_type ?? download.mimeType ?? "application/octet-stream";

        return {
          statusCode: 200,
          headers: {
            ...baseHeaders,
            "Content-Type": mimeType,
            "Content-Disposition": buildContentDisposition(fileName),
          },
          body: buffer.toString("base64"),
          isBase64Encoded: true,
        };
      }

      // Documentos S3 → descargamos el objeto y devolvemos binario
      if (!doc.file_url) {
        return errorResponse("VALIDATION_ERROR", "Documento sin referencia de ubicación", 400);
      }

      const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: String(doc.file_url) });
      const object = await s3.send(getCmd);
      const buffer = await streamToBuffer(object.Body);
      const mimeType = doc.file_type ?? object.ContentType ?? "application/octet-stream";
      const fileName = doc.file_name ?? `documento_${doc.id}`;

      return {
        statusCode: 200,
        headers: {
          ...baseHeaders,
          "Content-Type": mimeType,
          "Content-Disposition": buildContentDisposition(fileName),
        },
        body: buffer.toString("base64"),
        isBase64Encoded: true,
      };
    }

    // 6) Borrado (si es S3 → borra objeto; si es http(s) → borra solo de BD)
    if (method === "DELETE" && docId) {
      const doc = await prisma.deal_files.findUnique({
        where: { id: String(docId) },
        select: { id: true, deal_id: true, file_url: true },
      });
      if (!doc || doc.deal_id !== dealIdStr) {
        return errorResponse("NOT_FOUND", "Documento no encontrado", 404);
      }

      if (doc.file_url && !isHttpUrl(doc.file_url)) {
        // interpretamos file_url como S3 Key
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: String(doc.file_url) }));
      }

      await prisma.deal_files.delete({ where: { id: String(docId) } });
      return successResponse({ ok: true });
    }

    return errorResponse("NOT_IMPLEMENTED", "Ruta o método no soportado", 404);
  } catch (e: any) {
    return errorResponse("UNEXPECTED", e?.message || "Unexpected", 500);
  }
};
