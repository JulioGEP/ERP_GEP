// frontend/src/features/presupuestos/api.ts
import type {
  DealDetail,
  DealDetailViewModel,
  DealProduct,
  DealSummary,
  DealDocument,
  DealNote,
  DealSession,
  DealSessionStatus,
} from "../../types/deal";
export type { DealSessionStatus } from "../../types/deal";
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

const SESSION_STATUS_VALUES: DealSessionStatus[] = [
  "BORRADOR",
  "PLANIFICADA",
  "SUSPENDIDO",
  "CANCELADO",
];

function normalizeSessionStatus(value: unknown): DealSessionStatus {
  if (typeof value !== "string") return "BORRADOR";
  const normalized = value.trim().toUpperCase();
  return SESSION_STATUS_VALUES.includes(normalized as DealSessionStatus)
    ? (normalized as DealSessionStatus)
    : "BORRADOR";
}

function normalizeIdArray(value: unknown): string[] {
  if (!value) return [];
  const addUnique = (acc: string[], entry: unknown) => {
    const str = typeof entry === "string" ? entry.trim() : String(entry ?? "").trim();
    if (str.length && !acc.includes(str)) acc.push(str);
    return acc;
  };

  if (Array.isArray(value)) {
    return value.reduce<string[]>((acc, entry) => addUnique(acc, entry), []);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.reduce<string[]>((acc, entry) => addUnique(acc, entry), []);
      }
    } catch {
      // fallback to comma-separated values
    }
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length)
      .reduce<string[]>((acc, entry) => addUnique(acc, entry), []);
  }

  return [];
}

function cleanIdArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of values) {
    const str = typeof entry === "string" ? entry.trim() : String(entry ?? "").trim();
    if (!str.length || seen.has(str)) continue;
    seen.add(str);
    result.push(str);
  }

  return result;
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

function normalizeDealSession(raw: any): DealSession {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Sesión no válida");
  }

  const id = toStringValue((raw as any).seasson_id ?? (raw as any).id) ?? "";
  const dealId =
    toStringValue((raw as any).deal_id ?? (raw as any).dealId ?? (raw as any).deal) ?? "";

  const start = toStringValue((raw as any).date_start ?? (raw as any).start ?? null);
  const end = toStringValue((raw as any).date_end ?? (raw as any).end ?? null);
  const sede = toStringValue((raw as any).sede ?? null);
  const address = toStringValue((raw as any).seasson_address ?? (raw as any).address ?? null);
  const roomId = toStringValue((raw as any).room_id ?? (raw as any).roomId ?? null);
  const comment = toStringValue((raw as any).comment_seasson ?? (raw as any).comment ?? null);
  const dealProduct = (raw as any).deal_product ?? (raw as any).dealProduct ?? null;
  const origin = (raw as any).origen ?? (raw as any).origin ?? null;
  const dealProductId =
    toStringValue((raw as any).deal_product_id ?? dealProduct?.id ?? origin?.deal_product_id) ?? null;
  const dealProductCode =
    toStringValue(dealProduct?.code ?? origin?.code ?? origin ?? null) ?? null;
  const hoursRaw =
    dealProduct?.hours ?? (raw as any).deal_product_hours ?? (raw as any).hours ?? null;
  const dealProductHours = typeof hoursRaw === "number" ? hoursRaw : toNumber(hoursRaw);
  const isEmptyRaw = (raw as any).is_empty ?? (raw as any).isEmpty;
  const isExceedingRaw =
    (raw as any).is_exceeding_quantity ?? (raw as any).isExceedingQuantity ?? (raw as any).exceeds_quantity;

  return {
    id,
    dealId,
    status: normalizeSessionStatus((raw as any).status),
    start,
    end,
    sede,
    address,
    roomId,
    trainerIds: normalizeIdArray((raw as any).seasson_fireman ?? (raw as any).trainerIds),
    mobileUnitIds: normalizeIdArray((raw as any).seasson_vehicle ?? (raw as any).mobileUnitIds),
    comment,
    dealProductId,
    dealProductCode,
    dealProductHours:
      typeof dealProductHours === "number" && Number.isFinite(dealProductHours)
        ? dealProductHours
        : null,
    isEmpty: Boolean(isEmptyRaw),
    isExceedingQuantity: Boolean(isExceedingRaw),
    createdAt: toStringValue((raw as any).created_at ?? null),
    updatedAt: toStringValue((raw as any).updated_at ?? null),
  };
}

