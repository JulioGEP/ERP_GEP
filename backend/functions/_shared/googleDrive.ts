// backend/functions/_shared/googleDrive.ts
import { createSign } from "crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@prisma/client";
import { downloadFile as downloadPipedriveFile } from "./pipedrive";
import { toMadridISOString } from "./timezone";
import { getPrisma } from "./prisma";

const DEFAULT_BASE_FOLDER_NAME = "Documentos ERP";
const DEAL_DOCUMENTS_LEGACY_FOLDER_NAME = "Documentos del deal";
const SESSION_DOCUMENTS_LEGACY_FOLDER_NAME = "Documentos del deal";
const CERTIFICATES_FOLDER_NAME = "Certificados";
const TRAINERS_FOLDER_NAME = "Formadores";
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

function toNonEmptyString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = typeof value === "string" ? value : String(value);
  const trimmed = str.trim();
  return trimmed.length ? trimmed : null;
}

function resolveDealOrganization(deal: any): any {
  if (!deal || typeof deal !== "object") {
    return null;
  }

  const raw = deal as Record<string, any>;
  const organization = raw.organizations ?? raw.organization ?? null;

  if (organization !== undefined && organization !== null && !("organizations" in raw)) {
    raw.organizations = organization;
  }

  return organization ?? null;
}

function resolveOrganizationNameFromDeal(deal: any): string | null {
  if (!deal) return null;

  const organization = resolveDealOrganization(deal);
  const candidates: unknown[] = [
    organization?.name,
    organization?.nombre,
    deal?.organization_name,
    deal?.organizationName,
    deal?.org_name,
    typeof deal?.org_id === "object" ? deal?.org_id?.name : null,
  ];

  for (const candidate of candidates) {
    const value = toNonEmptyString(candidate);
    if (value) return value;
  }

  return null;
}

