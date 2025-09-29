const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { buildDealPayloadFromRecord } = require('./_shared/dealPayload');
const { getPrisma } = require('./_shared/prisma');

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

function mapDealRecord(row) {
  const organization =
    row.organization_name || row.organization_cif || row.organization_phone || row.organization_address
      ? {
          name: row.organization_name ?? 'Organización sin nombre',
          cif: row.organization_cif ?? null,
          phone: row.organization_phone ?? null,
          address: row.organization_address ?? null
        }
      : row.organization_name
        ? { name: row.organization_name }
        : null;

  return buildDealPayloadFromRecord({
    id: row.id,
    organizationId: row.organization_id ?? null,
    organization,
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
    notes: [],
    participants: []
  });
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
        o.cif                        AS organization_cif,
        o.phone                      AS organization_phone,
        o.address                    AS organization_address,
        d.title,
        d."trainingType"            AS training_type,
        d.hours,
        d.direction                  AS direction,
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

    return rows.map(mapDealRecord);
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

    return rows.map((row) =>
      buildDealPayloadFromRecord({
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
        notes: [],
        participants: []
      })
    );
  } catch (error) {
    console.error(`[${requestId}] legacy deals query failed`, error);
    throw error;
  }
}

function extractDealIdFromPath(path) {
  if (!path) return null;
  const normalized = path.split('?')[0].replace(/\/$/, '');
  const match = normalized.match(/\/deals\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function fetchDealDetail(dealId, requestId) {
  const prisma = getPrisma();

  const record = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      organization: true,
      notes: true,
      documents: true,
      participants: { include: { person: true } }
    }
  });

  if (!record) {
    return null;
  }

  return buildDealPayloadFromRecord(record);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  const requestId = crypto.randomUUID();

  try {
    if (event.httpMethod !== 'GET') {
      return errorResponse({
        statusCode: 405,
        errorCode: 'METHOD_NOT_ALLOWED',
        message: 'Método no permitido',
        requestId
      });
    }

    const dealIdFromPath = extractDealIdFromPath(event.path);
    if (dealIdFromPath) {
      const dealId = Number(dealIdFromPath);
      if (!Number.isFinite(dealId)) {
        return errorResponse({
          statusCode: 400,
          errorCode: 'VALIDATION_ERROR',
          message: 'dealId debe ser numérico',
          requestId
        });
      }

      const detail = await fetchDealDetail(dealId, requestId);
      if (!detail) {
        return errorResponse({
          statusCode: 404,
          errorCode: 'DEAL_NOT_FOUND',
          message: 'No se ha encontrado el presupuesto solicitado.',
          requestId
        });
      }

      return successResponse({
        requestId,
        deal_id: String(dealId),
        deal: detail
      });
    }

    const noSessionsRaw = event.queryStringParameters?.noSessions ?? event.queryStringParameters?.no_sessions;
    const noSessions = typeof noSessionsRaw === 'string' ? noSessionsRaw.toLowerCase() === 'true' : false;

    const deals = await fetchDeals({ noSessions, requestId });

    return successResponse({
      requestId,
      count: deals.length,
      deals
    });
  } catch (error) {
    console.error(`[${requestId}] deals handler error`, error);
    return errorResponse({
      statusCode: 500,
      errorCode: 'UNEXPECTED_ERROR',
      message: error instanceof Error ? error.message : 'Error inesperado',
      requestId
    });
  }
};
