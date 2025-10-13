// backend/functions/_shared/googleDrive.ts
import { createSign } from "crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { downloadFile as downloadPipedriveFile } from "./pipedrive";
import { toMadridISOString } from "./timezone";
import { getPrisma } from "./prisma";

const DEFAULT_BASE_FOLDER_NAME = "Documentos ERP";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

const driveFolderCache = new Map<string, string>();
let s3Client: S3Client | null = null;
let tokenCache: { accessToken: string; expiresAt: number } | null = null;
let cachedServiceAccount: { clientEmail: string; privateKey: string } | null | undefined;

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;

function sanitizeName(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function isHttpUrl(value?: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^https?:\/\//i.test(value);
}

function resolveDriveBaseFolderName(): string {
  return process.env.GOOGLE_DRIVE_BASE_FOLDER_NAME?.trim() || DEFAULT_BASE_FOLDER_NAME;
}

function resolveDriveSharedId(): string | null {
  const raw = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;
  if (!raw || !String(raw).trim()) {
    console.warn("[google-drive-sync] Falta GOOGLE_DRIVE_SHARED_DRIVE_ID");
    return null;
  }
  return String(raw).trim();
}

function getServiceAccount(): { clientEmail: string; privateKey: string } | null {
  if (cachedServiceAccount !== undefined) {
    return cachedServiceAccount;
  }

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

  if (!clientEmail || !privateKeyRaw) {
    console.warn("[google-drive-sync] Faltan credenciales de Google Drive (CLIENT_EMAIL o PRIVATE_KEY)");
    cachedServiceAccount = null;
    return null;
  }

  cachedServiceAccount = {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
  };

  return cachedServiceAccount;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.isBuffer(input)
    ? input.toString("base64url")
    : Buffer.from(input).toString("base64url");
}

async function getAccessToken(): Promise<string> {
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    throw new Error("Credenciales de Google Drive no configuradas");
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.clientEmail,
    scope: DRIVE_SCOPE,
    aud: TOKEN_AUDIENCE,
    exp: now + 3600,
    iat: now,
  };

  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.privateKey, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch(TOKEN_AUDIENCE as any, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[google-drive-sync] Token request failed: ${response.status} ${text}`.trim());
  }

  const json: any = await response.json().catch(() => ({}));
  const accessToken = typeof json.access_token === "string" ? json.access_token : null;
  if (!accessToken) {
    throw new Error("[google-drive-sync] Respuesta de token sin access_token");
  }

  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + Math.max(0, (expiresIn - 60) * 1000),
  };

  return accessToken;
}

function headersToRecord(headers?: any): Record<string, string> {
  const record: Record<string, string> = {};
  if (!headers) return record;

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      record[key] = value;
    }
    return record;
  }

  if (typeof headers === "object" && typeof (headers as any).forEach === "function") {
    (headers as any).forEach((value: string, key: string) => {
      record[key] = value;
    });
    return record;
  }

  return { ...(headers as Record<string, string>) };
}

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = headersToRecord(init.headers);
  headers.Authorization = `Bearer ${token}`;
  return fetch(url as any, { ...init, headers });
}

function cacheKey(parentId: string, name: string): string {
  return `${parentId}::${name}`;
}

async function driveFilesList(params: Record<string, string | undefined>): Promise<any> {
  const url = new URL(`${DRIVE_API_BASE}/files`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, value);
  }

  const response = await authorizedFetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[google-drive-sync] List request failed: ${response.status} ${text}`.trim());
  }

  return response.json();
}

async function driveCreateFolder(params: { name: string; parents: string[] }): Promise<string> {
  const response = await authorizedFetch(`${DRIVE_API_BASE}/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      mimeType: "application/vnd.google-apps.folder",
      parents: params.parents,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[google-drive-sync] Folder creation failed: ${response.status} ${text}`.trim());
  }

  const json: any = await response.json().catch(() => ({}));
  if (!json.id) {
    throw new Error("[google-drive-sync] Respuesta de creación de carpeta sin id");
  }
  return String(json.id);
}

