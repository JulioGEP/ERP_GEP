// backend/functions/_shared/pipedrive.ts
// Cliente y utilidades para Pipedrive centralizadas

const BASE_URL = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';

// Cache en memoria simple (válida durante la vida de la función)
const cache = new Map<string, any>();
const getC = (k: string) => cache.get(k);
const setC = (k: string, v: any) => (cache.set(k, v), v);

type FetchOpts = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
};

function qs(obj: Record<string, any>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  return u.toString();
}

async function pd(path: string, opts: FetchOpts = {}) {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    throw new Error('Falta PIPEDRIVE_API_TOKEN en variables de entorno');
  }

  const url = `${BASE_URL}${path}${path.includes('?') ? '&' : '?'}api_token=${token}`;

  const res = await fetch(url as any, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[pipedrive] ${opts.method ?? 'GET'} ${path} -> ${res.status} ${text}`);
  }

  const json: any = await res.json().catch(() => ({}));
  // La mayoría de endpoints devuelven { data, ... }
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
  return pd(`/notes?${qs({ deal_id: String(dealId), limit, sort: 'add_time DESC' })}`);
}

export async function getDealFiles(dealId: number | string, limit = 500) {
  return pd(`/files?${qs({ deal_id: String(dealId), limit })}`);
}

export async function getPipelines() {
  const key = 'pipelines';
  const c = getC(key);
  if (c) return c;
  return setC(key, await pd(`/pipelines`));
}

export async function getDealFields() {
  const key = 'dealFields';
  const c = getC(key);
  if (c) return c;
  return setC(key, await pd(`/dealFields`));
}

export async function getProductFields() {
  const key = 'productFields';
  const c = getC(key);
  if (c) return c;
  return setC(key, await pd(`/productFields`));
}

/* ===========================
 * Utilidades para labels/keys
 * =========================== */

export function optionLabelOf(fieldDef: any, value: any): string | undefined {
  if (!fieldDef || !Array.isArray(fieldDef.options)) return undefined;
  const opt = fieldDef.options.find(
    (o: any) =>
      o.id === value ||
      o.id === Number(value) ||
      o.key === value ||
      o.label === value
  );
  return opt?.label ?? undefined;
}

export function findFieldDef(fieldDefs: any[], apiKey: string) {
  return fieldDefs?.find((f: any) => f?.key === apiKey);
}
