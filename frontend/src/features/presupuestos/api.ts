// frontend/src/features/presupuestos/api.ts
import type {
  DealDetail,
  DealDetailViewModel,
  DealProduct,
  DealSummary,
  DealDocument,
  DealNote,
  DealSession,
  DealSessionUpdatePayload,
} from "../../types/deal";
import type { Room } from "../../types/room";
import type { Trainer } from "../../types/trainer";
import type { MobileUnit } from "../../types/mobile-unit";
import type {
  ResourceAvailability,
  ResourceConflictDetail,
  ResourceConflictSummary,
} from "../../types/resource-conflict";

type Json = any;

// Netlify Functions base (auto local/Netlify)
// - Si estás en localhost:5173 (Vite), apunta a http://localhost:8888/.netlify/functions
// - Si estás sirviendo vía Netlify Dev (8888) o en producción, usa ruta relativa
export const API_BASE =
  typeof window !== "undefined" && window.location
    ? (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
        ? (window.location.port === "8888"
            ? "/.netlify/functions"
            : "http://localhost:8888/.netlify/functions")
        : "/.netlify/functions"
    : "/.netlify/functions";

/* =========================
 * Utilidades de normalizado
 * ========================= */

export class ApiError extends Error {
  code: string;
  status?: number;
  details?: unknown;
  constructor(code: string, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
export function isApiError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError ||
    (typeof err === "object" && !!err && (err as any).name === "ApiError")
  );
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function isHttpUrl(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  try {
    const str = String(value);
    return /^https?:\/\//i.test(str);
  } catch {
    return false;
  }
}

function pickNonEmptyString(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    }
  }
  return null;
}

function buildPersonFullName(person?: {
  first_name?: string | null;
  last_name?: string | null;
} | null): string | null {
  if (!person) return null;
  const parts = [person.first_name, person.last_name]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  return parts.length ? parts.join(" ") : null;
}

/* ==================================
 * Normalizadores (summary / detail)
 * ================================== */

function normalizeProducts(
  raw: unknown
): { products?: DealProduct[]; productNames?: string[] } {
  if (!raw) return {};

  const entries = Array.isArray(raw) ? raw : [];
  if (!entries.length) return {};

  const products: DealProduct[] = [];
  const names: string[] = [];

  for (const entry of entries) {
    if (entry && typeof entry === "object") {
      const item = entry as Record<string, any>;

      const product: DealProduct = {
        id: item.id ?? null,
        deal_id: item.deal_id ?? null,
        name: toStringValue(item.name) ?? null,
        code: toStringValue(item.code) ?? null,
        quantity: toNumber(item.quantity),
        price: toNumber(item.price),
        type: item.type ?? null,
        hours: typeof item.hours === "number" ? item.hours : toNumber(item.hours) ?? null,
        comments: toStringValue(item.product_comments ?? item.comments),
        typeLabel: toStringValue(item.typeLabel),
        categoryLabel: toStringValue(item.categoryLabel),
      };

      products.push(product);

      const label = toStringValue(product.name ?? product.code);
      if (label) names.push(label);
    } else {
      const label = toStringValue(entry);
      if (label) names.push(label);
    }
  }

  const result: { products?: DealProduct[]; productNames?: string[] } = {};
  if (products.length) result.products = products;
  if (names.length) result.productNames = names;
  return result;
}

