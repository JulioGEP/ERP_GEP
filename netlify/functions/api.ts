// netlify/functions/api.ts
// Netlify Function única que atiende /api/*
// - POST /deals/import  { federalNumber: string }

type HandlerEvent = {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  path: string;
  rawUrl: string;
  body: string | null;
};

type HandlerResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PIPEDRIVE_BASE_URL =
  process.env.PIPEDRIVE_BASE_URL?.trim() || "https://api.pipedrive.com/v1";
const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN?.trim() || "";
const DATABASE_URL = process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

function json(statusCode: number, data: unknown): HandlerResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(data) };
}

function badRequest(msg: string): HandlerResponse {
  return json(400, { error: msg });
}

function notFound(msg: string): HandlerResponse {
  return json(404, { error: msg });
}

function methodNotAllowed(): HandlerResponse {
  return { statusCode: 405, headers: JSON_HEADERS, body: "" };
}

async function fetchPipedrive(path: string, init?: RequestInit) {
  const url = new URL(path, PIPEDRIVE_BASE_URL);
  url.searchParams.set("api_token", PIPEDRIVE_API_TOKEN);
  const res = await fetch(url.toString(), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pipedrive ${res.status} ${res.statusText} -> ${text}`);
  }
  return res.json();
}

// --- DB (Neon) -----------------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";

async function withDb<T>(fn: (sql: ReturnType<typeof neon>) => Promise<T>): Promise<T> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL no definido");
  const sql = neon(DATABASE_URL);
  return fn(sql);
}

// Crea tablas mínimas si no existen (puedes perfeccionarlas con tus migraciones)
async function ensureSchema() {
  return withDb(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS organizations (
        org_id BIGINT PRIMARY KEY,
        name TEXT,
        cif TEXT,
        telf_org TEXT,
        address TEXT
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS deals (
        deal_id BIGINT PRIMARY KEY,
        deal_org_id BIGINT REFERENCES organizations(org_id),
        title TEXT,
        training_type BIGINT,
        hours TEXT,
        deal_direction TEXT,
        sede TEXT,
        caes TEXT,
        fundae TEXT,
        hotel_night TEXT,
        alumnos INTEGER,
        training TEXT,         -- nombres de productos form- concatenados
        prod_extra TEXT,       -- otros productos
        seassons_num INTEGER,
        seassons_id TEXT,
        documents_num INTEGER,
        documents_id TEXT
      );
    `;
  });
}

type DealNormalized = {
  deal_id: number;
  title: string;
  org: { org_id: number; name?: string | null };
  sede?: string | null;
  training: string[]; // sólo productos form-
};

function onlyStrings(a: any[]): string[] {
  return a.filter((x) => typeof x === "string") as string[];
}

async function upsertOrgAndDeal(normal: DealNormalized, extra: Record<string, any>) {
  await withDb(async (sql) => {
    // Org
    if (normal.org?.org_id) {
      await sql`
        INSERT INTO organizations (org_id, name)
        VALUES (${normal.org.org_id}, ${normal.org.name || null})
        ON CONFLICT (org_id) DO UPDATE SET name = EXCLUDED.name;
      `;
    }
    // Deal
    await sql`
      INSERT INTO deals (deal_id, deal_org_id, title, training_type, hours, deal_direction, sede, caes, fundae, hotel_night,
                         alumnos, training, prod_extra, seassons_num, seassons_id, documents_num, documents_id)
      VALUES (
        ${normal.deal_id},
        ${normal.org?.org_id || null},
        ${normal.title || null},
        ${extra.pipeline_id || null},
        ${extra.hours || null},
        ${extra.deal_direction || null},
        ${normal.sede || null},
        ${extra.caes || null},
        ${extra.fundae || null},
        ${extra.hotel_night || null},
        ${extra.alumnos || null},
        ${normal.training.join(", ") || null},
        ${extra.prod_extra || null},
        ${extra.seassons_num || null},
        ${extra.seassons_id || null},
        ${extra.documents_num || null},
        ${extra.documents_id || null}
      )
      ON CONFLICT (deal_id) DO UPDATE SET
        deal_org_id = EXCLUDED.deal_org_id,
        title = EXCLUDED.title,
        training_type = EXCLUDED.training_type,
        hours = EXCLUDED.hours,
        deal_direction = EXCLUDED.deal_direction,
        sede = EXCLUDED.sede,
        caes = EXCLUDED.caes,
        fundae = EXCLUDED.fundae,
        hotel_night = EXCLUDED.hotel_night,
        alumnos = EXCLUDED.alumnos,
        training = EXCLUDED.training,
        prod_extra = EXCLUDED.prod_extra,
        seassons_num = EXCLUDED.seassons_num,
        seassons_id = EXCLUDED.seassons_id,
        documents_num = EXCLUDED.documents_num,
        documents_id = EXCLUDED.documents_id;
    `;
  });
}

