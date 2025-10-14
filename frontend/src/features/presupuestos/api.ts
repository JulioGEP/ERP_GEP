// frontend/src/features/presupuestos/api.ts
import { Buffer } from "buffer";
import type {
  DealDetail,
  DealDetailViewModel,
  DealProduct,
  DealSummary,
  DealDocument,
  DealNote,
} from "../../types/deal";

export type SessionEstado =
  | 'BORRADOR'
  | 'PLANIFICADA'
  | 'SUSPENDIDA'
  | 'CANCELADA'
  | 'FINALIZADA';

const SESSION_ESTADOS: SessionEstado[] = [
  'BORRADOR',
  'PLANIFICADA',
  'SUSPENDIDA',
  'CANCELADA',
  'FINALIZADA',
];

export type SessionDTO = {
  id: string;
  deal_id: string;
  deal_product_id: string;
  nombre_cache: string;
  fecha_inicio_utc: string | null;
  fecha_fin_utc: string | null;
  sala_id: string | null;
  direccion: string;
  estado: SessionEstado;
  trainer_ids: string[];
  unidad_movil_ids: string[];
};

export type SessionGroupDTO = {
  product: {
    id: string;
    code: string | null;
    name: string | null;
    quantity: number;
  };
  sessions: SessionDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type SessionComment = {
  id: string;
  deal_id: string;
  sesion_id: string;
  content: string;
  author: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SessionDocument = {
  id: string;
  deal_id: string;
  sesion_id: string;
  file_type: string | null;
  compartir_formador: boolean;
  added_at: string | null;
  updated_at: string | null;
  drive_file_name: string | null;
  drive_web_view_link: string | null;
};

export type SessionStudent = {
  id: string;
  deal_id: string;
  sesion_id: string;
  nombre: string;
  apellido: string;
  dni: string;
  apto: boolean;
  certificado: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type SessionCounts = {
  comentarios: number;
  documentos: number;
  alumnos: number;
};

export type TrainerOption = {
  trainer_id: string;
  name: string;
  apellido: string | null;
  activo: boolean;
};

export type RoomOption = {
  sala_id: string;
  name: string;
  sede: string | null;
};

export type MobileUnitOption = {
  unidad_id: string;
  name: string;
  matricula: string | null;
};

export type SessionAvailability = {
  trainers: string[];
  rooms: string[];
  units: string[];
};

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
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
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

function toNonNegativeInteger(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (entry === null || entry === undefined) continue;
    const text = String(entry).trim();
    if (!text.length) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

function toSessionEstadoValue(value: unknown): SessionEstado {
  const text = toStringValue(value);
  if (!text) return 'BORRADOR';
  const normalized = text.toUpperCase();
  return SESSION_ESTADOS.includes(normalized as SessionEstado)
    ? (normalized as SessionEstado)
    : 'BORRADOR';
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
    tipo_servicio: toStringValue(row?.tipo_servicio) ?? null,
    mail_invoice: toStringValue(row?.mail_invoice) ?? null,

    hours: toNumber(row?.hours) ?? null,

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
    tipo_servicio: toStringValue(raw.tipo_servicio) ?? null,
    mail_invoice: toStringValue(raw.mail_invoice) ?? null,

    hours: toNumber(raw.hours) ?? null,

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
    content: normalizeNoteContent(contentValue ?? (raw?.content != null ? String(raw.content) : null)),
    author,
    created_at,
  };
}

const NOTE_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

const NOTE_ENTITY_REGEX = /&(?:nbsp|amp|quot|#39|lt|gt);/gi;

function decodeNoteEntities(value: string): string {
  return value.replace(NOTE_ENTITY_REGEX, (match) => NOTE_ENTITY_MAP[match.toLowerCase()] ?? match);
}

function normalizeNoteContent(value: string | null): string {
  if (!value) return "";

  const withLineBreaks = value
    .replace(/<\s*br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\s*\/?div[^>]*>/gi, "\n")
    .replace(/<\s*\/?p[^>]*>/gi, "\n");

  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, "");
  const decoded = decodeNoteEntities(withoutTags).replace(/\u00a0/g, " ");

  const lines = decoded.split(/\r?\n/).map((line) => line.trim());
  const compacted = lines.reduce<string[]>((acc, line) => {
    if (!line) {
      if (!acc.length || acc[acc.length - 1] === "") return acc;
      acc.push("");
      return acc;
    }
    acc.push(line);
    return acc;
  }, []);

  return compacted.join("\n").trim();
}

function normalizeDealDocument(raw: any): DealDocument {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : "");
  const driveFileName = toStringValue(raw?.drive_file_name);
  const name =
    pickNonEmptyString(
      driveFileName,
      toStringValue(raw?.name),
      toStringValue(raw?.file_name)
    ) ?? (raw?.name != null ? String(raw.name) : "Documento");
  const mime = toStringValue(raw?.mime_type ?? raw?.file_type);
  const size = raw?.size ?? raw?.file_size;
  const normalizedSize = typeof size === "number" ? size : toNumber(size);
  const driveWebViewLink = toStringValue(raw?.drive_web_view_link);
  const apiUrl = toStringValue(raw?.url);
  const fileUrl = toStringValue(isHttpUrl(raw?.file_url) ? raw?.file_url : null);
  const resolvedUrl = driveWebViewLink ?? apiUrl ?? fileUrl ?? null;
  const sourceValue = toStringValue(raw?.source);
  const hasManualSignature =
    (!toStringValue(raw?.file_url) || !String(raw?.file_url).trim().length) && !!driveWebViewLink;
  const source =
    sourceValue === "S3" || sourceValue === "PIPEDRIVE" || sourceValue === "MANUAL"
      ? (sourceValue as "S3" | "PIPEDRIVE" | "MANUAL")
      : hasManualSignature
      ? "MANUAL"
      : isHttpUrl(resolvedUrl)
      ? "PIPEDRIVE"
      : "S3";

  return {
    id: id || (raw?.id != null ? String(raw.id) : ""),
    source,
    name: name && name.length ? name : "Documento",
    mime_type: mime,
    size: normalizedSize ?? null,
    url: resolvedUrl,
    drive_file_name: driveFileName ?? null,
    drive_web_view_link: driveWebViewLink ?? null,
    created_at: toStringValue(raw?.created_at ?? raw?.added_at),
  };
}

function normalizeSession(row: any): SessionDTO {
  const id = toStringValue(row?.id) ?? (row?.id != null ? String(row.id) : "");
  const deal_id = toStringValue(row?.deal_id) ?? "";
  const deal_product_id = toStringValue(row?.deal_product_id) ?? "";
  const nombre_cache = toStringValue(row?.nombre_cache) ?? "Sesión";
  const fecha_inicio_utc = toStringValue(row?.fecha_inicio_utc);
  const fecha_fin_utc = toStringValue(row?.fecha_fin_utc);
  const sala_id = toStringValue(row?.sala_id);
  const direccion = toStringValue(row?.direccion) ?? "";
  const estado = toSessionEstadoValue(row?.estado);

  const trainer_ids = toStringArray(row?.trainer_ids);
  const unidad_movil_ids = toStringArray(row?.unidad_movil_ids);

  return {
    id,
    deal_id,
    deal_product_id,
    nombre_cache,
    fecha_inicio_utc: fecha_inicio_utc ?? null,
    fecha_fin_utc: fecha_fin_utc ?? null,
    sala_id: sala_id ?? null,
    direccion,
    estado,
    trainer_ids,
    unidad_movil_ids,
  };
}

function normalizeSessionGroup(raw: any): SessionGroupDTO {
  const product = raw?.product ?? {};
  const productId = toStringValue(product?.id) ?? (product?.id != null ? String(product.id) : "");
  const quantity = toNumber(product?.quantity);

  return {
    product: {
      id: productId,
      code: toStringValue(product?.code),
      name: toStringValue(product?.name),
      quantity: quantity != null ? quantity : 0,
    },
    sessions: Array.isArray(raw?.sessions) ? raw.sessions.map((row: any) => normalizeSession(row)) : [],
    pagination: {
      page: toNumber(raw?.pagination?.page) ?? 1,
      limit: toNumber(raw?.pagination?.limit) ?? 10,
      total: toNumber(raw?.pagination?.total) ?? 0,
      totalPages: toNumber(raw?.pagination?.totalPages) ?? 1,
    },
  };
}

function normalizeSessionComment(raw: any): SessionComment {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : '');
  const dealId = toStringValue(raw?.deal_id) ?? '';
  const sessionId = toStringValue(raw?.sesion_id) ?? '';
  const content = toStringValue(raw?.content) ?? '';
  const author = toStringValue(raw?.author);
  const createdAt = toStringValue(raw?.created_at);
  const updatedAt = toStringValue(raw?.updated_at);

  return {
    id,
    deal_id: dealId,
    sesion_id: sessionId,
    content,
    author: author ?? null,
    created_at: createdAt ?? null,
    updated_at: updatedAt ?? null,
  };
}

function normalizeSessionDocument(raw: any): SessionDocument {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : '');
  const dealId = toStringValue(raw?.deal_id) ?? '';
  const sessionId = toStringValue(raw?.sesion_id) ?? '';
  const fileType = toStringValue(raw?.file_type);
  const driveFileName = toStringValue(raw?.drive_file_name);
  const driveLink = toStringValue(raw?.drive_web_view_link);
  const createdAt = toStringValue(raw?.added_at ?? raw?.created_at);
  const updatedAt = toStringValue(raw?.updated_at);

  return {
    id,
    deal_id: dealId,
    sesion_id: sessionId,
    file_type: fileType,
    compartir_formador: Boolean(raw?.compartir_formador),
    added_at: createdAt ?? null,
    updated_at: updatedAt ?? null,
    drive_file_name: driveFileName ?? null,
    drive_web_view_link: driveLink ?? null,
  };
}