function normalizeDealSummary(row: Json): DealSummary {
  const rawDealId = row?.deal_id ?? row?.dealId ?? row?.id;
  const resolvedDealId =
    toStringValue(rawDealId) ?? (rawDealId != null ? String(rawDealId) : "");

  const title =
    toStringValue(row?.title ?? row?.deal_title) ??
    (resolvedDealId ? `Presupuesto #${resolvedDealId}` : "Presupuesto");

  const organization =
    row?.organization || row?.organizations
      ? {
          name:
            toStringValue(
              row?.organization?.name ?? row?.organizations?.name
            ) ?? null,
          org_id:
            toStringValue(
              row?.organization?.org_id ?? row?.organizations?.org_id
            ) ?? null,
        }
      : undefined;

  const person = row?.person
    ? {
        person_id: row.person.person_id ?? null,
        first_name: row.person.first_name ?? null,
        last_name: row.person.last_name ?? null,
        email: row.person.email ?? null,
        phone: row.person.phone ?? null,
      }
    : undefined;

  const productsInfo = normalizeProducts(row?.products ?? row?.deal_products);

  const summary: DealSummary = {
    deal_id: resolvedDealId,
    dealId: resolvedDealId, // compat
    title,

    pipeline_label: toStringValue(row?.pipeline_label) ?? null,
    training_address: toStringValue(row?.training_address) ?? null,

    sede_label: toStringValue(row?.sede_label) ?? null,
    caes_label: toStringValue(row?.caes_label) ?? null,
    fundae_label: toStringValue(row?.fundae_label) ?? null,
    hotel_label: toStringValue(row?.hotel_label) ?? null,

    hours: toNumber(row?.hours) ?? null,
    alumnos: toNumber(row?.alumnos) ?? null,

    organization: organization ?? null,
    person: person ?? null,
  };

  if (productsInfo.products) summary.products = productsInfo.products;
  if (productsInfo.productNames)
    summary.productNames = productsInfo.productNames;

  return summary;
}

function normalizeDealDetail(raw: Json): DealDetail {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_DEAL_DETAIL", "Detalle del presupuesto no disponible");
  }

  const detailId = toStringValue(raw.deal_id ?? raw.id ?? raw.dealId);
  if (!detailId) {
    throw new ApiError("INVALID_DEAL_DETAIL", "Detalle del presupuesto no disponible");
  }

  const detail: DealDetail = {
    deal_id: detailId,
    title: toStringValue(raw.title ?? raw.deal_title) ?? null,

    pipeline_label: toStringValue(raw.pipeline_label) ?? null,
    training_address:
      toStringValue(raw.training_address) ?? null,

    sede_label: toStringValue(raw.sede_label) ?? null,
    caes_label: toStringValue(raw.caes_label) ?? null,
    fundae_label: toStringValue(raw.fundae_label) ?? null,
    hotel_label: toStringValue(raw.hotel_label) ?? null,
    transporte:
      toStringValue(raw.transporte) === null
        ? null
        : (toStringValue(raw.transporte) as "Si" | "Sí" | "No"),
    po: toStringValue(raw.po) ?? null,

    hours: toNumber(raw.hours) ?? null,
    alumnos: toNumber(raw.alumnos) ?? null,

    organization: null,
    person: null,

    products: [],
    notes: [],
    documents: [],
  };

  // Organización
  const rawOrg = raw.organization ?? raw.organizations ?? null;
  if (rawOrg && (rawOrg.name || rawOrg.org_id)) {
    detail.organization = {
      name: toStringValue(rawOrg.name) ?? null,
      org_id: toStringValue(rawOrg.org_id) ?? null,
    };
  }

  // Persona
  const rawPerson = raw.person ?? null;
  if (rawPerson && (rawPerson.first_name || rawPerson.last_name)) {
    detail.person = {
      person_id: rawPerson.person_id ?? null,
      first_name: toStringValue(rawPerson.first_name) ?? null,
      last_name: toStringValue(rawPerson.last_name) ?? null,
      email: toStringValue(rawPerson.email) ?? null,
      phone: toStringValue(rawPerson.phone) ?? null,
    };
  }

  // Productos
  const productsInfo = normalizeProducts(raw.products ?? raw.deal_products);
  detail.products = productsInfo.products ?? [];

  // Notas
  if (Array.isArray(raw.notes ?? raw.deal_notes)) {
    const arr = (raw.notes ?? raw.deal_notes) as any[];
    detail.notes = arr.map((note) => ({
      id: note.id ?? null,
      deal_id: note.deal_id ?? null,
      content: toStringValue(note.content) ?? null,
      author: toStringValue(note.author) ?? null,
      created_at: toStringValue(note.created_at) ?? null,
    }));
  }

  // Documentos
  if (Array.isArray(raw.documents)) {
    detail.documents = (raw.documents as any[]).map((doc) => normalizeDealDocument(doc));
  }

  return detail;
}

function normalizeDealNote(raw: Json): DealNote {
  const id = toStringValue(raw?.id ?? raw?.note_id ?? null);
  const deal_id = toStringValue(raw?.deal_id ?? null);
  const contentValue = toStringValue(raw?.content ?? null);
  const author = toStringValue(raw?.author ?? null);
  const created_at = toStringValue(raw?.created_at ?? null);

  return {
    id: id ?? (raw?.id != null ? String(raw.id) : null),
    deal_id,
    content: contentValue ?? (raw?.content != null ? String(raw.content) : ""),
    author,
    created_at,
  };
}