type DealSessionResourceTrainer = {
  trainer_id: string;
  name: string | null;
  activo: boolean;
};

type DealSessionResourceMobileUnit = {
  unidad_id: string;
  name: string | null;
  matricula: string | null;
  tipo: string[];
  sede: string[];
};

type DealSessionResourceRoom = {
  sala_id: string;
  name: string | null;
  sede: string | null;
};

export type DealSessionResource = {
  session_id: string;
  deal_id: string;
  deal_product_id: string | null;
  deal_product: { id: string; code: string | null; hours: number | null } | null;
  inicio: string | null;
  fin: string | null;
  sala_id: string | null;
  sala: DealSessionResourceRoom | null;
  formadores: DealSessionResourceTrainer[];
  unidades_moviles: DealSessionResourceMobileUnit[];
  direccion: string | null;
  sede: string | null;
  comentarios: string | null;
  estado: string | null;
  origen: { deal_product_id: string | null; code: string | null } | null;
  created_at: string | null;
  updated_at: string | null;
  is_exceeding_quantity: boolean;
};

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => toStringValue(entry))
      .filter((entry): entry is string => entry !== null);
  }
  const parsed = toStringValue(value);
  if (!parsed) return [];
  try {
    const json = JSON.parse(parsed);
    if (Array.isArray(json)) {
      return json
        .map((entry) => toStringValue(entry))
        .filter((entry): entry is string => entry !== null);
    }
  } catch {
    /* ignore */
  }
  return parsed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length);
}

function normalizeDealSessionResourceTrainer(raw: any): DealSessionResourceTrainer | null {
  const trainerId = toStringValue(raw?.trainer_id ?? raw?.trainerId);
  if (!trainerId) return null;
  return {
    trainer_id: trainerId,
    name: toStringValue(raw?.name ?? raw?.trainer?.name) ?? null,
    activo: Boolean(raw?.activo ?? raw?.trainer?.activo ?? false),
  };
}

function normalizeDealSessionResourceMobileUnit(
  raw: any
): DealSessionResourceMobileUnit | null {
  const unitId = toStringValue(raw?.unidad_id ?? raw?.unidadId);
  if (!unitId) return null;
  const unit = raw?.unidad ?? raw;
  return {
    unidad_id: unitId,
    name: toStringValue(unit?.name) ?? null,
    matricula: toStringValue(unit?.matricula) ?? null,
    tipo: toStringArray(unit?.tipo),
    sede: toStringArray(unit?.sede),
  };
}

function normalizeDealSessionResourceRoom(raw: any): DealSessionResourceRoom | null {
  const roomId = toStringValue(raw?.sala_id ?? raw?.room_id ?? raw?.salaId);
  if (!roomId) return null;
  return {
    sala_id: roomId,
    name: toStringValue(raw?.name) ?? null,
    sede: toStringValue(raw?.sede) ?? null,
  };
}