function normalizeSessionStudent(raw: any): SessionStudent {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : '');
  const dealId = toStringValue(raw?.deal_id) ?? '';
  const sessionId = toStringValue(raw?.sesion_id) ?? '';
  const nombre = toStringValue(raw?.nombre) ?? '';
  const apellido = toStringValue(raw?.apellido) ?? '';
  const dni = toStringValue(raw?.dni) ?? '';
  const apto = Boolean(raw?.apto);
  const certificado = Boolean(raw?.certificado);
  const createdAt = toStringValue(raw?.created_at);
  const updatedAt = toStringValue(raw?.updated_at);

  return {
    id,
    deal_id: dealId,
    sesion_id: sessionId,
    nombre,
    apellido,
    dni,
    apto,
    certificado,
    created_at: createdAt ?? null,
    updated_at: updatedAt ?? null,
  };
}

function normalizeTrainerOption(raw: any): TrainerOption | null {
  const trainer_id = toStringValue(raw?.trainer_id) ?? (raw?.trainer_id != null ? String(raw.trainer_id) : "");
  if (!trainer_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  const apellido = toStringValue(raw?.apellido);
  const activoValue = raw?.activo;
  const activo = activoValue === undefined ? true : Boolean(activoValue);
  return { trainer_id, name, apellido: apellido ?? null, activo };
}

function normalizeRoomOption(raw: any): RoomOption | null {
  const sala_id = toStringValue(raw?.sala_id) ?? (raw?.sala_id != null ? String(raw.sala_id) : "");
  if (!sala_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  return { sala_id, name, sede: toStringValue(raw?.sede) ?? null };
}

function normalizeMobileUnitOption(raw: any): MobileUnitOption | null {
  const unidad_id = toStringValue(raw?.unidad_id) ?? (raw?.unidad_id != null ? String(raw.unidad_id) : "");
  if (!unidad_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  return { unidad_id, name, matricula: toStringValue(raw?.matricula) ?? null };
}

function sanitizeStringArray(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const normalized = values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length);
  return Array.from(new Set(normalized));
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
    throw new ApiError(code, msg, res.status);
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

async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return typeof window !== "undefined" ? window.btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

export async function uploadManualDocument(
  dealId: string,
  file: File,
  user?: { id: string; name?: string }
): Promise<void> {
  const normalizedId = String(dealId ?? "").trim();
  if (!normalizedId) {
    throw new ApiError("VALIDATION_ERROR", "Falta dealId para subir el documento");
  }

  const base64 = await fileToBase64(file);
  const headers: Record<string, string> = {};
  if (user?.id) headers["X-User-Id"] = user.id;
  if (user?.name) headers["X-User-Name"] = user.name;

  await request(`/deal_documents/${encodeURIComponent(normalizedId)}/manual`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      contentBase64: base64,
    }),
  });
}