function normalizeDealDocument(raw: any): DealDocument {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : "");
  const name =
    toStringValue(raw?.name) ??
    toStringValue(raw?.file_name) ??
    (raw?.name != null ? String(raw.name) : "Documento");
  const mime = toStringValue(raw?.mime_type ?? raw?.file_type);
  const size = raw?.size ?? raw?.file_size;
  const normalizedSize = typeof size === "number" ? size : toNumber(size);
  const rawUrl =
    toStringValue(raw?.url) ??
    toStringValue(isHttpUrl(raw?.file_url) ? raw?.file_url : null);
  const sourceValue = toStringValue(raw?.source);
  const source =
    sourceValue === "S3" || sourceValue === "PIPEDRIVE"
      ? sourceValue
      : isHttpUrl(rawUrl)
      ? "PIPEDRIVE"
      : "S3";

  return {
    id: id || (raw?.id != null ? String(raw.id) : ""),
    source,
    name: name && name.length ? name : "Documento",
    mime_type: mime,
    size: normalizedSize ?? null,
    url: rawUrl ?? null,
    created_at: toStringValue(raw?.created_at ?? raw?.added_at),
  };
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function normalizeResourceConflictDetail(raw: any): ResourceConflictDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const sessionId = toStringValue(raw.session_id ?? raw.sessionId) ?? "";
  const dealId = toStringValue(raw.deal_id ?? raw.dealId) ?? "";
  const dealTitle = toStringValue(raw.deal_title ?? raw.dealTitle);
  const organization = toStringValue(raw.organization_name ?? raw.organizationName);
  const productCode = toStringValue(raw.product_code ?? raw.productCode);
  const productName = toStringValue(raw.product_name ?? raw.productName);
  const inicio = toStringValue(raw.inicio ?? raw.start_at ?? raw.startAt);
  const fin = toStringValue(raw.fin ?? raw.end_at ?? raw.endAt);

  return {
    session_id: sessionId,
    deal_id: dealId,
    deal_title: dealTitle ?? null,
    organization_name: organization ?? null,
    product_code: productCode ?? null,
    product_name: productName ?? null,
    inicio: inicio ?? null,
    fin: fin ?? null,
  };
}

function normalizeResourceAvailability(raw: any): ResourceAvailability | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const conflictsRaw = Array.isArray(raw.conflicts) ? raw.conflicts : [];
  const conflicts = conflictsRaw
    .map((entry) => normalizeResourceConflictDetail(entry))
    .filter((entry): entry is ResourceConflictDetail => entry !== null);
  const busyFlag =
    raw.isBusy !== undefined
      ? Boolean(raw.isBusy)
      : raw.is_busy !== undefined
      ? Boolean(raw.is_busy)
      : undefined;

  const isBusy = busyFlag !== undefined ? busyFlag : conflicts.length > 0;
  return { isBusy, conflicts };
}

function normalizeRoomWithAvailability(raw: any): Room {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formato de sala no válido");
  }

  const createdAt =
    raw.created_at instanceof Date
      ? raw.created_at.toISOString()
      : toStringValue(raw.created_at ?? raw.createdAt);
  const updatedAt =
    raw.updated_at instanceof Date
      ? raw.updated_at.toISOString()
      : toStringValue(raw.updated_at ?? raw.updatedAt);

  return {
    sala_id: toStringValue(raw.sala_id ?? raw.id) ?? "",
    name: toStringValue(raw.name) ?? "",
    sede: toStringValue(raw.sede),
    created_at: createdAt ?? null,
    updated_at: updatedAt ?? null,
    availability: normalizeResourceAvailability(raw.availability),
  };
}

