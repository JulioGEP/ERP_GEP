// backend/functions/_shared/pipedrive.ts
// Cliente y utilidades para Pipedrive centralizadas

const BASE_URL = process.env.PIPEDRIVE_BASE_URL || "https://api.pipedrive.com/v1";

// Cache en memoria simple (válida durante la vida de la función)
const cache = new Map<string, any>();
const getC = (k: string) => cache.get(k);
const setC = (k: string, v: any) => (cache.set(k, v), v);

// Claves hash reales (fallbacks) y posibles overrides por ENV
const PD_PRODUCT_HOURS_HASH = "38f11c8876ecde803a027fbf3c9041fda2ae7eb7";
const PD_PRODUCT_TYPE_HASH  = "5bad94030bb7917c186f3238fb2cd8f7a91cf30b";

const PRODUCT_HOURS_KEY    = process.env.PD_PRODUCT_HOURS_KEY || "hours";
const PRODUCT_TYPE_KEY     = process.env.PD_PRODUCT_TYPE_KEY  || "type";
const PRODUCT_CATEGORY_KEY = process.env.PD_PRODUCT_CATEGORY_KEY || "category";

type FetchOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
};

function decodeRfc5987Value(str: string): string {
  const parts = str.split("''");
  if (parts.length === 2) {
    try {
      return decodeURIComponent(parts[1].replace(/\+/g, "%20"));
    } catch {
      return parts[1];
    }
  }
  try {
    return decodeURIComponent(str.replace(/\+/g, "%20"));
  } catch {
    return str;
  }
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const segments = header.split(";").map((seg) => seg.trim());
  for (const segment of segments) {
    if (segment.toLowerCase().startsWith("filename*=")) {
      const value = segment.substring(9).trim();
      const cleaned = value.replace(/^utf-8''/i, "UTF-8''");
      const withoutQuotes = cleaned.replace(/^"|"$/g, "");
      return decodeRfc5987Value(withoutQuotes);
    }
  }
  for (const segment of segments) {
    if (segment.toLowerCase().startsWith("filename=")) {
      const value = segment.substring(9).trim();
      const withoutQuotes = value.replace(/^"|"$/g, "");
      return withoutQuotes;
    }
  }
  return null;
}

function qs(obj: Record<string, any>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  return u.toString();
}

async function pd(path: string, opts: FetchOpts = {}) {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    throw new Error("Falta PIPEDRIVE_API_TOKEN en variables de entorno");
  }
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}api_token=${token}`;

  const res = await fetch(url as any, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[pipedrive] ${opts.method ?? "GET"} ${path} -> ${res.status} ${text}`);
  }

  const json: any = await res.json().catch(() => ({}));
  return json?.data ?? json;
}

/* =========
 * Endpoints
 * ========= */

export async function getDeal(id: number | string) {
  return pd(`/deals/${encodeURIComponent(String(id))}`);
}

export async function getOrganization(id: number | string) {
  return pd(`/organizations/${encodeURIComponent(String(id))}`);
}

export async function getPerson(id: number | string) {
  return pd(`/persons/${encodeURIComponent(String(id))}`);
}

export async function getDealProducts(dealId: number | string, limit = 500) {
  const id = encodeURIComponent(String(dealId));
  // include_product_data=1 para traer datos del catálogo en la misma llamada
  return pd(`/deals/${id}/products?${qs({ limit, include_product_data: 1 })}`);
}

export async function getDealNotes(dealId: number | string, limit = 500) {
  return pd(`/notes?${qs({ deal_id: String(dealId), limit, sort: "add_time DESC" })}`);
}

export async function getDealFiles(dealId: number | string, limit = 500) {
  const id = encodeURIComponent(String(dealId));
  return pd(`/deals/${id}/files?${qs({ limit })}`);
}

