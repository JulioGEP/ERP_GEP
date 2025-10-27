// backend/functions/deals.ts
import { COMMON_HEADERS, successResponse, errorResponse } from "./_shared/response";
import { getPrisma } from "./_shared/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import { nowInMadridDate, nowInMadridISO, toMadridISOString } from "./_shared/timezone";
import {
  getDeal,
  getOrganization,
  getPerson,
  getDealProducts,
  getDealNotes,
  getDealFiles,
  getPipelines,
} from "./_shared/pipedrive";
import { mapAndUpsertDealTree } from "./_shared/mappers";
import {
  syncDealDocumentsToGoogleDrive,
  deleteDealFolderFromGoogleDrive,
} from "./_shared/googleDrive";
import { generateSessionsForDeal } from "./_shared/sessionGeneration";
import { studentsFromNotes } from "./_shared/studentsFromNotes";
import type { StudentIdentifier } from "./_shared/studentsFromNotes";

const EDITABLE_FIELDS = new Set([
  "sede_label",
  "training_address_label", // alias de entrada…
  "training_address", // …campo real en BD
  "caes_label",
  "fundae_label",
  "hotel_label",
  "w_id_variation",
  "a_fecha",
]);

/* -------------------- Helpers -------------------- */
function parsePathId(path: any): string | null {
  if (!path) return null;
  // admite .../deals/:id
  const m = String(path).match(/\/deals\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function normalizeProductId(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  const id = String(raw).trim();
  return id.length ? id : null;
}

function parseProductHours(raw: any): { ok: boolean; value: number | null } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return { ok: false, value: null };
    return { ok: true, value: Math.round(raw) };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed.length) return { ok: true, value: null };
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, value: null };
    return { ok: true, value: Math.round(parsed) };
  }
  return { ok: false, value: null };
}

function normalizePipelineLabelValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value)
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
  return str.length ? str : null;
}

function normalizeLabelForComparison(value: unknown): string | null {
  const label = normalizePipelineLabelValue(value);
  if (!label) return null;
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isFormacionAbiertaPipeline(value: unknown): boolean {
  const normalized = normalizeLabelForComparison(value);
  if (!normalized) return false;
  return normalized === "formacion abierta";
}

function errorResponseToError(payload: ReturnType<typeof errorResponse>): Error {
  let message = "Error generando sesiones para el deal";
  try {
    const parsed = JSON.parse(payload.body ?? "{}");
    if (parsed && typeof parsed.message === "string" && parsed.message.trim().length) {
      message = parsed.message.trim();
    }
  } catch {
    // ignore JSON parse errors and keep fallback message
  }
  const error = new Error(message);
  (error as any).statusCode = payload.statusCode;
  return error;
}

type SessionForStudents = {
  id: string;
  estado: string | null;
  fecha_inicio_utc: Date | string | null;
  created_at: Date | string | null;
  nombre_cache: string | null;
};

type FormacionAbiertaSyncResult = {
  sessionsCreated: number;
  studentsCreated: number;
  studentsSkippedDuplicate: number;
  studentsSkippedMissingIdentifier: number;
  studentsSkippedNoSession: number;
  primaryNoteId: string | null;
};

function toTimestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function pickDefaultSessionIdForStudents(sessions: readonly SessionForStudents[]): string | null {
  const filtered = sessions
    .map((session) => {
      const id = typeof session?.id === "string" ? session.id.trim() : "";
      if (!id.length) return null;
      return { ...session, id } as SessionForStudents & { id: string };
    })
    .filter((session): session is SessionForStudents & { id: string } => Boolean(session));

  if (!filtered.length) {
    return null;
  }

  const preferred = filtered.filter((session) => session.estado !== "CANCELADA");
  const candidates = preferred.length ? preferred : filtered;

  const sorted = candidates.slice().sort((a, b) => {
    const startA = toTimestamp(a.fecha_inicio_utc);
    const startB = toTimestamp(b.fecha_inicio_utc);
    if (startA !== null && startB !== null && startA !== startB) {
      return startA - startB;
    }
    if (startA !== null && startB === null) return -1;
    if (startA === null && startB !== null) return 1;

    const createdA = toTimestamp(a.created_at) ?? 0;
    const createdB = toTimestamp(b.created_at) ?? 0;
    if (createdA !== createdB) return createdA - createdB;

    const nameA = (a.nombre_cache ?? "").trim().toLowerCase();
    const nameB = (b.nombre_cache ?? "").trim().toLowerCase();
    if (nameA !== nameB) return nameA.localeCompare(nameB, "es");

    return a.id.localeCompare(b.id, "es");
  });

  return sorted[0]?.id ?? null;
}

function buildStudentIdentifierKey(
  sessionId: string | null | undefined,
  identifier: StudentIdentifier | null,
): string | null {
  if (!identifier) return null;
  if (!sessionId) return null;
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId.length) return null;
  return `${trimmedSessionId}::${identifier.type}::${identifier.value}`;
}