function normalizeTrainerWithAvailability(raw: any): Trainer {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formato de formador no válido");
  }

  const sedeArray = Array.isArray(raw.sede)
    ? sanitizeStringArray(raw.sede)
    : sanitizeStringArray(raw.sede?.values ?? []);

  return {
    trainer_id: toStringValue(raw.trainer_id ?? raw.id) ?? "",
    name: toStringValue(raw.name) ?? "",
    apellido: toStringValue(raw.apellido ?? raw.last_name ?? raw.surname),
    email: toStringValue(raw.email),
    phone: toStringValue(raw.phone),
    dni: toStringValue(raw.dni),
    direccion: toStringValue(raw.direccion ?? raw.address),
    especialidad: toStringValue(raw.especialidad ?? raw.specialidad ?? raw.specialty),
    titulacion: toStringValue(raw.titulacion ?? raw.degree),
    activo: Boolean(
      raw.activo ??
        raw.active ??
        raw.is_active ??
        raw.trainer?.activo ??
        raw.trainer?.active ??
        true,
    ),
    sede: sedeArray,
    created_at: toStringValue(raw.created_at ?? raw.createdAt),
    updated_at: toStringValue(raw.updated_at ?? raw.updatedAt),
    availability: normalizeResourceAvailability(raw.availability),
  };
}

function normalizeMobileUnitWithAvailability(raw: any): MobileUnit {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formato de unidad móvil no válido");
  }

  return {
    unidad_id: toStringValue(raw.unidad_id ?? raw.id) ?? "",
    name: toStringValue(raw.name ?? raw.unidad?.name) ?? "",
    matricula: toStringValue(raw.matricula ?? raw.unidad?.matricula) ?? "",
    tipo: sanitizeStringArray(raw.tipo ?? raw.unidad?.tipo),
    sede: sanitizeStringArray(raw.sede ?? raw.unidad?.sede),
    created_at: toStringValue(raw.created_at ?? raw.createdAt),
    updated_at: toStringValue(raw.updated_at ?? raw.updatedAt),
    availability: normalizeResourceAvailability(raw.availability),
  };
}

function normalizeDealSession(raw: any): DealSession {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formato de sesión no válido");
  }

  const sessionId = toStringValue(raw.session_id ?? raw.sessionId ?? raw.id);
  if (!sessionId) {
    throw new ApiError("INVALID_RESPONSE", "Sesión sin identificador");
  }

  const trainersRaw = Array.isArray(raw.formadores ?? raw.trainers)
    ? (raw.formadores ?? raw.trainers)
    : [];
  const mobileUnitsRaw = Array.isArray(raw.unidades_moviles ?? raw.mobile_units)
    ? (raw.unidades_moviles ?? raw.mobile_units)
    : [];

  const formadores = trainersRaw
    .map((entry: any) => {
      const trainerId = toStringValue(entry?.trainer_id ?? entry?.id);
      if (!trainerId) return null;
      return {
        trainer_id: trainerId,
        name: toStringValue(entry?.name ?? entry?.trainer?.name) ?? null,
        activo: Boolean(
          entry?.activo ??
            entry?.active ??
            entry?.trainer?.activo ??
            entry?.trainer?.active ??
            true,
        ),
      };
    })
    .filter((entry): entry is DealSession["formadores"][number] => entry !== null);

  const unidades_moviles = mobileUnitsRaw
    .map((entry: any) => {
      const unidadId = toStringValue(entry?.unidad_id ?? entry?.id);
      if (!unidadId) return null;
      return {
        unidad_id: unidadId,
        name: toStringValue(entry?.name ?? entry?.unidad?.name) ?? null,
        matricula: toStringValue(entry?.matricula ?? entry?.unidad?.matricula) ?? null,
        tipo: sanitizeStringArray(entry?.tipo ?? entry?.unidad?.tipo),
        sede: sanitizeStringArray(entry?.sede ?? entry?.unidad?.sede),
      };
    })
    .filter((entry): entry is DealSession["unidades_moviles"][number] => entry !== null);

  const salaRaw = raw.sala ?? raw.room ?? null;
  const sala =
    salaRaw && typeof salaRaw === "object"
      ? {
          sala_id: toStringValue(salaRaw.sala_id ?? salaRaw.id) ?? "",
          name: toStringValue(salaRaw.name) ?? null,
          sede: toStringValue(salaRaw.sede),
        }
      : null;

  const dealProduct = raw.deal_product ?? raw.product ?? null;

  return {
    session_id: sessionId,
    deal_id: toStringValue(raw.deal_id ?? raw.dealId) ?? "",
    deal_product_id: toStringValue(raw.deal_product_id ?? raw.dealProductId),
    deal_product: dealProduct
      ? {
          id: toStringValue(dealProduct.id),
          code: toStringValue(dealProduct.code),
          hours:
            typeof dealProduct.hours === "number"
              ? dealProduct.hours
              : toNumber(dealProduct.hours),
        }
      : null,
    inicio: toStringValue(raw.inicio ?? raw.start_at ?? raw.startAt),
    fin: toStringValue(raw.fin ?? raw.end_at ?? raw.endAt),
    sala_id: toStringValue(raw.sala_id ?? raw.salaId),
    sala,
    formadores,
    unidades_moviles,
    direccion: toStringValue(raw.direccion ?? raw.address),
    sede: toStringValue(raw.sede),
    comentarios: toStringValue(raw.comentarios ?? raw.comments),
    estado: toStringValue(raw.estado ?? raw.status),
    origen:
      raw.origen && typeof raw.origen === "object"
        ? {
            deal_product_id: toStringValue(raw.origen.deal_product_id ?? raw.origen.dealProductId),
            code: toStringValue(raw.origen.code),
          }
        : null,
    created_at: toStringValue(raw.created_at ?? raw.createdAt),
    updated_at: toStringValue(raw.updated_at ?? raw.updatedAt),
  };
}

