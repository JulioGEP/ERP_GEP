// frontend/src/features/presupuestos/api.ts
import type {
  DealDetail,
  DealDetailViewModel,
  DealProduct,
  DealSummary,
  DealDocument,
  DealNote,
  DealSession,
  DealSessionMobileUnit,
  DealSessionProduct,
  DealSessionRoom,
  DealSessionStatus,
  DealSessionTrainer,
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

type AvailabilityQuery = {
  start?: string;
  end?: string;
  excludeSessionId?: string;
};

function normalizeResourceConflictDetail(raw: any): ResourceConflictDetail | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const sessionId =
    toStringValue((raw as any).session_id ?? (raw as any).sessionId ?? (raw as any).session) ?? "";
  const dealId = toStringValue((raw as any).deal_id ?? (raw as any).dealId ?? (raw as any).deal) ?? "";

  return {
    session_id: sessionId,
    deal_id: dealId,
    deal_title: toStringValue((raw as any).deal_title ?? (raw as any).dealTitle) ?? null,
    organization_name:
      toStringValue((raw as any).organization_name ?? (raw as any).organizationName) ?? null,
    product_code: toStringValue((raw as any).product_code ?? (raw as any).productCode) ?? null,
    product_name: toStringValue((raw as any).product_name ?? (raw as any).productName) ?? null,
    inicio: toStringValue((raw as any).inicio ?? (raw as any).start ?? null),
    fin: toStringValue((raw as any).fin ?? (raw as any).end ?? null),
  };
}

function normalizeResourceAvailability(raw: any): ResourceAvailability {
  if (!raw || typeof raw !== "object") {
    return { isBusy: false, conflicts: [] };
  }

  const isBusyValue =
    (raw as any).isBusy ?? (raw as any).busy ?? (raw as any).ocupado ?? (raw as any).is_busy ?? null;
  const conflictsRaw = (raw as any).conflicts ?? (raw as any).detalles ?? (raw as any).details;
  const conflicts = Array.isArray(conflictsRaw)
    ? conflictsRaw
        .map((entry) => normalizeResourceConflictDetail(entry))
        .filter((entry) => Boolean(entry))
    : [];

  return {
    isBusy: typeof isBusyValue === "boolean" ? isBusyValue : Boolean(isBusyValue),
    conflicts,
  };
}

function normalizeResourceConflictSummary(raw: any): ResourceConflictSummary | null {
  if (!raw || typeof raw !== "object") return null;

  const rawType = toStringValue((raw as any).resource_type ?? (raw as any).type ?? null);
  const normalizedType = rawType
    ? rawType
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
    : null;

  let resource_type: ResourceConflictSummary["resource_type"] | null = null;
  if (normalizedType === "sala") resource_type = "sala";
  if (normalizedType === "formador") resource_type = "formador";
  if (normalizedType === "unidad_movil" || normalizedType === "unidad movil") {
    resource_type = "unidad_movil";
  }

  if (!resource_type) return null;

  const resource_id =
    toStringValue((raw as any).resource_id ?? (raw as any).id ?? (raw as any).resource) ?? "";
  const resource_label = toStringValue((raw as any).resource_label ?? (raw as any).label ?? null) ?? null;
  const conflictsRaw = (raw as any).conflicts ?? (raw as any).detalles ?? [];
  const conflicts = Array.isArray(conflictsRaw)
    ? conflictsRaw
        .map((entry) => normalizeResourceConflictDetail(entry))
        .filter((entry) => Boolean(entry))
    : [];

  return {
    resource_type,
    resource_id,
    resource_label,
    conflicts,
  };
}

function normalizeSessionTrainer(raw: any): DealSessionTrainer | null {
  if (!raw || typeof raw !== "object") return null;
  const trainerId =
    toStringValue((raw as any).trainer_id ?? (raw as any).id ?? (raw as any).trainer) ?? null;
  if (!trainerId) return null;

  const availabilityRaw = (raw as any).availability ?? (raw as any).disponibilidad ?? null;
  const availability = availabilityRaw ? normalizeResourceAvailability(availabilityRaw) : undefined;

  return {
    trainer_id: trainerId,
    name: toStringValue((raw as any).name ?? null),
    apellido: toStringValue((raw as any).apellido ?? (raw as any).last_name ?? null),
    availability,
  };
}

function normalizeSessionMobileUnit(raw: any): DealSessionMobileUnit | null {
  if (!raw || typeof raw !== "object") return null;
  const unitId = toStringValue((raw as any).unidad_id ?? (raw as any).id ?? (raw as any).unidad) ?? null;
  if (!unitId) return null;

  const availabilityRaw = (raw as any).availability ?? (raw as any).disponibilidad ?? null;
  const availability = availabilityRaw ? normalizeResourceAvailability(availabilityRaw) : undefined;

  return {
    unidad_id: unitId,
    name: toStringValue((raw as any).name ?? null),
    matricula: toStringValue((raw as any).matricula ?? null),
    availability,
  };
}

