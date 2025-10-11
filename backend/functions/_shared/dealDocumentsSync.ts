import { getPrisma } from "./prisma";
import {
  ensureDealSubfolder,
  ensureOrgFolder,
  findByAppProps,
  getDriveFileMetadata,
  setDomainPermission,
  uploadFile,
} from "./googleDrive";
import { downloadFile } from "./pipedrive";

const SHARED_DRIVE_ID =
  process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID ?? process.env.GOOGLE_DRIVE_SHARED_ID ?? "0AOXMlUY_16MGUk9PVA";
const DEFAULT_ORG_FOLDER = "— Sin organización —";
const SUBFOLDER_SEPARATOR = " – ";
const MAX_NAME_LENGTH = 200;

function normalizeDriveName(raw: any, fallback: string): string {
  const base = (raw ?? "").toString().normalize("NFC");
  let normalized = base.trim();
  if (!normalized.length) normalized = fallback;
  normalized = normalized.replace(/\s+/g, " ");
  normalized = normalized.replace(/[\\/:*?"<>|]/g, "-");
  normalized = normalized.replace(/-{2,}/g, "-");
  normalized = normalized.trim();
  if (!normalized.length) normalized = fallback;
  if (normalized.length > MAX_NAME_LENGTH) {
    normalized = normalized.slice(0, MAX_NAME_LENGTH);
  }
  return normalized;
}

function hasExtension(name: string): boolean {
  return /\.[^./]+$/.test(name);
}

function trimWithExtension(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < name.length - 1) {
    const ext = name.slice(dotIndex + 1);
    const allowedBase = Math.max(1, MAX_NAME_LENGTH - ext.length - 1);
    const base = name.slice(0, allowedBase);
    return `${base}.${ext}`;
  }
  return name.slice(0, MAX_NAME_LENGTH);
}

const MIME_EXTENSION_MAP: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/zip": "zip",
};

function extensionFromMime(mimeType?: string | null): string | null {
  if (!mimeType) return null;
  const lower = mimeType.toLowerCase();
  if (MIME_EXTENSION_MAP[lower]) return MIME_EXTENSION_MAP[lower];
  if (lower.startsWith("image/")) {
    const candidate = lower.split("/")[1];
    return candidate ? candidate.replace(/[^a-z0-9]+/g, "") : null;
  }
  if (lower.startsWith("text/")) {
    const candidate = lower.split("/")[1];
    return candidate ? candidate.replace(/[^a-z0-9]+/g, "") : null;
  }
  return null;
}

function ensureExtension(name: string, mimeType?: string | null): string {
  if (hasExtension(name)) return trimWithExtension(name);
  const ext = extensionFromMime(mimeType);
  if (!ext) return trimWithExtension(name);
  return trimWithExtension(`${name}.${ext}`);
}

function parsePipedriveDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const candidate = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(candidate)
      ? candidate
      : `${candidate}Z`;
    const date = new Date(withZone);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatDateLabel(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

function toDealFolderLabel(dealId: string, dealTitle: string | null, addTime: Date): string {
  const titleNormalized = normalizeDriveName(dealTitle, `Deal ${dealId}`);
  const dateLabel = formatDateLabel(addTime);
  const rawLabel = `${dateLabel}${SUBFOLDER_SEPARATOR}${dealId}${SUBFOLDER_SEPARATOR}${titleNormalized}`;
  return normalizeDriveName(rawLabel, rawLabel);
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const waitMs = baseDelayMs * 2 ** (attempt - 1);
      await delay(waitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Operación fallida tras reintentos");
}

function buildAppProperties(dealId: string, pipedriveFileId: string) {
  return {
    dealId,
    pipedriveFileId,
  };
}

function resolveFileName(
  downloadName: string | undefined,
  fallbackName: string | undefined,
  pipedriveFileId: string,
  mimeType?: string | null
): string {
  const candidate = downloadName?.trim().length
    ? downloadName
    : fallbackName?.trim().length
    ? fallbackName
    : `Documento ${pipedriveFileId}`;
  const normalized = normalizeDriveName(candidate, `Documento ${pipedriveFileId}`);
  return ensureExtension(normalized, mimeType);
}

function resolveOrgName(raw: string | undefined | null): string {
  return normalizeDriveName(raw, DEFAULT_ORG_FOLDER);
}

export async function syncDealDocumentsFromPipedrive({
  deal,
  dealId,
  files,
  organizationName,
}: {
  deal: any;
  dealId: string;
  files: any[];
  organizationName?: string | null;
}): Promise<void> {
  if (!SHARED_DRIVE_ID) {
    console.warn(
      "[deal-import][documents] Falta GOOGLE_DRIVE_SHARED_DRIVE_ID (o GOOGLE_DRIVE_SHARED_ID), se omite sincronización de documentos"
    );
    return;
  }
  if (!Array.isArray(files) || files.length === 0) return;

  const prisma = getPrisma();
  const addTime = parsePipedriveDate(deal?.add_time) ?? new Date();
  const orgFolderName = resolveOrgName(organizationName ?? null);
  const dealFolderLabel = toDealFolderLabel(dealId, deal?.title ?? null, addTime);

  const orgFolderId = await ensureOrgFolder(SHARED_DRIVE_ID, orgFolderName);
  const dealFolderId = await ensureDealSubfolder(SHARED_DRIVE_ID, orgFolderId, dealFolderLabel);

  const existingRecords = (await prisma.deal_files.findMany({
    where: { deal_id: dealId },
  })) as any[];
  const existingByPdId = new Map<string, any>();
  const existingById = new Map<string, any>();
  for (const record of existingRecords) {
    const recordId = record?.id != null ? String(record.id) : null;
    const pdId = record?.pipedrive_file_id != null ? String(record.pipedrive_file_id) : null;
    if (pdId) existingByPdId.set(pdId, record);
    if (recordId) existingById.set(recordId, record);
  }

  for (const file of files) {
    const pipedriveFileIdRaw = file?.id ?? file?.file_id;
    if (pipedriveFileIdRaw === null || pipedriveFileIdRaw === undefined) continue;
    const pipedriveFileId = String(pipedriveFileIdRaw);

    const existing = existingByPdId.get(pipedriveFileId) ?? existingById.get(pipedriveFileId) ?? null;

    const ensureLinkUpdates = async (
      recordId: string,
      data: Partial<{
        file_url: string | null;
        drive_web_view_link: string | null;
        drive_file_id: string | null;
        file_name: string | null;
        file_type: string | null;
        uploaded_at: Date | null;
      }>
    ) => {
      const updateData: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) updateData[key] = value;
      }
      if (Object.keys(updateData).length === 0) return;
      updateData.updated_at = new Date();
      await (prisma.deal_files as any).update({
        where: { id: recordId },
        data: updateData,
      });
    };

    try {
      if (existing?.drive_file_id) {
        const metadata = await getDriveFileMetadata(existing.drive_file_id);
        if (metadata) {
          const latestLink = metadata.webViewLink ?? existing.drive_web_view_link ?? existing.file_url ?? null;
          const latestName = metadata.name ?? existing.file_name ?? null;
          await ensureLinkUpdates(existing.id, {
            file_url: latestLink,
            drive_web_view_link: latestLink,
            file_name: latestName,
          });
          console.log("[deal-import][document]", {
            dealId,
            pipedriveFileId,
            chosenFileName: latestName,
            action: "skip-existing",
            driveFileId: existing.drive_file_id,
          });
          continue;
        }
      }

      let driveFileId = existing?.drive_file_id ?? null;
      if (!driveFileId) {
        const foundByProps = await findByAppProps(dealFolderId, buildAppProperties(dealId, pipedriveFileId));
        if (foundByProps) {
          const metadata = await getDriveFileMetadata(foundByProps);
          if (metadata) {
            const link = metadata.webViewLink ?? existing?.drive_web_view_link ?? existing?.file_url ?? null;
            const recordId = existing?.id ?? pipedriveFileId;
            await (prisma.deal_files as any).upsert({
              where: { id: recordId },
              create: {
                id: recordId,
                deal_id: dealId,
                file_name: metadata.name ?? resolveFileName(undefined, file?.file_name, pipedriveFileId, file?.file_type),
                file_type: file?.file_type ?? null,
                file_url: link,
                drive_web_view_link: link,
                drive_file_id: foundByProps,
                pipedrive_file_id: pipedriveFileId,
                added_at: parsePipedriveDate(file?.add_time) ?? null,
                uploaded_at: new Date(),
              },
              update: {
                file_name: metadata.name ?? existing?.file_name ?? null,
                file_type: file?.file_type ?? existing?.file_type ?? null,
                file_url: link,
                drive_web_view_link: link,
                drive_file_id: foundByProps,
                pipedrive_file_id: pipedriveFileId,
                uploaded_at: existing?.uploaded_at ?? new Date(),
                updated_at: new Date(),
              },
            });
            console.log("[deal-import][document]", {
              dealId,
              pipedriveFileId,
              chosenFileName: metadata.name ?? existing?.file_name,
              action: "relinked-existing",
              driveFileId: foundByProps,
            });
            continue;
          }
        }
      }

      const download = await withRetry(() => downloadFile(pipedriveFileId), 3, 500);
      const chosenFileName = resolveFileName(
        download.file_name_from_header,
        file?.file_name,
        pipedriveFileId,
        download.mimeType ?? file?.file_type ?? null
      );
      const mimeType = download.mimeType ?? file?.file_type ?? undefined;

      const uploadResult = await withRetry(
        () =>
          uploadFile(
            dealFolderId,
            chosenFileName,
            mimeType,
            download.buffer,
            buildAppProperties(dealId, pipedriveFileId)
          ),
        3,
        500
      );

      await withRetry(() => setDomainPermission(uploadResult.driveFileId), 3, 500);

      const recordId = existing?.id ?? pipedriveFileId;
      const webViewLink = uploadResult.webViewLink;
      const addedAt = parsePipedriveDate(file?.add_time);
      const now = new Date();

      await (prisma.deal_files as any).upsert({
        where: { id: recordId },
        create: {
          id: recordId,
          deal_id: dealId,
          file_name: chosenFileName,
          file_type: mimeType ?? null,
          file_url: webViewLink,
          drive_web_view_link: webViewLink,
          drive_file_id: uploadResult.driveFileId,
          pipedrive_file_id: pipedriveFileId,
          added_at: addedAt,
          uploaded_at: now,
        },
        update: {
          file_name: chosenFileName,
          file_type: mimeType ?? null,
          file_url: webViewLink,
          drive_web_view_link: webViewLink,
          drive_file_id: uploadResult.driveFileId,
          pipedrive_file_id: pipedriveFileId,
          added_at: addedAt ?? existing?.added_at ?? null,
          uploaded_at: now,
          updated_at: now,
        },
      });

      console.log("[deal-import][document]", {
        dealId,
        pipedriveFileId,
        chosenFileName,
        action: existing ? "reuploaded" : "uploaded",
        driveFileId: uploadResult.driveFileId,
      });
    } catch (error: any) {
      console.error("[deal-import][document]", {
        dealId,
        pipedriveFileId,
        chosenFileName: existing?.file_name ?? file?.file_name ?? null,
        action: "document_upload_failed",
        driveFileId: existing?.drive_file_id ?? null,
        error: error?.message ?? String(error),
      });
    }
  }
}