function normalizeResourceConflictSummary(raw: any): ResourceConflictSummary | null {
  if (!raw || typeof raw !== "object") return null;

  const resourceTypeRaw = toStringValue(raw.resource_type ?? raw.type ?? raw.resourceType);
  const resourceId = toStringValue(raw.resource_id ?? raw.id ?? raw.resourceId);
  if (!resourceTypeRaw || !resourceId) return null;

  const normalizedType =
    resourceTypeRaw === "trainer"
      ? "formador"
      : resourceTypeRaw === "mobile_unit"
      ? "unidad_movil"
      : (resourceTypeRaw as ResourceConflictSummary["resource_type"]);

  const conflictsRaw = Array.isArray(raw.conflicts) ? raw.conflicts : [];
  const conflicts = conflictsRaw
    .map((entry) => normalizeResourceConflictDetail(entry))
    .filter((entry): entry is ResourceConflictDetail => entry !== null);

  return {
    resource_type: normalizedType,
    resource_id: resourceId,
    resource_label: toStringValue(raw.resource_label ?? raw.label) ?? null,
    conflicts,
  };
}

export function normalizeConflictSummaries(raw: unknown): ResourceConflictSummary[] {
  if (!raw) return [];
  const entries = Array.isArray((raw as any)?.conflicts)
    ? (raw as any).conflicts
    : Array.isArray(raw)
    ? (raw as any)
    : [];
  return entries
    .map((entry) => normalizeResourceConflictSummary(entry))
    .filter((entry): entry is ResourceConflictSummary => entry !== null);
}

type AvailabilityQuery = {
  start?: string | null;
  end?: string | null;
  excludeSessionId?: string | null;
};

function buildAvailabilityQuery(params: AvailabilityQuery = {}): string {
  const searchParams = new URLSearchParams();
  if (params.start) searchParams.set("start", params.start);
  if (params.end) searchParams.set("end", params.end);
  if (params.excludeSessionId) {
    searchParams.set("excludeSessionId", params.excludeSessionId);
  }
  const query = searchParams.toString();
  return query.length ? `?${query}` : "";
}

/* =====================
 * Request helper (fetch)
 * ===================== */