function normalizeSessionRoom(raw: any, fallbackId: string | null): DealSessionRoom | null {
  if (!raw || typeof raw !== "object") {
    if (!fallbackId) return null;
    return {
      sala_id: fallbackId,
      name: null,
      sede: null,
    };
  }

  const salaId = toStringValue((raw as any).sala_id ?? (raw as any).id ?? fallbackId) ?? null;
  if (!salaId) return null;

  const availabilityRaw = (raw as any).availability ?? (raw as any).disponibilidad ?? null;
  const availability = availabilityRaw ? normalizeResourceAvailability(availabilityRaw) : undefined;

  return {
    sala_id: salaId,
    name: toStringValue((raw as any).name ?? null),
    sede: toStringValue((raw as any).sede ?? null),
    availability,
  };
}

function normalizeDealSessionProduct(raw: any): DealSessionProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const code = toStringValue((raw as any).code ?? (raw as any).product_code ?? null) ?? null;
  const name = toStringValue((raw as any).name ?? (raw as any).product_name ?? null) ?? null;
  if (!code && !name) return null;
  return { code, name };
}

function buildAvailabilityQuery(params: AvailabilityQuery): string {
  const searchParams = new URLSearchParams();
  const start = toStringValue(params.start ?? null);
  if (start) searchParams.set("start", start);
  const end = toStringValue(params.end ?? null);
  if (end) searchParams.set("end", end);
  const exclude = toStringValue(params.excludeSessionId ?? null);
  if (exclude) searchParams.set("excludeSessionId", exclude);
  const queryString = searchParams.toString();
  return queryString.length ? `?${queryString}` : "";
}

function normalizeRoomWithAvailability(raw: any): Room {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Sala no válida");
  }

  const salaId = toStringValue((raw as any).sala_id ?? (raw as any).id) ?? "";
  const name = toStringValue((raw as any).name ?? null) ?? "";
  const sede = toStringValue((raw as any).sede ?? null) ?? null;
  const created = toStringValue((raw as any).created_at ?? null);
  const updated = toStringValue((raw as any).updated_at ?? null);

  const availabilityRaw = (raw as any).availability ?? (raw as any).disponibilidad ?? null;
  const availability = availabilityRaw ? normalizeResourceAvailability(availabilityRaw) : undefined;

  const room: Room = {
    sala_id: salaId,
    name,
    sede,
    created_at: created,
    updated_at: updated,
  };

  if (availability) {
    room.availability = availability;
  }

  return room;
}

function normalizeTrainerWithAvailability(raw: any): Trainer {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formador no válido");
  }

  const trainerId = toStringValue((raw as any).trainer_id ?? (raw as any).id) ?? "";
  const sedeRaw = Array.isArray((raw as any).sede) ? ((raw as any).sede as any[]) : [];
  const sede = sedeRaw
    .map((value) => toStringValue(value ?? null))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const availabilityRaw = (raw as any).availability ?? (raw as any).disponibilidad ?? null;
  const availability = availabilityRaw ? normalizeResourceAvailability(availabilityRaw) : undefined;

  const trainer: Trainer = {
    trainer_id: trainerId,
    name: toStringValue((raw as any).name ?? null) ?? "",
    apellido: toStringValue((raw as any).apellido ?? (raw as any).last_name ?? null) ?? null,
    email: toStringValue((raw as any).email ?? null) ?? null,
    phone: toStringValue((raw as any).phone ?? null) ?? null,
    dni: toStringValue((raw as any).dni ?? null) ?? null,
    direccion: toStringValue((raw as any).direccion ?? (raw as any).address ?? null) ?? null,
    especialidad: toStringValue((raw as any).especialidad ?? (raw as any).specialty ?? null) ?? null,
    titulacion: toStringValue((raw as any).titulacion ?? (raw as any).degree ?? null) ?? null,
    activo: Boolean((raw as any).activo ?? (raw as any).active ?? true),
    sede,
    created_at: toStringValue((raw as any).created_at ?? null),
    updated_at: toStringValue((raw as any).updated_at ?? null),
  };

  if (availability) {
    trainer.availability = availability;
  }

  return trainer;
}

