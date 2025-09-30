// netlify/functions/deals_import.js
// Importación robusta: rellena created_at/updated_at cuando existan y evita Prisma.upsert.
// Hace cast seguro y es tolerante con esquemas existentes.

const crypto = require('crypto');
const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { requireEnv } = require('./_shared/env');
const { neon } = require('@neondatabase/serverless');

// Helpers
function readDealId(event) {
  const qs = event.queryStringParameters || {};
  if (qs.dealId) return String(qs.dealId).trim();
  if (qs.federalNumber) return String(qs.federalNumber).trim();

  const raw = event.body || '';
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  if (ct.includes('application/json')) {
    try {
      const data = JSON.parse(raw);
      const id = data?.dealId ?? data?.federalNumber;
      if (id) return String(id).trim();
    } catch {}
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const id = params.get('dealId') || params.get('federalNumber');
    if (id) return String(id).trim();
  }
  return null;
}

function pipedriveBase() {
  return process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
}

async function fetchJson(url) {
  const res = await fetch(url, { method: 'GET' });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Solo se permite POST', 405);
  }

  const requestId = crypto.randomUUID();
  console.time(`[${requestId}] deals_import`);

  try {
    const DATABASE_URL = requireEnv('DATABASE_URL');
    const PIPEDRIVE_API_TOKEN = requireEnv('PIPEDRIVE_API_TOKEN');

    const dealId = readDealId(event);
    if (!dealId) return errorResponse('VALIDATION_ERROR', 'Falta dealId', 400);

    // 1) Pipedrive: deal
    const base = pipedriveBase();
    const dealRes = await fetchJson(`${base}/deals/${encodeURIComponent(dealId)}?api_token=${encodeURIComponent(PIPEDRIVE_API_TOKEN)}`);
    if (!dealRes.ok || !dealRes.data?.data) {
      return errorResponse('PIPEDRIVE_NOT_FOUND', `No se encontró el deal ${dealId} en Pipedrive`, 404);
    }
    const deal = dealRes.data.data;

    // 2) org_id (puede venir objeto o id)
    const orgIdRaw =
      (deal.org_id && typeof deal.org_id === 'object' ? deal.org_id.value : deal.org_id) ??
      deal.orgId ?? null;
    const orgId = orgIdRaw != null ? String(orgIdRaw) : null;

    let orgName = 'Organización sin nombre';
    if (orgId) {
      const orgRes = await fetchJson(`${base}/organizations/${encodeURIComponent(orgId)}?api_token=${encodeURIComponent(PIPEDRIVE_API_TOKEN)}`);
      if (orgRes.ok && orgRes.data?.data?.name) {
        orgName = String(orgRes.data.data.name);
      }
    }

    const title = (deal.title && String(deal.title).trim()) || `Presupuesto ${dealId}`;

    // 3) Persistencia (tolerante a esquema): rellenamos created_at/updated_at si existen
    const sql = neon(DATABASE_URL);

    // Garantizamos tablas mínimas (si no existían)
    await sql`CREATE TABLE IF NOT EXISTS organizations (org_id TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMPTZ DEFAULT now() NOT NULL, updated_at TIMESTAMPTZ DEFAULT now() NOT NULL);`;
    await sql`CREATE TABLE IF NOT EXISTS deals (deal_id TEXT PRIMARY KEY, title TEXT, org_id TEXT, created_at TIMESTAMPTZ DEFAULT now() NOT NULL, updated_at TIMESTAMPTZ DEFAULT now() NOT NULL);`;

    // Detectamos columnas reales (por si tu esquema ya existía con otros tipos)
    const orgCols = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'organizations'
    `;
    const orgHasCreated = orgCols.some(c => String(c.column_name) === 'created_at');
    const orgHasUpdated = orgCols.some(c => String(c.column_name) === 'updated_at');

    const dealCols = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'deals'
    `;
    const dealHasCreated = dealCols.some(c => String(c.column_name) === 'created_at');
    const dealHasUpdated = dealCols.some(c => String(c.column_name) === 'updated_at');
    const dealHasOrgId   = dealCols.some(c => String(c.column_name) === 'org_id');
    const dealHasTitle   = dealCols.some(c => String(c.column_name) === 'title');

    // ORGANIZATION upsert
    if (orgId) {
      if (orgHasCreated && orgHasUpdated) {
        await sql`
          INSERT INTO organizations (org_id, name, created_at, updated_at)
          VALUES (${orgId}, ${orgName}, now(), now())
          ON CONFLICT (org_id) DO UPDATE
          SET name = EXCLUDED.name,
              updated_at = now()
        `;
      } else if (orgHasUpdated) {
        await sql`
          INSERT INTO organizations (org_id, name, updated_at)
          VALUES (${orgId}, ${orgName}, now())
          ON CONFLICT (org_id) DO UPDATE
          SET name = EXCLUDED.name,
              updated_at = now()
        `;
      } else {
        await sql`
          INSERT INTO organizations (org_id, name)
          VALUES (${orgId}, ${orgName})
          ON CONFLICT (org_id) DO UPDATE
          SET name = EXCLUDED.name
        `;
      }
    }

    // DEAL upsert
    if (dealHasCreated && dealHasUpdated && dealHasOrgId && dealHasTitle) {
      await sql`
        INSERT INTO deals (deal_id, title, org_id, created_at, updated_at)
        VALUES (${String(dealId)}, ${title}, ${orgId}, now(), now())
        ON CONFLICT (deal_id) DO UPDATE
        SET title = EXCLUDED.title,
            org_id = EXCLUDED.org_id,
            updated_at = now()
      `;
    } else if (dealHasUpdated && dealHasOrgId && dealHasTitle) {
      await sql`
        INSERT INTO deals (deal_id, title, org_id, updated_at)
        VALUES (${String(dealId)}, ${title}, ${orgId}, now())
        ON CONFLICT (deal_id) DO UPDATE
        SET title = EXCLUDED.title,
            org_id = EXCLUDED.org_id,
            updated_at = now()
      `;
    } else if (dealHasOrgId && dealHasTitle) {
      await sql`
        INSERT INTO deals (deal_id, title, org_id)
        VALUES (${String(dealId)}, ${title}, ${orgId})
        ON CONFLICT (deal_id) DO UPDATE
        SET title = EXCLUDED.title,
            org_id = EXCLUDED.org_id
      `;
    } else if (dealHasTitle) {
      await sql`
        INSERT INTO deals (deal_id, title)
        VALUES (${String(dealId)}, ${title})
        ON CONFLICT (deal_id) DO UPDATE
        SET title = EXCLUDED.title
      `;
    } else {
      await sql`
        INSERT INTO deals (deal_id)
        VALUES (${String(dealId)})
        ON CONFLICT (deal_id) DO NOTHING
      `;
    }

    return successResponse({ ok: true, deal_id: String(dealId) }, 200);
  } catch (err) {
    return errorResponse(err.code || 'UNEXPECTED_ERROR', err.message || 'Error inesperado', 500);
  } finally {
    console.timeEnd(`[${requestId}] deals_import`);
  }
};