export async function downloadFile(fileId: number | string) {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    throw new Error("Falta PIPEDRIVE_API_TOKEN en variables de entorno");
  }
  const url = `${BASE_URL}/files/${encodeURIComponent(String(fileId))}/download?api_token=${token}`;
  const res = await fetch(url as any, {
    method: "GET",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[pipedrive] GET /files/${fileId}/download -> ${res.status} ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const contentDisposition = res.headers.get("content-disposition");
  const fileNameFromHeader = parseContentDispositionFilename(contentDisposition);
  const mimeType = res.headers.get("content-type") ?? undefined;

  return {
    buffer: Buffer.from(arrayBuffer),
    file_name_from_header: fileNameFromHeader ?? undefined,
    content_disposition: contentDisposition ?? undefined,
    mimeType,
  };
}

export async function getPipelines() {
  const key = "pipelines";
  const c = getC(key);
  if (c) return c;
  return setC(key, await pd(`/pipelines`));
}

export async function getDealFields() {
  const key = "dealFields";
  const c = getC(key);
  if (c) return c;
  return setC(key, await pd(`/dealFields`));
}

export async function getProductFields() {
  const key = "productFields";
  const c = getC(key);
  if (c) return c;
  return setC(key, await pd(`/productFields`));
}

/** Obtiene un producto del catálogo por ID */
export async function getProduct(id: number | string) {
  const key = `product:${id}`;
  const c = getC(key);
  if (c) return c;
  return setC(key, await pd(`/products/${encodeURIComponent(String(id))}`));
}

/** Versión con cache explícita para múltiples lecturas en un mismo import */
export async function getProductCached(id: number | string) {
  return getProduct(id);
}

/* ===========================
 * Utilidades para labels/keys
 * =========================== */

export function optionLabelOf(fieldDef: any, value: any): string | undefined {
  if (!fieldDef || !Array.isArray(fieldDef.options)) return undefined;
  const vStr = value == null ? null : String(value);
  const opt = fieldDef.options.find(
    (o: any) =>
      String(o.id) === vStr || String(o.key) === vStr || String(o.label) === vStr
  );
  return opt?.label ?? undefined;
}

export function findFieldDef(fieldDefs: any[], apiKey: string) {
  return fieldDefs?.find((f: any) => f?.key === apiKey);
}

/**
 * Busca un campo de producto por:
 * - key exacta (preferKeys en orden de prioridad)
 * - nombre del campo (case-insensitive) en español/inglés
 */
function findProductFieldByKeyOrName(
  fieldDefs: any[],
  preferKeys: string[],
  names: string[]
) {
  if (!Array.isArray(fieldDefs)) return undefined;
  for (const k of preferKeys.filter(Boolean)) {
    const byKey = fieldDefs.find((f: any) => f?.key === k);
    if (byKey) return byKey;
  }
  const namesLc = names.map((n) => n.toLowerCase());
  return fieldDefs.find((f: any) => {
    const nm = (f?.name ?? f?.field_name ?? "").toString().toLowerCase();
    return namesLc.includes(nm);
  });
}

/**
 * Extrae atributos del catálogo: code, hours (number), type (label), category (label)
 * - hours: devuelve número entero/decimal según venga del campo; sin parsear “h”.
 * - type/category: si tienen options, devuelve el label humano.
 */
export async function extractProductCatalogAttributes(product: any) {
  const productFields = await getProductFields();

  // code (nativo de producto)
  const code = product?.code ?? null;

  // ---- HOURS (Texto en PD → numérico opcional) ----
const fHours =
  findProductFieldByKeyOrName(
    productFields,
    [PRODUCT_HOURS_KEY, PD_PRODUCT_HOURS_HASH],
    ["hours", "horas", "horas recomendadas", "duración", "duracion"]
  ) ||
  findFieldDef(productFields, PRODUCT_HOURS_KEY) ||
  findFieldDef(productFields, PD_PRODUCT_HOURS_HASH);

let hoursText: string | null = null;
let hoursNumber: number | null = null;

if (fHours) {
  const cf = product?.custom_fields ?? {};
  const raw =
    product?.[fHours.key] ??
    cf?.[fHours.key] ??
    product?.[PRODUCT_HOURS_KEY] ??
    cf?.[PRODUCT_HOURS_KEY] ??
    product?.[PD_PRODUCT_HOURS_HASH] ??
    cf?.[PD_PRODUCT_HOURS_HASH];

  if (raw != null && raw !== "") {
    hoursText = String(raw).trim();
    const n = Number(hoursText.replace(",", "."));
    hoursNumber = Number.isFinite(n) ? n : null;
  }
}

  // ---- TYPE (single-option → label) ----
  const fType = findProductFieldByKeyOrName(
    productFields,
    [PRODUCT_TYPE_KEY, PD_PRODUCT_TYPE_HASH],
    ["type", "tipo", "tipus"]
  ) || findFieldDef(productFields, PRODUCT_TYPE_KEY) || findFieldDef(productFields, PD_PRODUCT_TYPE_HASH);

  let type: string | null = null;
  if (fType) {
    const raw = product?.[fType.key] ?? product?.[PRODUCT_TYPE_KEY] ?? product?.[PD_PRODUCT_TYPE_HASH];
    type = optionLabelOf(fType, raw) ?? (raw != null ? String(raw) : null);
  }

  // ---- CATEGORY (puede ser texto u opción) ----
  const fCategory =
    findProductFieldByKeyOrName(productFields, [PRODUCT_CATEGORY_KEY], ["category", "categoría", "categoria"]) ||
    findFieldDef(productFields, PRODUCT_CATEGORY_KEY);

  let category: string | null = null;
  if (fCategory) {
    const raw = product?.[fCategory.key] ?? product?.[PRODUCT_CATEGORY_KEY];
    category = optionLabelOf(fCategory, raw) ?? (raw != null ? String(raw) : null);
  }

  return {
    code: code ?? null,
    hoursNumber: hoursNumber ?? null, // <- número ya limpio
    type,
    category,
  };
}