function normalizeMobileUnitWithAvailability(raw: any): MobileUnit {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Unidad móvil no válida");
  }

  const unidadId = toStringValue((raw as any).unidad_id ?? (raw as any).id) ?? "";
  const sedeRaw = Array.isArray((raw as any).sede) ? ((raw as any).sede as any[]) : [];
  const sede = sedeRaw
    .map((value) => toStringValue(value ?? null))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const availabilityRaw = (raw as any).availability ?? (raw as any).disponibilidad ?? null;
  const availability = availabilityRaw ? normalizeResourceAvailability(availabilityRaw) : undefined;

  const unit: MobileUnit = {
    unidad_id: unidadId,
    name: toStringValue((raw as any).name ?? null) ?? "",
    matricula: toStringValue((raw as any).matricula ?? null) ?? "",
    tipo: Array.isArray((raw as any).tipo)
      ? ((raw as any).tipo as any[])
          .map((value) => toStringValue(value ?? null))
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      : [],
    sede,
    created_at: toStringValue((raw as any).created_at ?? null),
    updated_at: toStringValue((raw as any).updated_at ?? null),
  };

  if (availability) {
    unit.availability = availability;
  }

  return unit;
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

  const sessionId =
    toStringValue((raw as any).seasson_id ?? (raw as any).session_id ?? (raw as any).id) ?? "";
  const dealId =
    toStringValue((raw as any).deal_id ?? (raw as any).dealId ?? (raw as any).deal) ?? "";

  const start = toStringValue(
    (raw as any).inicio ?? (raw as any).date_start ?? (raw as any).start ?? null
  );
  const end = toStringValue(
    (raw as any).fin ?? (raw as any).date_end ?? (raw as any).end ?? null
  );
  const sede = toStringValue((raw as any).sede ?? null);
  const address =
    toStringValue((raw as any).direccion ?? (raw as any).seasson_address ?? (raw as any).address ?? null) ?? null;
  const roomId =
    toStringValue((raw as any).sala_id ?? (raw as any).room_id ?? (raw as any).roomId ?? null) ?? null;
  const comment =
    toStringValue((raw as any).comentarios ?? (raw as any).comment_seasson ?? (raw as any).comment ?? null) ?? null;

  const statusRaw = (raw as any).estado ?? (raw as any).status;
  const status = normalizeSessionStatus(statusRaw);
  const estado = typeof (raw as any).estado === "string" ? normalizeSessionStatus((raw as any).estado) : status;

  const trainerIdSet = new Set<string>(
    normalizeIdArray((raw as any).seasson_fireman ?? (raw as any).trainerIds)
  );
  const formadores = Array.isArray((raw as any).formadores)
    ? ((raw as any).formadores as any[])
        .map((entry) => normalizeSessionTrainer(entry))
        .filter((entry): entry is DealSessionTrainer => Boolean(entry))
    : [];
  for (const trainer of formadores) {
    if (trainer.trainer_id && !trainerIdSet.has(trainer.trainer_id)) {
      trainerIdSet.add(trainer.trainer_id);
    }
  }

  const mobileUnitIdSet = new Set<string>(
    normalizeIdArray((raw as any).seasson_vehicle ?? (raw as any).mobileUnitIds)
  );
  const unidades = Array.isArray((raw as any).unidades_moviles)
    ? ((raw as any).unidades_moviles as any[])
        .map((entry) => normalizeSessionMobileUnit(entry))
        .filter((entry): entry is DealSessionMobileUnit => Boolean(entry))
    : [];
  for (const unit of unidades) {
    if (unit.unidad_id && !mobileUnitIdSet.has(unit.unidad_id)) {
      mobileUnitIdSet.add(unit.unidad_id);
    }
  }

  const sala = (raw as any).sala ?? (raw as any).room ?? null;
  const normalizedRoom = normalizeSessionRoom(sala, roomId);

  return {
    id: sessionId,
    session_id: sessionId,
    dealId,
    deal_id: dealId,
    status,
    estado,
    start,
    end,
    inicio: start,
    fin: end,
    sede,
    address,
    direccion: address,
    roomId,
    sala_id: roomId,
    trainerIds: Array.from(trainerIdSet),
    formadores,
    mobileUnitIds: Array.from(mobileUnitIdSet),
    unidades_moviles: unidades,
    comment,
    comentarios: comment,
    createdAt: toStringValue((raw as any).created_at ?? null),
    updatedAt: toStringValue((raw as any).updated_at ?? null),
    sala: normalizedRoom,
    deal_product: normalizeDealSessionProduct((raw as any).deal_product),
    origen: normalizeDealSessionProduct((raw as any).origen),
  };
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

export type DealSessionPayload = {
  status?: DealSessionStatus | null;
  start?: string | null;
  end?: string | null;
  sede?: string | null;
  address?: string | null;
  roomId?: string | null;
  trainerIds?: string[] | null;
  mobileUnitIds?: string[] | null;
  comment?: string | null;
};

