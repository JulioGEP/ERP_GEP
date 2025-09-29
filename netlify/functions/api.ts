// netlify/functions/api.ts
// Endpoints:
//   - GET  /.netlify/functions/api/health
//   - POST /.netlify/functions/api/deals/import  { federalNumber: string }

type HandlerEvent = {
  httpMethod: string;
  rawUrl: string;
  body: string | null;
};
type HandlerResponse = { statusCode: number; headers?: Record<string, string>; body: string };
type AnyInit = any;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN?.trim() || "";
const HOSTS = ["https://api.pipedrive.com/v1", "https://api-eu.pipedrive.com/v1"]; // fallback EU

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: JSON_HEADERS, body: "" };

  try {
    const url = new URL(event.rawUrl);
    const pathname = url.pathname.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api/, "");

    if (pathname === "/health") {
      return json(200, {
        ok: true,
        env: {
          pipedrive_api_token: PIPEDRIVE_API_TOKEN ? "present" : "missing",
          database_url: DB.SAFE ? "present" : "missing",
          database_url_sanitized: DB.MASKED || null,
        },
        path: url.pathname,
      });
    }

    if (pathname === "/deals/import") {
      if (event.httpMethod !== "POST") return methodNotAllowed();
      if (!event.body) return badRequest("Body vacío");

      let payload: any;
      try { payload = JSON.parse(event.body); } catch { return badRequest("JSON inválido"); }

      const federalNumber = String(payload?.federalNumber || "").trim();
      if (!federalNumber) return badRequest("federalNumber requerido");
      if (!PIPEDRIVE_API_TOKEN) return badRequest("PIPEDRIVE_API_TOKEN no definido");

      const detail = await fetchPipedriveJSON(`/deals/${encodeURIComponent(federalNumber)}`);
      if (!detail.ok) {
        // Diagnóstico claro para ti
        return json(502, { error: "pipedrive_upstream_failed", attempts: detail.attempts });
      }

      const d = detail.json?.data || {};
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
              email: Array.isArray(d?.person?.email) ? onlyStrings(d.person.email).at(0) ?? null : d?.person?.email ?? null,
            }
          : null,
      };

      await upsertOrgAndDeal(normalized);

      return json(200, {
        deal_id: normalized.deal_id,
        title: normalized.title,
        value: normalized.value ?? null,
        currency: normalized.currency ?? null,
        org_name: normalized.org?.name ?? null,
        person_name: normalized.person?.name ?? null,
        person_email: normalized.person?.email ?? null,
        host_used: detail.hostUsed,
      });
    }

    return notFound("Ruta no encontrada");
  } catch (err: any) {
    console.error("[api] ERROR:", err);
    return json(500, { error: String(err?.message || err) });
  }
};

// ---------- Pipedrive: intenta varios hosts y devuelve JSON o diagnóstico ----------
async function fetchPipedriveJSON(path: string, init?: AnyInit): Promise<{
  ok: boolean;
  hostUsed?: string;
  json?: any;
  attempts: Array<{ host: string; status: number; statusText: string; url: string; bodySnippet: string; contentType: string | null }>;
}> {
  const attempts: Array<{ host: string; status: number; statusText: string; url: string; bodySnippet: string; contentType: string | null }> = [];
  for (const host of HOSTS) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${host}${path}${sep}api_token=${encodeURIComponent(PIPEDRIVE_API_TOKEN)}`;
    try {
      const res = await fetch(url, {
        ...init,
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers || {}) },
        redirect: "follow",
      });
      const text = await res.text().catch(() => "");
      const ct = res.headers.get("content-type");
      const masked = url.replace(/(api_token=)[^&]+/i, "$1***");
      const bodySnippet = (text || "").replace(/\s+/g, " ").trim().slice(0, 800);
      attempts.push({ host, status: res.status, statusText: res.statusText, url: masked, bodySnippet, contentType: ct });

      if (res.ok && ct && ct.toLowerCase().includes("application/json")) {
        try {
          const json = JSON.parse(text);
          return { ok: true, hostUsed: host, json, attempts };
        } catch {
          // sigue al siguiente host
        }
      }
    } catch (e: any) {
      attempts.push({ host, status: 0, statusText: String(e?.message || e), url: url.replace(/(api_token=)[^&]+/i, "$1***"), bodySnippet: "", contentType: null });
      // sigue al siguiente host
    }
  }
  return { ok: false, attempts };
}

// ---------- DB (Neon) con URL saneada ----------
function sanitizeDbUrl(raw?: string) {
  if (!raw) return { url: "", masked: "", safe: false };
  let fixed = raw.trim().replace(/^postgres:\/\//i, "postgresql://");
  try {
    const u = new URL(fixed);
    u.searchParams.delete("channel_binding");
    if (!u.searchParams.get("sslmode")) u.searchParams.set("sslmode", "require");
    fixed = u.toString();
    const masked = u.password ? fixed.replace(u.password, "***") : fixed;
    return { url: fixed, masked, safe: true };
  } catch {
    if (!/[?&]sslmode=/.test(fixed)) fixed += (fixed.includes("?") ? "&" : "?") + "sslmode=require";
    return { url: fixed, masked: fixed.replace(/(:\/\/[^:]+:)[^@]+(@)/, "$1***$2"), safe: true };
  }
}
const DB = (() => { const s = sanitizeDbUrl(process.env.DATABASE_URL); return { URL: s.url, MASKED: s.masked, SAFE: s.safe }; })();

import { neon } from "@neondatabase/serverless";
async function withDb<T>(fn: (sql: any) => Promise<T>): Promise<T> {
  if (!DB.SAFE || !DB.URL) throw new Error("DATABASE_URL no definido o inválido");
  const sql: any = neon(DB.URL);
  return fn(sql);
}

// ---------- Tipos ----------
type DealNormalized = {
  deal_id: number;
  title: string;
  value?: number | null;
  currency?: string | null;
  add_time?: string | null;
  org?: { org_id: number; name?: string | null } | null;
  person?: { person_id: number; name?: string | null; email?: string | null } | null;
};

// ---------- Helpers HTTP ----------
function json(statusCode: number, data: unknown): HandlerResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(data) };
}
function badRequest(msg: string): HandlerResponse { return json(400, { error: msg }); }
function notFound(msg: string): HandlerResponse { return json(404, { error: msg }); }
function methodNotAllowed(): HandlerResponse { return { statusCode: 405, headers: JSON_HEADERS, body: "" }; }
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