function normalizeDealSessionResource(raw: any): DealSessionResource {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Sesión no válida");
  }

  const sessionId =
    toStringValue(raw?.session_id ?? raw?.seasson_id ?? raw?.id) ?? "";
  const dealId =
    toStringValue(raw?.deal_id ?? raw?.dealId ?? raw?.deal) ?? "";

  if (!sessionId || !dealId) {
    throw new ApiError("INVALID_RESPONSE", "Sesión no válida");
  }

  const trainers: DealSessionResourceTrainer[] = Array.isArray(raw?.formadores)
    ? raw.formadores
        .map((entry: any) => normalizeDealSessionResourceTrainer(entry))
        .filter((entry): entry is DealSessionResourceTrainer => entry !== null)
    : [];

  const mobileUnits: DealSessionResourceMobileUnit[] = Array.isArray(
    raw?.unidades_moviles
  )
    ? raw.unidades_moviles
        .map((entry: any) => normalizeDealSessionResourceMobileUnit(entry))
        .filter((entry): entry is DealSessionResourceMobileUnit => entry !== null)
    : [];

  const room = normalizeDealSessionResourceRoom(raw?.sala ?? null);

  let dealProduct: DealSessionResource["deal_product"] = null;
  if (raw?.deal_product && typeof raw.deal_product === "object") {
    const productId = toStringValue(raw.deal_product.id);
    dealProduct = {
      id: productId ?? (raw.deal_product.id != null ? String(raw.deal_product.id) : ""),
      code: toStringValue(raw.deal_product.code) ?? null,
      hours: toNumber(raw.deal_product.hours),
    };
  }

  const origin = raw?.origen && typeof raw.origen === "object"
    ? {
        deal_product_id:
          toStringValue(raw.origen.deal_product_id ?? raw.origen.dealProductId) ?? null,
        code: toStringValue(raw.origen.code) ?? null,
      }
    : null;

  const isExceedingRaw =
    raw?.is_exceeding_quantity ?? raw?.isExceedingQuantity ?? raw?.exceeds_quantity;

  return {
    session_id: sessionId,
    deal_id: dealId,
    deal_product_id: toStringValue(raw?.deal_product_id) ?? null,
    deal_product: dealProduct,
    inicio: toStringValue(raw?.inicio ?? raw?.date_start) ?? null,
    fin: toStringValue(raw?.fin ?? raw?.date_end) ?? null,
    sala_id: toStringValue(raw?.sala_id ?? raw?.room_id) ?? null,
    sala: room,
    formadores: trainers,
    unidades_moviles: mobileUnits,
    direccion: toStringValue(raw?.direccion ?? raw?.seasson_address) ?? null,
    sede: toStringValue(raw?.sede) ?? null,
    comentarios: toStringValue(raw?.comentarios ?? raw?.comment_seasson) ?? null,
    estado: toStringValue(raw?.estado ?? raw?.status) ?? null,
    origen: origin,
    created_at: toStringValue(raw?.created_at) ?? null,
    updated_at: toStringValue(raw?.updated_at) ?? null,
    is_exceeding_quantity: Boolean(isExceedingRaw),
  };
}

function normalizeConflictDetail(raw: any): ResourceConflictDetail | null {
  const sessionId = toStringValue(raw?.session_id ?? raw?.sessionId);
  const dealId = toStringValue(raw?.deal_id ?? raw?.dealId);
  if (!sessionId || !dealId) return null;

  return {
    session_id: sessionId,
    deal_id: dealId,
    deal_title: toStringValue(raw?.deal_title ?? raw?.dealTitle) ?? null,
    organization_name:
      toStringValue(raw?.organization_name ?? raw?.organizationName) ?? null,
    product_code: toStringValue(raw?.product_code ?? raw?.productCode) ?? null,
    product_name: toStringValue(raw?.product_name ?? raw?.productName) ?? null,
    inicio: toStringValue(raw?.inicio ?? raw?.start) ?? null,
    fin: toStringValue(raw?.fin ?? raw?.end) ?? null,
  };
}