async function syncFormacionAbiertaSessionsAndStudents(
  prisma: PrismaClient,
  dealId: string,
) : Promise<FormacionAbiertaSyncResult> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const generationResult = await generateSessionsForDeal(tx, dealId);
    if ("error" in generationResult) {
      throw errorResponseToError(generationResult.error);
    }

    const sessions = await tx.sessions.findMany({
      where: { deal_id: dealId },
      orderBy: [
        { fecha_inicio_utc: "asc" },
        { created_at: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        estado: true,
        fecha_inicio_utc: true,
        created_at: true,
        nombre_cache: true,
      },
    });

    const notes = await tx.deal_notes.findMany({
      where: { deal_id: dealId },
      orderBy: [{ created_at: "desc" }],
      select: { id: true, content: true },
    });

    const parsedStudents = studentsFromNotes(notes);
    const primaryNoteId = parsedStudents[0]?.sourceNoteId ?? null;
    const defaultSessionId = pickDefaultSessionIdForStudents(sessions);

    if (!defaultSessionId) {
      if (parsedStudents.length) {
        console.warn(
          "[formacion-abierta-import] No hay sesiones disponibles para crear alumnos",
          { dealId, noteId: primaryNoteId },
        );
      }

      return {
        sessionsCreated: generationResult.created ?? 0,
        studentsCreated: 0,
        studentsSkippedDuplicate: 0,
        studentsSkippedMissingIdentifier: 0,
        studentsSkippedNoSession: parsedStudents.length,
        primaryNoteId,
      };
    }

    if (!parsedStudents.length) {
      return {
        sessionsCreated: generationResult.created ?? 0,
        studentsCreated: 0,
        studentsSkippedDuplicate: 0,
        studentsSkippedMissingIdentifier: 0,
        studentsSkippedNoSession: 0,
        primaryNoteId,
      };
    }

    const timestamp = nowInMadridDate();

    const existingStudents = await tx.alumnos.findMany({
      where: { deal_id: dealId },
      select: { sesion_id: true, dni: true },
    });

    const existingKeys = new Set<string>();
    for (const existing of existingStudents) {
      const key = existing.dni
        ? buildStudentIdentifierKey(existing.sesion_id, {
            type: "DNI",
            value: existing.dni,
          })
        : null;
      if (key) existingKeys.add(key);
    }

    let studentsCreated = 0;
    let studentsSkippedDuplicate = 0;
    let studentsSkippedMissingIdentifier = 0;

    for (const student of parsedStudents) {
      const dniKey = student.dni
        ? buildStudentIdentifierKey(defaultSessionId, { type: "DNI", value: student.dni })
        : null;
      const identifierKey = buildStudentIdentifierKey(defaultSessionId, student.identifier);
      const keysToCheck = [identifierKey, dniKey].filter((key): key is string => Boolean(key));

      if (keysToCheck.some((key) => existingKeys.has(key))) {
        studentsSkippedDuplicate += 1;
        continue;
      }

      const dni = typeof student.dni === "string" ? student.dni.trim() : "";
      if (!dni.length) {
        if (identifierKey) existingKeys.add(identifierKey);
        studentsSkippedMissingIdentifier += 1;
        continue;
      }

      const nombre = typeof student.nombre === "string" ? student.nombre.trim() : "";
      const apellido = typeof student.apellido === "string" ? student.apellido.trim() : "";
      if (!nombre.length || !apellido.length) {
        if (identifierKey) existingKeys.add(identifierKey);
        if (dniKey) existingKeys.add(dniKey);
        studentsSkippedMissingIdentifier += 1;
        continue;
      }

      await tx.alumnos.create({
        data: {
          deal_id: dealId,
          sesion_id: defaultSessionId,
          nombre,
          apellido,
          dni,
          apto: false,
          certificado: false,
          created_at: timestamp,
          updated_at: timestamp,
        },
      });

      keysToCheck.forEach((key) => existingKeys.add(key));
      studentsCreated += 1;
    }

    return {
      sessionsCreated: generationResult.created ?? 0,
      studentsCreated,
      studentsSkippedDuplicate,
      studentsSkippedMissingIdentifier,
      studentsSkippedNoSession: 0,
      primaryNoteId,
    };
  });
}

function looksLikePipelineNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

async function resolvePipelineLabelFromId(pipelineId: unknown): Promise<string | null> {
  if (pipelineId === null || pipelineId === undefined) return null;

  const normalized = normalizePipelineLabelValue(pipelineId);
  if (!normalized) return null;

  const numericId =
    typeof pipelineId === "number"
      ? Number.isFinite(pipelineId)
        ? pipelineId
        : null
      : looksLikePipelineNumericId(normalized)
      ? Number(normalized)
      : null;

  if (numericId === null) {
    // El pipeline_id ya parece ser un label legible.
    return normalized;
  }

  try {
    const pipelines = await getPipelines();
    if (!Array.isArray(pipelines)) return null;
    const match = pipelines.find((pl: any) => pl?.id === numericId);
    const name = match?.name ?? match?.label ?? match?.title ?? null;
    return normalizePipelineLabelValue(name);
  } catch (error) {
    console.warn("[deals] No se pudo resolver el pipeline por ID", {
      error,
      pipelineId: numericId,
    });
    return null;
  }
}

