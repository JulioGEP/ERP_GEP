import { createSign } from "crypto";
import { getGoogleDriveClientEmail, getGoogleDrivePrivateKey } from "./env";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const SCOPES = ["https://www.googleapis.com/auth/drive"];

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input) : input;
  return buffer
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function fetchAccessToken(): Promise<string> {
  const clientEmail = getGoogleDriveClientEmail();
  const privateKey = getGoogleDrivePrivateKey();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: SCOPES.join(" "),
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  let signature: Buffer;
  try {
    signature = signer.sign(privateKey);
  } catch (error) {
    const err = new Error(
      "GOOGLE_DRIVE_PRIVATE_KEY_INVALID: PEM inválido o no corresponde a GOOGLE_DRIVE_CLIENT_EMAIL."
    );
    (err as any).cause = error;
    throw err;
  }
  const assertion = `${signingInput}.${base64UrlEncode(signature)}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Error obteniendo token de Google Drive: ${response.status} ${text}`);
  }

  const json: any = await response.json();
  const token = json?.access_token;
  const expiresIn = typeof json?.expires_in === "number" ? json.expires_in : 3600;
  if (!token) throw new Error("Respuesta sin access_token de Google Drive");

  cachedToken = { token, expiresAt: now + expiresIn - 60 };
  return token;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 30) {
    return cachedToken.token;
  }
  return fetchAccessToken();
}

type HeadersLike = Headers | Record<string, string> | Array<[string, string]> | undefined;

function toHeaders(init?: HeadersLike): Headers {
  if (init instanceof Headers) {
    const clone = new Headers();
    init.forEach((value, key) => clone.set(key, value));
    return clone;
  }
  const headers = new Headers();
  if (Array.isArray(init)) {
    for (const [key, value] of init) {
      if (key) headers.set(key, value);
    }
  } else if (init) {
    for (const [key, value] of Object.entries(init)) {
      headers.set(key, value);
    }
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return headers;
}

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = toHeaders(init.headers as any);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

function escapeForQuery(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function listFiles(params: Record<string, string>): Promise<any> {
  const search = new URLSearchParams(params);
  const response = await authorizedFetch(`${DRIVE_API_BASE}/files?${search.toString()}`, {
    method: "GET",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Drive files.list error ${response.status}: ${text}`);
  }
  return (await response.json()) as any;
}

async function createFolder(parentId: string, name: string): Promise<string> {
  const body = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [parentId],
  };
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  const response = await authorizedFetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Drive files.create error ${response.status}: ${text}`);
  }
  const json: any = await response.json();
  const id = json?.id;
  if (!id) throw new Error("files.create sin id");
  return String(id);
}

async function findFolderId(driveId: string, parentId: string, name: string): Promise<string | null> {
  const params = {
    q: `name = '${escapeForQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${escapeForQuery(parentId)}' in parents`,
    corpora: "drive",
    driveId,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    fields: "files(id)",
    pageSize: "1",
    spaces: "drive",
  };
  const json = await listFiles(params);
  const folder = Array.isArray(json?.files) ? json.files[0] : null;
  return folder?.id ?? null;
}

export async function ensureOrgFolder(sharedDriveId: string, folderName: string): Promise<string> {
  const parentId = sharedDriveId;
  const existing = await findFolderId(sharedDriveId, parentId, folderName);
  if (existing) return existing;
  return createFolder(parentId, folderName);
}

export async function ensureDealSubfolder(
  sharedDriveId: string,
  orgFolderId: string,
  label: string
): Promise<string> {
  const existing = await findFolderId(sharedDriveId, orgFolderId, label);
  if (existing) return existing;
  return createFolder(orgFolderId, label);
}

function buildMultipartBody(
  metadata: Record<string, any>,
  buffer: Buffer,
  mimeType: string
): { body: Buffer; boundary: string } {
  const boundary = `boundary_${Math.random().toString(36).slice(2)}`;
  const meta = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    "utf8"
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf8"
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([meta, fileHeader, buffer, closing]);
  return { body, boundary };
}

export async function uploadFile(
  parentId: string,
  filename: string,
  mimeType: string | undefined,
  buffer: Buffer,
  appProperties?: Record<string, string>
): Promise<{ driveFileId: string; webViewLink: string | null }> {
  const effectiveMime = mimeType || "application/octet-stream";
  const metadata: Record<string, any> = {
    name: filename,
    parents: [parentId],
    mimeType: effectiveMime,
  };
  if (appProperties && Object.keys(appProperties).length) {
    metadata.appProperties = appProperties;
  }
  const { body, boundary } = buildMultipartBody(metadata, buffer, effectiveMime);
  const params = new URLSearchParams({
    uploadType: "multipart",
    supportsAllDrives: "true",
    fields: "id,webViewLink",
  });
  const response = await authorizedFetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Drive upload error ${response.status}: ${text}`);
  }
  const json: any = await response.json();
  const id = json?.id;
  if (!id) throw new Error("Upload sin id");
  return { driveFileId: String(id), webViewLink: json?.webViewLink ?? null };
}

export async function setDomainPermission(
  driveFileId: string,
  domain = "gepgroup.es",
  role: "reader" | "commenter" | "writer" = "reader"
): Promise<void> {
  const params = new URLSearchParams({
    supportsAllDrives: "true",
    sendNotificationEmail: "false",
  });
  const body = {
    type: "domain",
    role,
    domain,
    allowFileDiscovery: false,
  };
  const response = await authorizedFetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(driveFileId)}/permissions?${params.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    if (response.status === 409) return;
    const text = await response.text().catch(() => "");
    throw new Error(`Drive permissions.create error ${response.status}: ${text}`);
  }
}

export async function findByAppProps(
  parentId: string,
  props: Record<string, string>
): Promise<string | null> {
  const conditions = [`'${escapeForQuery(parentId)}' in parents`, "trashed = false"];
  for (const [key, value] of Object.entries(props)) {
    conditions.push(
      `appProperties has { key='${escapeForQuery(key)}' and value='${escapeForQuery(value)}' }`
    );
  }
  const params = {
    q: conditions.join(" and "),
    corpora: "allDrives",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    fields: "files(id)",
    pageSize: "1",
    spaces: "drive",
  };
  const json = await listFiles(params);
  const file = Array.isArray(json?.files) ? json.files[0] : null;
  return file?.id ?? null;
}

export async function getDriveFileMetadata(
  fileId: string
): Promise<{ id?: string; name?: string; webViewLink?: string } | null> {
  const params = new URLSearchParams({
    fields: "id,name,webViewLink",
    supportsAllDrives: "true",
  });
  const response = await authorizedFetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { method: "GET" }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Drive files.get error ${response.status}: ${text}`);
  }
  return (await response.json()) as any;
}