function buildSessionRequestPayload(payload: DealSessionPayload) {
  const session: Record<string, any> = {};

  session.status = payload.status ? normalizeSessionStatus(payload.status) : null;
  session.date_start = payload.start ?? null;
  session.date_end = payload.end ?? null;
  session.sede = toStringValue(payload.sede);
  session.seasson_address = toStringValue(payload.address);
  session.room_id = toStringValue(payload.roomId);
  session.seasson_fireman = cleanIdArray(payload.trainerIds ?? []);
  session.seasson_vehicle = cleanIdArray(payload.mobileUnitIds ?? []);
  session.comment_seasson = toStringValue(payload.comment);

  return { session };
}

function isPlannerUpdatePayload(payload: unknown): payload is DealSessionUpdatePayload {
  if (!payload || typeof payload !== "object") return false;
  const keys: (keyof DealSessionUpdatePayload)[] = [
    "inicio",
    "fin",
    "sala_id",
    "formadores",
    "unidades_moviles",
    "direccion",
    "sede",
    "comentarios",
    "estado",
  ];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

export async function fetchDealSessions(dealId: string): Promise<DealSession[]> {
  const normalizedDealId = toStringValue(dealId);
  if (!normalizedDealId) {
    throw new ApiError("VALIDATION_ERROR", "dealId requerido para obtener sesiones");
  }

  const search = new URLSearchParams({ dealId: normalizedDealId });
  search.set("expand", "resources");
  const data = await request(`/deal-sessions?${search.toString()}`);
  const rows: any[] = Array.isArray(data?.sessions) ? data.sessions : [];
  return rows.map((row) => normalizeDealSession(row));
}

export async function createDealSession(
  dealId: string,
  payload: DealSessionPayload
): Promise<DealSession> {
  const normalizedDealId = toStringValue(dealId);
  if (!normalizedDealId) {
    throw new ApiError("VALIDATION_ERROR", "dealId requerido para crear sesión");
  }

  const body = {
    dealId: normalizedDealId,
    ...buildSessionRequestPayload(payload),
  };

  const data = await request(`/deal-sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return normalizeDealSession(data?.session ?? {});
}

export async function updateDealSession(
  sessionId: string,
  payload: DealSessionPayload | DealSessionUpdatePayload
): Promise<DealSession> {
  const normalizedSessionId = toStringValue(sessionId);
  if (!normalizedSessionId) {
    throw new ApiError("VALIDATION_ERROR", "sessionId requerido para actualizar");
  }

  let body: Record<string, unknown>;

  if (isPlannerUpdatePayload(payload)) {
    const plannerPayload = payload as DealSessionUpdatePayload;
    body = { expand: "resources" };

    if (Object.prototype.hasOwnProperty.call(plannerPayload, "inicio")) {
      body.inicio = plannerPayload.inicio ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(plannerPayload, "fin")) {
      body.fin = plannerPayload.fin ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(plannerPayload, "sala_id")) {
      body.sala_id = plannerPayload.sala_id ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(plannerPayload, "formadores")) {
      const values = plannerPayload.formadores;
      body.formadores = Array.isArray(values) ? cleanIdArray(values) : values ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(plannerPayload, "unidades_moviles")) {
      const values = plannerPayload.unidades_moviles;
      body.unidades_moviles = Array.isArray(values) ? cleanIdArray(values) : values ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(plannerPayload, "direccion")) {
      body.direccion = toStringValue(plannerPayload.direccion) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(plannerPayload, "sede")) {
      body.sede = toStringValue(plannerPayload.sede) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(plannerPayload, "comentarios")) {
      body.comentarios = toStringValue(plannerPayload.comentarios) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(plannerPayload, "estado")) {
      body.estado =
        plannerPayload.estado !== undefined && plannerPayload.estado !== null
          ? normalizeSessionStatus(plannerPayload.estado)
          : null;
    }
  } else {
    body = { ...buildSessionRequestPayload(payload as DealSessionPayload), expand: "resources" };
  }

  const data = await request(`/deal-sessions/${encodeURIComponent(normalizedSessionId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  return normalizeDealSession(data?.session ?? {});
}

export async function deleteDealSession(sessionId: string): Promise<void> {
  const normalizedSessionId = toStringValue(sessionId);
  if (!normalizedSessionId) {
    throw new ApiError("VALIDATION_ERROR", "sessionId requerido para eliminar");
  }

  await request(`/deal-sessions/${encodeURIComponent(normalizedSessionId)}`, {
    method: "DELETE",
  });
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

export function normalizeConflictSummaries(raw: unknown): ResourceConflictSummary[] {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.conflicts)
    ? ((raw as any).conflicts as unknown[])
    : Array.isArray((raw as any)?.details)
    ? ((raw as any).details as unknown[])
    : [];

  return source
    .map((entry) => normalizeResourceConflictSummary(entry))
    .filter((entry): entry is ResourceConflictSummary => Boolean(entry));
}