async function request(path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`,
      {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      }
    );
  } catch (e: any) {
    throw new ApiError("NETWORK_ERROR", e?.message || "Fallo de red");
  }

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* puede no haber body */
  }

  if (!res.ok || data?.ok === false) {
    const code = data?.error_code || data?.code || `HTTP_${res.status}`;
    const msg = data?.message || "Error inesperado";
    const details = data?.conflicts ?? data?.details ?? null;
    throw new ApiError(code, msg, res.status, details);
  }
  return data;
}

/* ===============================
 * Listado / Detalle / Import deal
 * =============================== */

export async function fetchDealsWithoutSessions(): Promise<DealSummary[]> {
  const data = await request("/deals?noSessions=true");
  const rows: Json[] = Array.isArray(data?.deals) ? data.deals : [];
  return rows.map((row) => normalizeDealSummary(row));
}

export async function fetchDealDetail(dealId: number | string): Promise<DealDetail> {
  const data = await request(`/deals?dealId=${encodeURIComponent(String(dealId))}`);
  return normalizeDealDetail(data?.deal);
}

/** Resultado del import: warnings + detalle del deal ya persistido */
export type ImportDealResult = { warnings: string[]; deal: DealDetail };

export async function importDeal(dealId: string): Promise<ImportDealResult> {
  const data = await request("/deals/import", {
    method: "POST",
    body: JSON.stringify({ dealId }),
  });

  // El backend devuelve { ok, warnings, deal }
  const warnings: string[] = Array.isArray(data?.warnings) ? data.warnings : [];
  const deal: DealDetail = normalizeDealDetail(data?.deal ?? {});
  return { warnings, deal };
}

export async function deleteDeal(dealId: string): Promise<void> {
  const normalizedId = String(dealId ?? "").trim();
  if (!normalizedId) {
    throw new ApiError("VALIDATION_ERROR", "Falta dealId para eliminar el presupuesto");
  }

  await request(`/deals/${encodeURIComponent(normalizedId)}`, {
    method: "DELETE",
  });
}

/* =========================
 * PATCH (campos editables)
 * ========================= */

export type DealEditablePatch = {
  sede_label?: string | null;
  hours?: number | null;
  training_address?: string | null; // dirección de formación
  caes_label?: string | null;
  fundae_label?: string | null;
  hotel_label?: string | null;
  alumnos?: number | null;
};

export type DealProductEditablePatch = {
  id: string;
  hours?: number | null;
  comments?: string | null;
};

export async function patchDealEditable(
  dealId: string,
  dealPatch: Partial<DealEditablePatch>,
  user?: { id: string; name?: string },
  options?: { products?: DealProductEditablePatch[] }
): Promise<void> {
  const headers: Record<string, string> = {};
  if (user?.id) headers["X-User-Id"] = user.id;
  if (user?.name) headers["X-User-Name"] = user.name;

  const sanitizedDealPatch = dealPatch
    ? (Object.fromEntries(
        Object.entries(dealPatch).filter(([, value]) => value !== undefined)
      ) as Partial<DealEditablePatch>)
    : null;
  const hasDealPatch = !!sanitizedDealPatch && Object.keys(sanitizedDealPatch).length > 0;

  const sanitizedProductPatch: DealProductEditablePatch[] = Array.isArray(options?.products)
    ? options!.products
        .map((product) => {
          if (!product || typeof product !== "object") return null;
          const id = "id" in product ? String(product.id).trim() : "";
          if (!id) return null;

          const entry: DealProductEditablePatch = { id };
          if (Object.prototype.hasOwnProperty.call(product, "hours")) {
            entry.hours = product.hours ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(product, "comments")) {
            entry.comments = product.comments ?? null;
          }

          return Object.keys(entry).length > 1 ? entry : null;
        })
        .filter((entry): entry is DealProductEditablePatch => entry !== null)
    : [];

  if (!hasDealPatch && !sanitizedProductPatch.length) return;

  const body: Record<string, unknown> = {};
  if (hasDealPatch && sanitizedDealPatch) body.deal = sanitizedDealPatch;
  if (sanitizedProductPatch.length) body.products = sanitizedProductPatch;

  await request(`/deals/${encodeURIComponent(String(dealId))}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

/* ==============
 * Notas del deal
 * ============== */

export async function createDealNote(
  dealId: string,
  content: string,
  user?: { id: string; name?: string }
): Promise<DealNote> {
  const headers: Record<string, string> = {};
  if (user?.id) headers["X-User-Id"] = user.id;
  if (user?.name) headers["X-User-Name"] = user.name;

  const data = await request(`/deal_notes/${encodeURIComponent(String(dealId))}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content }),
  });

  return normalizeDealNote(data?.note ?? {});
}

export async function updateDealNote(
  dealId: string,
  noteId: string,
  content: string,
  user?: { id: string; name?: string }
): Promise<DealNote> {
  const headers: Record<string, string> = {};
  if (user?.id) headers["X-User-Id"] = user.id;
  if (user?.name) headers["X-User-Name"] = user.name;

  const data = await request(
    `/deal_notes/${encodeURIComponent(String(dealId))}/${encodeURIComponent(String(noteId))}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ content }),
    }
  );

  return normalizeDealNote(data?.note ?? {});
}

