// frontend/src/features/presupuestos/api.ts
import type {
  DealDetail,
  DealDetailViewModel,
  DealProduct,
  DealSummary,
  DealDocument,
  DealNote,
} from "../../types/deal";

type Json = any;

// Netlify Functions base (auto local/Netlify)
// - Si estás en localhost:5173 (Vite), apunta a http://localhost:8888/.netlify/functions
// - Si estás sirviendo vía Netlify Dev (8888) o en producción, usa ruta relativa
const API_BASE =
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