async function driveDelete(fileId: string): Promise<void> {
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`;
  const response = await authorizedFetch(url, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`[google-drive-sync] Delete failed: ${response.status} ${text}`.trim());
  }
}

async function findFolder(params: { name: string; parentId: string; driveId: string }): Promise<string | null> {
  const name = sanitizeName(params.name || "carpeta");
  const key = cacheKey(params.parentId, name);
  if (driveFolderCache.has(key)) {
    return driveFolderCache.get(key)!;
  }

  const query = [
    `'${params.parentId}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `name = '${name.replace(/'/g, "\\'")}'`,
  ].join(" and ");

  const list = await driveFilesList({
    corpora: "drive",
    driveId: params.driveId,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    q: query,
    fields: "files(id, name)",
    pageSize: "1",
  });

  const existing = Array.isArray(list.files) ? list.files[0] : null;
  if (existing?.id) {
    const id = String(existing.id);
    driveFolderCache.set(key, id);
    return id;
  }

  return null;
}

async function ensureFolder(params: { name: string; parentId: string; driveId: string }): Promise<string> {
  const name = sanitizeName(params.name || "carpeta");
  const key = cacheKey(params.parentId, name);
  if (driveFolderCache.has(key)) {
    return driveFolderCache.get(key)!;
  }

  const query = [
    `'${params.parentId}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `name = '${name.replace(/'/g, "\\'")}'`,
  ].join(" and ");

  const list = await driveFilesList({
    corpora: "drive",
    driveId: params.driveId,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    q: query,
    fields: "files(id, name)",
    pageSize: "1",
  });

  const existing = Array.isArray(list.files) ? list.files[0] : null;
  if (existing?.id) {
    driveFolderCache.set(key, existing.id);
    return existing.id;
  }

  const createdId = await driveCreateFolder({ name, parents: [params.parentId] });
  driveFolderCache.set(key, createdId);
  return createdId;
}