async function ensureDealPipelineLabel<T extends Record<string, any>>(
  deal: T,
  options: { pipelineId?: unknown; pipelineLabel?: unknown } = {}
): Promise<T> {
  if (!deal || typeof deal !== "object") return deal;

  const currentLabel = normalizePipelineLabelValue((deal as any).pipeline_label);
  const fallbackLabel = normalizePipelineLabelValue(options.pipelineLabel);

  let resolvedLabel = currentLabel ?? fallbackLabel ?? null;

  if (!resolvedLabel) {
    const pipelineIdCandidate =
      (deal as any).pipeline_id ?? options.pipelineId ?? (deal as any).deal_pipeline_id ?? null;

    const normalizedCandidate = normalizePipelineLabelValue(pipelineIdCandidate);
    if (normalizedCandidate && !looksLikePipelineNumericId(normalizedCandidate)) {
      resolvedLabel = normalizedCandidate;
    } else {
      const resolvedFromId = await resolvePipelineLabelFromId(pipelineIdCandidate);
      if (resolvedFromId) {
        resolvedLabel = resolvedFromId;
      } else if (normalizedCandidate && !looksLikePipelineNumericId(normalizedCandidate)) {
        resolvedLabel = normalizedCandidate;
      }
    }
  }

  (deal as Record<string, any>).pipeline_label = resolvedLabel ?? null;
  return deal;
}

function resolvePipedriveId(raw: any): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const v = (raw as any)?.value ?? (raw as any)?.id ?? null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function resolvePipedriveName(deal: any): string | null {
  const direct = deal?.org_name ?? null;
  const nested = typeof deal?.org_id === "object" ? deal.org_id?.name ?? null : null;
  return (direct || nested || null) as string | null;
}

/** Normaliza un deal de Prisma para exponer `products`, `notes`, `documents` */
function isHttpUrl(value?: unknown): boolean {
  if (!value) return false;
  try {
    const url = String(value);
    return /^https?:\/\//i.test(url);
  } catch {
    return false;
  }
}

function mapDealFileForApi(file: any) {
  if (!file) return file;
  const id = file.id != null ? String(file.id) : undefined;
  const rawUrl = typeof file.url === "string" ? file.url : null;
  const rawFileUrl = typeof file.file_url === "string" ? file.file_url : null;
  const isHttp = isHttpUrl(rawUrl ?? rawFileUrl);

  const createdAt = file.created_at ?? file.added_at ?? null;

  return {
    id,
    source: isHttp ? "PIPEDRIVE" : "S3",
    name:
      file.drive_file_name ??
      file.original_file_name ??
      file.file_name ??
      file.name ??
      (typeof file.title === "string" ? file.title : null),
    mime_type: file.file_type ?? file.mime_type ?? null,
    url: file.drive_web_view_link ?? (isHttp ? rawUrl ?? rawFileUrl ?? null : null),
    drive_file_name: file.drive_file_name ?? null,
    drive_web_view_link: file.drive_web_view_link ?? null,
    created_at: toMadridISOString(createdAt),
  };
}

function mapDealForApi<T extends Record<string, any>>(deal: T | null): T | null {
  if (!deal) return deal;
  const out: any = { ...deal };

  if ("created_at" in out) {
    out.created_at = toMadridISOString(out.created_at);
  }
  if ("updated_at" in out) {
    out.updated_at = toMadridISOString(out.updated_at);
  }

  if ("deal_products" in out) {
    out.products = Array.isArray(out.deal_products)
      ? out.deal_products.map((product: any) => ({
          ...product,
          created_at: toMadridISOString(product?.created_at ?? null),
          updated_at: toMadridISOString(product?.updated_at ?? null),
        }))
      : out.deal_products;
    delete out.deal_products;
  }
  if ("deal_notes" in out) {
    out.notes = Array.isArray(out.deal_notes)
      ? out.deal_notes.map((note: any) => ({
          ...note,
          created_at: toMadridISOString(note?.created_at ?? null),
          updated_at: toMadridISOString(note?.updated_at ?? null),
        }))
      : out.deal_notes;
    delete out.deal_notes;
  }
  if ("deal_files" in out) {
    out.documents = Array.isArray(out.deal_files)
      ? out.deal_files.map((file: any) => mapDealFileForApi(file))
      : out.deal_files;
    delete out.deal_files;
  }

  if ("a_fecha" in out) {
    out.a_fecha = toMadridISOString(out.a_fecha);
  }

  if ("sessions" in out) {
    out.sessions = Array.isArray(out.sessions)
      ? out.sessions.map((session: any) => {
          if (!session || typeof session !== "object") {
            return session;
          }
          return {
            ...session,
            fecha_inicio_utc: toMadridISOString((session as any)?.fecha_inicio_utc ?? null),
            fecha_fin_utc: toMadridISOString((session as any)?.fecha_fin_utc ?? null),
          };
        })
      : out.sessions;
  }

  return out as T;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null) {
    const decimalValue = value as { toNumber?: () => number };
    if (typeof decimalValue.toNumber === "function") {
      try {
        const parsed = decimalValue.toNumber();
        return Number.isFinite(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseSedeLabels(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number | null,
  label?: string
): Promise<T> {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(
        label ? `${label} timed out after ${timeoutMs}ms` : `Timeout after ${timeoutMs}ms`
      );
      (err as any).code = "TIMEOUT";
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }),
    timeoutPromise,
  ]);
}