function normalizeConflictSummary(raw: any): ResourceConflictSummary | null {
  const typeValue = toStringValue(raw?.resource_type ?? raw?.resourceType);
  const id = toStringValue(raw?.resource_id ?? raw?.resourceId);
  if (!typeValue || !id) return null;

  const normalizedType =
    typeValue === "sala"
      ? "sala"
      : typeValue === "formador"
      ? "formador"
      : typeValue === "unidad_movil" || typeValue === "unidad-movil"
      ? "unidad_movil"
      : null;
  if (!normalizedType) return null;

  const conflictsRaw = Array.isArray(raw?.conflicts) ? raw.conflicts : [];
  const conflicts = conflictsRaw
    .map((entry: any) => normalizeConflictDetail(entry))
    .filter((entry): entry is ResourceConflictDetail => entry !== null);

  return {
    resource_type: normalizedType,
    resource_id: id,
    resource_label: toStringValue(raw?.resource_label ?? raw?.resourceLabel) ?? null,
    conflicts,
  };
}

export function normalizeConflictSummaries(raw: unknown): ResourceConflictSummary[] {
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.conflicts)
    ? ((raw as any).conflicts as unknown[])
    : [];

  return entries
    .map((entry) => normalizeConflictSummary(entry))
    .filter((entry): entry is ResourceConflictSummary => entry !== null);
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
 * Sesiones del deal
 * ====================== */

export type DealSessionsSyncResult = {
  created: number;
  deleted: number;
  flagged: string[];
  total: number;
};

function buildSessionUpdateBody(payload: DealSessionUpdatePayload) {
  const body: Record<string, unknown> = { expand: 'resources' };

  if (Object.prototype.hasOwnProperty.call(payload, 'estado')) {
    body.estado = payload.estado ? normalizeSessionStatus(payload.estado) : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'inicio')) {
    body.inicio = payload.inicio ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'fin')) {
    body.fin = payload.fin ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sala_id')) {
    body.sala_id = payload.sala_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'formadores')) {
    body.formadores = Array.isArray(payload.formadores) ? payload.formadores : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'unidades_moviles')) {
    body.unidades_moviles = Array.isArray(payload.unidades_moviles)
      ? payload.unidades_moviles
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'direccion')) {
    body.direccion = payload.direccion ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sede')) {
    body.sede = payload.sede ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'comentarios')) {
    body.comentarios = payload.comentarios ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'deal_product_id')) {
    body.deal_product_id = payload.deal_product_id ?? null;
  }

  return body;
}

export async function fetchDealSessions(dealId: string): Promise<DealSession[]> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId.length) {
    throw new ApiError('VALIDATION_ERROR', 'dealId requerido para obtener sesiones');
  }

  const data = await request(
    `/deal-sessions?dealId=${encodeURIComponent(normalizedId)}&expand=resources`
  );
  const rows: any[] = Array.isArray(data?.sessions) ? data.sessions : [];
  return rows.map((row) => normalizeDealSession(row));
}

export async function bootstrapDealSessions(
  dealId: string
): Promise<{ created: number }> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId.length) {
    throw new ApiError('VALIDATION_ERROR', 'dealId requerido para crear sesiones');
  }

  const data = await request(
    `/deal-sessions/bootstrap?dealId=${encodeURIComponent(normalizedId)}`,
    {
      method: 'POST',
    }
  );

  return {
    created: Number.isFinite(Number(data?.created)) ? Number(data.created) : 0,
  };
}

export async function createDealSession(
  dealId: string,
  payload: DealSessionUpdatePayload
): Promise<DealSession> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId.length) {
    throw new ApiError('VALIDATION_ERROR', 'dealId requerido para crear sesión');
  }

  const body = {
    dealId: normalizedId,
    ...buildSessionUpdateBody(payload),
  };

  const data = await request(`/deal-sessions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return normalizeDealSession(data?.session ?? {});
}

export async function updateDealSession(
  sessionId: string,
  payload: DealSessionUpdatePayload
): Promise<DealSession> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId.length) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId requerido para actualizar la sesión');
  }

  const body = buildSessionUpdateBody(payload);

  const data = await request(`/deal-sessions/${encodeURIComponent(normalizedId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

  return normalizeDealSession(data?.session ?? {});
}

export async function deleteDealSession(sessionId: string): Promise<void> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId.length) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId requerido para eliminar');
  }

  await request(`/deal-sessions/${encodeURIComponent(normalizedId)}`, {
    method: 'DELETE',
  });
}