export async function deleteDealNote(
  dealId: string,
  noteId: string,
  user?: { id: string; name?: string }
): Promise<void> {
  const headers: Record<string, string> = {};
  if (user?.id) headers["X-User-Id"] = user.id;
  if (user?.name) headers["X-User-Name"] = user.name;

  await request(
    `/deal_notes/${encodeURIComponent(String(dealId))}/${encodeURIComponent(String(noteId))}`,
    {
      method: "DELETE",
      headers,
    }
  );
}

/* ======================
 * Documentos (S3/PDrive)
 * ====================== */

export async function listDocuments(dealId: string): Promise<DealDocument[]> {
  const data = await request(`/deal_documents/${encodeURIComponent(String(dealId))}`);
  const docs: any[] = Array.isArray(data?.documents) ? data.documents : [];
  return docs.map((doc) => normalizeDealDocument(doc));
}

export async function getDocPreviewUrl(
  dealId: string,
  docId: string
): Promise<{ url: string; name?: string | null; mime_type?: string | null }> {
  const data = await request(
    `/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}/url`
  );
  return {
    url: String(data?.url ?? ""),
    name: toStringValue(data?.name),
    mime_type: toStringValue(data?.mime_type),
  };
}

export async function getUploadUrl(
  dealId: string,
  file: File
): Promise<{ uploadUrl: string; storageKey: string }> {
  return await request(
    `/deal_documents/${encodeURIComponent(String(dealId))}/upload-url`,
    {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      }),
    }
  );
}

export async function createDocumentMeta(
  dealId: string,
  meta: { file_name: string; file_size: number; mime_type?: string; storage_key: string },
  user?: { id: string; name?: string }
): Promise<void> {
  const headers: Record<string, string> = {};
  if (user?.id) headers["X-User-Id"] = user.id;
  if (user?.name) headers["X-User-Name"] = user.name;

  await request(`/deal_documents/${encodeURIComponent(String(dealId))}`, {
    method: "POST",
    headers,
    body: JSON.stringify(meta),
  });
}

export async function deleteDocument(dealId: string, docId: string): Promise<void> {
  await request(
    `/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}`,
    { method: "DELETE" }
  );
}

/* =======================
 * ViewModel constructor
 * ======================= */

function resolveProducts(detail?: DealDetail | null, summary?: DealSummary | null): DealProduct[] {
  if (detail?.products?.length) return detail.products;
  if (summary?.products?.length) return summary.products;
  return [];
}

function resolveProductName(detail?: DealDetail | null, summary?: DealSummary | null): string | null {
  const products = resolveProducts(detail, summary);
  for (const p of products) {
    const label = pickNonEmptyString(p?.name ?? null, p?.code ?? null);
    if (label) return label;
  }
  if (Array.isArray(summary?.productNames)) {
    const label = pickNonEmptyString(...summary!.productNames);
    if (label) return label;
  }
  return null;
}