async function clearFolder(folderId: string, driveId: string): Promise<void> {
  let pageToken: string | undefined;
  do {
    const list = await driveFilesList({
      corpora: "drive",
      driveId,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id)",
      pageSize: "100",
      pageToken,
    });

    const files = Array.isArray(list.files) ? list.files : [];
    for (const file of files) {
      if (!file?.id) continue;
      try {
        await driveDelete(String(file.id));
      } catch (err) {
        console.warn("[google-drive-sync] No se pudo borrar archivo previo", {
          fileId: file.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    pageToken = typeof list.nextPageToken === "string" ? list.nextPageToken : undefined;
  } while (pageToken);
}

function resolvePipedriveFileId(doc: { id?: unknown; file_url?: unknown }): number | null {
  const id = typeof doc?.id === "number" ? doc.id : Number(doc?.id);
  if (Number.isFinite(id)) {
    return id as number;
  }

  const url = typeof doc?.file_url === "string" ? doc.file_url : null;
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get("id") ?? parsed.searchParams.get("file_id");
    if (fromQuery) {
      const asNumber = Number(fromQuery);
      if (Number.isFinite(asNumber)) return asNumber;
    }
  } catch {
    // ignoramos y probamos regex
  }

  const match = url.match(/\/files\/(\d+)/i);
  if (match && match[1]) {
    const asNumber = Number(match[1]);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
  }

  return null;
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

function extractFileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;

  const starMatch = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (starMatch && starMatch[1]) {
    try {
      return decodeURIComponent(starMatch[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return starMatch[1].trim().replace(/^"|"$/g, "");
    }
  }

  const filenameMatch = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (filenameMatch && filenameMatch[1]) {
    return filenameMatch[1].trim();
  }

  return null;
}

async function downloadFromHttp(url: string): Promise<{ data: Buffer; fileName: string | null; mimeType: string | null }> {
  const response = await fetch(url as any, { method: "GET" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Descarga HTTP falló (${response.status} ${response.statusText}) ${text}`.trim());
  }
  const arrayBuffer = await response.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  const fileName = extractFileNameFromDisposition(response.headers.get("content-disposition"));
  const mimeType = response.headers.get("content-type");
  return { data, fileName, mimeType };
}

async function fetchDocumentData(doc: any): Promise<{ data: Buffer; fileName: string; mimeType: string }> {
  const fallbackName = sanitizeName(
    doc?.file_name || doc?.original_file_name || doc?.name || doc?.title || `documento_${doc?.id ?? ""}`
  ) || "documento";
  const fallbackMime = (doc?.file_type || doc?.mime_type || "application/octet-stream") as string;

  const httpUrl = isHttpUrl(doc?.file_url) ? doc.file_url : isHttpUrl(doc?.url) ? doc.url : null;

  if (httpUrl) {
    const pipedriveId = resolvePipedriveFileId({ ...doc, file_url: httpUrl });
    if (pipedriveId !== null) {
      const { data, fileName, mimeType } = await downloadPipedriveFile(pipedriveId);
      return {
        data,
        fileName: sanitizeName(fileName || fallbackName),
        mimeType: (mimeType || fallbackMime) as string,
      };
    }

    const { data, fileName, mimeType } = await downloadFromHttp(httpUrl);
    return {
      data,
      fileName: sanitizeName(fileName || fallbackName),
      mimeType: (mimeType || fallbackMime) as string,
    };
  }

  if (typeof doc?.file_url === "string" && doc.file_url) {
    const client = resolveS3Client();
    if (!client) {
      throw new Error("No se pudo inicializar el cliente S3 para descargar el archivo");
    }
    if (!S3_BUCKET) {
      throw new Error("S3_BUCKET no configurado");
    }

    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: doc.file_url });
    const result = await client.send(command);
    const buffer = await streamToBuffer(result.Body);
    const mimeType = (result.ContentType || fallbackMime) as string;

    return {
      data: buffer,
      fileName: fallbackName,
      mimeType,
    };
  }

  throw new Error("Documento sin origen conocido (sin file_url)");
}

function resolveS3Client(): S3Client | null {
  if (s3Client) return s3Client;
  if (!S3_BUCKET || !S3_REGION || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    console.warn(
      "[google-drive-sync] Faltan variables de S3 (S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)"
    );
    return null;
  }

  s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

function formatDealDate(deal: any): string {
  const raw = deal?.created_at ?? deal?.add_time ?? null;
  let iso = typeof raw === "string" ? toMadridISOString(raw) : null;
  if (!iso && raw instanceof Date) {
    iso = toMadridISOString(raw);
  }
  if (!iso) {
    iso = toMadridISOString(new Date());
  }
  const datePart = iso?.slice(0, 10) ?? "0000-00-00";
  const [year, month, day] = datePart.split("-");
  if (year && month && day) {
    return `${day}/${month}/${year}`;
  }
  return datePart;
}

function buildDealFolderName(deal: any): string {
  const id = deal?.deal_id ?? deal?.id ?? "sin-id";
  const title = sanitizeName(deal?.title || deal?.name || "Sin título");
  const date = formatDealDate(deal);
  return `${id} - ${date} - ${title}`;
}

type DriveUploadResult = { id: string; name: string; webViewLink: string | null };

async function uploadBufferToDrive(params: {
  parentId: string;
  name: string;
  mimeType: string;
  data: Buffer;
}): Promise<DriveUploadResult> {
  const boundary = `----erp-gep-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: params.name,
    parents: [params.parentId],
  });

  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
  );
  const fileHeader = Buffer.from(`--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`);
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([preamble, fileHeader, params.data, closing]);

  const response = await authorizedFetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[google-drive-sync] Upload failed: ${response.status} ${text}`.trim());
  }

  const json: any = await response.json().catch(() => ({}));
  if (!json?.id) {
    throw new Error("[google-drive-sync] Respuesta de subida sin id");
  }

  return {
    id: String(json.id),
    name: typeof json.name === "string" && json.name.trim() ? json.name : params.name,
    webViewLink: typeof json.webViewLink === "string" && json.webViewLink ? json.webViewLink : null,
  };
}

async function ensureFilePublicWebViewLink(fileId: string): Promise<string | null> {
  const permissionUrl = `${DRIVE_API_BASE}/files/${encodeURIComponent(
    fileId
  )}/permissions?supportsAllDrives=true&sendNotificationEmails=false`;

  const permissionBody = {
    role: "reader",
    type: "anyone",
    allowFileDiscovery: false,
  };

  const permissionResponse = await authorizedFetch(permissionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(permissionBody),
  });

  if (!permissionResponse.ok && permissionResponse.status !== 409) {
    const text = await permissionResponse.text().catch(() => "");
    throw new Error(`[google-drive-sync] Permission failed: ${permissionResponse.status} ${text}`.trim());
  }

  const metadataUrl = `${DRIVE_API_BASE}/files/${encodeURIComponent(
    fileId
  )}?supportsAllDrives=true&fields=webViewLink`;
  const metadataResponse = await authorizedFetch(metadataUrl, { method: "GET" });

  if (!metadataResponse.ok) {
    const text = await metadataResponse.text().catch(() => "");
    throw new Error(`[google-drive-sync] Metadata fetch failed: ${metadataResponse.status} ${text}`.trim());
  }

  const metadata: any = await metadataResponse.json().catch(() => ({}));
  return typeof metadata?.webViewLink === "string" ? metadata.webViewLink : null;
}

async function updateDealFileDriveMetadata(
  prisma: PrismaClient,
  doc: any,
  metadata: { driveFileName: string; driveWebViewLink: string | null }
): Promise<void> {
  const rawId = doc?.id;
  if (rawId === null || rawId === undefined) return;
  const id = String(rawId);
  if (!id.trim()) return;

  try {
    await prisma.deal_files.update({
      where: { id },
      data: {
        drive_file_name: metadata.driveFileName,
        drive_web_view_link: metadata.driveWebViewLink,
      },
    });
  } catch (err) {
    console.error("[google-drive-sync] No se pudo actualizar drive metadata en BD", {
      docId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function syncDealDocumentsToGoogleDrive(params: {
  deal: any;
  documents: any[];
  organizationName?: string | null;
}): Promise<void> {
  try {
    const driveId = resolveDriveSharedId();
    if (!driveId) return;

    if (!getServiceAccount()) {
      return;
    }

    const prisma = getPrisma();
    const documents = Array.isArray(params.documents) ? params.documents : [];
    if (!documents.length) {
      console.log("[google-drive-sync] Deal sin documentos, no se crea carpeta en Drive");
    }

    const baseFolderId = await ensureFolder({
      name: resolveDriveBaseFolderName(),
      parentId: driveId,
      driveId,
    });

    const organizationName = sanitizeName(params.organizationName || "Sin organización");
    const organizationFolderId = await ensureFolder({
      name: organizationName || "Sin organización",
      parentId: baseFolderId,
      driveId,
    });

    const dealFolderName = sanitizeName(buildDealFolderName(params.deal));
    const dealFolderId = await ensureFolder({
      name: dealFolderName,
      parentId: organizationFolderId,
      driveId,
    });

    await clearFolder(dealFolderId, driveId);

    let successCount = 0;
    for (const doc of documents) {
      try {
        const { data, fileName, mimeType } = await fetchDocumentData(doc);
        const safeName = sanitizeName(fileName || `documento_${doc?.id ?? successCount + 1}`) || "documento";
        const uploadResult = await uploadBufferToDrive({
          parentId: dealFolderId,
          name: safeName,
          mimeType: mimeType || "application/octet-stream",
          data,
        });

        let publicLink = uploadResult.webViewLink;
        try {
          publicLink = await ensureFilePublicWebViewLink(uploadResult.id);
        } catch (permissionError) {
          console.warn("[google-drive-sync] No se pudo generar enlace público de Drive", {
            dealId: params.deal?.deal_id ?? params.deal?.id,
            documentId: doc?.id,
            fileId: uploadResult.id,
            error: permissionError instanceof Error ? permissionError.message : String(permissionError),
          });
        }

        await updateDealFileDriveMetadata(prisma, doc, {
          driveFileName: uploadResult.name || safeName,
          driveWebViewLink: publicLink ?? null,
        });
        successCount += 1;
      } catch (err) {
        console.warn("[google-drive-sync] Error subiendo documento a Drive", {
          dealId: params.deal?.deal_id ?? params.deal?.id,
          documentId: doc?.id,
          error: err instanceof Error ? err.message : String(err),
        });
        const errorMessage = `No se pudo copiar el documento "${doc?.file_name || doc?.id || "sin nombre"}".\nMotivo: ${
          err instanceof Error ? err.message : String(err)
        }`;
        try {
          await uploadBufferToDrive({
            parentId: dealFolderId,
            name: sanitizeName(`ERROR - ${doc?.file_name || doc?.id || "documento"}.txt`),
            mimeType: "text/plain",
            data: Buffer.from(errorMessage, "utf8"),
          });
        } catch (uploadErr) {
          console.error("[google-drive-sync] No se pudo registrar el error en Drive", uploadErr);
        }
      }
    }

    console.log(
      "[google-drive-sync] Sincronización completada",
      JSON.stringify({
        dealId: params.deal?.deal_id ?? params.deal?.id,
        organization: organizationName,
        totalDocuments: documents.length,
        uploaded: successCount,
      })
    );
  } catch (err) {
    console.error("[google-drive-sync] Error inesperado en la sincronización", err);
  }
}

function removeFolderFromCache(parentId: string, name: string): void {
  const sanitized = sanitizeName(name || "carpeta");
  driveFolderCache.delete(cacheKey(parentId, sanitized));
}

export async function deleteDealFolderFromGoogleDrive(params: {
  deal: any;
  organizationName?: string | null;
}): Promise<void> {
  try {
    const driveId = resolveDriveSharedId();
    if (!driveId) return;

    if (!getServiceAccount()) {
      return;
    }

    const baseFolderName = resolveDriveBaseFolderName();
    const baseFolderId = await findFolder({
      name: baseFolderName,
      parentId: driveId,
      driveId,
    });
    if (!baseFolderId) {
      console.warn("[google-drive-sync] Carpeta base no encontrada, no se borra carpeta del deal");
      return;
    }

    const organizationDisplayName = params.organizationName?.trim()
      ? params.organizationName
      : "Sin organización";
    const organizationFolderName = sanitizeName(organizationDisplayName) || "Sin organización";
    const organizationFolderId = await findFolder({
      name: organizationFolderName,
      parentId: baseFolderId,
      driveId,
    });
    if (!organizationFolderId) {
      console.warn(
        "[google-drive-sync] Carpeta de organización no encontrada, no se borra carpeta del deal",
        { organizationName: organizationDisplayName }
      );
      return;
    }

    const dealFolderName = sanitizeName(buildDealFolderName(params.deal));
    const dealFolderId = await findFolder({
      name: dealFolderName,
      parentId: organizationFolderId,
      driveId,
    });
    if (!dealFolderId) {
      console.warn("[google-drive-sync] Carpeta del deal no encontrada, no se borra en Drive", {
        dealId: params.deal?.deal_id ?? params.deal?.id,
      });
      return;
    }

    try {
      await driveDelete(dealFolderId);
    } catch (err) {
      console.error("[google-drive-sync] Error eliminando carpeta del deal en Drive", {
        dealId: params.deal?.deal_id ?? params.deal?.id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    removeFolderFromCache(baseFolderId, organizationFolderName);
    removeFolderFromCache(organizationFolderId, dealFolderName);

    console.log("[google-drive-sync] Carpeta del deal eliminada en Drive", {
      dealId: params.deal?.deal_id ?? params.deal?.id,
      organizationName: organizationDisplayName,
    });
  } catch (err) {
    console.error("[google-drive-sync] Error inesperado eliminando carpeta del deal", err);
    throw err;
  }
}

export async function uploadDealDocumentToGoogleDrive(params: {
  deal: any;
  organizationName?: string | null;
  fileName: string;
  mimeType?: string | null;
  data: Buffer;
}): Promise<{ driveFileName: string; driveWebViewLink: string | null }> {
  const driveId = resolveDriveSharedId();
  if (!driveId) {
    throw new Error("Google Drive no está configurado (falta GOOGLE_DRIVE_SHARED_DRIVE_ID)");
  }

  if (!getServiceAccount()) {
    throw new Error("Credenciales de Google Drive no configuradas");
  }

  const baseFolderId = await ensureFolder({
    name: resolveDriveBaseFolderName(),
    parentId: driveId,
    driveId,
  });

  const organizationDisplayName = sanitizeName(params.organizationName || "Sin organización") ||
    "Sin organización";
  const organizationFolderId = await ensureFolder({
    name: organizationDisplayName,
    parentId: baseFolderId,
    driveId,
  });

  const dealFolderName = sanitizeName(buildDealFolderName(params.deal));
  const dealFolderId = await ensureFolder({
    name: dealFolderName,
    parentId: organizationFolderId,
    driveId,
  });

  const safeName = sanitizeName(params.fileName || "documento") || "documento";
  const mimeType = params.mimeType?.trim() || "application/octet-stream";

  const uploadResult = await uploadBufferToDrive({
    parentId: dealFolderId,
    name: safeName,
    mimeType,
    data: params.data,
  });

  let publicLink = uploadResult.webViewLink;
  try {
    publicLink = await ensureFilePublicWebViewLink(uploadResult.id);
  } catch (permissionError) {
    console.warn("[google-drive-sync] No se pudo generar enlace público de Drive", {
      dealId: params.deal?.deal_id ?? params.deal?.id,
      fileId: uploadResult.id,
      error: permissionError instanceof Error ? permissionError.message : String(permissionError),
    });
  }

  return {
    driveFileName: uploadResult.name || safeName,
    driveWebViewLink: publicLink ?? uploadResult.webViewLink ?? null,
  };
}