export async function deleteDocument(dealId: string, docId: string): Promise<void> {
  await request(
    `/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}`,
    { method: "DELETE" }
  );
}

/* ==================
 * Sesiones
 * ================== */

export async function generateSessionsFromDeal(dealId: string): Promise<number> {
  const normalizedId = String(dealId ?? "").trim();
  if (!normalizedId) {
    throw new ApiError("VALIDATION_ERROR", "dealId es obligatorio");
  }
  const data = await request(`/sessions/generate-from-deal`, {
    method: "POST",
    body: JSON.stringify({ dealId: normalizedId }),
  });
  const count = toNumber(data?.count);
  return count ?? 0;
}

export async function fetchDealSessions(
  dealId: string,
  options?: { productId?: string; page?: number; limit?: number }
): Promise<SessionGroupDTO[]> {
  const normalizedId = String(dealId ?? "").trim();
  if (!normalizedId) {
    throw new ApiError("VALIDATION_ERROR", "dealId es obligatorio");
  }

  const params = new URLSearchParams({ dealId: normalizedId });
  if (options?.productId) params.set("productId", String(options.productId));
  if (options?.page) params.set("page", String(options.page));
  if (options?.limit) params.set("limit", String(options.limit));

  const data = await request(`/sessions?${params.toString()}`);
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  return groups.map((group: any) => normalizeSessionGroup(group));
}