function resolveOrganizationIdFromDeal(deal: any): string | null {
  if (!deal) return null;

  const organization = resolveDealOrganization(deal);
  const candidates: unknown[] = [
    organization?.org_id,
    organization?.orgId,
    organization?.id,
    deal?.org_id,
    deal?.organization_id,
    typeof deal?.org_id === "object" ? deal?.org_id?.value ?? deal?.org_id?.id ?? null : null,
  ];

  for (const candidate of candidates) {
    const normalized =
      candidate && typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
        ? toNonEmptyString(
            (candidate as any).value ??
              (candidate as any).id ??
              (candidate as any).org_id ??
              (candidate as any).orgId ??
              null
          )
        : toNonEmptyString(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function resolveTrainerId(trainer: any): string | null {
  const candidates: unknown[] = [
    trainer?.trainer_id,
    trainer?.trainerId,
    trainer?.id,
  ];

  for (const candidate of candidates) {
    const value = toNonEmptyString(candidate);
    if (value) return value;
  }

  return null;
}

function uniqueSanitizedNames(names: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const sanitized = sanitizeName(name || "");
    if (!sanitized || seen.has(sanitized)) continue;
    seen.add(sanitized);
    result.push(sanitized);
  }
  return result;
}

function resolveOrganizationFolderNames(params: {
  deal?: any;
  organizationName?: string | null;
}): { preferredName: string; legacyNames: string[] } {
  const explicitName = toNonEmptyString(params.organizationName);
  const resolvedName = explicitName ?? resolveOrganizationNameFromDeal(params.deal) ?? "Sin organización";
  const preferredName = sanitizeName(resolvedName) || "Sin organización";

  const legacyNames: string[] = [];
  const organizationId = resolveOrganizationIdFromDeal(params.deal);
  const sanitizedId = organizationId ? sanitizeName(organizationId) : null;

  if (sanitizedId && !preferredName.startsWith(sanitizedId)) {
    const combined = sanitizeName(`${sanitizedId} - ${preferredName}`) || `${sanitizedId} - ${preferredName}`;
    if (combined !== preferredName) {
      legacyNames.push(combined);
    }
  }

  return { preferredName, legacyNames };
}

function resolveTrainerFolderNames(trainer: any): { preferredName: string; legacyNames: string[] } {
  const firstName = toNonEmptyString(trainer?.name);
  const lastName = toNonEmptyString(trainer?.apellido ?? trainer?.last_name ?? trainer?.lastName);
  const fullNameCandidate = toNonEmptyString(trainer?.full_name ?? trainer?.fullName);

  const combinedName =
    firstName || lastName
      ? [firstName, lastName].filter((value): value is string => Boolean(value)).join(" ")
      : null;

  const displayCandidates = uniqueSanitizedNames([
    fullNameCandidate,
    combinedName,
    firstName,
    lastName,
  ]);

  let preferredName = displayCandidates.find((name) => Boolean(name)) ?? "";

  if (!preferredName) {
    preferredName = sanitizeName(firstName ?? lastName ?? "") ?? "";
  }

  const trainerId = resolveTrainerId(trainer);
  if (!preferredName) {
    preferredName = trainerId ? sanitizeName(trainerId) ?? trainerId : "";
  }

  if (!preferredName) {
    preferredName = "Formador sin nombre";
  }

  const legacyNames = uniqueSanitizedNames([
    trainerId,
    trainerId ? `${trainerId} - ${preferredName}` : null,
  ]).filter((name) => Boolean(name) && name !== preferredName);

  return { preferredName, legacyNames };
}

function buildOrganizationFolderName(params: { deal?: any; organizationName?: string | null }): string {
  return resolveOrganizationFolderNames(params).preferredName;
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

function normalizeKey(k: string): string {
  if (!k) return k;

  // quitar BOM y comillas envolventes
  let key = k.replace(/^\uFEFF/, "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "");

  // normalizar saltos
  key = key.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // convertir \\n literales a saltos reales
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");

  // asegurar cabeceras PEM
  const hasBegin = key.includes("-----BEGIN PRIVATE KEY-----");
  const hasEnd   = key.includes("-----END PRIVATE KEY-----");
  if (!hasBegin && !hasEnd) {
    key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----\n`;
  } else {
    key = key
      .replace(/-----BEGIN PRIVATE KEY-----\s*/g, "-----BEGIN PRIVATE KEY-----\n")
      .replace(/\s*-----END PRIVATE KEY-----/g, "\n-----END PRIVATE KEY-----\n");
  }
  return key;
}

function getServiceAccount(): { clientEmail: string; privateKey: string } | null {
  if (cachedServiceAccount !== undefined) return cachedServiceAccount;

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

  if (!clientEmail || !privateKeyRaw) {
    console.warn("[google-drive-sync] Faltan credenciales de Google Drive (CLIENT_EMAIL o PRIVATE_KEY)");
    cachedServiceAccount = null;
    return null;
  }

  cachedServiceAccount = {
    clientEmail,
    privateKey: normalizeKey(privateKeyRaw),
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
const subject = (process.env.DRIVE_IMPERSONATE || process.env.GMAIL_IMPERSONATE || "").trim();
if (!subject) {
  console.warn("[google-drive-sync] Falta DRIVE_IMPERSONATE o GMAIL_IMPERSONATE para DWD; se usa el SA sin 'sub'");
}
const payload: Record<string, any> = {
  iss: serviceAccount.clientEmail,
  scope: DRIVE_SCOPE,
  aud: TOKEN_AUDIENCE,
  exp: now + 3600,
  iat: now,
};
if (subject) payload.sub = subject;

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

async function moveFileToParent(params: {
  fileId: string;
  newParentId: string;
  previousParentId?: string | null;
}): Promise<void> {
  const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}`);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,parents");
  url.searchParams.set("addParents", params.newParentId);
  if (params.previousParentId) {
    url.searchParams.set("removeParents", params.previousParentId);
  }

  const response = await authorizedFetch(url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[google-drive-sync] Move failed: ${response.status} ${text}`.trim());
  }
}

async function renameDriveFile(fileId: string, name: string): Promise<void> {
  const sanitized = sanitizeName(name || "carpeta");
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name`;
  const response = await authorizedFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: sanitized }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[google-drive-sync] Rename failed: ${response.status} ${text}`.trim());
  }
}

async function ensureFolderWithCandidates(params: {
  driveId: string;
  parentId: string;
  preferredName: string;
  legacyNames?: string[];
  createIfMissing?: boolean;
  context?: Record<string, unknown>;
}): Promise<{ folderId: string; folderName: string } | null> {
  const preferredName = sanitizeName(params.preferredName || "carpeta") || "carpeta";
  const legacyNames = Array.isArray(params.legacyNames) ? params.legacyNames : [];
  const candidates = uniqueSanitizedNames([preferredName, ...legacyNames]);

  for (const name of candidates) {
    const existing = await findFolder({
      name,
      parentId: params.parentId,
      driveId: params.driveId,
    });
    if (existing) {
      if (name !== preferredName) {
        try {
          await renameDriveFile(existing, preferredName);
          removeFolderFromCache(params.parentId, name);
          driveFolderCache.set(cacheKey(params.parentId, preferredName), existing);
          return { folderId: existing, folderName: preferredName };
        } catch (err) {
          console.warn("[google-drive-sync] No se pudo renombrar carpeta en Drive", {
            ...(params.context ?? {}),
            folderId: existing,
            fromName: name,
            toName: preferredName,
            error: err instanceof Error ? err.message : String(err),
          });
          return { folderId: existing, folderName: name };
        }
      }
      return { folderId: existing, folderName: preferredName };
    }
  }

  if (params.createIfMissing === false) {
    return null;
  }

  const folderId = await ensureFolder({
    name: preferredName,
    parentId: params.parentId,
    driveId: params.driveId,
  });
  return { folderId, folderName: preferredName };
}

async function ensureTrainerFolder(params: {
  driveId: string;
  trainersRootId: string;
  trainer: any;
  createIfMissing?: boolean;
}): Promise<{ folderId: string; folderName: string } | null> {
  const trainerId = resolveTrainerId(params.trainer);
  const { preferredName, legacyNames } = resolveTrainerFolderNames(params.trainer);

  return ensureFolderWithCandidates({
    driveId: params.driveId,
    parentId: params.trainersRootId,
    preferredName,
    legacyNames,
    createIfMissing: params.createIfMissing,
    context: {
      trainerId,
      trainerName: preferredName,
    },
  });
}

async function ensureOrganizationFolder(params: {
  driveId: string;
  baseFolderId: string;
  deal: any;
  organizationName?: string | null;
  createIfMissing?: boolean;
}): Promise<
  | { folderId: string; folderName: string; preferredName: string; legacyNames: string[] }
  | null
> {
  const { preferredName, legacyNames } = resolveOrganizationFolderNames({
    deal: params.deal,
    organizationName: params.organizationName,
  });

  const result = await ensureFolderWithCandidates({
    driveId: params.driveId,
    parentId: params.baseFolderId,
    preferredName,
    legacyNames,
    createIfMissing: params.createIfMissing,
    context: { organizationName: preferredName },
  });

  if (!result) {
    return null;
  }

  return {
    folderId: result.folderId,
    folderName: result.folderName,
    preferredName,
    legacyNames,
  };
}

async function ensureDealFolder(params: {
  driveId: string;
  organizationFolderId: string;
  deal: any;
  createIfMissing?: boolean;
}): Promise<
  | { folderId: string; folderName: string; preferredName: string; legacyNames: string[] }
  | null
> {
  const { preferredName, legacyNames } = resolveDealFolderNames(params.deal);

  const result = await ensureFolderWithCandidates({
    driveId: params.driveId,
    parentId: params.organizationFolderId,
    preferredName,
    legacyNames,
    createIfMissing: params.createIfMissing,
    context: {
      dealId: resolveDealId(params.deal),
      organizationFolderId: params.organizationFolderId,
    },
  });

  if (!result) {
    return null;
  }

  return {
    folderId: result.folderId,
    folderName: result.folderName,
    preferredName,
    legacyNames,
  };
}

async function ensureSessionFolderUnderOrganization(params: {
  driveId: string;
  organizationFolderId: string;
  deal: any;
  session: any;
  sessionNumber: string;
  sessionName?: string | null;
  createIfMissing?: boolean;
}): Promise<{ folderId: string; folderName: string; legacyFolderName: string } | null> {
  const dealFolder = await ensureDealFolder({
    driveId: params.driveId,
    organizationFolderId: params.organizationFolderId,
    deal: params.deal,
    createIfMissing: params.createIfMissing,
  });

  if (!dealFolder) {
    return null;
  }

  const { preferredName, legacyNames, legacyFolderName } = buildSessionFolderNameOptions({
    deal: params.deal,
    sessionNumber: params.sessionNumber,
    sessionName: params.sessionName,
    session: params.session,
  });

  const sessionFolderResult = await ensureFolderWithCandidates({
    driveId: params.driveId,
    parentId: dealFolder.folderId,
    preferredName,
    legacyNames,
    createIfMissing: false,
    context: {
      dealId: resolveDealId(params.deal),
      sessionId: params.session?.id,
    },
  });

  if (sessionFolderResult) {
    return {
      folderId: sessionFolderResult.folderId,
      folderName: sessionFolderResult.folderName,
      legacyFolderName,
    };
  }

  const searchParents = [params.organizationFolderId];
  for (const legacyDealName of dealFolder.legacyNames) {
    const legacyDealFolder = await findFolder({
      name: legacyDealName,
      parentId: params.organizationFolderId,
      driveId: params.driveId,
    });
    if (legacyDealFolder) {
      searchParents.push(legacyDealFolder);
    }
  }

  for (const parentId of searchParents) {
    for (const candidate of uniqueSanitizedNames([preferredName, ...legacyNames])) {
      const existing = await findFolder({
        name: candidate,
        parentId,
        driveId: params.driveId,
      });
      if (!existing) continue;

      try {
        await moveFileToParent({
          fileId: existing,
          newParentId: dealFolder.folderId,
          previousParentId: parentId,
        });
        removeFolderFromCache(parentId, candidate);
        driveFolderCache.set(cacheKey(dealFolder.folderId, candidate), existing);
      } catch (err) {
        console.warn("[google-drive-sync] No se pudo mover la carpeta de sesión a la carpeta del deal", {
          dealId: resolveDealId(params.deal),
          sessionId: params.session?.id,
          folderId: existing,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const renamed = await ensureFolderWithCandidates({
        driveId: params.driveId,
        parentId: dealFolder.folderId,
        preferredName,
        legacyNames,
        createIfMissing: false,
        context: {
          dealId: resolveDealId(params.deal),
          sessionId: params.session?.id,
        },
      });

      if (renamed) {
        return {
          folderId: renamed.folderId,
          folderName: renamed.folderName,
          legacyFolderName,
        };
      }
    }
  }

  if (params.createIfMissing === false) {
    return null;
  }

  const finalResult = await ensureFolderWithCandidates({
    driveId: params.driveId,
    parentId: dealFolder.folderId,
    preferredName,
    legacyNames,
    createIfMissing: true,
    context: {
      dealId: resolveDealId(params.deal),
      sessionId: params.session?.id,
    },
  });

  if (!finalResult) {
    return null;
  }

  return {
    folderId: finalResult.folderId,
    folderName: finalResult.folderName,
    legacyFolderName,
  };
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

type DriveFolderSummary = { id?: string | null; createdTime?: string | null };

async function moveFolderChildrenToTarget(params: {
  sourceFolderId: string;
  targetFolderId: string;
  driveId: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  let pageToken: string | undefined;
  do {
    const list = await driveFilesList({
      corpora: "drive",
      driveId: params.driveId,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      q: `'${params.sourceFolderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id)",
      pageSize: "100",
      pageToken,
    });

    const files = Array.isArray(list.files) ? list.files : [];
    for (const file of files) {
      if (!file?.id) continue;
      try {
        await moveFileToParent({
          fileId: String(file.id),
          newParentId: params.targetFolderId,
          previousParentId: params.sourceFolderId,
        });
      } catch (err) {
        console.warn("[google-drive-sync] No se pudo mover un archivo de la carpeta duplicada", {
          ...(params.context ?? {}),
          sourceFolderId: params.sourceFolderId,
          fileId: file.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    pageToken = typeof list.nextPageToken === "string" ? list.nextPageToken : undefined;
  } while (pageToken);
}

async function consolidateDuplicateNamedFolders(params: {
  driveId: string;
  parentId: string;
  folderName: string;
  keepFolderId: string;
  context?: Record<string, unknown>;
  existingFolders?: DriveFolderSummary[];
}): Promise<void> {
  const sanitizedName = sanitizeName(params.folderName || "carpeta") || "carpeta";

  let folderEntries = params.existingFolders;
  if (!folderEntries) {
    const query = [
      `'${params.parentId}' in parents`,
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      `name = '${sanitizedName.replace(/'/g, "\\'")}'`,
    ].join(" and ");

    const list = await driveFilesList({
      corpora: "drive",
      driveId: params.driveId,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      q: query,
      fields: "files(id, createdTime)",
      orderBy: "createdTime asc",
      pageSize: "100",
    });

    folderEntries = Array.isArray(list.files) ? list.files : [];
  }

  const duplicates = (folderEntries || [])
    .map((entry) => (entry?.id ? String(entry.id) : null))
    .filter((id): id is string => Boolean(id) && id !== params.keepFolderId);

  if (!duplicates.length) {
    return;
  }

  for (const duplicateId of duplicates) {
    try {
      await moveFolderChildrenToTarget({
        sourceFolderId: duplicateId,
        targetFolderId: params.keepFolderId,
        driveId: params.driveId,
        context: params.context,
      });
    } catch (err) {
      console.warn("[google-drive-sync] No se pudieron mover todos los archivos de la carpeta duplicada", {
        ...(params.context ?? {}),
        parentId: params.parentId,
        folderName: sanitizedName,
        duplicateId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await driveDelete(duplicateId);
      removeFolderFromCache(params.parentId, sanitizedName);
    } catch (err) {
      console.warn("[google-drive-sync] No se pudo eliminar carpeta duplicada", {
        ...(params.context ?? {}),
        parentId: params.parentId,
        folderName: sanitizedName,
        duplicateId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function ensureUniqueSubfolder(params: {
  driveId: string;
  parentId: string;
  folderName: string;
  context?: Record<string, unknown>;
}): Promise<string> {
  const sanitizedName = sanitizeName(params.folderName || "carpeta") || "carpeta";
  const key = cacheKey(params.parentId, sanitizedName);
  if (driveFolderCache.has(key)) {
    return driveFolderCache.get(key)!;
  }

  const query = [
    `'${params.parentId}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `name = '${sanitizedName.replace(/'/g, "\\'")}'`,
  ].join(" and ");

  const list = await driveFilesList({
    corpora: "drive",
    driveId: params.driveId,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    q: query,
    fields: "files(id, createdTime)",
    orderBy: "createdTime asc",
    pageSize: "100",
  });

  const folders: DriveFolderSummary[] = Array.isArray(list.files) ? list.files : [];
  if (folders.length > 0 && folders[0]?.id) {
    const primaryId = String(folders[0].id);
    driveFolderCache.set(key, primaryId);
    await consolidateDuplicateNamedFolders({
      driveId: params.driveId,
      parentId: params.parentId,
      folderName: sanitizedName,
      keepFolderId: primaryId,
      context: params.context,
      existingFolders: folders,
    });
    return primaryId;
  }

  const createdId = await driveCreateFolder({
    name: sanitizedName,
    parents: [params.parentId],
  });
  driveFolderCache.set(key, createdId);

  await consolidateDuplicateNamedFolders({
    driveId: params.driveId,
    parentId: params.parentId,
    folderName: sanitizedName,
    keepFolderId: createdId,
    context: params.context,
  });

  return createdId;
}

async function ensureTrainersRootFolder(params: {
  driveId: string;
  baseFolderId?: string | null;
  createIfMissing?: boolean;
}): Promise<string | null> {
  const sanitizedName = sanitizeName(TRAINERS_FOLDER_NAME) || TRAINERS_FOLDER_NAME;
  const parentId = params.driveId;

  if (params.createIfMissing === false) {
    return findFolder({
      name: sanitizedName,
      parentId,
      driveId: params.driveId,
    });
  }

  return ensureUniqueSubfolder({
    driveId: params.driveId,
    parentId,
    folderName: sanitizedName,
    context: { scope: "trainerDocuments" },
  });
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

function resolveDealFolderNames(deal: any): { preferredName: string; legacyNames: string[] } {
  const dealIdRaw = resolveDealId(deal) ?? "sin-id";
  const dealId = sanitizeName(String(dealIdRaw)) || "sin-id";
  const title = sanitizeName(deal?.title || deal?.name || "Sin título") || "Sin título";
  const preferredName = sanitizeName(`${dealId} - ${title}`) || `${dealId} - ${title}`;

  const legacyNames: string[] = [];
  const legacyWithDate = sanitizeName(`${dealId} - ${formatDealDate(deal)} - ${title}`);
  if (legacyWithDate && legacyWithDate !== preferredName) {
    legacyNames.push(legacyWithDate);
  }

  return { preferredName, legacyNames };
}

function buildDealFolderName(deal: any): string {
  return resolveDealFolderNames(deal).preferredName;
}

function resolveSessionFolderNames(params: {
  sessionNumber: string;
  sessionName?: string | null;
  session?: any;
}): { sessionNumberLabel: string; baseSessionName: string; folderName: string } {
  const sessionNumberLabel =
    sanitizeName(params.sessionNumber || "") || params.sessionNumber || "1";
  const baseSessionName =
    sanitizeName(
      params.sessionName ||
        params.session?.nombre_cache ||
        params.session?.name ||
        `Sesión ${sessionNumberLabel}`,
    ) || `Sesión ${sessionNumberLabel}`;
  const folderName =
    sanitizeName(`${sessionNumberLabel} - ${baseSessionName}`) || baseSessionName;

  return { sessionNumberLabel, baseSessionName, folderName };
}

function buildSessionFolderNameOptions(params: {
  deal: any;
  sessionNumber: string;
  sessionName?: string | null;
  session?: any;
}): { preferredName: string; legacyNames: string[]; legacyFolderName: string } {
  const { folderName: baseName } = resolveSessionFolderNames({
    sessionNumber: params.sessionNumber,
    sessionName: params.sessionName,
    session: params.session,
  });

  const preferredName = baseName;
  const legacyNames: string[] = [];
  const dealId = resolveDealId(params.deal);
  if (dealId) {
    const prefixed = sanitizeName(`${dealId} - ${baseName}`);
    if (prefixed && prefixed !== preferredName) {
      legacyNames.push(prefixed);
    }
  }

  return { preferredName, legacyNames, legacyFolderName: legacyNames[0] ?? preferredName };
}

function resolveDealId(deal: any): string | null {
  if (!deal) return null;
  const candidates = [deal.deal_id, deal.id];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const value = String(candidate).trim();
    if (value.length) return value;
  }
  return null;
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

async function updateDealFolderLink({
  deal,
  link,
}: {
  deal: any;
  link: string | null;
}): Promise<void> {
  const dealId = resolveDealId(deal);
  if (!dealId) return;

  if (link) {
    console.info("[google-drive-sync] Enlace de carpeta ignorado (columna eliminada)", {
      dealId,
      link,
    });
  }
}

async function ensureDealFolderPublicLink({
  deal,
  folderId,
}: {
  deal: any;
  folderId: string;
}): Promise<string | null> {
  const dealId = resolveDealId(deal);
  if (!dealId) return null;

  let publicLink: string | null = null;
  try {
    publicLink = await ensureFilePublicWebViewLink(folderId);
  } catch (err) {
    console.warn("[google-drive-sync] No se pudo generar enlace público de la carpeta", {
      dealId,
      folderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await updateDealFolderLink({ deal, link: publicLink ?? null });
  return publicLink ?? null;
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

    const organizationFolder = await ensureOrganizationFolder({
      driveId,
      baseFolderId,
      deal: params.deal,
      organizationName: params.organizationName,
    });
    if (!organizationFolder) {
      console.warn("[google-drive-sync] No se pudo preparar la carpeta de la organización en Drive");
      return;
    }

    const dealFolder = await ensureDealFolder({
      driveId,
      organizationFolderId: organizationFolder.folderId,
      deal: params.deal,
    });
    if (!dealFolder) {
      console.warn("[google-drive-sync] No se pudo preparar la carpeta del deal en Drive");
      return;
    }

    await ensureDealFolderPublicLink({ deal: params.deal, folderId: dealFolder.folderId });

    await clearFolder(dealFolder.folderId, driveId);

    let successCount = 0;
    for (const doc of documents) {
      try {
        const { data, fileName, mimeType } = await fetchDocumentData(doc);
        const safeName = sanitizeName(fileName || `documento_${doc?.id ?? successCount + 1}`) || "documento";
        const uploadResult = await uploadBufferToDrive({
          parentId: dealFolder.folderId,
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
            parentId: dealFolder.folderId,
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
        organization: params.organizationName ?? organizationFolder.folderName,
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

    const prisma = getPrisma();
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

    const organizationFolder = await ensureOrganizationFolder({
      driveId,
      baseFolderId,
      deal: params.deal,
      organizationName: params.organizationName,
      createIfMissing: false,
    });
    if (!organizationFolder) {
      console.warn(
        "[google-drive-sync] Carpeta de organización no encontrada, no se borra carpeta del deal",
        { organizationName: params.organizationName }
      );
      return;
    }

    const dealFolder = await ensureDealFolder({
      driveId,
      organizationFolderId: organizationFolder.folderId,
      deal: params.deal,
      createIfMissing: false,
    });
    if (!dealFolder) {
      console.warn("[google-drive-sync] Carpeta del deal no encontrada, no se borra en Drive", {
        dealId: params.deal?.deal_id ?? params.deal?.id,
      });
      return;
    }

    try {
      await driveDelete(dealFolder.folderId);
      await updateDealFolderLink({ deal: params.deal, link: null });
    } catch (err) {
      console.error("[google-drive-sync] Error eliminando carpeta del deal en Drive", {
        dealId: params.deal?.deal_id ?? params.deal?.id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    for (const name of uniqueSanitizedNames([
      organizationFolder.folderName,
      organizationFolder.preferredName,
      ...(organizationFolder.legacyNames ?? []),
    ])) {
      removeFolderFromCache(baseFolderId, name);
    }
    for (const name of uniqueSanitizedNames([
      dealFolder.folderName,
      dealFolder.preferredName,
      ...(dealFolder.legacyNames ?? []),
    ])) {
      removeFolderFromCache(organizationFolder.folderId, name);
    }

    console.log("[google-drive-sync] Carpeta del deal eliminada en Drive", {
      dealId: params.deal?.deal_id ?? params.deal?.id,
      organizationName: organizationFolder.folderName,
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
}): Promise<{
  driveFileId: string;
  driveFileName: string;
  driveWebViewLink: string | null;
}> {
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

  const organizationFolder = await ensureOrganizationFolder({
    driveId,
    baseFolderId,
    deal: params.deal,
    organizationName: params.organizationName,
  });
  if (!organizationFolder) {
    throw new Error("No se pudo preparar la carpeta de la organización en Drive");
  }

  const dealFolder = await ensureDealFolder({
    driveId,
    organizationFolderId: organizationFolder.folderId,
    deal: params.deal,
  });
  if (!dealFolder) {
    throw new Error("No se pudo preparar la carpeta del deal en Drive");
  }

  await ensureDealFolderPublicLink({ deal: params.deal, folderId: dealFolder.folderId });

  const safeName = sanitizeName(params.fileName || "documento") || "documento";
  const mimeType = params.mimeType?.trim() || "application/octet-stream";

  const legacyDealDocumentsFolderName =
    sanitizeName(DEAL_DOCUMENTS_LEGACY_FOLDER_NAME) || DEAL_DOCUMENTS_LEGACY_FOLDER_NAME;
  const legacyDealDocumentsFolderId = await findFolder({
    name: legacyDealDocumentsFolderName,
    parentId: dealFolder.folderId,
    driveId,
  });

  if (legacyDealDocumentsFolderId) {
    try {
      await moveFolderChildrenToTarget({
        sourceFolderId: legacyDealDocumentsFolderId,
        targetFolderId: dealFolder.folderId,
        driveId,
        context: {
          dealId: resolveDealId(params.deal),
          organizationFolderId: organizationFolder.folderId,
          legacyFolderName: legacyDealDocumentsFolderName,
        },
      });
    } catch (err) {
      console.warn("[google-drive-sync] No se pudieron mover los archivos de la carpeta heredada del deal", {
        dealId: resolveDealId(params.deal),
        legacyFolderId: legacyDealDocumentsFolderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await driveDelete(legacyDealDocumentsFolderId);
      removeFolderFromCache(dealFolder.folderId, legacyDealDocumentsFolderName);
    } catch (err) {
      console.warn("[google-drive-sync] No se pudo eliminar la carpeta heredada del deal", {
        dealId: resolveDealId(params.deal),
        legacyFolderId: legacyDealDocumentsFolderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const uploadResult = await uploadBufferToDrive({
    parentId: dealFolder.folderId,
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
    driveFileId: uploadResult.id,
    driveFileName: uploadResult.name || safeName,
    driveWebViewLink: publicLink ?? uploadResult.webViewLink ?? null,
  };
}

export async function uploadSessionDocumentToGoogleDrive(params: {
  deal: any;
  session: any;
  organizationName?: string | null;
  sessionNumber: string;
  sessionName?: string | null;
  fileName: string;
  mimeType?: string | null;
  data: Buffer;
  targetSubfolderName?: string | null;
}): Promise<{
  driveFileId: string;
  driveFileName: string;
  driveWebViewLink: string | null;
  sessionFolderWebViewLink: string | null;
}> {
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

  const organizationFolder = await ensureOrganizationFolder({
    driveId,
    baseFolderId,
    deal: params.deal,
    organizationName: params.organizationName,
  });
  if (!organizationFolder) {
    throw new Error("No se pudo preparar la carpeta de la organización en Drive");
  }

  const safeName = sanitizeName(params.fileName || "documento") || "documento";
  const mimeType = params.mimeType?.trim() || "application/octet-stream";

  const dealFolder = await ensureDealFolder({
    driveId,
    organizationFolderId: organizationFolder.folderId,
    deal: params.deal,
  });
  if (!dealFolder) {
    throw new Error("No se pudo preparar la carpeta del deal en Drive");
  }

  await ensureDealFolderPublicLink({ deal: params.deal, folderId: dealFolder.folderId });

  let parentFolderId = dealFolder.folderId;
  let sessionFolderLink: string | null = null;

  const sessionFolderInfo = await ensureSessionFolderUnderOrganization({
    driveId,
    organizationFolderId: organizationFolder.folderId,
    deal: params.deal,
    session: params.session,
    sessionNumber: params.sessionNumber,
    sessionName: params.sessionName,
  });

  if (!sessionFolderInfo) {
    throw new Error("No se pudo preparar la carpeta de la sesión en Drive");
  }

  const sessionFolderId = sessionFolderInfo.folderId;
  parentFolderId = sessionFolderId;

  try {
    sessionFolderLink = await ensureFilePublicWebViewLink(sessionFolderId);
  } catch (permissionError) {
    console.warn("[google-drive-sync] No se pudo generar enlace público de carpeta de sesión", {
      dealId: params.deal?.deal_id ?? params.deal?.id,
      sessionId: params.session?.id,
      sessionFolderId,
      error: permissionError instanceof Error ? permissionError.message : String(permissionError),
    });
  }

  if (!sessionFolderLink) {
    sessionFolderLink = `https://drive.google.com/drive/folders/${sessionFolderId}`;
  }

  if (params.targetSubfolderName) {
    const fallbackName =
      params.targetSubfolderName && params.targetSubfolderName.trim().length
        ? params.targetSubfolderName
        : CERTIFICATES_FOLDER_NAME;
    const effectiveName = sanitizeName(fallbackName) || CERTIFICATES_FOLDER_NAME;
    const subfolderId = await ensureUniqueSubfolder({
      driveId,
      parentId: parentFolderId,
      folderName: effectiveName,
      context: {
        dealId: resolveDealId(params.deal),
        sessionId: params.session?.id,
        sessionNumber: params.sessionNumber,
        targetSubfolderName: effectiveName,
      },
    });
    parentFolderId = subfolderId;
  }

  const uploadResult = await uploadBufferToDrive({
    parentId: parentFolderId,
    name: safeName,
    mimeType,
    data: params.data,
  });

  let publicLink = uploadResult.webViewLink;
  try {
    publicLink = await ensureFilePublicWebViewLink(uploadResult.id);
  } catch (permissionError) {
    console.warn("[google-drive-sync] No se pudo generar enlace público de documento de sesión", {
      dealId: params.deal?.deal_id ?? params.deal?.id,
      sessionId: params.session?.id,
      fileId: uploadResult.id,
      error: permissionError instanceof Error ? permissionError.message : String(permissionError),
    });
  }

  return {
    driveFileId: uploadResult.id,
    driveFileName: uploadResult.name || safeName,
    driveWebViewLink: publicLink ?? uploadResult.webViewLink ?? null,
    sessionFolderWebViewLink: sessionFolderLink,
  };
}

type UploadSessionCertificateParams = {
  deal: any;
  session: any;
  organizationName?: string | null;
  sessionNumber: string;
  sessionName?: string | null;
  fileName: string;
  mimeType?: string | null;
  data: Buffer;
};

export async function uploadSessionCertificateToGoogleDrive(
  params: UploadSessionCertificateParams,
): Promise<{
  driveFileId: string;
  driveFileName: string;
  driveWebViewLink: string | null;
  sessionFolderWebViewLink: string | null;
}> {
  return uploadSessionDocumentToGoogleDrive({
    ...params,
    targetSubfolderName: CERTIFICATES_FOLDER_NAME,
  });
}

function extractDriveFileId(link?: string | null): string | null {
  if (!link) return null;
  const normalized = String(link);
  const byPath = normalized.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (byPath?.[1]) {
    return byPath[1];
  }
  const byQuery = normalized.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (byQuery?.[1]) {
    return byQuery[1];
  }
  return null;
}

export async function deleteDealDocumentFromGoogleDrive(params: {
  deal: any;
  organizationName?: string | null;
  driveFileName?: string | null;
  driveWebViewLink?: string | null;
}): Promise<{ fileDeleted: boolean }> {
  const driveId = resolveDriveSharedId();
  if (!driveId) {
    throw new Error(
      "Google Drive no está configurado (falta GOOGLE_DRIVE_SHARED_DRIVE_ID)",
    );
  }

  if (!getServiceAccount()) {
    throw new Error("Credenciales de Google Drive no configuradas");
  }

  const baseFolderId = await findFolder({
    name: resolveDriveBaseFolderName(),
    parentId: driveId,
    driveId,
  });

  if (!baseFolderId) {
    console.warn(
      "[google-drive-sync] Carpeta base no encontrada al eliminar documento del deal",
    );
    return { fileDeleted: false };
  }

  const organizationFolder = await ensureOrganizationFolder({
    driveId,
    baseFolderId,
    deal: params.deal,
    organizationName: params.organizationName,
    createIfMissing: false,
  });

  if (!organizationFolder) {
    console.warn(
      "[google-drive-sync] Carpeta de organización no encontrada al eliminar documento del deal",
      { organizationName: params.organizationName },
    );
    return { fileDeleted: false };
  }

  const dealFolder = await ensureDealFolder({
    driveId,
    organizationFolderId: organizationFolder.folderId,
    deal: params.deal,
    createIfMissing: false,
  });

  if (!dealFolder) {
    console.warn(
      "[google-drive-sync] Carpeta del deal no encontrada al eliminar documento en Drive",
      { dealId: resolveDealId(params.deal) },
    );
    return { fileDeleted: false };
  }

  const dealDocumentsFolderName =
    sanitizeName(DEAL_DOCUMENTS_LEGACY_FOLDER_NAME) || DEAL_DOCUMENTS_LEGACY_FOLDER_NAME;
  const dealDocumentsFolderId = await findFolder({
    name: dealDocumentsFolderName,
    parentId: dealFolder.folderId,
    driveId,
  });

  let fileDeleted = false;
  let fileId = extractDriveFileId(params.driveWebViewLink);
  if (!fileId) {
    const searchFolders = dealDocumentsFolderId
      ? [dealDocumentsFolderId, dealFolder.folderId]
      : [dealFolder.folderId];

    for (const folderId of searchFolders) {
      try {
        fileId = await findFileIdInFolder({
          folderId,
          driveId,
          name: params.driveFileName,
        });
      } catch (err) {
        console.warn("[google-drive-sync] Error buscando documento del deal por nombre", {
          dealId: resolveDealId(params.deal),
          dealFolderId: folderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (fileId) {
        break;
      }
    }
  }

  if (fileId) {
    try {
      await driveDelete(fileId);
      fileDeleted = true;
    } catch (err) {
      console.error("[google-drive-sync] Error eliminando documento del deal en Drive", {
        dealId: resolveDealId(params.deal),
        fileId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } else {
    console.warn("[google-drive-sync] No se encontró el documento del deal a eliminar en Drive", {
      dealId: resolveDealId(params.deal),
      driveFileName: params.driveFileName,
      driveWebViewLink: params.driveWebViewLink,
    });
  }

  return { fileDeleted };
}

async function findFileIdInFolder(params: {
  folderId: string;
  driveId: string;
  name: string | null | undefined;
}): Promise<string | null> {
  const safeName = sanitizeName(params.name || "");
  if (!safeName) {
    return null;
  }

  const query = [
    `'${params.folderId}' in parents`,
    "trashed = false",
    `name = '${safeName.replace(/'/g, "\\'")}'`,
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

  const file = Array.isArray(list.files) ? list.files[0] : null;
  return file?.id ? String(file.id) : null;
}

export async function uploadTrainerDocumentToGoogleDrive(params: {
  trainer: any;
  documentTypeLabel?: string | null;
  fileName: string;
  mimeType?: string | null;
  data: Buffer;
}): Promise<{
  driveFileId: string;
  driveFileName: string;
  driveWebViewLink: string | null;
  trainerFolderWebViewLink: string | null;
}> {
  const driveId = resolveDriveSharedId();
  if (!driveId) {
    throw new Error("Google Drive no está configurado (falta GOOGLE_DRIVE_SHARED_DRIVE_ID)");
  }

  if (!getServiceAccount()) {
    throw new Error("Credenciales de Google Drive no configuradas");
  }

  const trainerId = resolveTrainerId(params.trainer);
  const baseFolderId = await ensureFolder({
    name: resolveDriveBaseFolderName(),
    parentId: driveId,
    driveId,
  });

  const trainersRootId = await ensureTrainersRootFolder({
    driveId,
    baseFolderId,
    createIfMissing: true,
  });

  if (!trainersRootId) {
    throw new Error("No se pudo preparar la carpeta de formadores en Drive");
  }

  const trainerFolder = await ensureTrainerFolder({
    driveId,
    trainersRootId,
    trainer: params.trainer,
    createIfMissing: true,
  });

  if (!trainerFolder) {
    throw new Error("No se pudo preparar la carpeta del formador en Drive");
  }

  const safeName = sanitizeName(params.fileName || "documento") || "documento";
  const mimeType = params.mimeType?.trim() || "application/octet-stream";

  const uploadResult = await uploadBufferToDrive({
    parentId: trainerFolder.folderId,
    name: safeName,
    mimeType,
    data: params.data,
  });

  let publicLink = uploadResult.webViewLink;
  try {
    publicLink = (await ensureFilePublicWebViewLink(uploadResult.id)) ?? publicLink;
  } catch (err) {
    console.warn("[google-drive-sync] No se pudo generar enlace público de documento de formador", {
      trainerId,
      fileId: uploadResult.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let folderLink: string | null = null;
  try {
    folderLink = await ensureFilePublicWebViewLink(trainerFolder.folderId);
  } catch (err) {
    console.warn("[google-drive-sync] No se pudo generar enlace público de carpeta de formador", {
      trainerId,
      folderId: trainerFolder.folderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!folderLink) {
    folderLink = `https://drive.google.com/drive/folders/${trainerFolder.folderId}`;
  }

  return {
    driveFileId: uploadResult.id,
    driveFileName: uploadResult.name || safeName,
    driveWebViewLink: publicLink ?? uploadResult.webViewLink ?? null,
    trainerFolderWebViewLink: folderLink,
  };
}

export async function deleteTrainerDocumentFromGoogleDrive(params: {
  trainer: any;
  driveFileId?: string | null;
  driveFileName?: string | null;
  driveWebViewLink?: string | null;
}): Promise<{ fileDeleted: boolean }> {
  const driveId = resolveDriveSharedId();
  if (!driveId) {
    throw new Error("Google Drive no está configurado (falta GOOGLE_DRIVE_SHARED_DRIVE_ID)");
  }

  if (!getServiceAccount()) {
    throw new Error("Credenciales de Google Drive no configuradas");
  }

  const trainerId = resolveTrainerId(params.trainer);

  const baseFolderId = await findFolder({
    name: resolveDriveBaseFolderName(),
    parentId: driveId,
    driveId,
  });

  if (!baseFolderId) {
    console.warn("[google-drive-sync] Carpeta base no encontrada al eliminar documento de formador", {
      trainerId,
    });
  }

  const trainersRootId = await ensureTrainersRootFolder({
    driveId,
    baseFolderId,
    createIfMissing: false,
  });

  if (!trainersRootId) {
    console.warn("[google-drive-sync] Carpeta de formadores no encontrada al eliminar documento", {
      trainerId,
    });
    return { fileDeleted: false };
  }

  const trainerFolder = await ensureTrainerFolder({
    driveId,
    trainersRootId,
    trainer: params.trainer,
    createIfMissing: false,
  });

  if (!trainerFolder) {
    console.warn("[google-drive-sync] Carpeta del formador no encontrada al eliminar documento", {
      trainerId,
    });
    return { fileDeleted: false };
  }

  let fileId = toNonEmptyString(params.driveFileId);
  if (!fileId) {
    fileId = extractDriveFileId(params.driveWebViewLink);
  }

  if (!fileId && params.driveFileName) {
    try {
      fileId = await findFileIdInFolder({
        folderId: trainerFolder.folderId,
        driveId,
        name: params.driveFileName,
      });
    } catch (err) {
      console.warn("[google-drive-sync] Error buscando documento de formador por nombre", {
        trainerId,
        folderId: trainerFolder.folderId,
        fileName: params.driveFileName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!fileId) {
    return { fileDeleted: false };
  }

  try {
    await driveDelete(fileId);
    return { fileDeleted: true };
  } catch (err) {
    console.warn("[google-drive-sync] No se pudo eliminar documento de formador en Drive", {
      trainerId,
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { fileDeleted: false };
  }
}

export async function deleteUserDocumentFromGoogleDrive(params: {
  user?: any;
  driveFileId?: string | null;
  driveFileName?: string | null;
  driveWebViewLink?: string | null;
  driveWebContentLink?: string | null;
  driveFolderId?: string | null;
  driveIdOverride?: string | null;
  baseFolderName?: string | null;
}): Promise<{ fileDeleted: boolean }> {
  const preferredDriveId = params.driveIdOverride?.trim();
  const driveId =
    preferredDriveId ||
    process.env.USER_DOCUMENTS_DRIVE_ID?.trim() ||
    resolveDriveSharedId() ||
    '0AOXMlUY_16MGUk9PVA';

  if (!driveId) {
    throw new Error('Google Drive no está configurado (falta shared drive id)');
  }

  if (!getServiceAccount()) {
    throw new Error('Credenciales de Google Drive no configuradas');
  }

  const baseFolderName =
    params.baseFolderName?.trim() ||
    process.env.USER_DOCUMENTS_BASE_FOLDER_NAME?.trim() ||
    resolveDriveBaseFolderName();

  let fileId = toNonEmptyString(params.driveFileId);
  if (!fileId) {
    fileId =
      extractDriveFileId(params.driveWebViewLink) || extractDriveFileId(params.driveWebContentLink);
  }

  if (!fileId && params.driveFolderId && params.driveFileName) {
    const baseFolderId = await findFolder({ name: baseFolderName, parentId: driveId, driveId });
    if (baseFolderId) {
      try {
        fileId = await findFileIdInFolder({
          folderId: params.driveFolderId,
          driveId,
          name: params.driveFileName,
        });
      } catch (err) {
        console.warn('[google-drive-sync] Error buscando documento de usuario por nombre', {
          userId: params.user?.id,
          folderId: params.driveFolderId,
          fileName: params.driveFileName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (!fileId) {
    return { fileDeleted: false };
  }

  try {
    await driveDelete(fileId);
    return { fileDeleted: true };
  } catch (err) {
    console.warn('[google-drive-sync] No se pudo eliminar documento de usuario en Drive', {
      userId: params.user?.id,
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { fileDeleted: false };
  }
}

export async function getTrainerFolderWebViewLink(params: {
  trainer: any;
  createIfMissing?: boolean;
}): Promise<string | null> {
  const driveId = resolveDriveSharedId();
  if (!driveId) {
    return null;
  }

  if (!getServiceAccount()) {
    return null;
  }

  const trainerId = resolveTrainerId(params.trainer);
  const baseFolderName = resolveDriveBaseFolderName();

  let baseFolderId: string | null;
  if (params.createIfMissing === false) {
    baseFolderId = await findFolder({
      name: baseFolderName,
      parentId: driveId,
      driveId,
    });
  } else {
    baseFolderId = await ensureFolder({
      name: baseFolderName,
      parentId: driveId,
      driveId,
    });
  }

  if (!baseFolderId) {
    console.warn("[google-drive-sync] Carpeta base no encontrada al obtener enlace de formador", {
      trainerId,
    });
  }

  const trainersRootId = await ensureTrainersRootFolder({
    driveId,
    baseFolderId,
    createIfMissing: params.createIfMissing,
  });

  if (!trainersRootId) {
    return null;
  }

  const trainerFolder = await ensureTrainerFolder({
    driveId,
    trainersRootId,
    trainer: params.trainer,
    createIfMissing: params.createIfMissing,
  });

  if (!trainerFolder) {
    return null;
  }

  try {
    const link = await ensureFilePublicWebViewLink(trainerFolder.folderId);
    return link ?? `https://drive.google.com/drive/folders/${trainerFolder.folderId}`;
  } catch (err) {
    console.warn("[google-drive-sync] No se pudo generar enlace público de carpeta de formador", {
      trainerId,
      folderId: trainerFolder.folderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return `https://drive.google.com/drive/folders/${trainerFolder.folderId}`;
  }
}

export async function deleteSessionDocumentFromGoogleDrive(params: {
  deal: any;
  session: any;
  organizationName?: string | null;
  sessionNumber: string;
  sessionName?: string | null;
  driveFileName?: string | null;
  driveWebViewLink?: string | null;
  removeSessionFolder?: boolean;
}): Promise<{ fileDeleted: boolean; sessionFolderDeleted: boolean }> {
  const driveId = resolveDriveSharedId();
  if (!driveId) {
    throw new Error(
      "Google Drive no está configurado (falta GOOGLE_DRIVE_SHARED_DRIVE_ID)",
    );
  }

  if (!getServiceAccount()) {
    throw new Error("Credenciales de Google Drive no configuradas");
  }

  const baseFolderName = resolveDriveBaseFolderName();
  const baseFolderId = await findFolder({
    name: baseFolderName,
    parentId: driveId,
    driveId,
  });
  if (!baseFolderId) {
    console.warn(
      "[google-drive-sync] Carpeta base no encontrada al eliminar documento de sesión",
    );
    return { fileDeleted: false, sessionFolderDeleted: false };
  }

  const organizationFolder = await ensureOrganizationFolder({
    driveId,
    baseFolderId,
    deal: params.deal,
    organizationName: params.organizationName,
    createIfMissing: false,
  });
  if (!organizationFolder) {
    console.warn(
      "[google-drive-sync] Carpeta de organización no encontrada al eliminar documento de sesión",
      { organizationName: params.organizationName },
    );
    return { fileDeleted: false, sessionFolderDeleted: false };
  }

  const sessionFolderInfo = await ensureSessionFolderUnderOrganization({
    driveId,
    organizationFolderId: organizationFolder.folderId,
    deal: params.deal,
    session: params.session,
    sessionNumber: params.sessionNumber,
    sessionName: params.sessionName,
    createIfMissing: false,
  });

  if (!sessionFolderInfo) {
    console.warn(
      "[google-drive-sync] Carpeta de sesión no encontrada al eliminar documento",
      { sessionId: params.session?.id },
    );
    return { fileDeleted: false, sessionFolderDeleted: false };
  }

  const sessionFolderId = sessionFolderInfo.folderId;
  const sessionFolderName = sessionFolderInfo.folderName;
  const legacySessionFolderName = sessionFolderInfo.legacyFolderName;

  const sessionDocumentsFolderName =
    sanitizeName(SESSION_DOCUMENTS_LEGACY_FOLDER_NAME) || SESSION_DOCUMENTS_LEGACY_FOLDER_NAME;
  const certificatesFolderName = sanitizeName(CERTIFICATES_FOLDER_NAME) || CERTIFICATES_FOLDER_NAME;

  const sessionDocumentsFolderId = await findFolder({
    name: sessionDocumentsFolderName,
    parentId: sessionFolderId,
    driveId,
  });

  const sessionCertificatesFolderId = await findFolder({
    name: certificatesFolderName,
    parentId: sessionFolderId,
    driveId,
  });

  let fileDeleted = false;
  let fileId = extractDriveFileId(params.driveWebViewLink);
  if (!fileId) {
    const searchFolders = [sessionDocumentsFolderId, sessionCertificatesFolderId, sessionFolderId].filter(
      (folderId): folderId is string => Boolean(folderId),
    );

    for (const folderId of searchFolders) {
      try {
        fileId = await findFileIdInFolder({
          folderId,
          driveId,
          name: params.driveFileName,
        });
      } catch (err) {
        console.warn(
          "[google-drive-sync] Error buscando archivo de sesión por nombre",
          {
            sessionId: params.session?.id,
            sessionFolderId: folderId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }

      if (fileId) {
        break;
      }
    }
  }

  if (fileId) {
    try {
      await driveDelete(fileId);
      fileDeleted = true;
    } catch (err) {
      console.error(
        "[google-drive-sync] Error eliminando documento de sesión en Drive",
        {
          fileId,
          sessionId: params.session?.id,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      throw err;
    }
  } else {
    console.warn(
      "[google-drive-sync] No se encontró el archivo de sesión a eliminar en Drive",
      {
        sessionId: params.session?.id,
        driveFileName: params.driveFileName,
        driveWebViewLink: params.driveWebViewLink,
      },
    );
  }

  let sessionFolderDeleted = false;
  if (params.removeSessionFolder) {
    try {
      const foldersToClean: Array<{ id: string; name: string }> = [];
      if (sessionDocumentsFolderId) {
        foldersToClean.push({ id: sessionDocumentsFolderId, name: sessionDocumentsFolderName });
      }
      if (sessionCertificatesFolderId) {
        foldersToClean.push({ id: sessionCertificatesFolderId, name: certificatesFolderName });
      }

      for (const folder of foldersToClean) {
        const childList = await driveFilesList({
          corpora: "drive",
          driveId,
          includeItemsFromAllDrives: "true",
          supportsAllDrives: "true",
          q: `'${folder.id}' in parents and trashed = false`,
          fields: "files(id)",
          pageSize: "1",
        });
        const hasChildren = Array.isArray(childList.files) && childList.files.length > 0;
        if (!hasChildren) {
          try {
            await driveDelete(folder.id);
          } catch (deleteErr) {
            console.warn("[google-drive-sync] No se pudo eliminar subcarpeta vacía de la sesión", {
              sessionId: params.session?.id,
              folderId: folder.id,
              error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
            });
            continue;
          }
          removeFolderFromCache(sessionFolderId, folder.name);
        }
      }

      const list = await driveFilesList({
        corpora: "drive",
        driveId,
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
        q: `'${sessionFolderId}' in parents and trashed = false`,
        fields: "files(id)",
        pageSize: "1",
      });
      const hasRemainingItems = Array.isArray(list.files) && list.files.length > 0;
      if (!hasRemainingItems) {
        await driveDelete(sessionFolderId);
        removeFolderFromCache(organizationFolder.folderId, sessionFolderName);
        if (legacySessionFolderName && legacySessionFolderName !== sessionFolderName) {
          removeFolderFromCache(organizationFolder.folderId, legacySessionFolderName);
        }
        sessionFolderDeleted = true;
      }
    } catch (err) {
      console.error(
        "[google-drive-sync] Error comprobando o eliminando carpeta de sesión en Drive",
        {
          sessionId: params.session?.id,
          sessionFolderId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      throw err;
    }
  }

  return { fileDeleted, sessionFolderDeleted };
}

export async function uploadUserDocumentToGoogleDrive(params: {
  user: any;
  title: string;
  fileName: string;
  mimeType?: string | null;
  data: Buffer;
  driveIdOverride?: string | null;
  baseFolderName?: string | null;
}): Promise<{
  driveFileId: string;
  driveFileName: string;
  driveWebViewLink: string | null;
  driveFolderId: string;
  driveFolderWebViewLink: string | null;
  driveFolderContentLink: string | null;
}> {
  const preferredDriveId = params.driveIdOverride?.trim();
  const driveId =
    preferredDriveId ||
    process.env.USER_DOCUMENTS_DRIVE_ID?.trim() ||
    resolveDriveSharedId() ||
    '0AOXMlUY_16MGUk9PVA';

  if (!driveId) {
    throw new Error('Google Drive no está configurado (falta shared drive id)');
  }

  if (!getServiceAccount()) {
    throw new Error('Credenciales de Google Drive no configuradas');
  }

  const baseFolderName =
    params.baseFolderName?.trim() ||
    process.env.USER_DOCUMENTS_BASE_FOLDER_NAME?.trim() ||
    'Equipo GEP Group';

  const baseFolderId = await ensureFolder({
    name: baseFolderName,
    parentId: driveId,
    driveId,
  });

  const userNamePieces: string[] = [];
  if (params.user?.first_name) userNamePieces.push(String(params.user.first_name));
  if (params.user?.last_name) userNamePieces.push(String(params.user.last_name));
  if (!userNamePieces.length && params.user?.name) {
    userNamePieces.push(String(params.user.name));
  }
  if (!userNamePieces.length && params.user?.email) {
    userNamePieces.push(String(params.user.email));
  }

  const userFolderName =
    sanitizeName(userNamePieces.join(' ').trim()) || sanitizeName(params.user?.id || '') || 'Usuario';

  const userFolderId = await ensureUniqueSubfolder({
    driveId,
    parentId: baseFolderId,
    folderName: userFolderName,
    context: { userId: params.user?.id },
  });

  const safeFileName = sanitizeName(params.fileName || 'documento') || 'documento';
  const mimeType = params.mimeType?.trim() || 'application/octet-stream';
  const uploadResult = await uploadBufferToDrive({
    parentId: userFolderId,
    name: safeFileName,
    mimeType,
    data: params.data,
  });

  let webViewLink: string | null = uploadResult.webViewLink ?? null;
  try {
    webViewLink = (await ensureFilePublicWebViewLink(uploadResult.id)) ?? webViewLink;
  } catch (permissionError) {
    console.warn('[google-drive-sync] No se pudo generar enlace público del documento de usuario', {
      userId: params.user?.id,
      title: params.title,
      fileName: params.fileName,
      error: permissionError instanceof Error ? permissionError.message : String(permissionError),
    });
  }

  const contentLink = `https://drive.google.com/uc?id=${uploadResult.id}&export=download`;

  let folderWebViewLink: string | null = null;
  try {
    folderWebViewLink = (await ensureFilePublicWebViewLink(userFolderId)) ?? null;
  } catch (permissionError) {
    console.warn('[google-drive-sync] No se pudo generar enlace público de carpeta de usuario', {
      userId: params.user?.id,
      folderId: userFolderId,
      error: permissionError instanceof Error ? permissionError.message : String(permissionError),
    });
  }

  return {
    driveFileId: uploadResult.id,
    driveFileName: uploadResult.name,
    driveWebViewLink: webViewLink,
    driveFolderId: userFolderId,
    driveFolderWebViewLink: folderWebViewLink,
    driveFolderContentLink: contentLink,
  };
}
