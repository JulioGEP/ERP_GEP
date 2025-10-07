// backend/functions/_shared/pipedrive.ts
// Cliente y utilidades para Pipedrive centralizadas

const BASE_URL = process.env.PIPEDRIVE_BASE_URL || "https://api.pipedrive.com/v1";

// Cache en memoria simple (válida durante la vida de la función)
const cache = new Map<string, any>();
const getC = (k: string) => cache.get(k);
const setC = (k: string, v: any) => (cache.set(k, v), v);

// Posibles overrides por ENV para campos de producto en catálogo
const PRODUCT_HOURS_KEY = process.env.PD_PRODUCT_HOURS_KEY || "hours";
const PRODUCT_TYPE_KEY = process.env.PD_PRODUCT_TYPE_KEY || "type";
const PRODUCT_CATEGORY_KEY = process.env.PD_PRODUCT_CATEGORY_KEY || "category";

type FetchOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
};

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
  return pd(`/deals/${id}/products?${qs({ limit })}`);
}

export async function getDealNotes(dealId: number | string, limit = 500) {
  return pd(`/notes?${qs({ deal_id: String(dealId), limit, sort: "add_time DESC" })}`);
}

export async function getDealFiles(dealId: number | string, limit = 500) {
  const id = encodeURIComponent(String(dealId));
  return pd(`/deals/${id}/files?${qs({ limit })}`);
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
 * 1) key exacta (hash o slug)
 * 2) nombre del campo (case-insensitive) en español/inglés
 */
function findProductFieldByKeyOrName(fieldDefs: any[], preferKey: string, names: string[]) {
  if (!Array.isArray(fieldDefs)) return undefined;
  const byKey = fieldDefs.find((f: any) => f?.key === preferKey);
  if (byKey) return byKey;

  const namesLc = names.map((n) => n.toLowerCase());
  return fieldDefs.find((f: any) => {
    const nm = (f?.name ?? f?.field_name ?? "").toString().toLowerCase();
    return namesLc.includes(nm);
  });
}

/**
 * Extrae atributos del catálogo: code, hours, type, category
 * - hours: devuelve `hoursText` (lo que venga) y `hoursNumber` (parse 12h -> 12)
 * - type/category: si tienen options, devuelve el label humano
 */
export async function extractProductCatalogAttributes(product: any) {
  const productFields = await getProductFields();

  // code (nativo de producto)
  const code = product?.code ?? null;

  // hours
  const fHours =
    findProductFieldByKeyOrName(productFields, PRODUCT_HOURS_KEY, [
      "hours",
      "horas",
      "duración",
      "duracion",
    ]) || findFieldDef(productFields, PRODUCT_HOURS_KEY);

  const hoursVal = fHours ? product?.[fHours.key] : product?.[PRODUCT_HOURS_KEY];
  const hoursText =
    hoursVal == null
      ? null
      : typeof hoursVal === "string"
      ? hoursVal
      : String(hoursVal);
  const hoursNumber = hoursText
    ? ((): number => {
        const m = hoursText.match(/(-?\d+(?:[.,]\d+)?)\s*h?/i);
        if (!m) return NaN;
        const n = Number(m[1].replace(",", "."));
        return Number.isFinite(n) ? n : NaN;
      })()
    : NaN;

  // type
  const fType =
    findProductFieldByKeyOrName(productFields, PRODUCT_TYPE_KEY, [
      "type",
      "tipo",
      "tipus",
    ]) || findFieldDef(productFields, PRODUCT_TYPE_KEY);
  let type: string | null = null;
  if (fType) {
    const raw = product?.[fType.key];
    type = optionLabelOf(fType, raw) ?? (raw != null ? String(raw) : null);
  }

  // category
  const fCategory =
    findProductFieldByKeyOrName(productFields, PRODUCT_CATEGORY_KEY, [
      "category",
      "categoría",
      "categoria",
    ]) || findFieldDef(productFields, PRODUCT_CATEGORY_KEY);
  let category: string | null = null;
  if (fCategory) {
    const raw = product?.[fCategory.key];
    category = optionLabelOf(fCategory, raw) ?? (raw != null ? String(raw) : null);
  }

  return {
    code: code ?? null,
    hoursText: hoursText ?? null,
    hoursNumber: Number.isFinite(hoursNumber) ? hoursNumber : null,
    type,
    category,
  };
}