/* ======================= IMPORT DESDE PIPEDRIVE ======================= */
async function importDealFromPipedrive(dealIdRaw: any) {
  const dealIdStr = String(dealIdRaw ?? "").trim();
  if (!dealIdStr) throw new Error("Falta dealId");
  const dealIdNum = Number(dealIdStr);
  if (!Number.isFinite(dealIdNum)) throw new Error("dealId inválido");

  const warnings: string[] = [];
  const timings = {
    getDealMs: 0,
    parallelFetchMs: 0,
    persistMs: 0,
    documentsSyncMs: 0,
  };
  const counters = {
    productsCount: 0,
    notesCount: 0,
    filesCount: 0,
  };
  let errorMessage: string | undefined;

  let d: any;
  let pipelineContext: { id?: unknown; label?: unknown } = {};
  let savedDealId: any;

  try {
    // 1) Traer árbol completo desde Pipedrive
    const getDealStart = Date.now();
    try {
      d = await getDeal(dealIdNum);
      pipelineContext = {
        id: d?.pipeline_id ?? null,
        label:
          d?.pipeline_name ??
          (d as any)?.pipeline?.name ??
          (d as any)?.pipeline?.label ??
          null,
      };
    } finally {
      timings.getDealMs = Date.now() - getDealStart;
    }
    if (!d) throw new Error("Deal no encontrado en Pipedrive");

    const orgId = resolvePipedriveId(d.org_id);
    const personId = resolvePipedriveId(d.person_id);

    const parallelTimeoutMs = Number(
      process.env.PIPEDRIVE_TIMEOUT_MS ?? process.env.PIPEDRIVE_FETCH_TIMEOUT_MS ?? null
    );

    const parallelStart = Date.now();
    const parallelSettled = await (async () => {
      const promises: [
        Promise<any>,
        Promise<any>,
        Promise<any[]>,
        Promise<any[]>,
        Promise<any[]>
      ] = [
        orgId ? getOrganization(orgId) : Promise.resolve(null),
        personId ? getPerson(personId) : Promise.resolve(null),
        getDealProducts(dealIdNum).then((x) => x ?? []),
        getDealNotes(dealIdNum).then((x) => x ?? []),
        getDealFiles(dealIdNum).then((x) => x ?? []),
      ];
      return withTimeout(Promise.allSettled(promises), parallelTimeoutMs, "parallelFetch");
    })().finally(() => {
      timings.parallelFetchMs = Date.now() - parallelStart;
    });

    const [orgRes, personRes, productsRes, notesRes, filesRes] = parallelSettled;

    const resolveErrorMessage = (reason: any) => {
      if (!reason) return "error desconocido";
      if (reason instanceof Error) return reason.message;
      return typeof reason === "string" ? reason : JSON.stringify(reason);
    };

    const org =
      orgRes.status === "fulfilled"
        ? orgRes.value
        : (() => {
            if (orgId) {
              warnings.push(
                `No se pudo obtener la organización desde Pipedrive (${resolveErrorMessage(
                  orgRes.reason
                )})`
              );
            }
            return null;
          })();

    const person =
      personRes.status === "fulfilled"
        ? personRes.value
        : (() => {
            if (personId) {
              warnings.push(
                `No se pudo obtener la persona desde Pipedrive (${resolveErrorMessage(
                  personRes.reason
                )})`
              );
            }
            return null;
          })();

    const productsFetchFailed = productsRes.status === "rejected";
    const products =
      productsRes.status === "fulfilled"
        ? Array.isArray(productsRes.value)
          ? productsRes.value
          : productsRes.value ?? []
        : [];
    if (productsFetchFailed) {
      warnings.push(
        `No se pudieron obtener los productos del deal (${resolveErrorMessage(productsRes.reason)})`
      );
    }

    const notesFetchFailed = notesRes.status === "rejected";
    const notes =
      notesRes.status === "fulfilled"
        ? Array.isArray(notesRes.value)
          ? notesRes.value
          : notesRes.value ?? []
        : [];
    if (notesFetchFailed) {
      warnings.push(
        `No se pudieron obtener las notas del deal (${resolveErrorMessage(notesRes.reason)})`
      );
    }

    const filesFetchFailed = filesRes.status === "rejected";
    const files =
      filesRes.status === "fulfilled"
        ? Array.isArray(filesRes.value)
          ? filesRes.value
          : filesRes.value ?? []
        : [];
    if (filesFetchFailed) {
      warnings.push(
        `No se pudieron obtener los archivos del deal (${resolveErrorMessage(filesRes.reason)})`
      );
    }

    counters.productsCount = Array.isArray(products) ? products.length : 0;
    counters.notesCount = Array.isArray(notes) ? notes.length : 0;
    counters.filesCount = Array.isArray(files) ? files.length : 0;

    // 2) Mapear + upsert relacional en Neon
    const persistStart = Date.now();
    try {
      savedDealId = await mapAndUpsertDealTree({
        deal: d,
        org: org || (orgId ? { id: orgId, name: resolvePipedriveName(d) ?? "—" } : undefined),
        person: person || (personId ? { id: personId } : undefined),
        products,
        notes,
        files,
      });
    } finally {
      timings.persistMs = Date.now() - persistStart;
    }

    if (savedDealId) {
      const persisted = await prisma.deals.findUnique({
        where: { deal_id: String(savedDealId) },
        select: { pipeline_label: true },
      });

      const pipelineLabelCandidate =
        persisted?.pipeline_label ??
        pipelineContext.label ??
        (d as any)?.pipeline_label ??
        (d as any)?.pipeline_name ??
        null;

      if (isFormacionAbiertaPipeline(pipelineLabelCandidate)) {
        try {
          const syncResult = await syncFormacionAbiertaSessionsAndStudents(
            prisma,
            String(savedDealId),
          );
          console.log(
            JSON.stringify({
              event: "formacion-abierta-import-summary",
              deal_id: String(savedDealId),
              sessions_created: syncResult.sessionsCreated,
              students_created: syncResult.studentsCreated,
              students_skipped_duplicate: syncResult.studentsSkippedDuplicate,
              students_skipped_missing_identifier: syncResult.studentsSkippedMissingIdentifier,
              students_skipped_no_session: syncResult.studentsSkippedNoSession,
              note_id: syncResult.primaryNoteId,
            }),
          );
        } catch (syncError) {
          const message =
            syncError instanceof Error
              ? syncError.message
              : "Error sincronizando sesiones y alumnos";
          console.error(
            "[formacion-abierta-import] Error sincronizando sesiones y alumnos",
            {
              dealId: String(savedDealId),
              error: message,
            },
          );
          throw syncError instanceof Error ? syncError : new Error(message);
        }
      }
    }

    // 3) Avisos no bloqueantes (warnings)
    if (!d.title) warnings.push("Falta título en el deal.");
    if (!d.pipeline_id) warnings.push("No se ha podido resolver el pipeline del deal.");
    if (!productsFetchFailed && !products?.length) {
      warnings.push("El deal no tiene productos vinculados en Pipedrive.");
    }

    return { deal_id: savedDealId, warnings };
  } catch (err: any) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const logPayload: Record<string, any> = {
      event: "deal-import-telemetry",
      dealId: dealIdNum,
      timings,
      counters,
    };
    if (errorMessage) {
      logPayload.error = errorMessage;
    }
    console.log(JSON.stringify(logPayload));
  }
}

