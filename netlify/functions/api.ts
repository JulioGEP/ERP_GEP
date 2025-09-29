// netlify/functions/api.ts
// Rutas:
//  - GET  /api/health
//  - POST /api/deals/import  { federalNumber: string }

type HandlerEvent = {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  path: string;
  rawUrl: string;
  body: string | null;
};
type HandlerResponse = { statusCode: number; headers?: Record<string, string>; body: string };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }

  try {
    // OJO: cuando se invoca como /.netlify/functions/api/* no hay prefijo /api en pathname.
    const url = new URL(event.rawUrl);
    const pathname = url.pathname
      .replace(/^\/\.netlify\/functions\/api/, "") // invocación directa a la Function
      .replace(/^\/api/, "");                      // invocación vía redirect

    if (isPath(pathname, "/health")) {
      return json(200, {
        ok: true,
        env: {
          pipedrive_base_url_used: PIPEDRIVE_BASE_URL,
          pipedrive_api_token: PIPEDRIVE_API_TOKEN ? "present" : "missing",
          database_url: DATABASE_URL ? "present" : "missing"
        },
        path: pathname
      });
    }

    if (isPath(pathname, "/deals/import")) {
      if (event.httpMethod !== "POST") return methodNotAllowed();
      if (!event.body) return badRequest("Body vacío");

      let payload: any;
      try { payload = JSON.parse(event.body); }
      catch { return badRequest("JSON inválido"); }

      const federalNumber = String(payload?.federalNumber || "").trim();
      if (!federalNumber) return badRequest("federalNumber requerido");

      const data = await importDealByFederal(federalNumber);
      return json(200, data);
    }

    return notFound("Ruta no encontrada");
  } catch (err: any) {
    console.error("[api] ERROR:", err);
    return json(500, { error: String(err?.message || err) });
  }
};

// ---------- Helpers HTTP ----------
function json(statusCode: number, data: unknown): HandlerResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(data) };
}
function badRequest(msg: string): HandlerResponse { return json(400, { error: msg }); }
function notFound(msg: string): HandlerResponse { return json(404, { error: msg }); }
function methodNotAllowed(): HandlerResponse { return { statusCode: 405, headers: JSON_HEADERS, body: "" }; }
function isPath(pathname: string, expected: string): boolean {
  const a = pathname.replace(/\/+$/, ""); const b = expected.replace(/\/+$/, ""); return a === b;
}

// ---------- Pipedrive (FORZAMOS HOST OFICIAL) ----------
function normalizePipedriveBaseUrl(input?: string): string {
  // Usamos SIEMPRE el host oficial para evitar redirecciones HTML.
  // Si algún día necesitas dominio empresa, cámbialo aquí.
  return "https://api.pipedrive.com/v1";
}
const PIPEDRIVE_BASE_URL = normalizePipedriveBaseUrl(process.env.PIPEDRIVE_BASE_URL);
const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN?.trim() || "";
const DATABASE_URL = process.env.DATABASE_URL?.trim() || "";

/**
 * Hace fetch a Pipedrive y SIEMPRE lee texto; intenta parsear JSON.
 * Si recibe HTML u otro formato, lanza error con snippet y URL desensibilizada.
 */
async function fetchPipedrive(path: string, init?: RequestInit) {
  if (!PIPEDRIVE_API_TOKEN) throw new Error("PIPEDRIVE_API_TOKEN no definido");

  const sep = path.includes("?") ? "&" : "?";
  const fullUrl = `${PIPEDRIVE_BASE_URL}${path}${sep}api_token=${encodeURIComponent(PIPEDRIVE_API_TOKEN)}`;

  const res = await fetch(fullUrl, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers || {}) }
  });

  const text = await res.text().catch(() => "");
  // Si no OK, devolvemos el texto (suele venir JSON con 'error', pero si es HTML lo verás)
  if (!res.ok) {
    throw new Error(`Pipedrive ${res.status} ${res.statusText} -> ${snippet(text)} :: url=${maskToken(fullUrl)}`);
  }

  // OK pero intentamos parsear JSON; si es HTML, lanzamos error claro
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respuesta no-JSON de Pipedrive (posible HTML/redirect). url=${maskToken(fullUrl)} :: body=${snippet(text)}`);
  }
}

function maskToken(u: string): string {
  return u.replace(/(api_token=)[^&]+/i, "$1***");
}
function snippet(s: string): string {
  const t = (s || "").trim().replace(/\s+/g, " ");
  return t.slice(0, 180);
}

// ---------- DB (Neon) ----------
import { neon } from "@neondatabase/serverless";
async function withDb<T>(fn: (sql: any) => Promise<T>): Promise<T> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL no definido");
  const sql: any = neon(DATABASE_URL);
  return fn(sql);
}

// ---------- Tipos mínimos ----------
type DealNormalized = {
  deal_id: number;
  title: string;
  value?: number | null;
  currency?: string | null;
  add_time?: string | null;
  org?: { org_id: number; name?: string | null } | null;
  person?: { person_id: number; name?: string | null; email?: string | null } | null;
};
type DealSummary = {
  deal_id: number;
  title: string;
  value?: number | null;
  currency?: string | null;
  org_name?: string | null;
  person_name?: string | null;
  person_email?: string | null;
};

// ---------- Lógica principal ----------
async function importDealByFederal(federalNumber: string): Promise<DealSummary> {
  const id = Number(federalNumber);
  if (!Number.isFinite(id)) throw new Error("federalNumber debe ser numérico");

  const detail = await fetchPipedrive(`/deals/${id}`);
  const d = detail?.data || {};

  const normalized: DealNormalized = {
    deal_id: d.id,
    title: d.title,
    value: d.value ?? null,
    currency: d.currency ?? null,
    add_time: d.add_time ?? null,
    org: d.org_id ? { org_id: d.org_id, name: d.org_name ?? null } : null,
    person: d.person_id
      ? {
          person_id: d.person_id,
          name: d.person_name ?? null,
          email: Array.isArray(d?.person?.email) ? onlyStrings(d.person.email).at(0) ?? null : d?.person?.email ?? null
        }
      : null
  };

  await upsertOrgAndDeal(normalized);

  return {
    deal_id: normalized.deal_id,
    title: normalized.title,
    value: normalized.value ?? null,
    currency: normalized.currency ?? null,
    org_name: normalized.org?.name ?? null,
    person_name: normalized.person?.name ?? null,
    person_email: normalized.person?.email ?? null
  };
}

function onlyStrings(a: any[]): string[] { return a.filter((x) => typeof x === "string") as string[]; }

async function upsertOrgAndDeal(normal: DealNormalized) {
  await withDb(async (sql) => {
    if (normal.org?.org_id) {
      await sql`
        INSERT INTO organizations (org_id, name)
        VALUES (${normal.org.org_id}, ${normal.org.name || null})
        ON CONFLICT (org_id) DO UPDATE SET name = EXCLUDED.name;
      `;
    }
    await sql`
      INSERT INTO deals (deal_id, title, value, currency, org_id)
      VALUES (${normal.deal_id}, ${normal.title}, ${normal.value || null}, ${normal.currency || null}, ${normal.org?.org_id || null})
      ON CONFLICT (deal_id) DO UPDATE
      SET title = EXCLUDED.title,
          value = EXCLUDED.value,
          currency = EXCLUDED.currency,
          org_id = EXCLUDED.org_id;
    `;
  });
}