export async function createSession(
  payload: {
    deal_id: string;
    deal_product_id: string;
    nombre_cache?: string;
    fecha_inicio_utc?: string | null;
    fecha_fin_utc?: string | null;
    sala_id?: string | null;
    direccion?: string | null;
    trainer_ids?: string[];
    unidad_movil_ids?: string[];
  }
): Promise<SessionDTO> {
  const body: Record<string, unknown> = {
    deal_id: String(payload.deal_id ?? "").trim(),
    deal_product_id: String(payload.deal_product_id ?? "").trim(),
  };

  if (!body.deal_id || !body.deal_product_id) {
    throw new ApiError("VALIDATION_ERROR", "deal_id y deal_product_id son obligatorios");
  }

  if (payload.nombre_cache !== undefined) body.nombre_cache = payload.nombre_cache;
  if (payload.fecha_inicio_utc !== undefined) body.fecha_inicio_utc = payload.fecha_inicio_utc;
  if (payload.fecha_fin_utc !== undefined) body.fecha_fin_utc = payload.fecha_fin_utc;
  if (payload.sala_id !== undefined) body.sala_id = payload.sala_id;
  if (payload.direccion !== undefined) body.direccion = payload.direccion;
  const trainerIds = sanitizeStringArray(payload.trainer_ids);
  if (trainerIds !== undefined) body.trainer_ids = trainerIds;

  const unidadIds = sanitizeStringArray(payload.unidad_movil_ids);
  if (unidadIds !== undefined) body.unidad_movil_ids = unidadIds;

  const data = await request(`/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return normalizeSession(data?.session ?? {});
}

export async function patchSession(
  sessionId: string,
  payload: Partial<{
    nombre_cache: string;
    fecha_inicio_utc: string | null;
    fecha_fin_utc: string | null;
    sala_id: string | null;
    direccion: string | null;
    trainer_ids: string[];
    unidad_movil_ids: string[];
    estado: SessionEstado;
  }>
): Promise<SessionDTO> {
  const normalizedId = String(sessionId ?? "").trim();
  if (!normalizedId) {
    throw new ApiError("VALIDATION_ERROR", "sessionId es obligatorio");
  }

  const body: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(payload, "nombre_cache")) {
    body.nombre_cache = payload.nombre_cache ?? "";
  }
  if (Object.prototype.hasOwnProperty.call(payload, "fecha_inicio_utc"))
    body.fecha_inicio_utc = payload.fecha_inicio_utc ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "fecha_fin_utc"))
    body.fecha_fin_utc = payload.fecha_fin_utc ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "sala_id")) body.sala_id = payload.sala_id ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "direccion")) body.direccion = payload.direccion ?? "";
  if (Object.prototype.hasOwnProperty.call(payload, "trainer_ids")) {
    body.trainer_ids = sanitizeStringArray(payload.trainer_ids) ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, "unidad_movil_ids")) {
    body.unidad_movil_ids = sanitizeStringArray(payload.unidad_movil_ids) ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, "estado")) {
    body.estado = payload.estado;
  }

  const data = await request(`/sessions/${encodeURIComponent(normalizedId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  return normalizeSession(data?.session ?? {});
}

export async function fetchSessionCounts(sessionId: string): Promise<SessionCounts> {
  const normalizedId = String(sessionId ?? "").trim();
  if (!normalizedId) {
    throw new ApiError("VALIDATION_ERROR", "sessionId es obligatorio");
  }

  const data = await request(`/sessions/${encodeURIComponent(normalizedId)}/counts`);

  return {
    comentarios: toNonNegativeInteger(data?.comentarios),
    documentos: toNonNegativeInteger(data?.documentos),
    alumnos: toNonNegativeInteger(data?.alumnos),
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  const normalizedId = String(sessionId ?? "").trim();
  if (!normalizedId) {
    throw new ApiError("VALIDATION_ERROR", "sessionId es obligatorio");
  }

  await request(`/sessions/${encodeURIComponent(normalizedId)}`, {
    method: "DELETE",
  });
}

/* ==================
 * Catálogos auxiliares
 * ================== */

export async function fetchActiveTrainers(): Promise<TrainerOption[]> {
  const data = await request(`/trainers`);
  const trainers = Array.isArray(data?.trainers) ? (data.trainers as unknown[]) : [];
  return trainers
    .map((trainer) => normalizeTrainerOption(trainer))
    .filter((trainer): trainer is TrainerOption => !!trainer && trainer.activo)
    .sort((a: TrainerOption, b: TrainerOption) => {
      const nameA = `${a.name} ${a.apellido ?? ''}`.trim().toLowerCase();
      const nameB = `${b.name} ${b.apellido ?? ''}`.trim().toLowerCase();
      return nameA.localeCompare(nameB, 'es');
    });
}

export async function fetchRoomsCatalog(): Promise<RoomOption[]> {
  const data = await request(`/rooms`);
  const rooms = Array.isArray(data?.rooms) ? (data.rooms as unknown[]) : [];
  return rooms
    .map((room) => normalizeRoomOption(room))
    .filter((room): room is RoomOption => !!room)
    .sort((a: RoomOption, b: RoomOption) => a.name.localeCompare(b.name, 'es'));
}

export async function fetchMobileUnitsCatalog(): Promise<MobileUnitOption[]> {
  const data = await request(`/mobile-units`);
  const units = Array.isArray(data?.mobileUnits) ? (data.mobileUnits as unknown[]) : [];
  return units
    .map((unit) => normalizeMobileUnitOption(unit))
    .filter((unit): unit is MobileUnitOption => !!unit)
    .sort((a: MobileUnitOption, b: MobileUnitOption) => a.name.localeCompare(b.name, 'es'));
}

export async function fetchSessionAvailability(params: {
  start: string;
  end?: string;
  excludeSessionId?: string;
}): Promise<SessionAvailability> {
  const searchParams = new URLSearchParams();
  searchParams.set('start', params.start);
  if (params.end) searchParams.set('end', params.end);
  if (params.excludeSessionId) searchParams.set('excludeSessionId', params.excludeSessionId);

  const data = await request(`/sessions/availability?${searchParams.toString()}`);
  const availability = data?.availability ?? {};

  return {
    trainers: toStringArray(availability.trainers),
    rooms: toStringArray(availability.rooms),
    units: toStringArray(availability.units),
  };
}

/* =========================
 * Comentarios de sesión
 * ========================= */

export async function fetchSessionComments(sessionId: string): Promise<SessionComment[]> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  const data = await request(`/session_comments/${encodeURIComponent(normalizedId)}`);
  const comments = Array.isArray(data?.comments) ? data.comments : [];
  return comments.map((comment: any) => normalizeSessionComment(comment));
}

export async function createSessionComment(
  sessionId: string,
  content: string,
  user?: { id: string; name?: string },
): Promise<SessionComment> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  const trimmedContent = typeof content === 'string' ? content.trim() : '';
  if (!trimmedContent.length) {
    throw new ApiError('VALIDATION_ERROR', 'content requerido');
  }

  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  const data = await request(`/session_comments/${encodeURIComponent(normalizedId)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: trimmedContent }),
  });

  return normalizeSessionComment(data?.comment ?? {});
}

export async function updateSessionComment(
  sessionId: string,
  commentId: string,
  content: string,
  user?: { id: string; name?: string },
): Promise<SessionComment> {
  const normalizedSessionId = String(sessionId ?? '').trim();
  const normalizedCommentId = String(commentId ?? '').trim();
  if (!normalizedSessionId || !normalizedCommentId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId y commentId son obligatorios');
  }

  const trimmedContent = typeof content === 'string' ? content.trim() : '';
  if (!trimmedContent.length) {
    throw new ApiError('VALIDATION_ERROR', 'content requerido');
  }

  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  const data = await request(
    `/session_comments/${encodeURIComponent(normalizedSessionId)}/${encodeURIComponent(normalizedCommentId)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ content: trimmedContent }),
    },
  );

  return normalizeSessionComment(data?.comment ?? {});
}