/* ============================== HANDLER ============================== */
export const handler = async (event: any) => {
  try {
    // CORS
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: COMMON_HEADERS, body: "" };
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || "";

    // id por PATH o por QUERY (?dealId=)
    const qsId = event.queryStringParameters?.dealId
      ? String(event.queryStringParameters.dealId).trim()
      : null;
    const dealIdStr = parsePathId(path) ?? (qsId && qsId.length ? qsId : null);
    const dealId = dealIdStr !== null ? String(dealIdStr) : null;

    /* ------------ IMPORT: POST/GET /.netlify/functions/deals/import ------------ */
    if (
      (method === "POST" && path.endsWith("/deals/import")) ||
      (method === "GET" && path.endsWith("/deals/import"))
    ) {
      const body = event.body ? JSON.parse(event.body) : {};
      const incomingId =
        body?.dealId ?? body?.id ?? body?.deal_id ?? event.queryStringParameters?.dealId;
      if (!incomingId) return errorResponse("VALIDATION_ERROR", "Falta dealId", 400);

      try {
        const { deal_id, warnings } = await importDealFromPipedrive(incomingId);
        const dealInclude = {
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: true,
          deal_notes: true,
          deal_files: true,
        } as const;

        let dealRaw = await prisma.deals.findUnique({
          where: { deal_id: String(deal_id) },
          include: dealInclude,
        });
        if (dealRaw) {
          try {
            await syncDealDocumentsToGoogleDrive({
              deal: dealRaw,
              documents: dealRaw.deal_files ?? [],
              organizationName: dealRaw.organization?.name ?? null,
            });
            const refreshed = await prisma.deals.findUnique({
              where: { deal_id: String(deal_id) },
              include: dealInclude,
            });
            if (refreshed) {
              dealRaw = refreshed;
            }
          } catch (driveError) {
            console.warn("[google-drive-sync] Error no bloqueante", {
              dealId: dealRaw?.deal_id,
              error: driveError instanceof Error ? driveError.message : String(driveError),
            });
          }
        }
        const deal = mapDealForApi(dealRaw);
        return successResponse({ ok: true, warnings, deal });
      } catch (e: any) {
        return errorResponse("IMPORT_ERROR", e?.message || "Error importando deal", 502);
      }
    }

    /* ------------------- GET detalle: /deals/:id o ?dealId= ------------------- */
    if (method === "GET" && dealId !== null) {
      const dealRaw = await prisma.deals.findUnique({
        where: { deal_id: String(dealId) },
        include: {
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: { orderBy: { created_at: "asc" } },
          deal_notes: { orderBy: { created_at: "desc" } },
          deal_files: { orderBy: { created_at: "desc" } },
        },
      });
      if (!dealRaw) return errorResponse("NOT_FOUND", "Deal no encontrado", 404);

      const dealProductNames = (dealRaw.deal_products ?? [])
        .map((product: { name?: string | null }) =>
          typeof product?.name === "string" ? product.name.trim() : "",
        )
        .filter((name: string) => name.length > 0);

      let dealWithTemplates = dealRaw;
      if (dealProductNames.length > 0) {
        const uniqueNames = Array.from(new Set(dealProductNames));
        const catalogProducts = await prisma.products.findMany({
          where: { name: { in: uniqueNames } },
          select: { name: true, template: true },
        });
        const templateByName = new Map<string, string | null>();
        for (const catalogProduct of catalogProducts) {
          const key =
            typeof catalogProduct.name === "string"
              ? catalogProduct.name.trim().toLowerCase()
              : "";
          if (!key) continue;
          if (!templateByName.has(key) || typeof catalogProduct.template === "string") {
            templateByName.set(key, catalogProduct.template ?? null);
          }
        }

        dealWithTemplates = {
          ...dealRaw,
          deal_products: (dealRaw.deal_products ?? []).map((product: any) => {
            const key =
              typeof product?.name === "string" ? product.name.trim().toLowerCase() : "";
            const template = key ? templateByName.get(key) ?? null : null;
            return {
              ...product,
              template,
            };
          }),
        };
      }

      const deal = mapDealForApi(dealWithTemplates);
      const sedeLabels = parseSedeLabels(dealRaw?.sede_label ?? null);
      const dealProducts = (dealWithTemplates.deal_products ?? []).map((product: any) => ({
        name: typeof product?.name === "string" ? product.name : null,
        hours: toNullableNumber(product?.hours),
        template:
          typeof product?.template === "string" && product.template.trim().length
            ? product.template.trim()
            : null,
      }));

      return successResponse({
        deal: deal
          ? {
              ...deal,
              sede_labels: sedeLabels,
              deal_products: dealProducts,
            }
          : null,
      });
    }

    /* ---------------- ELIMINAR DEAL ---------------- */
    if (method === "DELETE" && dealId !== null) {
      const id = String(dealId);

      const existing = await prisma.deals.findUnique({
        where: { deal_id: id },
        include: {
          organization: { select: { name: true } },
        },
      });

      if (!existing) {
        return errorResponse("NOT_FOUND", "Deal no encontrado", 404);
      }

      const commentsTableExistsResult = await prisma.$queryRaw<
        Array<{ table_ref: string | null }>
      >`SELECT to_regclass('public.comments')::text AS table_ref`;

      const commentsTableExists = Array.isArray(commentsTableExistsResult)
        ? commentsTableExistsResult.some((row) => Boolean(row?.table_ref))
        : false;

      const transactionOperations: Parameters<typeof prisma.$transaction>[0] = [
        prisma.deal_products.deleteMany({ where: { deal_id: id } }),
        prisma.deal_notes.deleteMany({ where: { deal_id: id } }),
        prisma.deal_files.deleteMany({ where: { deal_id: id } }),
        prisma.sessions.deleteMany({ where: { deal_id: id } }),
        prisma.deals.delete({ where: { deal_id: id } }),
      ];

      if (commentsTableExists) {
        transactionOperations.splice(3, 0, prisma.comments.deleteMany({ where: { deal_id: id } }));
      }

      await prisma.$transaction(transactionOperations);

      try {
        await deleteDealFolderFromGoogleDrive({
          deal: existing,
          organizationName: existing.organization?.name ?? null,
        });
      } catch (driveError) {
        console.warn("[google-drive-sync] Error no bloqueante eliminando carpeta del deal", {
          dealId: existing.deal_id,
          error: driveError instanceof Error ? driveError.message : String(driveError),
        });
      }

      return successResponse({ ok: true });
    }

    /* ---------------- PATCH (campos editables) ---------------- */
    if (method === "PATCH" && dealId !== null) {
      if (!event.body) return errorResponse("VALIDATION_ERROR", "Body requerido", 400);

      const body = JSON.parse(event.body || "{}");
      const patch: Record<string, any> = {};

      if (body.deal && typeof body.deal === "object") {
        for (const k of Object.keys(body.deal)) {
          if (EDITABLE_FIELDS.has(k)) patch[k] = body.deal[k];
        }
      }

      // Normaliza alias de dirección de formación al campo real de BD
      if ("training_address_label" in patch && patch.training_address_label != null) {
        patch.training_address = patch.training_address_label;
        delete patch.training_address_label;
      }

      if (Object.prototype.hasOwnProperty.call(patch, "w_id_variation")) {
        const raw = patch.w_id_variation;
        if (raw === null || raw === undefined || raw === "") {
          patch.w_id_variation = null;
        } else {
          const normalized = typeof raw === "string" ? raw.trim() : String(raw).trim();
          patch.w_id_variation = normalized.length ? normalized : null;
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, "a_fecha")) {
        const rawDate = patch.a_fecha;
        if (rawDate === null || rawDate === undefined || rawDate === "") {
          patch.a_fecha = null;
        } else {
          const parsed = new Date(rawDate);
          if (Number.isNaN(parsed.getTime())) {
            return errorResponse("VALIDATION_ERROR", "Fecha de formación inválida", 400);
          }
          patch.a_fecha = parsed;
        }
      }

      const productPatches: Array<{ id: string; data: Record<string, any> }> = [];
      if (Array.isArray(body.products)) {
        for (const entry of body.products) {
          if (!entry || typeof entry !== "object") continue;
          const rawId = (entry as any).id ?? (entry as any).product_id;
          const productId = normalizeProductId(rawId);
          if (!productId) continue;

          const data: Record<string, any> = {};

          if (Object.prototype.hasOwnProperty.call(entry, "hours")) {
            const { ok, value } = parseProductHours((entry as any).hours);
            if (!ok) {
              return errorResponse("VALIDATION_ERROR", "hours inválido para producto", 400);
            }
            data.hours = value;
          }

          if (
            Object.prototype.hasOwnProperty.call(entry, "comments") ||
            Object.prototype.hasOwnProperty.call(entry, "product_comments")
          ) {
            const rawComment = (entry as any).comments ?? (entry as any).product_comments;
            if (rawComment === null || rawComment === undefined) {
              data.product_comments = null;
            } else {
              const commentStr = String(rawComment).trim();
              data.product_comments = commentStr.length ? commentStr : null;
            }
          }

          if (Object.keys(data).length) {
            productPatches.push({ id: productId, data });
          }
        }
      }

      if (Object.keys(patch).length) {
        await prisma.deals.update({
          where: { deal_id: String(dealId) },
          data: patch,
        });
      }

      if (productPatches.length) {
        const timestamp = nowInMadridDate();
        await Promise.all(
          productPatches.map((product) =>
            prisma.deal_products.updateMany({
              where: { id: product.id, deal_id: String(dealId) },
              data: { ...product.data, updated_at: timestamp },
            })
          )
        );
      }

      const updatedRaw = await prisma.deals.findUnique({
        where: { deal_id: String(dealId) },
        include: {
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: { orderBy: { created_at: "asc" } },
          deal_notes: { orderBy: { created_at: "desc" } },
          deal_files: { orderBy: { created_at: "desc" } },
        },
      });

      const deal = mapDealForApi(updatedRaw);
      const dealWithPipelineLabel = deal
        ? await ensureDealPipelineLabel(deal, {
            pipelineId: updatedRaw?.pipeline_id ?? pipelineContext.id ?? null,
            pipelineLabel:
              (updatedRaw as any)?.pipeline_label ?? pipelineContext.label ?? null,
          })
        : deal;
      return successResponse({ ok: true, deal: dealWithPipelineLabel });
    }

    if (method === "GET" && event.queryStringParameters?.w_id_variation) {
      const rawVariationId = event.queryStringParameters.w_id_variation;
      const variationId = typeof rawVariationId === "string" ? rawVariationId.trim() : String(rawVariationId ?? "").trim();

      if (!variationId) {
        return successResponse({ deals: [] });
      }

      const rowsRaw = await prisma.deals.findMany({
        where: { w_id_variation: variationId },
        select: {
          deal_id: true,
          title: true,
          pipeline_id: true,
          sede_label: true,
          training_address: true,
          caes_label: true,
          fundae_label: true,
          po: true,
          hotel_label: true,
          comercial: true,
          a_fecha: true,
          w_id_variation: true,
          presu_holded: true,
          modo_reserva: true,
          org_id: true,
          person_id: true,
          created_at: true,
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: {
            select: {
              id: true,
              name: true,
              code: true,
              quantity: true,
              price: true,
              type: true,
              hours: true,
              created_at: true,
            },
            orderBy: { created_at: "asc" },
          },
          _count: {
            select: {
              alumnos: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
      });

      const deals = rowsRaw.map((row: any) => {
        const mapped = mapDealForApi(row);
        if (!mapped) return mapped;

        const studentsCountRaw = row?._count?.alumnos;
        const studentsCount =
          typeof studentsCountRaw === "number" && Number.isFinite(studentsCountRaw)
            ? studentsCountRaw
            : 0;

        const result: any = { ...mapped, students_count: studentsCount };
        if ("_count" in result) {
          delete result._count;
        }

        return result;
      });
      return successResponse({ deals });
    }

    /* -------------- GET listado: /.netlify/functions/deals?pendingCertificates=true -------------- */
    if (method === "GET" && event.queryStringParameters?.pendingCertificates === "true") {
      const now = nowInMadridDate();

      let variantIdsForPendingCertificates: string[] = [];

      try {
        const variantRows = await prisma.variants.findMany({
          where: {
            date: { lt: now },
          },
          select: { id_woo: true },
        });

        const seenVariantIds = new Set<string>();
        variantRows.forEach((variant) => {
          const rawId = variant?.id_woo;
          if (rawId === null || rawId === undefined) return;

          let normalized: string | null = null;
          if (typeof rawId === "bigint") {
            normalized = rawId.toString();
          } else if (typeof rawId === "number") {
            normalized = Number.isFinite(rawId) ? String(rawId) : null;
          } else if (typeof rawId === "string") {
            const trimmed = rawId.trim();
            normalized = trimmed.length ? trimmed : null;
          }

          if (normalized && !seenVariantIds.has(normalized)) {
            seenVariantIds.add(normalized);
          }
        });

        variantIdsForPendingCertificates = Array.from(seenVariantIds);
      } catch (error) {
        console.warn("[deals] pendingCertificates fallback without variant data", { error });
      }

      const conditions: Prisma.dealsWhereInput[] = [
        {
          sessions: {
            some: {
              AND: [
                {
                  OR: [
                    { fecha_inicio_utc: { lt: now } },
                    { fecha_fin_utc: { lt: now } },
                  ],
                },
                {
                  alumnos: {
                    some: {
                      certificado: false,
                    },
                  },
                },
              ],
            },
          },
        },
      ];

      if (variantIdsForPendingCertificates.length > 0) {
        conditions.push({
          w_id_variation: { in: variantIdsForPendingCertificates },
          alumnos: {
            some: {
              certificado: false,
            },
          },
        });
      }

      const rowsRaw = await prisma.deals.findMany({
        where: {
          OR: conditions,
        },
        select: {
          deal_id: true,
          title: true,
          pipeline_id: true,
          sede_label: true,
          training_address: true,
          caes_label: true,
          fundae_label: true,
          hotel_label: true,
          transporte: true,
          po: true,
          comercial: true,
          a_fecha: true,
          w_id_variation: true,
          presu_holded: true,
          modo_reserva: true,
          org_id: true,
          person_id: true,
          created_at: true,
          sessions: {
            select: {
              id: true,
              fecha_inicio_utc: true,
              fecha_fin_utc: true,
            },
            orderBy: { fecha_inicio_utc: "asc" },
          },
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: {
            select: {
              id: true,
              name: true,
              code: true,
              quantity: true,
              price: true,
              type: true,
              hours: true,
              created_at: true,
            },
            orderBy: { created_at: "asc" },
          },
        },
        orderBy: { created_at: "desc" },
      });

      const deals = rowsRaw.map((r: any) => mapDealForApi(r));
      return successResponse({ deals });
    }

    /* -------------- GET listado: /.netlify/functions/deals?noSessions=true -------------- */
    if (method === "GET" && event.queryStringParameters?.noSessions === "true") {
      // listamos deals + organización/persona + productos (sin sessions)
      const rowsRaw = await prisma.deals.findMany({
        select: {
          deal_id: true,
          title: true,
          pipeline_id: true,
          sede_label: true,
          training_address: true,
          caes_label: true,
          fundae_label: true,
          hotel_label: true,
          transporte: true,
          po: true,
          comercial: true,
          a_fecha: true,
          w_id_variation: true,
          presu_holded: true,
          modo_reserva: true,
          org_id: true,
          person_id: true,
          created_at: true,
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: {
            select: {
              id: true,
              name: true,
              code: true,
              quantity: true,
              price: true,
              type: true,
              hours: true,       // hours existe en deal_products
              created_at: true,
            },
            orderBy: { created_at: "asc" },
          },
        },
        orderBy: { created_at: "desc" },
      });

      const deals = rowsRaw.map((r: any) => mapDealForApi(r));
      return successResponse({ deals });
    }

    return errorResponse("NOT_IMPLEMENTED", "Ruta o método no soportado", 404);
  } catch (e: any) {
    const message = e?.message || "Unexpected";
    return errorResponse("UNEXPECTED", message, 500);
  }
};
