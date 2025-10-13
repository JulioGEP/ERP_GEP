import { getPrisma } from "./prisma";
import {
  getValidatedSharedDriveId,
  ensureDealSubfolder,
  ensureOrgFolder,
  findByAppProps,
  getDriveFileMetadata,
  setDomainPermission,
  uploadFile,
} from "./googleDrive";
import { downloadFile } from "./pipedrive";
import { resolveDealCustomLabels } from "./mappers";

const DEFAULT_ORG_FOLDER = "— Sin organización —";
const SUBFOLDER_SEPARATOR = " - ";
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

type DealFolderMetadata = {
  budgetNumber: string | null;
  serviceLabel: string | null;
};

async function resolveDealFolderMetadata(deal: any): Promise<DealFolderMetadata> {
  try {
    const { poValue, tipoServicioLabel } = await resolveDealCustomLabels(deal);
    return {
      budgetNumber: poValue ?? null,
      serviceLabel: tipoServicioLabel ?? null,
    };
  } catch (error) {
    console.warn("[deal-import][document]", {
      action: "resolve_folder_metadata_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return { budgetNumber: null, serviceLabel: null };
  }
}

function toDealFolderLabel({
  dealId,
  addTime,
  budgetNumber,
  serviceLabel,
}: {
  dealId: string;
  addTime: Date;
  budgetNumber?: string | null;
  serviceLabel?: string | null;
}): string {
  const dateLabel = formatDateLabel(addTime);
  const budgetLabel = normalizeDriveName(
    budgetNumber ?? "",
    `Presupuesto ${dealId}`
  );
  const serviceLabelNormalized = normalizeDriveName(
    serviceLabel ?? "",
    "Formación"
  );
  const rawLabel = `${dateLabel}${SUBFOLDER_SEPARATOR}${budgetLabel}${SUBFOLDER_SEPARATOR}${serviceLabelNormalized}`;
  return normalizeDriveName(rawLabel, rawLabel);
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(fn: () => Promise<T>, delaysMs: number[]): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === delaysMs.length) break;
      const waitMs = delaysMs[Math.min(attempt, delaysMs.length - 1)];
      await delay(waitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Operación fallida tras reintentos");
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  let currentIndex = 0;

  const worker = async () => {
    while (true) {
      if (currentIndex >= items.length) return;
      const index = currentIndex;
      currentIndex += 1;
      await handler(items[index], index);
    }
  };

  const workers = Array.from({ length: safeLimit }, () => worker());

  await Promise.all(workers);
}

const DOWNLOAD_UPLOAD_RETRY_DELAYS_MS = [500, 2000, 5000];
const PERMISSION_RETRY_DELAYS_MS = [500, 1000, 2000];
const CONCURRENCY_LIMIT = 3;

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

export type DealDocumentsSyncResult = {
  imported: number;
  skipped: number;
  warnings: string[];
};

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
}): Promise<DealDocumentsSyncResult> {
  const summary: DealDocumentsSyncResult = {
    imported: 0,
    skipped: 0,
    warnings: [],
  };

  const addTime = parsePipedriveDate(deal?.add_time) ?? new Date();
  const orgFolderName = resolveOrgName(organizationName ?? null);
  const normalizedFiles = Array.isArray(files) ? files : [];
  if (!normalizedFiles.length) {
    return summary;
  }

  const prisma = getPrisma();
  const sharedDriveId = await getValidatedSharedDriveId();
  const orgFolderId = await ensureOrgFolder(sharedDriveId, orgFolderName);

  const { budgetNumber, serviceLabel } = await resolveDealFolderMetadata(deal);

  const dealFolderLabel = toDealFolderLabel({
    dealId,
    addTime,
    budgetNumber,
    serviceLabel,
  });

  const dealFolderId = await ensureDealSubfolder(sharedDriveId, orgFolderId, dealFolderLabel);

  const existingRecords = (await prisma.deal_files.findMany({
    where: { deal_id: dealId },
  })) as any[];
  const existingByPdId = new Map<string, any>();
  for (const record of existingRecords) {
    const pdId = record?.pipedrive_file_id != null ? String(record.pipedrive_file_id) : null;
    if (pdId) existingByPdId.set(pdId, record);
  }

  const ensureRecordFromMetadata = async (
    pipedriveFileId: string,
    metadata: { id?: string | null; name?: string | null; webViewLink?: string | null } | null,
    fallbackFile: any,
    existing: any
  ) => {
    const chosenName = resolveFileName(
      metadata?.name ?? undefined,
      fallbackFile?.file_name,
      pipedriveFileId,
      fallbackFile?.file_type
    );
    const driveFileId = metadata?.id ?? existing?.drive_file_id ?? null;
    const link = metadata?.webViewLink ?? existing?.drive_web_view_link ?? existing?.file_url ?? null;
    const recordId = existing?.id ?? pipedriveFileId;
    const now = new Date();
    const uploadedAt = existing?.uploaded_at ?? now;
    await (prisma.deal_files as any).upsert({
      where: { id: recordId },
      create: {
        id: recordId,
        deal_id: dealId,
        file_name: chosenName,
        file_type: fallbackFile?.file_type ?? existing?.file_type ?? null,
        file_url: link,
        drive_web_view_link: link,
        drive_file_id: driveFileId,
        pipedrive_file_id: pipedriveFileId,
        added_at: parsePipedriveDate(fallbackFile?.add_time) ?? existing?.added_at ?? null,
        uploaded_at: uploadedAt,
      },
      update: {
        file_name: chosenName,
        file_type: fallbackFile?.file_type ?? existing?.file_type ?? null,
        file_url: link,
        drive_web_view_link: link,
        drive_file_id: driveFileId,
        pipedrive_file_id: pipedriveFileId,
        added_at: parsePipedriveDate(fallbackFile?.add_time) ?? existing?.added_at ?? null,
        uploaded_at: uploadedAt,
        updated_at: now,
      },
    });
    const refreshed = await prisma.deal_files.findUnique({ where: { id: recordId } });
    if (refreshed) existingByPdId.set(pipedriveFileId, refreshed);
    summary.skipped += 1;
    console.log("[deal-import][document]", {
      dealId,
      pipedriveFileId,
      chosenFileName: chosenName,
      action: "skip-existing",
      driveFileId: driveFileId,
    });
  };

  await runWithConcurrencyLimit(normalizedFiles, CONCURRENCY_LIMIT, async (file) => {
    const pipedriveFileIdRaw = file?.id ?? file?.file_id;
    if (pipedriveFileIdRaw === null || pipedriveFileIdRaw === undefined) return;

    const pipedriveFileId = String(pipedriveFileIdRaw);
    const existing = existingByPdId.get(pipedriveFileId) ?? null;
    let chosenFileName: string | null = existing?.file_name ?? file?.file_name ?? null;

    try {
      if (existing?.drive_file_id) {
        const metadata = await getDriveFileMetadata(existing.drive_file_id);
        if (metadata) {
          await ensureRecordFromMetadata(pipedriveFileId, metadata, file, existing);
          return;
        }
      }

      const foundByProps = await findByAppProps(
        dealFolderId,
        buildAppProperties(dealId, pipedriveFileId)
      );
      if (foundByProps) {
        const metadata = await getDriveFileMetadata(foundByProps);
        if (metadata) {
          await ensureRecordFromMetadata(
            pipedriveFileId,
            { ...metadata, id: foundByProps },
            file,
            existing
          );
          return;
        }
      }

      const download = await retryWithBackoff(
        () => downloadFile(pipedriveFileId),
        DOWNLOAD_UPLOAD_RETRY_DELAYS_MS
      );
      const resolvedFileName = resolveFileName(
        download.file_name_from_header,
        file?.file_name,
        pipedriveFileId,
        download.mimeType ?? file?.file_type ?? null
      );
      chosenFileName = resolvedFileName;
      const mimeType = download.mimeType ?? file?.file_type ?? undefined;

      const uploadResult = await retryWithBackoff(
        () =>
          uploadFile(
            dealFolderId,
            resolvedFileName,
            mimeType,
            download.buffer,
            buildAppProperties(dealId, pipedriveFileId)
          ),
        DOWNLOAD_UPLOAD_RETRY_DELAYS_MS
      );

      await retryWithBackoff(
        () => setDomainPermission(uploadResult.driveFileId, "gepgroup.es", "reader"),
        PERMISSION_RETRY_DELAYS_MS
      );

      const recordId = existing?.id ?? pipedriveFileId;
      const webViewLink = uploadResult.webViewLink;
      const addedAt = parsePipedriveDate(file?.add_time);
      const now = new Date();

      await (prisma.deal_files as any).upsert({
        where: { id: recordId },
        create: {
          id: recordId,
          deal_id: dealId,
          file_name: resolvedFileName,
          file_type: mimeType ?? null,
          file_url: webViewLink,
          drive_web_view_link: webViewLink,
          drive_file_id: uploadResult.driveFileId,
          pipedrive_file_id: pipedriveFileId,
          added_at: addedAt,
          uploaded_at: now,
        },
        update: {
          file_name: resolvedFileName,
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

      const refreshed = await prisma.deal_files.findUnique({ where: { id: recordId } });
      if (refreshed) existingByPdId.set(pipedriveFileId, refreshed);

      summary.imported += 1;
      console.log("[deal-import][document]", {
        dealId,
        pipedriveFileId,
        chosenFileName: resolvedFileName,
        action: existing ? "reuploaded" : "uploaded",
        driveFileId: uploadResult.driveFileId,
      });
    } catch (error: any) {
      const message = error?.message ? String(error.message) : String(error);
      const warningName = chosenFileName ?? file?.file_name ?? `Documento ${pipedriveFileId}`;
      summary.skipped += 1;
      summary.warnings.push(
        `No se pudo sincronizar el fichero "${warningName}" (ID ${pipedriveFileId}): ${message}`
      );
      console.error("[deal-import][document]", {
        dealId,
        pipedriveFileId,
        chosenFileName: warningName,
        action: "document_upload_failed",
        driveFileId: existing?.drive_file_id ?? null,
        error: message,
      });
    }
  });

  return summary;
}