export async function syncDealSessions(dealId: string): Promise<DealSessionsSyncResult> {
  const normalizedDealId = toStringValue(dealId);
  if (!normalizedDealId) {
    throw new ApiError("VALIDATION_ERROR", "dealId requerido para sincronizar sesiones");
  }

  const data = await request(`/deal-sessions/sync`, {
    method: "POST",
    body: JSON.stringify({ dealId: normalizedDealId }),
  });

  const flaggedRaw = Array.isArray(data?.flagged)
    ? data.flagged
    : Array.isArray(data?.flaggedSessions)
    ? data.flaggedSessions
    : [];

  return {
    created: Number.isFinite(Number(data?.created)) ? Number(data.created) : 0,
    deleted: Number.isFinite(Number(data?.deleted)) ? Number(data.deleted) : 0,
    flagged: flaggedRaw.map((id: any) => String(id)).filter((id) => id.length > 0),
    total: Number.isFinite(Number(data?.total)) ? Number(data.total) : 0,
  };
}

export type AdjustDealSessionsResult = {
  created: number;
  exceeding_session_ids: string[];
  exceeding_count: number;
};

export async function adjustDealSessions(
  dealId: string
): Promise<AdjustDealSessionsResult> {
  const normalizedDealId = toStringValue(dealId);
  if (!normalizedDealId) {
    throw new ApiError("VALIDATION_ERROR", "dealId requerido para ajustar sesiones");
  }

  const data = await request(
    `/deal-sessions/adjust?dealId=${encodeURIComponent(normalizedDealId)}`,
    { method: "POST" }
  );

  const exceedingRaw = Array.isArray(data?.exceeding_session_ids)
    ? data.exceeding_session_ids
    : [];

  const exceedingIds = exceedingRaw
    .map((id: unknown) => toStringValue(id))
    .filter((id): id is string => !!id && id.length > 0);

  const exceedingCount = Number.isFinite(Number(data?.exceeding_count))
    ? Number(data.exceeding_count)
    : exceedingIds.length;

  return {
    created: Number.isFinite(Number(data?.created)) ? Number(data.created) : 0,
    exceeding_session_ids: exceedingIds,
    exceeding_count: exceedingCount,
  };
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

/* =============================================
 * Sesiones con recursos (planificador)
 * ============================================= */

export type DealSessionUpdatePayload = {
  inicio?: string | null;
  fin?: string | null;
  sala_id?: string | null;
  formadores?: string[];
  unidades_moviles?: string[];
  direccion?: string | null;
  sede?: string | null;
  comentarios?: string | null;
  estado?: string | null;
};

export async function fetchDealSessionsWithResources(
  dealId: string
): Promise<DealSessionResource[]> {
  const normalizedId = String(dealId ?? "").trim();
  if (!normalizedId.length) {
    throw new ApiError("VALIDATION_ERROR", "dealId requerido para obtener sesiones");
  }

  const data = await request(
    `/deal-sessions?dealId=${encodeURIComponent(normalizedId)}&expand=resources`
  );
  const rows: any[] = Array.isArray(data?.sessions) ? data.sessions : [];
  return rows.map((row) => normalizeDealSessionResource(row));
}

export async function updateDealSessionWithResources(
  sessionId: string,
  payload: DealSessionUpdatePayload
): Promise<DealSessionResource> {
  const normalizedId = String(sessionId ?? "").trim();
  if (!normalizedId.length) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "sessionId requerido para actualizar la sesión"
    );
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

  return normalizeDealSessionResource(data?.session ?? {});
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
