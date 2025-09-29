const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const COMMON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

let sqlClient;

function getSqlClient() {
  if (!sqlClient) {
    const { DATABASE_URL } = process.env;
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not configured');
    }
    sqlClient = neon(DATABASE_URL);
  }
  return sqlClient;
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: COMMON_HEADERS, body: JSON.stringify(body) };
}

function sanitizeHtml(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function normalizeJsonArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [];
}

function mapDealRecord(record) {
  const training = normalizeJsonArray(record.training);
  const prodExtra = normalizeJsonArray(record.prodExtra);
  const documents = Array.isArray(record.documents) ? record.documents : [];
  const notes = Array.isArray(record.notes) ? record.notes : [];
  const trainingNames = training
    .map((product) => (product && typeof product.name === 'string' ? product.name : null))
    .filter(Boolean);
  const extraNames = prodExtra
    .map((product) => (product && typeof product.name === 'string' ? product.name : null))
    .filter(Boolean);

  return {
    deal_id: record.id,
    deal_org_id: record.organizationId,
    organization_name: record.organization?.name ?? 'Organización sin nombre',
    title: record.title,
    training_type: record.trainingType ?? null,
    training,
    training_names: trainingNames,
    hours: record.hours,
    deal_direction: record.direction ?? null,
    sede: record.sede ?? null,
    caes: record.caes ?? null,
    fundae: record.fundae ?? null,
    hotel_night: record.hotelNight ?? null,
    prod_extra: prodExtra,
    prod_extra_names: extraNames,
    documents_num: record.documentsNum ?? documents.length,
    documents_id: documents.map((doc) => doc.id),
    documents: documents.map((doc) => doc.title),
    notes_count: record.notesNum ?? notes.length,
    notes: notes.map((note) => sanitizeHtml(note.comment) ?? note.comment),
    created_at: record.createdAt?.toISOString?.() ?? record.createdAt,
    updated_at: record.updatedAt?.toISOString?.() ?? record.updatedAt
  };
}

async function fetchDeals({ noSessions, requestId }) {
  const sql = getSqlClient();

  const noSessionsFilter = noSessions
    ? sql`WHERE NOT EXISTS (SELECT 1 FROM "Session" s WHERE s."dealId" = d.id)`
    : sql``;

  try {
    const rows = await sql`
      SELECT
        d.id,
        d."organizationId"          AS organization_id,
        o.name                       AS organization_name,
        d.title,
        d."trainingType"            AS training_type,
        d.hours,
        d.direction,
        d.sede,
        d.caes,
        d.fundae,
        d."hotelNight"              AS hotel_night,
        d.training,
        d."prodExtra"               AS prod_extra,
        d."documentsNum"            AS documents_num,
        d."notesNum"                AS notes_num,
        d."createdAt"               AS created_at,
        d."updatedAt"               AS updated_at
      FROM "Deal" d
      LEFT JOIN "Organization" o ON o.id = d."organizationId"
      ${noSessionsFilter}
      ORDER BY d."createdAt" DESC NULLS LAST
    `;

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id ?? null,
      organization: row.organization_name ? { name: row.organization_name } : null,
      title: row.title,
      trainingType: row.training_type ?? null,
      hours: row.hours ?? null,
      direction: row.direction ?? null,
      sede: row.sede ?? null,
      caes: row.caes ?? null,
      fundae: row.fundae ?? null,
      hotelNight: row.hotel_night ?? null,
      training: row.training ?? [],
      prodExtra: row.prod_extra ?? [],
      documentsNum: row.documents_num ?? 0,
      notesNum: row.notes_num ?? 0,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
      documents: [],
      notes: []
    }));
  } catch (error) {
    console.warn(`[${requestId}] falling back to legacy deals query`, error);
  }

  try {
    const rows = await sql`
      SELECT
        d.deal_id AS id,
        d.org_id  AS organization_id,
        o.name    AS organization_name,
        d.title,
        d.value,
        d.currency
      FROM deals d
      LEFT JOIN organizations o ON o.org_id = d.org_id
      ORDER BY d.deal_id DESC
    `;

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id ?? null,
      organization: row.organization_name ? { name: row.organization_name } : null,
      title: row.title,
      trainingType: null,
      hours: null,
      direction: null,
      sede: null,
      caes: null,
      fundae: null,
      hotelNight: null,
      training: [],
      prodExtra: [],
      documentsNum: 0,
      notesNum: 0,
      createdAt: null,
      updatedAt: null,
      documents: [],
      notes: []
    }));
  } catch (error) {
    console.error(`[${requestId}] legacy deals query failed`, error);
    throw error;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  const requestId = crypto.randomUUID();

  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { error: 'method_not_allowed', message: 'Método no permitido' });
    }

    const noSessionsRaw = event.queryStringParameters?.noSessions ?? event.queryStringParameters?.no_sessions;
    const noSessions = typeof noSessionsRaw === 'string' ? noSessionsRaw.toLowerCase() === 'true' : false;

    const deals = await fetchDeals({ noSessions, requestId });

    const payload = deals.map(mapDealRecord);

    return jsonResponse(200, {
      ok: true,
      requestId,
      count: payload.length,
      deals: payload
    });
  } catch (error) {
    console.error(`[${requestId}] deals list error`, error);
    return jsonResponse(500, {
      error: 'unexpected_error',
      message: error instanceof Error ? error.message : 'Error inesperado',
      requestId
    });
  }
};