export async function deleteSessionComment(
  sessionId: string,
  commentId: string,
  user?: { id: string; name?: string },
): Promise<void> {
  const normalizedSessionId = String(sessionId ?? '').trim();
  const normalizedCommentId = String(commentId ?? '').trim();
  if (!normalizedSessionId || !normalizedCommentId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId y commentId son obligatorios');
  }

  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  await request(
    `/session_comments/${encodeURIComponent(normalizedSessionId)}/${encodeURIComponent(normalizedCommentId)}`,
    {
      method: 'DELETE',
      headers,
    },
  );
}

/* =========================
 * Documentos de sesión
 * ========================= */

export async function fetchSessionDocuments(
  dealId: string,
  sessionId: string,
): Promise<SessionDocument[]> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const params = new URLSearchParams({ dealId: normalizedDealId, sessionId: normalizedSessionId });
  const data = await request(`/session_documents?${params.toString()}`);
  const docs: any[] = Array.isArray(data?.documents) ? data.documents : [];
  return docs.map((doc) => normalizeSessionDocument(doc));
}

export async function uploadSessionDocuments(params: {
  dealId: string;
  sessionId: string;
  files: File[];
  shareWithTrainer: boolean;
}): Promise<SessionDocument[]> {
  const normalizedDealId = String(params.dealId ?? '').trim();
  const normalizedSessionId = String(params.sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const files = Array.isArray(params.files) ? params.files : [];
  if (!files.length) {
    throw new ApiError('VALIDATION_ERROR', 'Selecciona al menos un archivo');
  }

  const payloadFiles = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      contentBase64: await fileToBase64(file),
    })),
  );

  const data = await request(`/session_documents`, {
    method: 'POST',
    body: JSON.stringify({
      deal_id: normalizedDealId,
      sesion_id: normalizedSessionId,
      compartir_formador: params.shareWithTrainer,
      files: payloadFiles,
    }),
  });

  const docs: any[] = Array.isArray(data?.documents) ? data.documents : [];
  return docs.map((doc) => normalizeSessionDocument(doc));
}