// --- Normalización mínima desde Pipedrive ---------------------------------------------------------
async function importDealByFederal(federalNumber: string): Promise<DealNormalized> {
  if (!PIPEDRIVE_API_TOKEN) {
    throw new Error("PIPEDRIVE_API_TOKEN no definido");
  }
  // 1) Deal base
  const deal = await fetchPipedrive(`/deals/${encodeURIComponent(federalNumber)}`);
  const d = deal?.data;
  if (!d) throw new Error("Deal no encontrado");

  // 2) Org
  let org: { org_id: number; name?: string | null } | null = null;
  if (d.org_id) {
    // org_id puede venir como objeto {value, name} o número según SDK/respuesta
    const oid = typeof d.org_id === "object" ? d.org_id.value : d.org_id;
    const oname = typeof d.org_id === "object" ? d.org_id.name : undefined;
    org = { org_id: Number(oid), name: oname ?? null };
  }

  // 3) Productos del deal (para training y prod_extra)
  const prodsRes = await fetchPipedrive(`/deals/${encodeURIComponent(federalNumber)}/products`);
  const products: any[] = prodsRes?.data || [];
  const training = products
    .filter((p) => {
      const code = p?.code || p?.product?.code;
      return typeof code === "string" && code.startsWith("form-");
    })
    .map((p) => p?.name || p?.product?.name)
    .filter(Boolean);

  // 4) Campos personalizados
  const sede = d["676d6bd51e52999c582c01f67c99a35ed30bf6ae"] || null; // Sede (texto)
  const extra = {
    pipeline_id: d?.pipeline_id ?? null,
    hours: d["38f11c8876ecde803a027fbf3c9041fda2ae7eb7"] ?? null,
    deal_direction: d["8b2a7570f5ba8aa4754f061cd9dc92fd778376a7"] ?? null,
    caes: d["e1971bf3a21d48737b682bf8d864ddc5eb15a351"] ?? null,
    fundae: d["245d60d4d18aec40ba888998ef92e5d00e494583"] ?? null,
    hotel_night: d["c3a6daf8eb5b4e59c3c07cda8e01f43439101269"] ?? null,
    alumnos: null, // editable desde front
    // prod_extra: productos cuyo code NO empieza por form-
    prod_extra: onlyStrings(
      products
        .filter((p) => {
          const code = p?.code || p?.product?.code;
          return !(typeof code === "string" && code.startsWith("form-"));
        })
        .map((p) => p?.name || p?.product?.name)
        .filter(Boolean)
    ).join(", "),
    // placeholders de sesiones y docs: puedes calcularlos desde productos/cantidades y /files si quieres
    seassons_num: null,
    seassons_id: null,
    documents_num: null,
    documents_id: null,
  };

  const normal: DealNormalized = {
    deal_id: Number(d.id),
    title: d.title || "",
    org: org || { org_id: 0 },
    sede,
    training: training as string[],
  };

  // 5) Upsert en DB
  await ensureSchema();
  await upsertOrgAndDeal(normal, extra);

  return normal;
}

// --- Router ---------------------------------------------------------------------------------------
export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: JSON_HEADERS, body: "" };
    }

    const path = event.path || "";

    if (path.endsWith("/api/deals/import")) {
      if (event.httpMethod !== "POST") return methodNotAllowed();
      if (!event.body) return badRequest("Body vacío");
      let payload: any;
      try {
        payload = JSON.parse(event.body);
      } catch {
        return badRequest("JSON inválido");
      }
      const federalNumber = String(payload?.federalNumber || "").trim();
      if (!federalNumber) return badRequest("federalNumber requerido");

      const data = await importDealByFederal(federalNumber);
      return json(200, data);
    }

    return notFound("Ruta no encontrada");
  } catch (err: any) {
    console.error(err);
    return json(500, { error: String(err?.message || err) });
  }
};