export function buildDealDetailViewModel(
  detail?: DealDetail | null,
  summary?: DealSummary | null
): DealDetailViewModel {
  const dealId = pickNonEmptyString(detail?.deal_id, summary?.deal_id, summary?.dealId);

  const title = pickNonEmptyString(detail?.title ?? null, summary?.title ?? null);
  const organizationName = pickNonEmptyString(
    detail?.organization?.name ?? null,
    summary?.organization?.name ?? null
  );
  const person = detail?.person ?? summary?.person ?? null;
  const clientName = buildPersonFullName(person ?? null);
  const clientEmail = pickNonEmptyString(person?.email ?? null);
  const clientPhone = pickNonEmptyString(person?.phone ?? null);

  const pipelineLabel = pickNonEmptyString(
    detail?.pipeline_label ?? null,
    summary?.pipeline_label ?? null
  );
  const trainingAddress = pickNonEmptyString(
    detail?.training_address ?? null,
    summary?.training_address ?? null
  );

  const productName = resolveProductName(detail ?? null, summary ?? null);

  const hours = detail?.hours ?? summary?.hours ?? null;
  const alumnos = detail?.alumnos ?? summary?.alumnos ?? null;

  const sedeLabel = pickNonEmptyString(detail?.sede_label ?? null, summary?.sede_label ?? null);
  const caesLabel = pickNonEmptyString(detail?.caes_label ?? null, summary?.caes_label ?? null);
  const fundaeLabel = pickNonEmptyString(detail?.fundae_label ?? null, summary?.fundae_label ?? null);
  const hotelLabel = pickNonEmptyString(detail?.hotel_label ?? null, summary?.hotel_label ?? null);

  return {
    dealId: dealId ?? "",
    title: title ?? null,
    organizationName: organizationName ?? null,
    clientName: clientName ?? null,
    clientEmail: clientEmail ?? null,
    clientPhone: clientPhone ?? null,
    pipelineLabel: pipelineLabel ?? null,
    trainingAddress: trainingAddress ?? null,
    productName: productName ?? null,
    hours,
    alumnos,
    sedeLabel: sedeLabel ?? null,
    caesLabel: caesLabel ?? null,
    fundaeLabel: fundaeLabel ?? null,
    hotelLabel: hotelLabel ?? null,
    extras: undefined,
    products: resolveProducts(detail, summary),
    notes: (detail?.notes ?? []).map((n) => ({
      id: n?.id ?? null,
      content: pickNonEmptyString(n?.content ?? null) ?? "",
      author: pickNonEmptyString(n?.author ?? null),
    })),
  };
}

/* ===============================
 * Sesiones y disponibilidad
 * =============================== */

export async function fetchDealSessions(dealId: string): Promise<DealSession[]> {
  const normalizedId = String(dealId ?? "").trim();
  if (!normalizedId.length) {
    throw new ApiError("VALIDATION_ERROR", "dealId requerido para obtener sesiones");
  }

  const data = await request(
    `/deal-sessions?dealId=${encodeURIComponent(normalizedId)}&expand=resources`
  );
  const rows: any[] = Array.isArray(data?.sessions) ? data.sessions : [];
  return rows.map((row) => normalizeDealSession(row));
}

export async function updateDealSession(
  sessionId: string,
  payload: DealSessionUpdatePayload
): Promise<DealSession> {
  const normalizedId = String(sessionId ?? "").trim();
  if (!normalizedId.length) {
    throw new ApiError("VALIDATION_ERROR", "sessionId requerido para actualizar la sesión");
  }

  const body: Record<string, unknown> = { expand: "resources" };
  if (Object.prototype.hasOwnProperty.call(payload, "inicio")) {
    body.inicio = payload.inicio;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "fin")) {
    body.fin = payload.fin;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "sala_id")) {
    body.sala_id = payload.sala_id;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "formadores")) {
    body.formadores = payload.formadores;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "unidades_moviles")) {
    body.unidades_moviles = payload.unidades_moviles;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "direccion")) {
    body.direccion = payload.direccion;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "sede")) {
    body.sede = payload.sede;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "comentarios")) {
    body.comentarios = payload.comentarios;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "estado")) {
    body.estado = payload.estado;
  }

  const data = await request(`/deal-sessions/${encodeURIComponent(normalizedId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  return normalizeDealSession(data?.session ?? {});
}

export async function fetchRoomsAvailability(
  params: AvailabilityQuery = {}
): Promise<Room[]> {
  const query = buildAvailabilityQuery(params);
  const data = await request(`/rooms${query}`);
  const rows: any[] = Array.isArray(data?.rooms) ? data.rooms : [];
  return rows.map((row) => normalizeRoomWithAvailability(row));
}

export async function fetchTrainersAvailability(
  params: AvailabilityQuery = {}
): Promise<Trainer[]> {
  const query = buildAvailabilityQuery(params);
  const data = await request(`/trainers${query}`);
  const rows: any[] = Array.isArray(data?.trainers) ? data.trainers : [];
  return rows.map((row) => normalizeTrainerWithAvailability(row));
}

export async function fetchMobileUnitsAvailability(
  params: AvailabilityQuery = {}
): Promise<MobileUnit[]> {
  const query = buildAvailabilityQuery(params);
  const data = await request(`/mobile-units${query}`);
  const rows: any[] = Array.isArray(data?.mobileUnits) ? data.mobileUnits : [];
  return rows.map((row) => normalizeMobileUnitWithAvailability(row));
}