export async function updateSessionDocumentShare(
  dealId: string,
  sessionId: string,
  documentId: string,
  shareWithTrainer: boolean,
): Promise<SessionDocument> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  const normalizedDocumentId = String(documentId ?? '').trim();

  if (!normalizedDealId || !normalizedSessionId || !normalizedDocumentId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId, sessionId y documentId son obligatorios');
  }

  const data = await request(`/session_documents/${encodeURIComponent(normalizedDocumentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      deal_id: normalizedDealId,
      sesion_id: normalizedSessionId,
      compartir_formador: shareWithTrainer,
    }),
  });

  return normalizeSessionDocument(data?.document ?? {});
}

/* =========================
 * Alumnos de sesión
 * ========================= */

export async function fetchSessionStudents(
  dealId: string,
  sessionId: string,
): Promise<SessionStudent[]> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const params = new URLSearchParams({
    deal_id: normalizedDealId,
    sesion_id: normalizedSessionId,
  });

  const data = await request(`/alumnos?${params.toString()}`);
  const students: any[] = Array.isArray(data?.students) ? data.students : [];
  return students.map((student) => normalizeSessionStudent(student));
}

export type CreateSessionStudentInput = {
  dealId: string;
  sessionId: string;
  nombre: string;
  apellido: string;
  dni: string;
  apto?: boolean;
  certificado?: boolean;
};

export async function createSessionStudent(input: CreateSessionStudentInput): Promise<SessionStudent> {
  const normalizedDealId = String(input.dealId ?? '').trim();
  const normalizedSessionId = String(input.sessionId ?? '').trim();
  const nombre = String(input.nombre ?? '').trim();
  const apellido = String(input.apellido ?? '').trim();
  const dni = String(input.dni ?? '').trim();
  const apto = Boolean(input.apto);
  const certificado = Boolean(input.certificado);

  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }
  if (!nombre.length || !apellido.length || !dni.length) {
    throw new ApiError('VALIDATION_ERROR', 'Nombre, apellidos y DNI son obligatorios');
  }

  const data = await request('/alumnos', {
    method: 'POST',
    body: JSON.stringify({
      deal_id: normalizedDealId,
      sesion_id: normalizedSessionId,
      nombre,
      apellido,
      dni,
      apto,
      certificado,
    }),
  });

  return normalizeSessionStudent(data?.student ?? {});
}

export type UpdateSessionStudentInput = {
  nombre?: string;
  apellido?: string;
  dni?: string;
  apto?: boolean;
  certificado?: boolean;
};

export async function updateSessionStudent(
  studentId: string,
  input: UpdateSessionStudentInput,
): Promise<SessionStudent> {
  const normalizedId = String(studentId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'studentId es obligatorio');
  }

  const payload: Record<string, unknown> = {};
  if (input.nombre !== undefined) payload.nombre = String(input.nombre ?? '').trim();
  if (input.apellido !== undefined) payload.apellido = String(input.apellido ?? '').trim();
  if (input.dni !== undefined) payload.dni = String(input.dni ?? '').trim();
  if (input.apto !== undefined) payload.apto = Boolean(input.apto);
  if (input.certificado !== undefined) payload.certificado = Boolean(input.certificado);

  const data = await request(`/alumnos/${encodeURIComponent(normalizedId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  return normalizeSessionStudent(data?.student ?? {});
}

export async function deleteSessionStudent(studentId: string): Promise<void> {
  const normalizedId = String(studentId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'studentId es obligatorio');
  }

  await request(`/alumnos/${encodeURIComponent(normalizedId)}`, { method: 'DELETE' });
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
    sedeLabel: sedeLabel ?? null,
    caesLabel: caesLabel ?? null,
    fundaeLabel: fundaeLabel ?? null,
    hotelLabel: hotelLabel ?? null,
    extras: undefined,
    products: resolveProducts(detail, summary),
    notes: (detail?.notes ?? []).map((n) => ({
      id: n?.id ?? null,
      content: normalizeNoteContent(n?.content ?? null),
      author: pickNonEmptyString(n?.author ?? null),
    })),
  };
}
